import { randomUUID } from 'node:crypto';
import {
  BAN_MAX_MINUTES,
  DEFAULT_DEPT_COLOR,
  cleanDeptName,
  cleanTitle,
  isDeptColor,
  CREATE_ROLE_MAX,
  DEFAULT_ORG_ID,
  DEFAULT_TEAM_ID,
  ROLE_RANK,
  STAFF_RANK,
  isRole,
  isStaffLevel,
  maskEmail,
  type StaffAccountDetail,
  type StaffAccountRow,
  type StaffLevel,
  type StaffMemberRow,
} from '@workverse/shared';
import { accessBlock, isBanned, isDisabled } from './accountState';
import { checkPassword, hashPassword, normalizeEmail } from './auth';
import type { Result } from './org';
import { generateProvisionalPassword } from './provisional';
import { DuplicateAccountError, type Account, type AccountStore } from './store';
import { isReservedName, normalizeName, type World } from './world';

/**
 * Regras de negocio da administracao de contas e da equipe de staff. Sem HTTP aqui: staffRoutes.ts cuida de autenticacao,
 * origem, taxa e validacao de formato; este modulo decide (hierarquia, ultimo admin, efeitos) e executa.
 * Todas as funcoes recebem o ator ja autenticado e com nivel conferido.
 */

export interface AdminCtx {
  store: AccountStore;
  world: World;
  clock: () => number;
}

export interface Actor {
  account: Account;
  level: StaffLevel;
}

const fail = (status: number, code: string, message: string): Result<never> => ({ ok: false, status, code, message });
const ok = <T>(value: T): Result<T> => ({ ok: true, value });

const rank = (a: Pick<Account, 'staff'>) => (isStaffLevel(a.staff) ? STAFF_RANK[a.staff] : 0);

// ---- views -------------------------------------------------------------------------------------------------

function orgOf(ctx: AdminCtx, a: Account): { orgId: string | null; orgName: string | null; role: string | null } {
  const svc = ctx.world.orgService;
  const live = ctx.world.findPlayerByAccount(a.id);
  const ms = svc.activeMemberships(a.id);
  const m = ms.find((x) => x.orgId === live?.orgId) ?? ms.find((x) => x.orgId === a.lastOrg) ?? ms.find((x) => x.orgId === DEFAULT_ORG_ID) ?? ms[0];
  if (!m) return { orgId: null, orgName: null, role: null };
  return { orgId: m.orgId, orgName: ctx.store.orgs.getOrg(m.orgId)?.name ?? m.orgId, role: m.role };
}

/** O e-mail completo so sai para staff admin. */
const emailFor = (viewer: StaffLevel, email: string) => (viewer === 'admin' ? { email, emailMasked: false } : { email: maskEmail(email), emailMasked: true });

export function accountRow(ctx: AdminCtx, a: Account, viewer: StaffLevel): StaffAccountRow {
  const now = ctx.clock();
  return {
    id: a.id,
    displayName: a.displayName,
    ...emailFor(viewer, a.email),
    dev: a.passwordHash === '',
    ...(isStaffLevel(a.staff) ? { staff: a.staff } : {}),
    online: !!ctx.world.findPlayerByAccount(a.id),
    ...orgOf(ctx, a),
    lastLoginAt: a.lastLoginAt ?? null,
    createdAt: a.createdAt,
    disabled: isDisabled(a),
    banned: isBanned(a, now),
    muted: !!a.mute && a.mute.until > now,
    mustChangePassword: a.mustChangePassword === true,
  };
}

export function accountDetail(ctx: AdminCtx, a: Account, viewer: StaffLevel): StaffAccountDetail {
  const now = ctx.clock();
  const memberships = ctx.store.orgs.membershipsOf(a.id).map((m) => ({
    orgId: m.orgId,
    orgName: ctx.store.orgs.getOrg(m.orgId)?.name ?? m.orgId,
    role: m.role,
    team: m.teamId ? (ctx.store.orgs.getTeam(m.teamId)?.name ?? null) : null,
    teamId: m.teamId,
    title: m.title ?? null,
    status: m.status,
  }));
  return {
    ...accountRow(ctx, a, viewer),
    memberships,
    ban: a.ban && isBanned(a, now) ? { ...a.ban } : null,
    disabledInfo: a.disabled ? { ...a.disabled } : null,
    mute: a.mute && a.mute.until > now ? { ...a.mute } : null,
    unlocks: [...(a.unlocks ?? [])],
    createdBy: a.createdBy ?? null,
    passwordChangedAt: a.passwordChangedAt ?? null,
  };
}

