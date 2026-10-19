import { randomBytes, randomUUID } from 'node:crypto';
import {
  DEFAULT_ORG_ID,
  DEFAULT_ORG_NAME,
  DEFAULT_TEAM,
  DEFAULT_TEAM_ID,
  cleanDeptName,
  cleanTitle,
  isDeptColor,
  isGeneralDept,
  isRole,
  type ProfileTag,
  permissionsOf,
  type InvitePreview,
  type OrgSummary,
} from '@workverse/shared';
import { hashToken } from './auth';
import { can, type Actor } from './authz';
import type { Invite, Org, OrgMember, OrgStore, Team } from './orgStore';
import type { Account } from './store';

// Same normalization as store.ts#emailKey, repeated here so this module does not import store.ts at runtime
// (store.ts imports OrgService for the JSON migration).
const emailKey = (e: string) => e.normalize('NFKC').trim().toLowerCase();

export type Result<T> = { ok: true; value: T } | { ok: false; status: number; code: string; message: string };

const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const err = (status: number, code: string, message: string): Result<never> => ({ ok: false, status, code, message });

export const DEFAULT_TEAM_NAME = 'Geral';
export const DEFAULT_TEAM_COLOR = '#6c8cff';
export const INVITE_LIMITS = { minTtlHours: 1, maxTtlHours: 24 * 30, defaultTtlHours: 72, maxUses: 100 } as const;
/** Organizations one account may own at the same time. */
export const MAX_OWNED_ORGS = 5;
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$/;

export interface OrgServiceOptions {
  clock?: () => number;
  /** E-mail of the account that becomes owner of the default org (BOOTSTRAP_OWNER_EMAIL). */
  bootstrapOwnerEmail?: string;
  /** Persists a change made to an account (the `orgsInit` flag). */
  saveAccount?: (account: Account) => void;
  log?: (event: string, data?: Record<string, unknown>) => void;
}

/** Accounts created through the name-only path (ALLOW_DEV_LOGIN) have no password. */
export const isDevAccount = (a: Pick<Account, 'passwordHash'>) => a.passwordHash === '';

export function slugify(name: string): string {
  const base = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 38)
    .replace(/-+$/g, '');
  return base.length >= 2 ? base : 'org';
}

export function summaryOf(org: Org, m: OrgMember): OrgSummary {
  return { id: org.id, slug: org.slug, name: org.name, role: m.role, teamId: m.teamId, perms: permissionsOf(m.role) };
}

/**
 * Rules for organizations: creation, memberships, teams, invites and the default-org migration.
 * Methods that act for a person take an `Actor` and re-check it with `can()` (hierarchy, last owner).
 */
export class OrgService {
  private readonly clock: () => number;
  private readonly bootstrap: string;
  private readonly log: NonNullable<OrgServiceOptions['log']>;

  constructor(
    readonly store: OrgStore,
    private readonly opts: OrgServiceOptions = {},
  ) {
    this.clock = opts.clock ?? Date.now;
    this.bootstrap = emailKey(opts.bootstrapOwnerEmail ?? '');
    this.log = opts.log ?? (() => undefined);
  }

  // ---- default org / migration ------------------------------------------------------------------

  ensureDefaultOrg(): Org {
    let org = this.store.getOrg(DEFAULT_ORG_ID);
    if (!org) {
      org = { id: DEFAULT_ORG_ID, slug: 'default', name: DEFAULT_ORG_NAME, settings: {}, createdAt: this.clock() };
      this.store.putOrg(org);
    }
    if (!this.store.getTeam(DEFAULT_TEAM_ID)) {
      this.store.putTeam({ id: DEFAULT_TEAM_ID, orgId: DEFAULT_ORG_ID, name: DEFAULT_TEAM_NAME, color: DEFAULT_TEAM_COLOR });
    }
    return org;
  }

  private hasOwner(orgId: string): boolean {
    return this.store.membersOf(orgId).some((m) => m.role === 'owner' && m.status === 'active');
  }

  /** Team of the default org with this (legacy) name, created on demand. 'geral' is the default team. */
  private legacyTeamId(legacy: string | undefined): string {
    const name = (legacy ?? DEFAULT_TEAM).normalize('NFKC').trim();
    if (!name || name.toLowerCase() === DEFAULT_TEAM) return DEFAULT_TEAM_ID;
    const existing = this.store.teamsOf(DEFAULT_ORG_ID).find((t) => t.name.toLowerCase() === name.toLowerCase());
    if (existing) return existing.id;
    const team: Team = { id: randomUUID(), orgId: DEFAULT_ORG_ID, name: name.slice(0, 40), color: DEFAULT_TEAM_COLOR };
    this.store.putTeam(team);
    return team.id;
  }

