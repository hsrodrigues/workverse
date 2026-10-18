import type { FastifyInstance } from 'fastify';
import { authenticate, type AuthDeps } from './authRoutes';
import { normalizeEmail } from './auth';
import { can } from './authz';
import { normalizeName } from './world';
import { parseUnlockKey, setUnlock } from './wardrobe';
import type { Account } from './store';

/**
 * POST /api/admin/unlocks { accountId | email, key, revoke? }
 * Grants (or revokes) an avatar unlock key. The caller must be an owner/admin (`can(..., 'member.invite')`) of an
 * organization in which the target account is also an active member; nothing is read from the body except who and which key.
 */
export function registerAdminRoutes(app: FastifyInstance, deps: AuthDeps) {
  const devLogin = deps.allowDevLogin && !deps.secureCookies;
  const err = (reply: import('fastify').FastifyReply, status: number, code: string, message: string) => reply.code(status).send({ error: { code, message } });

  function identify(headers: Record<string, unknown>): Account | undefined {
    const fromCookie = authenticate(deps, headers.cookie as string | undefined)?.account;
    if (fromCookie) return fromCookie;
    if (!devLogin) return undefined;
    const name = typeof headers['x-dev-name'] === 'string' ? normalizeName(headers['x-dev-name']) : null;
    const account = name ? deps.store.getByName(name) : undefined;
    return account && account.passwordHash === '' ? account : undefined;
  }

  app.post('/api/admin/unlocks', { bodyLimit: 1024 }, async (req, reply) => {
    if (deps.allowedOrigins.length > 0 && !deps.allowedOrigins.includes(String(req.headers.origin ?? ''))) {
      return err(reply, 403, 'forbidden_origin', 'Origem não permitida.');
    }
    const caller = identify(req.headers);
    if (!caller) return err(reply, 401, 'unauthorized', 'Faça login para continuar.');
    const body = (typeof req.body === 'object' && req.body !== null ? req.body : {}) as Record<string, unknown>;
    const key = parseUnlockKey(body.key);
    if (!key.ok) return err(reply, 400, 'bad_key', key.message);
    let target: Account | undefined;
    if (typeof body.accountId === 'string') target = deps.store.getById(body.accountId);
    else if (typeof body.email === 'string') target = deps.store.getByEmail(normalizeEmail(body.email) ?? '');
    if (!target) return err(reply, 404, 'not_found', 'Conta não encontrada.');

    const svc = deps.world.orgService;
    const targetOrgs = new Set(svc.activeMemberships(target.id).map((m) => m.orgId));
    const allowed = svc.activeMemberships(caller.id).some((m) => {
      const actor = svc.actorFor(caller.id, m.orgId);
      return !!actor && targetOrgs.has(m.orgId) && can(actor, 'member.invite', { orgId: m.orgId, newRole: 'member' }).allow;
    });
    if (!allowed) return err(reply, 403, 'forbidden', 'Apenas administradores da organização da pessoa podem conceder itens.');

    const revoke = body.revoke === true;
    const changed = setUnlock(deps.store, target, key.key, !revoke);
    return { ok: true, changed, unlocks: target.unlocks ?? [] };
  });
}
