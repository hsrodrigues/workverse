import { randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH, type ApiErrorBody } from '@workverse/shared';
import { checkPassword, hashPassword, hashToken, normalizeEmail } from './auth';
import { originAllowed, passwordResetEnabled, type AuthDeps } from './authRoutes';
import { accessBlock } from './accountState';
import { maskToken } from './mailer';

/**
 * "Esqueci minha senha" por e-mail (docs/password-reset.md):
 *   POST /api/password/forgot {email}          sempre a mesma resposta; so envia se a conta existe e esta ativa
 *   POST /api/password/reset  {token,password} token de uso unico (so o SHA-256 fica no store), valido por 30 min
 */

const BODY_LIMIT = 1024;
export const RESET_TTL_MS = 30 * 60_000;
export const MAX_PENDING_RESETS = 3;
const FORGOT_MESSAGE = 'Se existir uma conta com esse e-mail, enviamos um link para redefinir a senha. Ele vale por 30 minutos.';
const INVALID_TOKEN = 'Link inválido ou expirado. Peça um novo em "Esqueci minha senha".';
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function fail(reply: FastifyReply, status: number, code: string, message: string, retryAfterSeconds?: number) {
  if (retryAfterSeconds !== undefined) void reply.header('Retry-After', String(retryAfterSeconds));
  const body: ApiErrorBody = { error: { code, message, ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}) } };
  return reply.code(status).send(body);
}

