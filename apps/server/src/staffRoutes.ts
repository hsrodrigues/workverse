import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { MAX_STAFF_REASON, isStaffLevel, staffCan, type ApiErrorBody, type AuditRecord, type StaffAction, type StaffLevel } from '@workverse/shared';
import { authenticate, type AuthDeps } from './authRoutes';
import { KeyedLimiter } from './limiter';
import { cleanChat } from './room';
import { accountDetail, accountRow, addStaff, banAccount, createAccount, findAccount, removeStaff, resetPassword, saveDept, setDisabled, setMemberProfile, setStaffLevel, staffRow, unbanAccount, type Actor, type AdminCtx } from './staffAdmin';
import type { Result } from './org';
import type { Account } from './store';
import { isBanned, isDisabled } from './accountState';

/**
 * API de administracao da plataforma: /api/staff/*. Cada rota passa por `gate()`:
 *   sessao valida -> conta staff -> EM SERVICO (jogador online com o servico ligado, como no painel) -> nivel minimo -> taxa.
 * Escritas ja passam pela checagem de Origin do hook global (CSRF). Corpo estrito (campo desconhecido = 400), tudo
 * auditado por `world.staff.record`. O e-mail completo so sai para staff admin; DMs e midia privada nunca passam por aqui.
 */

const BODY_LIMIT = 2048;
const MAX_ID = 64;
const MAX_Q = 64;

function fail(reply: FastifyReply, status: number, code: string, message: string, retryAfterSeconds?: number) {
  if (retryAfterSeconds !== undefined) void reply.header('Retry-After', String(retryAfterSeconds));
  const body: ApiErrorBody = { error: { code, message, ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}) } };
  return reply.code(status).send(body);
}

/** Corpo precisa ser um objeto simples com SOMENTE as chaves esperadas. */
function strict(body: unknown, allowed: readonly string[]): Record<string, unknown> | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;
  for (const k of Object.keys(body)) if (!allowed.includes(k)) return null;
  return body as Record<string, unknown>;
}

const str = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max;