  /**
   * First time an account is seen after organizations exist: it joins the default org (once; removing it later is
   * respected). The first password account, or the one with BOOTSTRAP_OWNER_EMAIL, becomes the owner; quick-login
   * (dev) accounts are always plain members. Returns the memberships of the account.
   */
  ensureMembership(account: Account): OrgMember[] {
    if (!account.orgsInit) {
      const org = this.ensureDefaultOrg();
      if (!this.store.getMember(org.id, account.id)) {
        const eligible = !isDevAccount(account) && !this.hasOwner(org.id) && (this.bootstrap === '' || emailKey(account.email) === this.bootstrap);
        this.store.putMember({
          orgId: org.id,
          accountId: account.id,
          role: eligible ? 'owner' : 'member',
          teamId: this.legacyTeamId(account.team),
          status: 'active',
          createdAt: this.clock(),
        });
        this.log('org.member_add', { org: org.id, account: account.id, why: 'default' });
      }
      account.orgsInit = true;
      this.opts.saveAccount?.(account);
    }
    return this.store.membershipsOf(account.id);
  }

  /** Marks an account as handled without joining the default org (it registered through an invite). */
  markInitialized(account: Account) {
    if (account.orgsInit) return;
    account.orgsInit = true;
    this.opts.saveAccount?.(account);
  }

  /** Idempotent migration of existing accounts into the default org (oldest first, so the first registered owns it). */
  backfill(accounts: Iterable<Account>): number {
    this.ensureDefaultOrg();
    let n = 0;
    for (const a of [...accounts].sort((x, y) => x.createdAt - y.createdAt)) {
      if (a.orgsInit) continue;
      this.ensureMembership(a);
      n++;
    }
    return n;
  }

  // ---- lookups ------------------------------------------------------------------------------------

  /** The caller's membership as an Actor; undefined when not an active member (callers answer 404). */
  actorFor(accountId: string, orgId: string): Actor | undefined {
    const m = this.store.getMember(orgId, accountId);
    if (!m || m.status !== 'active' || !this.store.getOrg(orgId)) return undefined;
    return { accountId, orgId, role: m.role, teamId: m.teamId };
  }

  activeMemberships(accountId: string): OrgMember[] {
    return this.store.membershipsOf(accountId).filter((m) => m.status === 'active' && this.store.getOrg(m.orgId));
  }

  isLastOwner(orgId: string, accountId: string): boolean {
    const owners = this.store.membersOf(orgId).filter((m) => m.role === 'owner' && m.status === 'active');
    return owners.length === 1 && owners[0]!.accountId === accountId;
  }

  // ---- organizations ------------------------------------------------------------------------------

  createOrg(account: Account, nameRaw: unknown, slugRaw?: unknown): Result<{ org: Org; member: OrgMember }> {
    const name = typeof nameRaw === 'string' ? nameRaw.normalize('NFKC').replace(/\s+/g, ' ').trim() : '';
    if (name.length < 2 || name.length > 60) return err(400, 'bad_name', 'O nome da organização deve ter de 2 a 60 caracteres.');
    // Every organization holds a live world and (when used) stage images in memory: one account cannot create them without bound.
    const owned = this.store.membershipsOf(account.id).filter((m) => m.role === 'owner' && m.status === 'active').length;
    if (owned >= MAX_OWNED_ORGS) return err(403, 'org_limit', `Você já é dono de ${MAX_OWNED_ORGS} organizações (o máximo).`);
    let slug: string;
    if (slugRaw !== undefined && slugRaw !== null && slugRaw !== '') {
      if (typeof slugRaw !== 'string' || !SLUG_PATTERN.test(slugRaw)) return err(400, 'bad_slug', 'Use letras minúsculas, números e hífen (2 a 40).');
      if (this.store.getOrgBySlug(slugRaw)) return err(409, 'slug_taken', 'Esse endereço já está em uso.');
      slug = slugRaw;
    } else {
      const base = slugify(name);
      slug = base;
      for (let i = 2; this.store.getOrgBySlug(slug); i++) slug = `${base}-${i}`.slice(0, 40);
    }
    const now = this.clock();
    const org: Org = { id: randomUUID(), slug, name, settings: {}, createdAt: now };
    this.store.putOrg(org);
    const team: Team = { id: randomUUID(), orgId: org.id, name: DEFAULT_TEAM_NAME, color: DEFAULT_TEAM_COLOR };
    this.store.putTeam(team);
    const member: OrgMember = { orgId: org.id, accountId: account.id, role: 'owner', teamId: team.id, status: 'active', createdAt: now };
    this.store.putMember(member);
    this.markInitialized(account);
    this.log('org.create', { org: org.id, account: account.id });
    return ok({ org, member });
  }

