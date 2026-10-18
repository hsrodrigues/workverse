import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { MAX_NAME_LENGTH, MIN_NAME_LENGTH, MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH, type AccountView, type ApiErrorBody, type ServerConfig } from '@workverse/shared';
import {
  SESSION_COOKIE,
  SESSION_TTL_MS,
  MAX_SESSIONS_PER_ACCOUNT,
  AuthGuard,
  checkPassword,
  clearedSessionCookie,
  fakeVerify,
  hashPassword,
  hashToken,
  needsRehash,
  newSessionToken,
  normalizeEmail,
  parseCookies,
  sessionCookie,
  verifyPassword,
} from './auth';
import { DuplicateAccountError, type Account, type AccountStore } from './store';
import { isReservedName, normalizeName, type World } from './world';
import { registrationGate, type RegistrationMode } from './registration';
import { accessBlock } from './accountState';

/** Requests to `/api/*` never need more than a few hundred bytes. */
const BODY_LIMIT = 2048;
const GENERIC_LOGIN_ERROR = 'E-mail ou senha incorretos.';

export interface AuthInfo {
  account: Account;
  sessionHash: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthInfo | null;
  }
}

export interface AuthDeps {
  store: AccountStore;
  world: World;
  guard: AuthGuard;
  clock: () => number;
  secureCookies: boolean;
  allowDevLogin: boolean;
  allowedOrigins: string[];
  /** REGISTRATION_MODE (padrao 'open' quando ausente, ex.: testes). */
  registrationMode?: RegistrationMode;
}

export const toView = (a: Account): AccountView => ({ id: a.id, email: a.email, displayName: a.displayName, avatar: a.avatar, ...(a.mustChangePassword ? { mustChangePassword: true } : {}) });

function fail(reply: FastifyReply, status: number, code: string, message: string, retryAfterSeconds?: number) {
  if (retryAfterSeconds !== undefined) void reply.header('Retry-After', String(retryAfterSeconds));
  const body: ApiErrorBody = { error: { code, message, ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}) } };
  return reply.code(status).send(body);
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Resolves the session cookie to an account; expired sessions are removed on sight. */
export function authenticate(deps: Pick<AuthDeps, 'store' | 'clock'>, cookieHeader: string | undefined): AuthInfo | null {
  const token = parseCookies(cookieHeader)[SESSION_COOKIE];
  if (!token || token.length > 128) return null;
  const sessionHash = hashToken(token);
  const session = deps.store.getSession(sessionHash);
  if (!session) return null;
  if (session.expiresAt <= deps.clock()) {
    deps.store.deleteSession(sessionHash);
    return null;
  }
  const account = deps.store.getById(session.accountId);
  // Conta banida / desativada por staff: a sessao deixa de valer na hora (HTTP e WebSocket).
  if (account && accessBlock(account, deps.clock())) return null;
  return account ? { account, sessionHash } : null;
}

/**
 * Origin policy shared by every state-changing HTTP route and by the WebSocket upgrade.
 *  - allow-list configured (ALLOWED_ORIGINS / PUBLIC_URL): the Origin header must be on it (a missing one is refused);
 *  - no allow-list in production: same-origin only (a present Origin must have the Host the request came to);
 *  - no allow-list in development: anything goes (Vite on :5173 talks to :3001).
 * The session cookie is SameSite=Strict as well, so this is the second layer, not the only one.
 */
export function originAllowed(headers: { origin?: string; host?: string }, deps: Pick<AuthDeps, 'allowedOrigins' | 'secureCookies'>): boolean {
  const origin = headers.origin;
  if (deps.allowedOrigins.length > 0) return typeof origin === 'string' && deps.allowedOrigins.includes(origin);
  if (!deps.secureCookies) return true;
  // Browsers always send Origin on writes and on WebSocket upgrades; no Origin means a non-browser client, which has no ambient cookie to abuse.
  if (typeof origin !== 'string') return true;
  if (typeof headers.host !== 'string') return false;
  try {
    return new URL(origin).hostname === new URL(`http://${headers.host}`).hostname;
  } catch {
    return false;
  }
}

