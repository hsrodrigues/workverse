import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ApiErrorBody, InviteView, MemberView, OrgsMeResponse, TeamView } from '@workverse/shared';
import { DEFAULT_ORG_ID } from '@workverse/shared';
import { authenticate, type AuthDeps } from './authRoutes';
import { normalizeEmail } from './auth';
import { can, NO_ORG, type Actor } from './authz';
import { KeyedLimiter } from './limiter';
import { reasonText, summaryOf, type Result } from './org';
import type { Invite } from './orgStore';
import type { Account } from './store';
import { normalizeName } from './world';

const BODY_LIMIT = 2048;

export interface OrgRouteOptions {
  /** Invite creation per account: burst and refill per second. */
  inviteLimit?: { capacity: number; refillPerSecond: number };
  /** Public invite endpoints (preview / accept) per IP. */
  publicLimit?: { capacity: number; refillPerSecond: number };
  /** Organization creation per account. */
  createLimit?: { capacity: number; refillPerSecond: number };
}

function fail(reply: FastifyReply, status: number, code: string, message: string, retryAfterSeconds?: number) {
  if (retryAfterSeconds !== undefined) void reply.header('Retry-After', String(retryAfterSeconds));
  const body: ApiErrorBody = { error: { code, message, ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}) } };
  return reply.code(status).send(body);
}

const inviteView = (i: Invite): InviteView => ({
  id: i.id,
  email: i.email,
  role: i.role,
  teamId: i.teamId,
  expiresAt: i.expiresAt,
  maxUses: i.maxUses,
  uses: i.uses,
  revokedAt: i.revokedAt,
  createdBy: i.createdBy,
});

/**
 * Organization API. Isolation rules for every route:
 *  - the caller comes from the session cookie (or X-Dev-Name with ALLOW_DEV_LOGIN, as in the stage routes);
 *  - a route with `:id` resolves the caller's ACTIVE MEMBERSHIP in that org (404 when there is none, so the
 *    existence of other orgs is not revealed) and every sub-resource (team, invite, member) is looked up inside
 *    that org; the orgId is never read from the body;
 *  - the decision is made by `can()`, with the resource's orgId taken from the stored record.
 */