  // ---- teams ------------------------------------------------------------------------------------

  createTeam(actor: Actor, nameRaw: unknown, colorRaw?: unknown): Result<Team> {
    const d = can(actor, 'team.manage', { orgId: actor.orgId });
    if (!d.allow) return err(403, 'forbidden', 'Você não tem permissão para gerenciar equipes.');
    const name = cleanDeptName(nameRaw);
    if (!name) return err(400, 'bad_name', 'O nome do setor deve ter de 2 a 24 caracteres (letras, números e espaço).');
    if (this.store.teamsOf(actor.orgId).some((t) => t.name.toLowerCase() === name.toLowerCase())) {
      return err(409, 'team_exists', 'Já existe um setor com esse nome.');
    }
    if (colorRaw !== undefined && colorRaw !== null && !isDeptColor(colorRaw)) return err(400, 'bad_color', 'Escolha uma das cores da paleta.');
    const color = typeof colorRaw === 'string' ? colorRaw.toLowerCase() : DEFAULT_TEAM_COLOR;
    const team: Team = { id: randomUUID(), orgId: actor.orgId, name, color };
    this.store.putTeam(team);
    this.log('team.create', { org: actor.orgId, team: team.id, by: actor.accountId });
    return ok(team);
  }

  /** Renomeia e/ou recolore um setor (cor so da paleta). Quem esta online ve a mudanca na hora (ver World.refreshTeam). */
  updateTeam(actor: Actor, teamId: string, patch: { name?: unknown; color?: unknown }): Result<Team> {
    const d = can(actor, 'team.manage', { orgId: actor.orgId });
    if (!d.allow) return err(403, 'forbidden', 'Você não tem permissão para gerenciar setores.');
    const team = this.store.getTeam(teamId);
    if (!team || team.orgId !== actor.orgId) return err(404, 'not_found', 'Setor não encontrado.');
    let next = team;
    if (patch.name !== undefined) {
      const name = cleanDeptName(patch.name);
      if (!name) return err(400, 'bad_name', 'O nome do setor deve ter de 2 a 24 caracteres (letras, números e espaço).');
      if (this.store.teamsOf(actor.orgId).some((t) => t.id !== team.id && t.name.toLowerCase() === name.toLowerCase())) return err(409, 'team_exists', 'Já existe um setor com esse nome.');
      next = { ...next, name };
    }
    if (patch.color !== undefined) {
      if (!isDeptColor(patch.color)) return err(400, 'bad_color', 'Escolha uma das cores da paleta.');
      next = { ...next, color: patch.color.toLowerCase() };
    }
    if (next !== team) {
      this.store.putTeam(next);
      this.log('team.update', { org: actor.orgId, team: team.id, by: actor.accountId });
    }
    return ok(next);
  }

  /** Cargo e setor como aparecem no mundo. O setor "Geral" (padrao de todo mundo) conta como "sem setor". */
  profileOf(orgId: string, accountId: string): ProfileTag {
    const m = this.store.getMember(orgId, accountId);
    if (!m) return {};
    const team = m.teamId ? this.store.getTeam(m.teamId) : undefined;
    const dept = team && team.orgId === orgId && !isGeneralDept(team) ? team : undefined;
    return { ...(m.title ? { title: m.title } : {}), ...(dept ? { dept: dept.name, deptColor: dept.color } : {}) };
  }

  // ---- members ----------------------------------------------------------------------------------