export function staffRow(ctx: AdminCtx, a: Account, viewer: StaffLevel): StaffMemberRow {
  return {
    id: a.id,
    displayName: a.displayName,
    ...emailFor(viewer, a.email),
    level: a.staff as StaffLevel,
    online: !!ctx.world.findPlayerByAccount(a.id),
    envManaged: ctx.world.staff.isEnvManaged(a.email),
    disabled: isDisabled(a),
    banned: isBanned(a, ctx.clock()),
  };
}

// ---- lookup ------------------------------------------------------------------------------------------------

/** Conta por id, e-mail ou nome de exibicao. */
export function findAccount(store: AccountStore, raw: string): Account | undefined {
  const key = raw.normalize('NFKC').trim();
  if (!key) return undefined;
  const byId = store.getById(key);
  if (byId) return byId;
  if (key.includes('@')) {
    const email = normalizeEmail(key);
    return email ? store.getByEmail(email) : undefined;
  }
  return store.getByName(key);
}

/** Alvo de uma acao disciplinar: nunca a si mesmo, nunca staff de nivel igual ou maior. */
function checkTarget(actor: Actor, target: Account): Result<true> {
  if (target.id === actor.account.id) return fail(403, 'self', 'Você não pode fazer isso na própria conta.');
  if (rank(target) >= STAFF_RANK[actor.level]) return fail(403, 'hierarchy', 'Você não pode agir sobre alguém de nível igual ou maior que o seu.');
  return ok(true);
}

/** Derruba as sessoes da conta (cookie e WebSocket). */
function endSessions(ctx: AdminCtx, target: Account, message: string) {
  ctx.store.deleteSessionsOf(target.id);
  ctx.world.kick(target.id, 'kicked', message, undefined, 4005);
}

const label = (a: Account) => ({ id: a.id, name: a.displayName });
const who = (actor: Actor) => ({ id: actor.account.id, name: actor.account.displayName, level: actor.level });

// ---- contas ------------------------------------------------------------------------------------------------

export interface CreateInput {
  email: string;
  displayName: string;
  password?: string;
  orgId?: string;
  teamId?: string;
  role?: string;
  title?: string;
}

export async function createAccount(ctx: AdminCtx, actor: Actor, input: CreateInput): Promise<Result<{ account: Account; provisionalPassword: string }>> {
  const email = normalizeEmail(input.email);
  if (!email) return fail(400, 'invalid_email', 'Informe um e-mail válido.');
  const displayName = normalizeName(input.displayName);
  if (!displayName) return fail(400, 'bad_name', 'O nome deve ter de 2 a 16 letras, números, espaço, _ ou -.');
  if (isReservedName(displayName)) return fail(400, 'bad_name', 'Esse nome é reservado. Escolha outro.');
  const password = input.password ?? generateProvisionalPassword();
  const problem = checkPassword(password, { email, name: displayName });
  if (problem) return fail(400, 'weak_password', problem === 'too_short' ? 'A senha precisa ter pelo menos 10 caracteres.' : problem === 'too_long' ? 'A senha é longa demais (máximo 128).' : 'Essa senha é muito comum ou previsível.');

  const role = input.role ?? 'member';
  if (!isRole(role)) return fail(400, 'bad_role', 'Papel inválido.');
  if (ROLE_RANK[role] > ROLE_RANK[CREATE_ROLE_MAX[actor.level]]) return fail(403, 'role_too_high', 'Seu nível de staff não permite atribuir esse papel.');

  const svc = ctx.world.orgService;
  svc.ensureDefaultOrg();
  const orgId = input.orgId ?? DEFAULT_ORG_ID;
  if (!ctx.store.orgs.getOrg(orgId)) return fail(404, 'org_not_found', 'Organização não encontrada.');
  let teamId: string | null = null;
  if (input.teamId !== undefined) {
    const team = ctx.store.orgs.getTeam(input.teamId);
    if (!team || team.orgId !== orgId) return fail(404, 'team_not_found', 'Equipe não encontrada nessa organização.');
    teamId = team.id;
  } else {
    teamId = orgId === DEFAULT_ORG_ID ? DEFAULT_TEAM_ID : (ctx.store.orgs.teamsOf(orgId)[0]?.id ?? null);
  }

  let title: string | undefined;
  if (input.title !== undefined) {
    const t = cleanTitle(input.title);
    if (t === null) return fail(400, 'bad_title', 'O cargo deve ter até 32 caracteres (letras, números, espaço e . , - / & ( )).');
    if (t) title = t;
  }

  if (ctx.store.getByEmail(email)) return fail(409, 'email_taken', 'Este e-mail já está cadastrado.');
  if (ctx.store.getByName(displayName)) return fail(409, 'name_taken', 'Esse nome já está em uso por outra pessoa.');
  const passwordHash = await hashPassword(password);
  let account: Account;
  try {
    account = ctx.store.create({ email, displayName, passwordHash });
  } catch (err) {
    if (err instanceof DuplicateAccountError) {
      return err.field === 'email' ? fail(409, 'email_taken', 'Este e-mail já está cadastrado.') : fail(409, 'name_taken', 'Esse nome já está em uso por outra pessoa.');
    }
    throw err;
  }
  account.mustChangePassword = true;
  account.createdBy = actor.account.displayName;
  svc.markInitialized(account);
  ctx.store.save(account);
  ctx.store.orgs.putMember({ orgId, accountId: account.id, role, teamId, status: 'active', createdAt: ctx.clock(), ...(title ? { title } : {}) });
  ctx.world.staff.record(who(actor), 'account.create', label(account), `org ${ctx.store.orgs.getOrg(orgId)!.name}, papel ${role}${title ? `, cargo ${title}` : ''}`);
  return ok({ account, provisionalPassword: password });
}