export function registerOrgRoutes(app: FastifyInstance, deps: AuthDeps, opts: OrgRouteOptions = {}) {
  const { world, clock } = deps;
  const svc = world.orgService;
  const inviteLimiter = new KeyedLimiter(opts.inviteLimit?.capacity ?? 10, opts.inviteLimit?.refillPerSecond ?? 0.2);
  const publicLimiter = new KeyedLimiter(opts.publicLimit?.capacity ?? 20, opts.publicLimit?.refillPerSecond ?? 0.5);
  const createLimiter = new KeyedLimiter(opts.createLimit?.capacity ?? 3, opts.createLimit?.refillPerSecond ?? 1 / 60);
  const devLogin = deps.allowDevLogin && !deps.secureCookies;

  function identify(req: FastifyRequest): Account | undefined {
    const fromCookie = authenticate(deps, req.headers.cookie)?.account;
    if (fromCookie) return fromCookie;
    if (!devLogin) return undefined;
    const raw = req.headers['x-dev-name'];
    const name = typeof raw === 'string' ? normalizeName(raw) : null;
    const account = name ? deps.store.getByName(name) : undefined;
    return account && account.passwordHash === '' ? account : undefined;
  }

  const checkOrigin = async (req: FastifyRequest, reply: FastifyReply) => {
    if (deps.allowedOrigins.length === 0) return;
    const origin = req.headers.origin;
    if (!origin || !deps.allowedOrigins.includes(origin)) return fail(reply, 403, 'forbidden_origin', 'Origem não permitida.');
  };

  const bodyOf = (req: FastifyRequest) => (typeof req.body === 'object' && req.body !== null ? req.body : {}) as Record<string, unknown>;

  /** Actor of the caller inside `orgId`, or a 404 already sent. */
  function actorIn(account: Account, orgId: string, reply: FastifyReply): Actor | undefined {
    const actor = svc.actorFor(account.id, orgId);
    if (!actor) void fail(reply, 404, 'not_found', 'Organização não encontrada.');
    return actor;
  }

  const send = <T>(reply: FastifyReply, r: Result<T>, ok: (v: T) => unknown, status = 200) =>
    r.ok ? reply.code(status).send(ok(r.value)) : fail(reply, r.status, r.code, r.message);

  function buildMe(account: Account, requested: unknown): OrgsMeResponse {
    const memberships = svc.activeMemberships(account.id);
    const orgs = memberships.map((m) => summaryOf(svc.store.getOrg(m.orgId)!, m));
    const live = world.findPlayerByAccount(account.id);
    const pick = [requested, live?.orgId, account.lastOrg, DEFAULT_ORG_ID].find((id) => typeof id === 'string' && memberships.some((m) => m.orgId === id));
    const orgId = (pick as string | undefined) ?? memberships[0]?.orgId;
    const summary = orgs.find((o) => o.id === orgId);
    if (!orgId || !summary) return { orgs, active: null };
    const actor = svc.actorFor(account.id, orgId)!;
    const teams: TeamView[] = svc.store.teamsOf(orgId).map((t) => ({ id: t.id, name: t.name, color: t.color }));
    const manages = can(actor, 'member.role.set', { orgId }).allow;
    // Guests only see themselves: the member list of the org is not for outsiders.
    const visible = actor.role === 'guest' ? svc.store.membersOf(orgId).filter((m) => m.accountId === account.id) : svc.store.membersOf(orgId);
    const members: MemberView[] = visible.map((m) => {
      const a = deps.store.getById(m.accountId);
      return {
        accountId: m.accountId,
        displayName: a?.displayName ?? '?',
        ...(manages && a ? { email: a.email } : {}),
        ...(m.title ? { title: m.title } : {}),
        role: m.role,
        teamId: m.teamId,
        status: m.status,
      };
    });
    const invites = can(actor, 'member.invite', { orgId, newRole: 'guest' }).allow ? svc.store.invitesOf(orgId).map(inviteView) : [];
    return { orgs, active: { org: summary, teams, members, invites } };
  }

  // ---- own organizations ---------------------------------------------------------------------------

  app.get('/api/orgs/me', async (req, reply) => {
    void reply.header('Cache-Control', 'no-store');
    const account = identify(req);
    if (!account) return fail(reply, 401, 'unauthorized', 'Sessão inválida ou expirada.');
    svc.ensureMembership(account);
    const q = (req.query as Record<string, unknown> | undefined)?.orgId;
    return buildMe(account, q);
  });

  app.post('/api/orgs', { bodyLimit: BODY_LIMIT, preHandler: checkOrigin }, async (req, reply) => {
    void reply.header('Cache-Control', 'no-store');
    const account = identify(req);
    if (!account) return fail(reply, 401, 'unauthorized', 'Sessão inválida ou expirada.');
    // Creating an organization is the one action without an org yet: the actor is "nobody, nowhere".
    const decision = can({ accountId: account.id, orgId: NO_ORG, role: 'member', teamId: null }, 'org.create', { orgId: NO_ORG });
    if (!decision.allow) return fail(reply, 403, 'forbidden', reasonText(decision.reason));
    if (!createLimiter.take(account.id, clock())) {
      return fail(reply, 429, 'rate_limited', 'Muitas organizações criadas. Aguarde um pouco.', Math.max(1, createLimiter.retryAfterSeconds(account.id, clock())));
    }
    const body = bodyOf(req);
    return send(reply, svc.createOrg(account, body.name, body.slug), ({ org, member }) => ({ org: summaryOf(org, member) }), 201);
  });

  // ---- invites (inside an org) ---------------------------------------------------------------------

  app.post<{ Params: { id: string } }>('/api/orgs/:id/invites', { bodyLimit: BODY_LIMIT, preHandler: checkOrigin }, async (req, reply) => {
    void reply.header('Cache-Control', 'no-store');
    const account = identify(req);
    if (!account) return fail(reply, 401, 'unauthorized', 'Sessão inválida ou expirada.');
    const actor = actorIn(account, req.params.id, reply);
    if (!actor) return;
    if (!inviteLimiter.take(account.id, clock())) {
      return fail(reply, 429, 'rate_limited', 'Muitos convites criados. Aguarde um pouco.', Math.max(1, inviteLimiter.retryAfterSeconds(account.id, clock())));
    }
    const r = svc.createInvite(actor, bodyOf(req), normalizeEmail);
    // The token is returned here, once. Only its hash is stored.
    return send(reply, r, ({ invite, token }) => ({ invite: inviteView(invite), token, path: `/invite/${token}` }), 201);
  });

  app.delete<{ Params: { id: string; inviteId: string } }>('/api/orgs/:id/invites/:inviteId', { preHandler: checkOrigin }, async (req, reply) => {
    void reply.header('Cache-Control', 'no-store');
    const account = identify(req);
    if (!account) return fail(reply, 401, 'unauthorized', 'Sessão inválida ou expirada.');
    const actor = actorIn(account, req.params.id, reply);
    if (!actor) return;
    const r = svc.revokeInvite(actor, req.params.inviteId);
    return r.ok ? reply.code(204).send() : fail(reply, r.status, r.code, r.message);
  });

  // ---- teams and members ---------------------------------------------------------------------------

  app.post<{ Params: { id: string } }>('/api/orgs/:id/teams', { bodyLimit: BODY_LIMIT, preHandler: checkOrigin }, async (req, reply) => {
    void reply.header('Cache-Control', 'no-store');
    const account = identify(req);
    if (!account) return fail(reply, 401, 'unauthorized', 'Sessão inválida ou expirada.');
    const actor = actorIn(account, req.params.id, reply);
    if (!actor) return;
    const body = bodyOf(req);
    return send(reply, svc.createTeam(actor, body.name, body.color), (t): TeamView => ({ id: t.id, name: t.name, color: t.color }), 201);
  });

  /** Renomeia/recolore um setor (permissao `team.manage`); quem esta online ve a etiqueta mudar na hora. */
  app.patch<{ Params: { id: string; teamId: string } }>('/api/orgs/:id/teams/:teamId', { bodyLimit: BODY_LIMIT, preHandler: checkOrigin }, async (req, reply) => {
    void reply.header('Cache-Control', 'no-store');
    const account = identify(req);
    if (!account) return fail(reply, 401, 'unauthorized', 'Sessão inválida ou expirada.');
    const actor = actorIn(account, req.params.id, reply);
    if (!actor) return;
    const body = bodyOf(req);
    const r = svc.updateTeam(actor, req.params.teamId, { ...('name' in body ? { name: body.name } : {}), ...('color' in body ? { color: body.color } : {}) });
    if (r.ok) world.refreshTeam(actor.orgId, r.value.id);
    return send(reply, r, (t): TeamView => ({ id: t.id, name: t.name, color: t.color }));
  });

  app.patch<{ Params: { id: string; accountId: string } }>('/api/orgs/:id/members/:accountId', { bodyLimit: BODY_LIMIT, preHandler: checkOrigin }, async (req, reply) => {
    void reply.header('Cache-Control', 'no-store');
    const account = identify(req);
    if (!account) return fail(reply, 401, 'unauthorized', 'Sessão inválida ou expirada.');
    const actor = actorIn(account, req.params.id, reply);
    if (!actor) return;
    const body = bodyOf(req);
    const r = svc.updateMember(actor, req.params.accountId, {
      ...('role' in body ? { role: body.role } : {}),
      ...('teamId' in body ? { teamId: body.teamId } : {}),
      ...('title' in body ? { title: body.title } : {}),
    });
    if (r.ok) {
      world.refreshMembership(r.value.accountId, actor.orgId);
      world.refreshProfile(r.value.accountId, actor.orgId);
    }
    return send(reply, r, (m): MemberView => ({
      accountId: m.accountId,
      displayName: deps.store.getById(m.accountId)?.displayName ?? '?',
      ...(m.title ? { title: m.title } : {}),
      role: m.role,
      teamId: m.teamId,
      status: m.status,
    }));
  });

  app.delete<{ Params: { id: string; accountId: string } }>('/api/orgs/:id/members/:accountId', { preHandler: checkOrigin }, async (req, reply) => {
    void reply.header('Cache-Control', 'no-store');
    const account = identify(req);
    if (!account) return fail(reply, 401, 'unauthorized', 'Sessão inválida ou expirada.');
    const actor = actorIn(account, req.params.id, reply);
    if (!actor) return;
    const r = svc.removeMember(actor, req.params.accountId);
    if (!r.ok) return fail(reply, r.status, r.code, r.message);
    world.refreshMembership(req.params.accountId, actor.orgId);
    return reply.code(204).send();
  });

  // ---- invite links (token is the credential) ---------------------------------------------------------

  const publicThrottle = (req: FastifyRequest, reply: FastifyReply): boolean => {
    if (publicLimiter.take(req.ip, clock())) return true;
    void fail(reply, 429, 'rate_limited', 'Muitas tentativas. Aguarde um pouco.', Math.max(1, publicLimiter.retryAfterSeconds(req.ip, clock())));
    return false;
  };

  app.get<{ Params: { token: string } }>('/api/invites/:token', async (req, reply) => {
    void reply.header('Cache-Control', 'no-store');
    if (!publicThrottle(req, reply)) return;
    return send(reply, svc.previewInvite(req.params.token), (p) => p);
  });

  app.post<{ Params: { token: string } }>('/api/invites/:token/accept', { bodyLimit: BODY_LIMIT, preHandler: checkOrigin }, async (req, reply) => {
    void reply.header('Cache-Control', 'no-store');
    if (!publicThrottle(req, reply)) return;
    const account = identify(req);
    if (!account) return fail(reply, 401, 'unauthorized', 'Entre ou crie uma conta para aceitar o convite.');
    return send(reply, svc.acceptInvite(req.params.token, account), ({ org, member }) => ({ org: summaryOf(org, member) }), 201);
  });
}