/** Celula de CSV: aspas dobradas e prefixo contra injecao de formula (=, +, -, @) em planilhas. */
export function csvCell(v: string | number | undefined | null): string {
  let s = v === undefined || v === null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

export function auditCsv(rows: AuditRecord[]): string {
  const head = ['data_hora_utc', 'ator', 'nivel', 'acao', 'alvo', 'detalhe', 'id_ator', 'id_alvo'].map(csvCell).join(',');
  const lines = rows.map((r) =>
    [new Date(r.at).toISOString(), r.actor, r.level ?? '', r.action, r.target ?? '', r.detail ?? '', r.actorId, r.targetId ?? ''].map(csvCell).join(','),
  );
  // BOM para o Excel abrir os acentos corretamente.
  return `﻿${[head, ...lines].join('\r\n')}\r\n`;
}

export function registerStaffRoutes(app: FastifyInstance, deps: AuthDeps) {
  const { store, world, clock } = deps;
  const ctx: AdminCtx = { store, world, clock };
  const readLimiter = new KeyedLimiter(40, 4);
  const writeLimiter = new KeyedLimiter(15, 1);

  function noStore(reply: FastifyReply) {
    void reply.header('Cache-Control', 'no-store');
  }

  /** Autentica e confere o poder; ja responde o erro (e registra a negativa) quando nao passa. */
  function gate(req: FastifyRequest, reply: FastifyReply, action: StaffAction, write: boolean): Actor | null {
    noStore(reply);
    const auth = authenticate(deps, req.headers.cookie);
    if (!auth) {
      void fail(reply, 401, 'unauthorized', 'Sessão inválida ou expirada.');
      return null;
    }
    const account = auth.account;
    const deny = (reason: string) => {
      world.staff.deniedHttp(account, action, reason);
      void fail(reply, 403, 'forbidden', 'Você não tem permissão para isso.');
      return null;
    };
    const level: StaffLevel | null = isStaffLevel(account.staff) ? account.staff : null;
    if (!level) return deny('not_staff');
    const player = world.findPlayerByAccount(account.id);
    if (!player || !player.onDuty) {
      void fail(reply, 403, 'off_duty', 'Você precisa estar em serviço (entre no escritório e ligue o serviço) para usar o painel.');
      return null;
    }
    if (!staffCan(level, action)) return deny('level');
    const limiter = write ? writeLimiter : readLimiter;
    if (!limiter.take(`${account.id}`, clock())) {
      void fail(reply, 429, 'rate_limited', 'Calma! Muitas ações de staff seguidas.', 2);
      return null;
    }
    return { account, level };
  }

  const idParam = (req: FastifyRequest): string | null => {
    const id = (req.params as { id?: unknown }).id;
    return str(id, MAX_ID) && id.length > 0 ? id : null;
  };

  function target(req: FastifyRequest, reply: FastifyReply): Account | null {
    const id = idParam(req);
    const acc = id ? store.getById(id) : undefined;
    if (!acc) {
      void fail(reply, 404, 'not_found', 'Conta não encontrada.');
      return null;
    }
    return acc;
  }

  const send = <T>(reply: FastifyReply, r: Result<T>, ok: (v: T) => unknown, status = 200) =>
    r.ok ? reply.code(status).send(ok(r.value)) : fail(reply, r.status, r.code, r.message);

  const reasonOf = (v: unknown): string => (typeof v === 'string' ? cleanChat(v).slice(0, MAX_STAFF_REASON) : '');

  /** Organizacoes e equipes (so nomes/ids), para o formulario de criacao de conta. */
  app.get('/api/staff/orgs', async (req, reply) => {
    const actor = gate(req, reply, 'accounts.view', false);
    if (!actor) return;
    return {
      orgs: store.orgs.listOrgs().map((o) => ({ id: o.id, name: o.name, teams: store.orgs.teamsOf(o.id).map((t) => ({ id: t.id, name: t.name, color: t.color })) })),
    };
  });

  // ---- contas ---------------------------------------------------------------------------------------------

  app.get('/api/staff/accounts', async (req, reply) => {
    const actor = gate(req, reply, 'accounts.view', false);
    if (!actor) return;
    const q = req.query as Record<string, unknown>;
    const search = typeof q.q === 'string' ? q.q.normalize('NFKC').trim().toLowerCase() : '';
    const filter = typeof q.filter === 'string' ? q.filter : 'all';
    if (search.length > MAX_Q || !['all', 'staff', 'online', 'blocked'].includes(filter)) return fail(reply, 400, 'bad_request', 'Consulta inválida.');
    const now = clock();
    const rows = store
      .listAccounts()
      .filter((a) => {
        if (filter === 'staff' && !isStaffLevel(a.staff)) return false;
        if (filter === 'online' && !world.findPlayerByAccount(a.id)) return false;
        if (filter === 'blocked' && !(isDisabled(a) || isBanned(a, now))) return false;
        // E-mail so entra na busca para quem o ve inteiro (senao daria para "descobrir" o e-mail por tentativa).
        return !search || a.displayName.toLowerCase().includes(search) || (actor.level === 'admin' && a.email.includes(search));
      })
      .sort((a, b) => a.displayName.localeCompare(b.displayName, 'pt-BR'));
    return { total: rows.length, accounts: rows.slice(0, 100).map((a) => accountRow(ctx, a, actor.level)) };
  });

  app.get('/api/staff/accounts/:id', async (req, reply) => {
    const actor = gate(req, reply, 'accounts.view', false);
    if (!actor) return;
    const acc = target(req, reply);
    if (!acc) return;
    world.staff.record({ id: actor.account.id, name: actor.account.displayName, level: actor.level }, 'account.view', { id: acc.id, name: acc.displayName });
    return { account: accountDetail(ctx, acc, actor.level) };
  });

  app.post('/api/staff/accounts', { bodyLimit: BODY_LIMIT }, async (req, reply) => {
    const actor = gate(req, reply, 'accounts.create', true);
    if (!actor) return;
    const b = strict(req.body, ['email', 'displayName', 'password', 'orgId', 'teamId', 'role', 'title']);
    if (!b || !str(b.email, 254) || !str(b.displayName, 64)) return fail(reply, 400, 'bad_request', 'Informe e-mail e nome de exibição.');
    for (const k of ['password', 'orgId', 'teamId', 'role', 'title'] as const) {
      if (b[k] !== undefined && b[k] !== '' && !str(b[k], k === 'password' ? 200 : k === 'title' ? 128 : MAX_ID)) return fail(reply, 400, 'bad_request', 'Campo inválido.');
    }
    const opt = (k: string) => (typeof b[k] === 'string' && b[k] !== '' ? (b[k] as string) : undefined);
    const r = await createAccount(ctx, actor, {
      email: b.email,
      displayName: b.displayName,
      password: opt('password'),
      orgId: opt('orgId'),
      teamId: opt('teamId'),
      role: opt('role'),
      title: opt('title'),
    });
    return send(reply, r, (v) => ({ account: accountRow(ctx, v.account, actor.level), provisionalPassword: v.provisionalPassword }), 201);
  });

  /** Cargo e/ou setor de uma pessoa numa organizacao. */
  app.patch('/api/staff/accounts/:id/profile', { bodyLimit: BODY_LIMIT }, async (req, reply) => {
    const actor = gate(req, reply, 'accounts.profile', true);
    if (!actor) return;
    const acc = target(req, reply);
    if (!acc) return;
    const b = strict(req.body, ['orgId', 'teamId', 'title']);
    if (!b || !str(b.orgId, MAX_ID) || (b.teamId !== undefined && !str(b.teamId, MAX_ID)) || (b.title !== undefined && b.title !== null && !str(b.title, 128))) return fail(reply, 400, 'bad_request', 'Requisição inválida.');
    return send(reply, setMemberProfile(ctx, actor, acc, { orgId: b.orgId, teamId: b.teamId as string | undefined, title: b.title as string | null | undefined }), (v) => v);
  });

  // ---- setores ----------------------------------------------------------------------------------------------

  app.post('/api/staff/orgs/:orgId/depts', { bodyLimit: BODY_LIMIT }, async (req, reply) => {
    const actor = gate(req, reply, 'dept.manage', true);
    if (!actor) return;
    const b = strict(req.body, ['name', 'color']);
    const orgId = (req.params as { orgId?: unknown }).orgId;
    if (!b || !str(orgId, MAX_ID) || !str(b.name, 100) || (b.color !== undefined && !str(b.color, 16))) return fail(reply, 400, 'bad_request', 'Informe o nome e a cor.');
    return send(reply, saveDept(ctx, actor, orgId, null, { name: b.name, color: b.color }), (v) => ({ dept: v }), 201);
  });

  app.patch('/api/staff/orgs/:orgId/depts/:teamId', { bodyLimit: BODY_LIMIT }, async (req, reply) => {
    const actor = gate(req, reply, 'dept.manage', true);
    if (!actor) return;
    const b = strict(req.body, ['name', 'color']);
    const { orgId, teamId } = req.params as { orgId?: unknown; teamId?: unknown };
    if (!b || !str(orgId, MAX_ID) || !str(teamId, MAX_ID) || (b.name !== undefined && !str(b.name, 100)) || (b.color !== undefined && !str(b.color, 16))) return fail(reply, 400, 'bad_request', 'Requisição inválida.');
    return send(reply, saveDept(ctx, actor, orgId, teamId, { name: b.name, color: b.color }), (v) => ({ dept: v }));
  });

  app.post('/api/staff/accounts/:id/reset-password', { bodyLimit: BODY_LIMIT }, async (req, reply) => {
    const actor = gate(req, reply, 'accounts.reset', true);
    if (!actor) return;
    const acc = target(req, reply);
    if (!acc) return;
    const b = strict(req.body ?? {}, ['password']);
    if (!b || (b.password !== undefined && b.password !== '' && !str(b.password, 200))) return fail(reply, 400, 'bad_request', 'Requisição inválida.');
    const r = await resetPassword(ctx, actor, acc, typeof b.password === 'string' && b.password !== '' ? b.password : undefined);
    return send(reply, r, (v) => ({ ok: true, provisionalPassword: v.provisionalPassword }));
  });

  app.patch('/api/staff/accounts/:id', { bodyLimit: BODY_LIMIT }, async (req, reply) => {
    const actor = gate(req, reply, 'accounts.disable', true);
    if (!actor) return;
    const acc = target(req, reply);
    if (!acc) return;
    const b = strict(req.body, ['disabled', 'reason']);
    if (!b || typeof b.disabled !== 'boolean' || (b.reason !== undefined && !str(b.reason, 300))) return fail(reply, 400, 'bad_request', 'Requisição inválida.');
    return send(reply, setDisabled(ctx, actor, acc, b.disabled, reasonOf(b.reason)), (v) => ({ account: accountRow(ctx, v, actor.level) }));
  });

  app.post('/api/staff/accounts/:id/ban', { bodyLimit: BODY_LIMIT }, async (req, reply) => {
    const actor = gate(req, reply, 'ban', true);
    if (!actor) return;
    const acc = target(req, reply);
    if (!acc) return;
    const b = strict(req.body, ['minutes', 'reason']);
    const minutes = b?.minutes;
    if (!b || !str(b.reason, 300) || (minutes !== null && !(typeof minutes === 'number' && Number.isInteger(minutes) && minutes >= 1 && minutes <= 3_650 * 1440))) {
      return fail(reply, 400, 'bad_request', 'Informe o motivo e a duração em minutos (ou null para permanente).');
    }
    return send(reply, banAccount(ctx, actor, acc, minutes as number | null, reasonOf(b.reason)), (v) => ({ account: accountRow(ctx, v, actor.level) }));
  });

  app.post('/api/staff/accounts/:id/unban', { bodyLimit: BODY_LIMIT }, async (req, reply) => {
    const actor = gate(req, reply, 'unban', true);
    if (!actor) return;
    const acc = target(req, reply);
    if (!acc) return;
    if (!strict(req.body ?? {}, [])) return fail(reply, 400, 'bad_request', 'Requisição inválida.');
    return send(reply, unbanAccount(ctx, actor, acc), (v) => ({ account: accountRow(ctx, v, actor.level) }));
  });

  // ---- equipe de staff ------------------------------------------------------------------------------------

  app.get('/api/staff/team', async (req, reply) => {
    const actor = gate(req, reply, 'accounts.view', false);
    if (!actor) return;
    const staff = store
      .listAccounts()
      .filter((a) => isStaffLevel(a.staff))
      .sort((a, b) => a.displayName.localeCompare(b.displayName, 'pt-BR'));
    return { staff: staff.map((a) => staffRow(ctx, a, actor.level)) };
  });

  app.post('/api/staff/team', { bodyLimit: BODY_LIMIT }, async (req, reply) => {
    const actor = gate(req, reply, 'staff.manage', true);
    if (!actor) return;
    const b = strict(req.body, ['identifier', 'level']);
    if (!b || !str(b.identifier, 254) || !isStaffLevel(b.level)) return fail(reply, 400, 'bad_request', 'Informe o e-mail ou nome e o nível.');
    const acc = findAccount(store, b.identifier);
    if (!acc) return fail(reply, 404, 'not_found', 'Conta não encontrada.');
    return send(reply, addStaff(ctx, actor, acc, b.level), (v) => ({ member: staffRow(ctx, v, actor.level) }), 201);
  });

  app.patch('/api/staff/team/:id', { bodyLimit: BODY_LIMIT }, async (req, reply) => {
    const actor = gate(req, reply, 'staff.manage', true);
    if (!actor) return;
    const acc = target(req, reply);
    if (!acc) return;
    const b = strict(req.body, ['level']);
    if (!b || !isStaffLevel(b.level)) return fail(reply, 400, 'bad_request', 'Nível inválido.');
    return send(reply, setStaffLevel(ctx, actor, acc, b.level), (v) => ({ member: staffRow(ctx, v, actor.level) }));
  });

  app.delete('/api/staff/team/:id', async (req, reply) => {
    const actor = gate(req, reply, 'staff.manage', true);
    if (!actor) return;
    const acc = target(req, reply);
    if (!acc) return;
    return send(reply, removeStaff(ctx, actor, acc), () => ({ ok: true }));
  });

  // ---- auditoria ------------------------------------------------------------------------------------------

  const auditQuery = (req: FastifyRequest, reply: FastifyReply, limitMax: number) => {
    const q = req.query as Record<string, unknown>;
    const text = (v: unknown) => (typeof v === 'string' && v.length <= MAX_Q ? v : v === undefined ? undefined : null);
    const num = (v: unknown) => {
      if (v === undefined || v === '') return undefined;
      const n = Number(v);
      return Number.isFinite(n) && n >= 0 && n < 8.64e15 ? n : null;
    };
    const actor = text(q.actor);
    const targetQ = text(q.target);
    const action = text(q.action);
    const from = num(q.from);
    const to = num(q.to);
    const limit = num(q.limit);
    if (actor === null || targetQ === null || action === null || from === null || to === null || limit === null) {
      void fail(reply, 400, 'bad_request', 'Filtro inválido.');
      return null;
    }
    return { actor: actor || undefined, target: targetQ || undefined, action: action || undefined, from, to, limit: Math.min(limit ?? 200, limitMax) };
  };

  app.get('/api/staff/audit', async (req, reply) => {
    const actor = gate(req, reply, 'audit.read', false);
    if (!actor) return;
    const f = auditQuery(req, reply, 500);
    if (!f) return;
    return { records: store.queryAudit(f) };
  });

  app.get('/api/staff/audit.csv', async (req, reply) => {
    const actor = gate(req, reply, 'audit.read', true);
    if (!actor) return;
    const f = auditQuery(req, reply, 10_000);
    if (!f) return;
    const rows = store.queryAudit({ ...f, limit: f.limit ?? 10_000 });
    world.staff.record({ id: actor.account.id, name: actor.account.displayName, level: actor.level }, 'audit.export', null, `${rows.length} registros`);
    void reply.header('Content-Type', 'text/csv; charset=utf-8');
    void reply.header('Content-Disposition', 'attachment; filename="auditoria-staff.csv"');
    return auditCsv(rows);
  });

  /** Historico de avisos (qualquer staff em servico): so os registros `announce.*`. */
  app.get('/api/staff/announcements', async (req, reply) => {
    const actor = gate(req, reply, 'list', false);
    if (!actor) return;
    return { records: store.queryAudit({ action: 'announce', limit: 50 }) };
  });
}
