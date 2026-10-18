import type { FastifyInstance, FastifyReply } from 'fastify';
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH, type ApiErrorBody } from '@workverse/shared';
import { checkPassword, hashPassword, verifyPassword } from './auth';
import { authenticate, toView, type AuthDeps } from './authRoutes';
import { KeyedLimiter } from './limiter';

/**
 * Troca de senha pela propria pessoa (POST /api/account/password) e a trava da senha provisoria:
 * enquanto `Account.mustChangePassword` existir, so /api/me, /api/config, /api/login, /api/logout e esta rota funcionam
 * (todo o resto de /api/* responde 403 `password_change_required`; o WebSocket recusa o `hello`).
 */

const BODY_LIMIT = 1024;
const OPEN_WHILE_PENDING = new Set(['/api/config', '/api/me', '/api/login', '/api/logout', '/api/account/password']);

function fail(reply: FastifyReply, status: number, code: string, message: string, retryAfterSeconds?: number) {
  if (retryAfterSeconds !== undefined) void reply.header('Retry-After', String(retryAfterSeconds));
  const body: ApiErrorBody = { error: { code, message, ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}) } };
  return reply.code(status).send(body);
}

export function registerPasswordRoutes(app: FastifyInstance, deps: AuthDeps) {
  const { store, world, clock } = deps;
  // Quem erra a senha atual repetidamente (sessao roubada, por exemplo) leva atraso: 5 tentativas e depois 1 por minuto.
  const attempts = new KeyedLimiter(5, 1 / 60);

  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/api/')) return;
    const path = req.url.split('?')[0]!;
    if (OPEN_WHILE_PENDING.has(path)) return;
    const auth = authenticate(deps, req.headers.cookie);
    if (auth?.account.mustChangePassword) return fail(reply, 403, 'password_change_required', 'Troque a senha provisória para continuar.');
  });

  app.post('/api/account/password', { bodyLimit: BODY_LIMIT }, async (req, reply) => {
    void reply.header('Cache-Control', 'no-store');
    const auth = authenticate(deps, req.headers.cookie);
    if (!auth) return fail(reply, 401, 'unauthorized', 'Sessão inválida ou expirada.');
    const account = auth.account;
    const body = req.body;
    if (typeof body !== 'object' || body === null || Array.isArray(body) || Object.keys(body).some((k) => k !== 'current' && k !== 'next')) {
      return fail(reply, 400, 'bad_request', 'Informe a senha atual e a nova.');
    }
    const { current, next } = body as { current?: unknown; next?: unknown };
    if (typeof current !== 'string' || current.length === 0 || current.length > 1024) return fail(reply, 400, 'bad_request', 'Informe a senha atual.');
    if (account.passwordHash === '') return fail(reply, 400, 'no_password', 'Esta conta não usa senha.');

    if (!attempts.take(account.id, clock())) return fail(reply, 429, 'rate_limited', 'Muitas tentativas. Aguarde um pouco e tente de novo.', 60);
    if (!(await verifyPassword(current, account.passwordHash))) {
      app.log.info({ event: 'password.change_failed', account: account.id }, 'audit');
      return fail(reply, 403, 'invalid_credentials', 'A senha atual está incorreta.');
    }
    const problem = checkPassword(next, { email: account.email, name: account.displayName });
    if (problem === 'too_short') return fail(reply, 400, 'weak_password', `A senha precisa ter pelo menos ${MIN_PASSWORD_LENGTH} caracteres.`);
    if (problem === 'too_common') return fail(reply, 400, 'weak_password', 'Essa senha é muito comum ou previsível. Escolha outra (uma frase longa funciona bem).');
    if (problem) return fail(reply, 400, 'weak_password', `A senha pode ter no máximo ${MAX_PASSWORD_LENGTH} caracteres.`);
    if (next === current) return fail(reply, 400, 'same_password', 'A nova senha precisa ser diferente da atual.');

    account.passwordHash = await hashPassword(next as string);
    delete account.mustChangePassword;
    account.passwordChangedAt = clock();
    store.save(account);
    // Revoga todas as outras sessoes (cookies e WebSocket); a atual continua valendo.
    const keep = store.getSession(auth.sessionHash);
    store.deleteSessionsOf(account.id);
    if (keep) store.createSession(keep);
    world.kickOtherSessions(account.id, auth.sessionHash);
    app.log.info({ event: 'password.changed', account: account.id }, 'audit');
    return { account: toView(account) };
  });
}