  /** Changes role and/or team of a member of the actor's org. */
  updateMember(actor: Actor, targetId: string, patch: { role?: unknown; teamId?: unknown; title?: unknown }): Result<OrgMember> {
    const target = this.store.getMember(actor.orgId, targetId);
    if (!target) return err(404, 'not_found', 'Pessoa não encontrada.');
    let next = target;
    if (patch.role !== undefined) {
      if (!isRole(patch.role)) return err(400, 'bad_role', 'Papel inválido.');
      const d = can(actor, 'member.role.set', {
        orgId: target.orgId,
        targetAccountId: target.accountId,
        targetRole: target.role,
        newRole: patch.role,
        isLastOwner: this.isLastOwner(target.orgId, target.accountId),
      });
      if (!d.allow) return err(403, d.reason, reasonText(d.reason));
      next = { ...next, role: patch.role };
    }
    if (patch.teamId !== undefined) {
      const d = can(actor, 'team.manage', { orgId: target.orgId });
      if (!d.allow) return err(403, d.reason, reasonText(d.reason));
      if (patch.teamId !== null) {
        const team = typeof patch.teamId === 'string' ? this.store.getTeam(patch.teamId) : undefined;
        if (!team || team.orgId !== actor.orgId) return err(400, 'bad_team', 'Equipe inexistente.');
      }
      next = { ...next, teamId: patch.teamId as string | null };
    }
    if (patch.title !== undefined) {
      const d = can(actor, 'team.manage', { orgId: target.orgId });
      if (!d.allow) return err(403, d.reason, reasonText(d.reason));
      const title = patch.title === null ? '' : cleanTitle(patch.title);
      if (title === null) return err(400, 'bad_title', 'O cargo deve ter até 32 caracteres (letras, números, espaço e . , - / & ( )).');
      next = { ...next };
      if (title) next.title = title;
      else delete next.title;
    }
    if (next !== target) {
      this.store.putMember(next);
      this.log('org.member_update', { org: actor.orgId, account: targetId, by: actor.accountId, role: next.role, team: next.teamId, title: next.title ?? null });
    }
    return ok(next);
  }

  removeMember(actor: Actor, targetId: string): Result<true> {
    const target = this.store.getMember(actor.orgId, targetId);
    if (!target) return err(404, 'not_found', 'Pessoa não encontrada.');
    const d = can(actor, 'member.remove', {
      orgId: target.orgId,
      targetAccountId: target.accountId,
      targetRole: target.role,
      isLastOwner: this.isLastOwner(target.orgId, target.accountId),
    });
    if (!d.allow) return err(403, d.reason, reasonText(d.reason));
    this.store.deleteMember(target.orgId, target.accountId);
    this.log('org.member_remove', { org: actor.orgId, account: targetId, by: actor.accountId });
    return ok(true);
  }

  // ---- invites ----------------------------------------------------------------------------------

  createInvite(
    actor: Actor,
    input: { email?: unknown; role?: unknown; teamId?: unknown; ttlHours?: unknown; maxUses?: unknown },
    normalizeEmail: (raw: unknown) => string | null,
  ): Result<{ invite: Invite; token: string }> {
    if (!isRole(input.role)) return err(400, 'bad_role', 'Papel inválido.');
    const d = can(actor, 'member.invite', { orgId: actor.orgId, newRole: input.role });
    if (!d.allow) return err(403, d.reason, reasonText(d.reason));

    let email: string | null = null;
    if (input.email !== undefined && input.email !== null && input.email !== '') {
      email = normalizeEmail(input.email);
      if (!email) return err(400, 'invalid_email', 'E-mail inválido.');
    }
    let teamId: string | null = null;
    if (input.teamId !== undefined && input.teamId !== null && input.teamId !== '') {
      const team = typeof input.teamId === 'string' ? this.store.getTeam(input.teamId) : undefined;
      // The team is resolved inside the actor's org: a team id of another org is simply "not found".
      if (!team || team.orgId !== actor.orgId) return err(400, 'bad_team', 'Equipe inexistente.');
      teamId = team.id;
    }
    const ttl = input.ttlHours === undefined ? INVITE_LIMITS.defaultTtlHours : input.ttlHours;
    if (typeof ttl !== 'number' || !Number.isFinite(ttl) || ttl < INVITE_LIMITS.minTtlHours || ttl > INVITE_LIMITS.maxTtlHours) {
      return err(400, 'bad_ttl', `A validade deve ser de ${INVITE_LIMITS.minTtlHours} a ${INVITE_LIMITS.maxTtlHours} horas.`);
    }
    let maxUses = 1; // an invite tied to an e-mail is always single use
    if (input.maxUses !== undefined && !email) {
      const v = input.maxUses;
      if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > INVITE_LIMITS.maxUses) {
        return err(400, 'bad_max_uses', `O limite de usos deve ser de 1 a ${INVITE_LIMITS.maxUses}.`);
      }
      maxUses = v;
    }