/** Define cargo e/ou setor de uma pessoa numa organizacao (painel de staff). Quem esta online ve a etiqueta mudar na hora. */
export function setMemberProfile(ctx: AdminCtx, actor: Actor, target: Account, input: { orgId: string; teamId?: string; title?: string | null }): Result<{ orgId: string; teamId: string | null; title: string | null }> {
  const m = ctx.store.orgs.getMember(input.orgId, target.id);
  if (!m) return fail(404, 'not_member', 'A pessoa não faz parte dessa organização.');
  const next = { ...m };
  const changes: string[] = [];
  if (input.teamId !== undefined) {
    const team = ctx.store.orgs.getTeam(input.teamId);
    if (!team || team.orgId !== input.orgId) return fail(404, 'team_not_found', 'Setor não encontrado nessa organização.');
    next.teamId = team.id;
    changes.push(`setor ${team.name}`);
  }
  if (input.title !== undefined) {
    const t = input.title === null ? '' : cleanTitle(input.title);
    if (t === null) return fail(400, 'bad_title', 'O cargo deve ter até 32 caracteres (letras, números, espaço e . , - / & ( )).');
    if (t) next.title = t;
    else delete next.title;
    changes.push(t ? `cargo ${t}` : 'cargo removido');
  }
  if (changes.length === 0) return fail(400, 'bad_request', 'Nada para alterar.');
  ctx.store.orgs.putMember(next);
  ctx.world.refreshMembership(target.id, input.orgId);
  ctx.world.refreshProfile(target.id, input.orgId);
  ctx.world.staff.record(who(actor), 'account.profile', label(target), `${ctx.store.orgs.getOrg(input.orgId)?.name ?? input.orgId}: ${changes.join(', ')}`);
  return ok({ orgId: input.orgId, teamId: next.teamId, title: next.title ?? null });
}