const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function registerAuthRoutes(app: FastifyInstance, deps: AuthDeps) {
  const { store, world, guard, clock } = deps;
  app.decorateRequest('auth', null);

  // CSRF / cross-site writes: EVERY mutating /api route is covered here, including ones added later.
  app.addHook('onRequest', async (req, reply) => {
    if (!STATE_CHANGING.has(req.method) || !req.url.startsWith('/api/')) return;
    if (!originAllowed(req.headers, deps)) return fail(reply, 403, 'forbidden_origin', 'Origem não permitida.');
  });

  const checkOrigin = async (req: FastifyRequest, reply: FastifyReply) => {
    if (!originAllowed(req.headers, deps)) return fail(reply, 403, 'forbidden_origin', 'Origem não permitida.');
  };

  /**
   * New random token on every login/registration (the client never chooses it: no session fixation). The cookie the
   * browser presented, if any, is revoked (and its live socket closed) and an account keeps at most N sessions.
   */
  const startSession = (req: FastifyRequest, reply: FastifyReply, account: Account) => {
    const previous = authenticate(deps, req.headers.cookie);
    if (previous) {
      store.deleteSession(previous.sessionHash);
      world.kick(previous.account.id, 'signed_out', 'Sessão substituída por um novo login.', previous.sessionHash);
    }
    const token = newSessionToken();
    const now = clock();
    store.deleteExpiredSessions(now);
    store.createSession({ tokenHash: hashToken(token), accountId: account.id, createdAt: now, expiresAt: now + SESSION_TTL_MS });
    store.trimSessionsOf(account.id, MAX_SESSIONS_PER_ACCOUNT);
    void reply.header('Set-Cookie', sessionCookie(token, deps.secureCookies));
  };

  const noStore = (reply: FastifyReply) => void reply.header('Cache-Control', 'no-store');

  app.get('/api/config', async (_req, reply): Promise<ServerConfig> => {
    noStore(reply);
    return { devLogin: deps.allowDevLogin, registration: deps.registrationMode ?? 'open' };
  });

  app.get('/api/me', async (req, reply) => {
    noStore(reply);
    const auth = authenticate(deps, req.headers.cookie);
    if (!auth) return fail(reply, 401, 'unauthorized', 'Sessão inválida ou expirada.');
    return { account: toView(auth.account) };
  });

  app.post('/api/register', { bodyLimit: BODY_LIMIT, preHandler: checkOrigin }, async (req, reply) => {
    noStore(reply);
    const body = (typeof req.body === 'object' && req.body !== null ? req.body : {}) as Record<string, unknown>;
    const email = normalizeEmail(body.email);
    const throttle = guard.checkRegister(req.ip, email ?? '');
    if (!throttle.ok) return fail(reply, 429, 'rate_limited', 'Muitas tentativas. Aguarde um pouco e tente de novo.', throttle.retryAfterSeconds);

    // REGISTRATION_MODE: invite exige convite, closed bloqueia (ver registration.ts).
    const gate = registrationGate(deps.registrationMode ?? 'open', {
      inviteToken: typeof body.inviteToken === 'string' && body.inviteToken !== '' ? body.inviteToken : null,
    });
    if (!gate.ok) return fail(reply, gate.status, gate.code, gate.message);

    if (!email) return fail(reply, 400, 'invalid_email', 'Informe um e-mail válido.');
    const problem = checkPassword(body.password, { email, name: typeof body.displayName === 'string' ? body.displayName : undefined });
    if (problem === 'too_short') return fail(reply, 400, 'weak_password', `A senha precisa ter pelo menos ${MIN_PASSWORD_LENGTH} caracteres.`);
    if (problem === 'too_common') return fail(reply, 400, 'weak_password', 'Essa senha é muito comum ou previsível. Escolha outra (uma frase longa funciona bem).');
    if (problem) return fail(reply, 400, 'weak_password', `A senha pode ter no máximo ${MAX_PASSWORD_LENGTH} caracteres.`);
    const displayName = normalizeName(body.displayName);
    if (displayName && isReservedName(displayName)) return fail(reply, 400, 'bad_name', 'Esse nome é reservado. Escolha outro.');
    if (!displayName) {
      return fail(reply, 400, 'bad_name', `O nome deve ter de ${MIN_NAME_LENGTH} a ${MAX_NAME_LENGTH} letras, números, espaço, _ ou -.`);
    }
    // Optional invite: validated before the account exists so a bad link does not leave a half-registered account.
    const inviteToken = typeof body.inviteToken === 'string' && body.inviteToken !== '' ? body.inviteToken : null;
    if (body.inviteToken !== undefined && body.inviteToken !== null && body.inviteToken !== '' && inviteToken === null) {
      return fail(reply, 400, 'invite_not_found', 'Convite não encontrado.');
    }
    if (inviteToken) {
      const check = world.orgService.checkInvite(inviteToken, email);
      if (!check.ok) return fail(reply, check.status, check.code, check.message);
    }
    // Registration cannot hide that an e-mail is taken without e-mail verification (see README).
    if (store.getByEmail(email)) return fail(reply, 409, 'email_taken', 'Este e-mail já está cadastrado.');
    if (store.getByName(displayName)) return fail(reply, 409, 'name_taken', 'Esse nome já está em uso por outra pessoa.');

    const passwordHash = await hashPassword(body.password as string);
    let account: Account;
    try {
      account = store.create({ email, displayName, passwordHash });
    } catch (err) {
      if (err instanceof DuplicateAccountError) {
        return err.field === 'email'
          ? fail(reply, 409, 'email_taken', 'Este e-mail já está cadastrado.')
          : fail(reply, 409, 'name_taken', 'Esse nome já está em uso por outra pessoa.');
      }
      throw err;
    }
    // With an invite the account joins THAT organization (and not the default one); without, the default org.
    if (!inviteToken || !world.orgService.acceptInvite(inviteToken, account).ok) world.orgService.ensureMembership(account);
    startSession(req, reply, account);
    app.log.info({ event: 'account.register', account: account.id }, 'audit');
    return reply.code(201).send({ account: toView(account) });
  });

  app.post('/api/login', { bodyLimit: BODY_LIMIT, preHandler: checkOrigin }, async (req, reply) => {
    noStore(reply);
    const body = (typeof req.body === 'object' && req.body !== null ? req.body : {}) as Record<string, unknown>;
    const email = normalizeEmail(body.email);
    const password = typeof body.password === 'string' && body.password.length <= 1024 ? body.password : null;
    if (password === null || typeof body.email !== 'string') return fail(reply, 400, 'bad_request', 'Informe e-mail e senha.');
    // A malformed e-mail is throttled under its raw lowercase form so it still counts against the limits.
    const key = email ?? body.email.slice(0, 254).toLowerCase();

    const throttle = guard.checkLogin(req.ip, key);
    if (!throttle.ok) return fail(reply, 429, 'rate_limited', 'Muitas tentativas. Aguarde um pouco e tente de novo.', throttle.retryAfterSeconds);

    const account = email ? store.getByEmail(email) : undefined;
    let ok = false;
    if (account && account.passwordHash) ok = await verifyPassword(password, account.passwordHash);
    else await fakeVerify(password);

    if (!ok || !account) {
      guard.loginFailed(req.ip, key);
      app.log.info({ event: 'login.failed', ip: req.ip }, 'audit');
      if (guard.limits.failDelayMs > 0) await sleep(guard.limits.failDelayMs);
      return fail(reply, 401, 'invalid_credentials', GENERIC_LOGIN_ERROR);
    }
    guard.loginSucceeded(req.ip, key);
    // Banida / desativada por staff: a senha estava certa, entao a pessoa pode saber o motivo; nenhuma sessao e criada.
    const block = accessBlock(account, clock());
    if (block) return fail(reply, 403, `account_${block.code}`, block.message);
    account.lastLoginAt = clock();
    store.save(account);
    // Hash made with weaker scrypt parameters than today's: upgrade it now that we hold the plaintext.
    if (needsRehash(account.passwordHash)) {
      account.passwordHash = await hashPassword(password);
      store.save(account);
    }
    startSession(req, reply, account);
    app.log.info({ event: 'login.ok', account: account.id }, 'audit');
    return { account: toView(account) };
  });

  app.post('/api/logout', { bodyLimit: BODY_LIMIT, preHandler: checkOrigin }, async (req, reply) => {
    noStore(reply);
    const auth = authenticate(deps, req.headers.cookie);
    if (auth) {
      store.deleteSession(auth.sessionHash);
      world.kick(auth.account.id, 'signed_out', 'Você saiu da conta.', auth.sessionHash);
    }
    void reply.header('Set-Cookie', clearedSessionCookie(deps.secureCookies));
    return reply.code(204).send();
  });
}