    // 128 bits of randomness; only the hash is stored, the token is shown once.
    const token = randomBytes(16).toString('base64url');
    const now = this.clock();
    const invite: Invite = {
      id: randomUUID(),
      orgId: actor.orgId,
      email,
      role: input.role,
      teamId,
      tokenHash: hashToken(token),
      createdBy: actor.accountId,
      createdAt: now,
      expiresAt: now + ttl * 3_600_000,
      maxUses,
      uses: 0,
      revokedAt: null,
    };
    this.store.putInvite(invite);
    this.log('invite.create', { org: actor.orgId, invite: invite.id, by: actor.accountId, role: invite.role });
    return ok({ invite, token });
  }

  revokeInvite(actor: Actor, inviteId: string): Result<true> {
    const invite = this.store.getInvite(inviteId);
    // Invites of other organizations look exactly like missing ones.
    if (!invite || invite.orgId !== actor.orgId) return err(404, 'not_found', 'Convite não encontrado.');
    const d = can(actor, 'member.invite', { orgId: invite.orgId, newRole: invite.role });
    if (!d.allow) return err(403, d.reason, reasonText(d.reason));
    if (!invite.revokedAt) {
      this.store.putInvite({ ...invite, revokedAt: this.clock() });
      this.log('invite.revoke', { org: actor.orgId, invite: invite.id, by: actor.accountId });
    }
    return ok(true);
  }

  private resolveInvite(token: unknown): Result<Invite> {
    if (typeof token !== 'string' || token.length < 16 || token.length > 64) return err(404, 'invite_not_found', 'Convite não encontrado.');
    const invite = this.store.getInviteByHash(hashToken(token));
    if (!invite || !this.store.getOrg(invite.orgId)) return err(404, 'invite_not_found', 'Convite não encontrado.');
    if (invite.revokedAt) return err(410, 'invite_revoked', 'Este convite foi cancelado.');
    if (invite.expiresAt <= this.clock()) return err(410, 'invite_expired', 'Este convite expirou.');
    if (invite.uses >= invite.maxUses) return err(410, 'invite_used', 'Este convite já foi usado.');
    return ok(invite);
  }

  /** Validity of a token for a given (normalized) e-mail, without consuming it. Used by registration before the account exists. */
  checkInvite(token: unknown, email: string): Result<true> {
    const r = this.resolveInvite(token);
    if (!r.ok) return r;
    if (r.value.email !== null && r.value.email !== emailKey(email)) return err(403, 'invite_email_mismatch', 'Este convite é para outro e-mail.');
    return ok(true);
  }

  /** What the link shows before anyone logs in: no e-mails, no member names, nothing about other orgs. */
  previewInvite(token: unknown): Result<InvitePreview> {
    const r = this.resolveInvite(token);
    if (!r.ok) return r;
    const invite = r.value;
    const org = this.store.getOrg(invite.orgId)!;
    const team = invite.teamId ? this.store.getTeam(invite.teamId) : undefined;
    return ok({ orgName: org.name, role: invite.role, teamName: team?.name ?? null, expiresAt: invite.expiresAt, emailBound: invite.email !== null });
  }

  acceptInvite(token: unknown, account: Account): Result<{ org: Org; member: OrgMember }> {
    const r = this.resolveInvite(token);
    if (!r.ok) return r;
    const invite = r.value;
    if (invite.email !== null && emailKey(account.email) !== invite.email) {
      return err(403, 'invite_email_mismatch', 'Este convite é para outro e-mail.');
    }
    if (isDevAccount(account) && invite.role !== 'guest' && invite.role !== 'member') {
      return err(403, 'invite_dev_account', 'Contas rápidas não podem assumir esse papel.');
    }
    const org = this.store.getOrg(invite.orgId)!;
    if (this.store.getMember(org.id, account.id)) return err(409, 'already_member', 'Você já faz parte dessa organização.');
    const member: OrgMember = {
      orgId: org.id,
      accountId: account.id,
      role: invite.role,
      teamId: invite.teamId,
      status: 'active',
      createdAt: this.clock(),
    };
    this.store.putMember(member);
    this.store.putInvite({ ...invite, uses: invite.uses + 1 });
    this.markInitialized(account);
    this.log('invite.accept', { org: org.id, invite: invite.id, account: account.id, role: invite.role });
    return ok({ org, member });
  }
}

export function reasonText(reason: string): string {
  switch (reason) {
    case 'cross_org':
    case 'no_org':
      return 'Recurso de outra organização.';
    case 'escalation':
      return 'Você não pode conceder um papel acima do seu.';
    case 'hierarchy':
      return 'Você não pode alterar alguém do seu nível ou acima.';
    case 'last_owner':
      return 'A organização precisa manter pelo menos um proprietário.';
    default:
      return 'Você não tem permissão para isso.';
  }
}