/** Cria ou edita um setor (equipe) de uma organizacao pelo painel de staff. */
export function saveDept(ctx: AdminCtx, actor: Actor, orgId: string, teamId: string | null, input: { name?: unknown; color?: unknown }): Result<{ id: string; name: string; color: string }> {
  const org = ctx.store.orgs.getOrg(orgId);
  if (!org) return fail(404, 'org_not_found', 'Organização não encontrada.');
  const exists = (name: string, except?: string) => ctx.store.orgs.teamsOf(orgId).some((t) => t.id !== except && t.name.toLowerCase() === name.toLowerCase());
  if (input.color !== undefined && !isDeptColor(input.color)) return fail(400, 'bad_color', 'Escolha uma das cores da paleta.');
  if (teamId === null) {
    const name = cleanDeptName(input.name);
    if (!name) return fail(400, 'bad_name', 'O nome do setor deve ter de 2 a 24 caracteres (letras, números e espaço).');
    if (exists(name)) return fail(409, 'team_exists', 'Já existe um setor com esse nome.');
    const team = { id: randomUUID(), orgId, name, color: typeof input.color === 'string' ? input.color.toLowerCase() : DEFAULT_DEPT_COLOR };
    ctx.store.orgs.putTeam(team);
    ctx.world.staff.record(who(actor), 'dept.create', { id: team.id, name }, org.name);
    return ok({ id: team.id, name: team.name, color: team.color });
  }
  const team = ctx.store.orgs.getTeam(teamId);
  if (!team || team.orgId !== orgId) return fail(404, 'team_not_found', 'Setor não encontrado.');
  let next = team;
  if (input.name !== undefined) {
    const name = cleanDeptName(input.name);
    if (!name) return fail(400, 'bad_name', 'O nome do setor deve ter de 2 a 24 caracteres (letras, números e espaço).');
    if (exists(name, team.id)) return fail(409, 'team_exists', 'Já existe um setor com esse nome.');
    next = { ...next, name };
  }
  if (typeof input.color === 'string') next = { ...next, color: input.color.toLowerCase() };
  if (next !== team) {
    ctx.store.orgs.putTeam(next);
    ctx.world.refreshTeam(orgId, team.id);
    ctx.world.staff.record(who(actor), 'dept.update', { id: team.id, name: next.name }, `${org.name}: ${team.name} -> ${next.name}, ${next.color}`);
  }
  return ok({ id: next.id, name: next.name, color: next.color });
}

export async function resetPassword(ctx: AdminCtx, actor: Actor, target: Account, password?: string): Promise<Result<{ provisionalPassword: string }>> {
  const t = checkTarget(actor, target);
  if (!t.ok) return t;
  if (target.passwordHash === '') return fail(400, 'dev_account', 'Conta de teste (sem senha): não há senha para redefinir.');
  const pw = password ?? generateProvisionalPassword();
  const problem = checkPassword(pw, { email: target.email, name: target.displayName });
  if (problem) return fail(400, 'weak_password', problem === 'too_short' ? 'A senha precisa ter pelo menos 10 caracteres.' : problem === 'too_long' ? 'A senha é longa demais (máximo 128).' : 'Essa senha é muito comum ou previsível.');
  target.passwordHash = await hashPassword(pw);
  target.mustChangePassword = true;
  target.passwordChangedAt = ctx.clock();
  ctx.store.save(target);
  endSessions(ctx, target, 'Sua senha foi redefinida pela equipe. Entre com a senha provisória.');
  ctx.world.staff.record(who(actor), 'account.reset_password', label(target), 'sessões encerradas');
  return ok({ provisionalPassword: pw });
}

export function setDisabled(ctx: AdminCtx, actor: Actor, target: Account, disabled: boolean, reason: string): Result<Account> {
  const t = checkTarget(actor, target);
  if (!t.ok) return t;
  if (disabled === isDisabled(target)) return fail(409, 'no_change', disabled ? 'A conta já está desativada.' : 'A conta já está ativa.');
  if (disabled) {
    target.disabled = { at: ctx.clock(), by: actor.account.displayName, reason };
    ctx.store.save(target);
    endSessions(ctx, target, 'Sua conta foi desativada. Fale com quem administra o escritório.');
  } else {
    delete target.disabled;
    ctx.store.save(target);
  }
  ctx.world.staff.record(who(actor), disabled ? 'account.disable' : 'account.enable', label(target), reason || undefined);
  return ok(target);
}

export function banAccount(ctx: AdminCtx, actor: Actor, target: Account, minutes: number | null, reason: string): Result<Account> {
  const t = checkTarget(actor, target);
  if (!t.ok) return t;
  const max = BAN_MAX_MINUTES[actor.level];
  if (max === 0) return fail(403, 'level', 'Seu nível não permite banir contas.');
  if (max !== null && (minutes === null || minutes > max)) {
    return fail(403, 'ban_too_long', `Seu nível permite banir por até ${Math.floor(max / 1440)} dias. Banimento permanente é só para administradores.`);
  }
  if (!reason) return fail(400, 'reason_required', 'Informe o motivo do banimento.');
  const now = ctx.clock();
  target.ban = { at: now, by: actor.account.displayName, reason, until: minutes === null ? null : now + minutes * 60_000 };
  ctx.store.save(target);
  endSessions(ctx, target, accessBlock(target, now)?.message ?? 'Sua conta foi banida.');
  ctx.world.staff.record(who(actor), 'account.ban', label(target), `${minutes === null ? 'permanente' : `${minutes} min`}; ${reason}`);
  return ok(target);
}