export function registerPasswordReset(app: FastifyInstance, deps: AuthDeps) {
  const { store, world, guard, clock } = deps;
  const checkOrigin = async (req: { headers: { origin?: string; host?: string } }, reply: FastifyReply) => {
    if (!originAllowed(req.headers, deps)) return fail(reply, 403, 'forbidden_origin', 'Origem não permitida.');
  };
  const off = (reply: FastifyReply) => fail(reply, 503, 'reset_disabled', 'A redefinição por e-mail não está disponível. Peça à staff para redefinir sua senha.');
  const minMs = deps.forgotMinMs ?? 400;

  const sendLink = async (account: { id: string; email: string; displayName: string }) => {
    const now = clock();
    const token = randomBytes(32).toString('base64url');
    store.deleteExpiredResetTokens(now);
    store.createResetToken({ tokenHash: hashToken(token), accountId: account.id, createdAt: now, expiresAt: now + RESET_TTL_MS }, MAX_PENDING_RESETS, now);
    const link = `${deps.publicUrl}/?reset=${token}`;
    const text = [
      `Olá, ${account.displayName}!`,
      '',
      'Recebemos um pedido para redefinir a senha da sua conta no WorkVerse. Abra o link abaixo (vale por 30 minutos e só funciona uma vez):',
      '',
      link,
      '',
      'Se não foi você, ignore este e-mail: sua senha continua a mesma.',
      '',
    ].join('\n');
    try {
      await deps.mailer!.send({ to: account.email, subject: 'Redefinir sua senha do WorkVerse', text });
      app.log.info({ event: 'password.reset_sent', account: account.id, token: maskToken(token) }, 'audit');
    } catch (err) {
      // O erro do provedor nao carrega segredos (ver mailer.ts) e o token nunca vai inteiro para o log.
      app.log.warn({ event: 'password.reset_send_failed', account: account.id, reason: (err as Error).message }, 'audit');
    }
  };

  app.post('/api/password/forgot', { bodyLimit: BODY_LIMIT, preHandler: checkOrigin }, async (req, reply) => {
    void reply.header('Cache-Control', 'no-store');
    if (!passwordResetEnabled(deps)) return off(reply);
    const body = (typeof req.body === 'object' && req.body !== null ? req.body : {}) as Record<string, unknown>;
    if (typeof body.email !== 'string') return fail(reply, 400, 'bad_request', 'Informe seu e-mail.');
    const email = normalizeEmail(body.email);
    const key = email ?? body.email.slice(0, 254).toLowerCase();
    const throttle = guard.checkForgot(req.ip, key);
    if (!throttle.ok) return fail(reply, 429, 'rate_limited', 'Muitas tentativas. Aguarde um pouco e tente de novo.', throttle.retryAfterSeconds);

    const started = Date.now();
    const account = email ? store.getByEmail(email) : undefined;
    // So conta ativa, nao banida e com senha (conta de teste sem senha nao recebe link). O resto responde igual, sem enviar.
    if (account && account.passwordHash !== '' && !accessBlock(account, clock())) {
      // Em segundo plano: o tempo do provedor de e-mail nao pode diferenciar "existe" de "nao existe".
      void sendLink(account);
    } else {
      // Fica so no log do servidor (a resposta ao navegador e sempre a mesma): ajuda quem administra a entender "o e-mail nao chegou".
      const reason = !account ? 'sem_conta_com_esse_email' : account.passwordHash === '' ? 'conta_sem_senha' : 'conta_bloqueada_ou_desativada';
      app.log.info({ event: 'password.reset_ignored', reason }, 'audit');
    }
    const wait = minMs - (Date.now() - started);
    if (wait > 0) await sleep(wait);
    return { ok: true, message: FORGOT_MESSAGE };
  });

  app.post('/api/password/reset', { bodyLimit: BODY_LIMIT, preHandler: checkOrigin }, async (req, reply) => {
    void reply.header('Cache-Control', 'no-store');
    if (!passwordResetEnabled(deps)) return off(reply);
    const body = req.body;
    if (typeof body !== 'object' || body === null || Array.isArray(body) || Object.keys(body).some((k) => k !== 'token' && k !== 'password')) {
      return fail(reply, 400, 'bad_request', 'Informe o link e a nova senha.');
    }
    const { token, password } = body as { token?: unknown; password?: unknown };
    if (typeof token !== 'string' || token.length < 16 || token.length > 128 || typeof password !== 'string') {
      return fail(reply, 400, 'bad_request', 'Informe o link e a nova senha.');
    }
    const throttle = guard.checkReset(req.ip);
    if (!throttle.ok) return fail(reply, 429, 'rate_limited', 'Muitas tentativas. Aguarde um pouco e tente de novo.', throttle.retryAfterSeconds);

    const now = clock();
    const hash = hashToken(token);
    const pending = store.getResetToken(hash, now);
    const target = pending ? store.getById(pending.accountId) : undefined;
    if (!pending || !target || accessBlock(target, now)) return fail(reply, 400, 'invalid_token', INVALID_TOKEN);
    // A senha e validada ANTES de gastar o token: uma senha fraca nao obriga a pedir outro link.
    const problem = checkPassword(password, { email: target.email, name: target.displayName });
    if (problem === 'too_short') return fail(reply, 400, 'weak_password', `A senha precisa ter pelo menos ${MIN_PASSWORD_LENGTH} caracteres.`);
    if (problem === 'too_common') return fail(reply, 400, 'weak_password', 'Essa senha é muito comum ou previsível. Escolha outra (uma frase longa funciona bem).');
    if (problem) return fail(reply, 400, 'weak_password', `A senha pode ter no máximo ${MAX_PASSWORD_LENGTH} caracteres.`);

    // Uso unico: consumir e sincrono, entao duas requisicoes simultaneas nunca passam as duas.
    const used = store.consumeResetToken(hash, now);
    if (!used) return fail(reply, 400, 'invalid_token', INVALID_TOKEN);
    const passwordHash = await hashPassword(password);
    const account = store.getById(used.accountId);
    if (!account) return fail(reply, 400, 'invalid_token', INVALID_TOKEN);
    account.passwordHash = passwordHash;
    delete account.mustChangePassword;
    account.passwordChangedAt = clock();
    store.save(account);
    store.deleteSessionsOf(account.id);
    store.deleteResetTokensOf(account.id);
    world.kick(account.id, 'signed_out', 'Sua senha foi redefinida. Entre novamente.');
    store.appendAudit({
      id: randomBytes(8).toString('hex'),
      at: clock(),
      actorId: account.id,
      actor: account.displayName,
      level: null,
      action: 'account.password_reset_email',
      targetId: account.id,
      target: account.displayName,
      detail: 'sessões encerradas',
    });
    app.log.info({ event: 'password.reset_by_email', account: account.id }, 'audit');
    return { ok: true };
  });
}