export function unbanAccount(ctx: AdminCtx, actor: Actor, target: Account): Result<Account> {
  const t = checkTarget(actor, target);
  if (!t.ok) return t;
  if (!target.ban) return fail(409, 'no_change', 'A conta não está banida.');
  delete target.ban;
  ctx.store.save(target);
  ctx.world.staff.record(who(actor), 'account.unban', label(target));
  return ok(target);
}

// ---- equipe de staff -----------------------------------------------------------------------------------------

function activeAdmins(ctx: AdminCtx): Account[] {
  const now = ctx.clock();
  return ctx.store.listAccounts().filter((a) => a.staff === 'admin' && a.passwordHash !== '' && !isDisabled(a) && !isBanned(a, now));
}

/** Regras que valem para mudar ou remover o nivel de uma conta que ja e staff. */
function checkStaffChange(ctx: AdminCtx, target: Account, newLevel: StaffLevel | null): Result<true> {
  if (ctx.world.staff.isEnvManaged(target.email)) {
    return fail(409, 'env_managed', 'Esta conta é definida por BOOTSTRAP_STAFF_EMAILS no servidor; altere a variável de ambiente.');
  }
  if (target.staff === 'admin' && newLevel !== 'admin' && activeAdmins(ctx).filter((a) => a.id !== target.id).length === 0) {
    return fail(409, 'last_admin', 'Esta é a última conta administradora: promova outra pessoa antes de mudar ou remover este nível.');
  }
  return ok(true);
}

/** Aplica na conta e na sessao online (selo e painel mudam na hora, sem reiniciar). */
function applyStaff(ctx: AdminCtx, target: Account, level: StaffLevel | null) {
  if (level) target.staff = level;
  else delete target.staff;
  ctx.store.save(target);
  ctx.world.staff.reconcile(target.id);
}

export function addStaff(ctx: AdminCtx, actor: Actor, target: Account, level: StaffLevel): Result<Account> {
  if (target.passwordHash === '') return fail(400, 'dev_account', 'Conta de teste (sem senha) não pode ser staff.');
  if (isDisabled(target) || isBanned(target, ctx.clock())) return fail(409, 'account_blocked', 'A conta está desativada ou banida.');
  if (isStaffLevel(target.staff)) return fail(409, 'already_staff', 'Esta conta já faz parte da equipe: altere o nível.');
  if (ctx.world.staff.isEnvManaged(target.email)) return fail(409, 'env_managed', 'Esta conta é definida por BOOTSTRAP_STAFF_EMAILS no servidor.');
  applyStaff(ctx, target, level);
  ctx.world.staff.record(who(actor), 'staff.add', label(target), level);
  return ok(target);
}

export function setStaffLevel(ctx: AdminCtx, actor: Actor, target: Account, level: StaffLevel): Result<Account> {
  if (!isStaffLevel(target.staff)) return fail(409, 'not_staff', 'Esta conta não faz parte da equipe.');
  if (target.staff === level) return fail(409, 'no_change', 'A conta já tem esse nível.');
  const c = checkStaffChange(ctx, target, level);
  if (!c.ok) return c;
  const from = target.staff;
  applyStaff(ctx, target, level);
  ctx.world.staff.record(who(actor), 'staff.set_level', label(target), `${from} -> ${level}`);
  return ok(target);
}

export function removeStaff(ctx: AdminCtx, actor: Actor, target: Account): Result<Account> {
  if (!isStaffLevel(target.staff)) return fail(409, 'not_staff', 'Esta conta não faz parte da equipe.');
  const c = checkStaffChange(ctx, target, null);
  if (!c.ok) return c;
  const from = target.staff;
  applyStaff(ctx, target, null);
  ctx.world.staff.record(who(actor), 'staff.remove', label(target), from);
  return ok(target);
}
