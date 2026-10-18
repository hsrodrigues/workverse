import { randomUUID } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { OrgStore, type OrgData } from './orgStore';
import { OrgService } from './org';
import { DEFAULT_ROOM_ID, MAX_OUTFITS, randomAvatar, sanitizeAvatar, sanitizeOutfitName, type AuditRecord, type AvatarConfig, type Outfit, type PresenceStatus, type StaffLevel } from '@workverse/shared';

export interface Account {
  id: string;
  /** Lowercase, unique. */
  email: string;
  /** Unique, case-insensitive. */
  displayName: string;
  /** `scrypt$...` string; empty for development-only accounts, which can never log in with a password. */
  passwordHash: string;
  avatar: AvatarConfig;
  lastRoom: string;
  /** Saved outfits (references only, max MAX_OUTFITS). Absent means none. */
  outfits?: Outfit[];
  /** Unlock keys granted to the account (see shared items/access.ts). Absent means only free items. */
  unlocks?: string[];
  /** Nivel de staff da plataforma. SO o servidor define (BOOTSTRAP_STAFF_EMAILS / CLI staff:grant); ausente = conta comum. */
  staff?: StaffLevel;
  /** Senha provisoria (criada/redefinida por staff): a pessoa precisa trocar antes de usar a conta. Ausente = nao. */
  mustChangePassword?: true;
  passwordChangedAt?: number;
  /** Conta desativada por staff (reversivel): nao entra nem mantem sessao. */
  disabled?: { at: number; by: string; reason: string };
  /** Banimento por staff; `until` null = permanente. Persistente (sobrevive a reinicio). */
  ban?: { at: number; by: string; reason: string; until: number | null };
  /** Silenciamento por staff (chat, DM e equipe) ate `until`. Persistente. */
  mute?: { until: number; by: string; reason: string };
  lastLoginAt?: number;
  /** Nome da staff que criou a conta pelo painel / CLI. */
  createdBy?: string;
  /** Last status chosen manually by the player (automatic away is never persisted). */
  status?: PresenceStatus;
  /** @deprecated Legacy team name. Teams now live in the org store (org_members.team_id); read only by the v3 migration. */
  team?: string;
  /** True once the account went through the default-org migration (see OrgService.ensureMembership). */
  orgsInit?: boolean;
  /** Organization of the last session; used to pick the org on the next login. */
  lastOrg?: string;
  createdAt: number;
}

/** Server-side session. Only the sha256 of the cookie token is ever stored. */
export interface SessionRecord {
  tokenHash: string;
  accountId: string;
  createdAt: number;
  expiresAt: number;
}

export interface NewAccount {
  email: string;
  displayName: string;
  passwordHash: string;
  avatar?: AvatarConfig;
}

export class DuplicateAccountError extends Error {
  constructor(readonly field: 'email' | 'displayName') {
    super(`duplicate ${field}`);
  }
}

/**
 * Persistence boundary. The current slice ships a memory and a JSON-file
 * implementation; a PostgreSQL implementation can replace them without
 * touching the game logic.
 */
export interface AccountStore {
  /** Organizations, memberships, teams and invites (see orgStore.ts). */
  readonly orgs: OrgStore;
  /** Every account (used to migrate existing accounts into the default organization). */
  listAccounts(): Account[];
  getById(id: string): Account | undefined;
  getByEmail(email: string): Account | undefined;
  getByName(name: string): Account | undefined;
  /** Throws DuplicateAccountError when the e-mail or display name is taken. */
  create(input: NewAccount): Account;
  save(account: Account): void;

  createSession(session: SessionRecord): void;
  getSession(tokenHash: string): SessionRecord | undefined;
  deleteSession(tokenHash: string): void;
  deleteSessionsOf(accountId: string): void;
  deleteExpiredSessions(now: number): void;
  /** Keeps only the `keep` newest sessions of the account (older ones are revoked). Returns how many were removed. */
  trimSessionsOf(accountId: string, keep: number): number;

  /** Auditoria permanente de staff (ver docs/staff.md). Mantem os registros mais recentes em memoria. */
  appendAudit(record: AuditRecord): void;
  queryAudit(filter?: AuditFilter): AuditRecord[];
}

export interface AuditFilter {
  /** Trecho do nome ou id exato do ator / alvo (sem diferenciar maiusculas). */
  actor?: string;
  target?: string;
  /** Acao exata ou prefixo ("announce" casa announce.all, announce.room...). */
  action?: string;
  from?: number;
  to?: number;
  limit?: number;
}

/** Quantos registros de auditoria ficam em memoria (e saem em exportacoes). */
export const AUDIT_CAP = 10_000;

/** Repairs stored outfits (lenient, never throws): clean avatars, safe names, unique ids, capped list. */
export function sanitizeOutfits(raw: unknown): Outfit[] {
  if (!Array.isArray(raw)) return [];
  const out: Outfit[] = [];
  const ids = new Set<string>();
  for (const o of raw) {
    if (out.length >= MAX_OUTFITS) break;
    if (typeof o !== 'object' || o === null) continue;
    const r = o as Partial<Outfit>;
    const name = sanitizeOutfitName(r.name);
    if (!name || typeof r.id !== 'string' || r.id.length === 0 || r.id.length > 40 || ids.has(r.id)) continue;
    ids.add(r.id);
    out.push({ id: r.id, name, avatar: sanitizeAvatar(r.avatar), updatedAt: typeof r.updatedAt === 'number' ? r.updatedAt : 0 });
  }
  return out;
}

export const emailKey = (e: string) => e.normalize('NFKC').trim().toLowerCase();
export const nameKey = (n: string) => n.normalize('NFKC').toLocaleLowerCase();

export class MemoryAccountStore implements AccountStore {
  readonly orgs = new OrgStore();
  protected accounts = new Map<string, Account>();
  protected byEmail = new Map<string, Account>();
  protected byName = new Map<string, Account>();
  protected sessions = new Map<string, SessionRecord>();
  protected audit: AuditRecord[] = [];

  appendAudit(record: AuditRecord): void {
    this.audit.push(record);
    if (this.audit.length > AUDIT_CAP) this.audit.splice(0, this.audit.length - AUDIT_CAP);
  }

  /** Mais recentes primeiro. */
  queryAudit(f: AuditFilter = {}): AuditRecord[] {
    const has = (hay: string | undefined, needle: string | undefined, id?: string) => {
      if (!needle) return true;
      const n = needle.normalize('NFKC').toLowerCase();
      return (id !== undefined && id === needle) || (hay ?? '').toLowerCase().includes(n);
    };
    const out: AuditRecord[] = [];
    for (let i = this.audit.length - 1; i >= 0 && out.length < (f.limit ?? 200); i--) {
      const r = this.audit[i]!;
      if (f.from !== undefined && r.at < f.from) continue;
      if (f.to !== undefined && r.at > f.to) continue;
      if (f.action && !(r.action === f.action || r.action.startsWith(`${f.action}.`))) continue;
      if (!has(r.actor, f.actor, r.actorId) || !has(r.target, f.target, r.targetId)) continue;
      out.push(r);
    }
    return out;
  }

  listAccounts(): Account[] {
    return [...this.accounts.values()];
  }

  getById(id: string) {
    return this.accounts.get(id);
  }

  getByEmail(email: string) {
    return this.byEmail.get(emailKey(email));
  }

  getByName(name: string) {
    return this.byName.get(nameKey(name));
  }

  create(input: NewAccount): Account {
    const email = emailKey(input.email);
    if (this.byEmail.has(email)) throw new DuplicateAccountError('email');
    if (this.byName.has(nameKey(input.displayName))) throw new DuplicateAccountError('displayName');
    const account: Account = {
      id: randomUUID(),
      email,
      displayName: input.displayName,
      passwordHash: input.passwordHash,
      avatar: input.avatar ? sanitizeAvatar(input.avatar) : randomAvatar(),
      lastRoom: DEFAULT_ROOM_ID,
      createdAt: Date.now(),
    };
    this.index(account);
    this.save(account);
    return account;
  }

  save(account: Account): void {
    this.index(account);
  }

  createSession(session: SessionRecord): void {
    this.sessions.set(session.tokenHash, session);
  }

  getSession(tokenHash: string) {
    return this.sessions.get(tokenHash);
  }

  deleteSession(tokenHash: string): void {
    this.sessions.delete(tokenHash);
  }

  deleteSessionsOf(accountId: string): void {
    for (const [hash, s] of this.sessions) if (s.accountId === accountId) this.sessions.delete(hash);
  }

  deleteExpiredSessions(now: number): void {
    for (const [hash, s] of this.sessions) if (s.expiresAt <= now) this.sessions.delete(hash);
  }

  trimSessionsOf(accountId: string, keep: number): number {
    const mine = [...this.sessions.values()].filter((s) => s.accountId === accountId).sort((a, b) => b.createdAt - a.createdAt);
    const drop = mine.slice(Math.max(0, keep));
    // Through deleteSession so the JSON / PostgreSQL stores persist the removal.
    for (const s of drop) this.deleteSession(s.tokenHash);
    return drop.length;
  }

  protected index(account: Account) {
    this.accounts.set(account.id, account);
    this.byEmail.set(account.email, account);
    this.byName.set(nameKey(account.displayName), account);
  }
}

/** v2: accounts and sessions. v3 adds organizations, members, teams and invites. */
interface FileShape extends Partial<OrgData> {
  version: 2 | 3;
  accounts: Account[];
  sessions: SessionRecord[];
  audit?: AuditRecord[];
}

export interface JsonStoreOptions {
  /** E-mail that becomes owner of the default org during the v2 -> v3 migration. Defaults to BOOTSTRAP_OWNER_EMAIL. */
  bootstrapOwnerEmail?: string;
}

export class JsonFileAccountStore extends MemoryAccountStore {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly file: string,
    opts: JsonStoreOptions = {},
  ) {
    super();
    if (existsSync(file)) {
      let migrated = false;
      try {
        const data = JSON.parse(readFileSync(file, 'utf8')) as FileShape;
        for (const a of data.accounts ?? []) this.index({ ...a, avatar: sanitizeAvatar(a.avatar), ...(a.outfits ? { outfits: sanitizeOutfits(a.outfits) } : {}) });
        for (const s of data.sessions ?? []) this.sessions.set(s.tokenHash, s);
        if (Array.isArray(data.audit)) this.audit = data.audit.slice(-AUDIT_CAP);
        this.deleteExpiredSessions(Date.now());
        this.orgs.load(data);
        if ((data.version ?? 2) < 3) {
          // Keep the untouched v2 file next to the new one (never overwritten, so the first backup survives reruns).
          const backup = `${file}.bak-v2`;
          if (!existsSync(backup)) copyFileSync(file, backup);
          migrated = true;
        }
        // Idempotent: accounts already carrying `orgsInit` are skipped.
        const svc = new OrgService(this.orgs, {
          bootstrapOwnerEmail: opts.bootstrapOwnerEmail ?? process.env.BOOTSTRAP_OWNER_EMAIL,
          saveAccount: (a) => this.index(a),
        });
        if (svc.backfill(this.accounts.values()) > 0) migrated = true;
      } catch (err) {
        throw new Error(`Could not read account store ${file}: ${(err as Error).message}`);
      }
      if (migrated) this.flush();
    }
    this.orgs.onOp = () => this.schedule();
  }

  override create(input: NewAccount): Account {
    const account = super.create(input);
    this.flush(); // new accounts are written immediately; avatar/room updates are debounced
    return account;
  }

  override save(account: Account): void {
    super.save(account);
    this.schedule();
  }

  override createSession(session: SessionRecord): void {
    super.createSession(session);
    this.schedule();
  }

  override appendAudit(record: AuditRecord): void {
    super.appendAudit(record);
    this.schedule();
  }

  override deleteSession(tokenHash: string): void {
    super.deleteSession(tokenHash);
    this.schedule();
  }

  override deleteSessionsOf(accountId: string): void {
    super.deleteSessionsOf(accountId);
    this.schedule();
  }

  override deleteExpiredSessions(now: number): void {
    super.deleteExpiredSessions(now);
    this.schedule();
  }

  private schedule() {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, 500);
    this.timer.unref();
  }

  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    const data: FileShape = { version: 3, accounts: [...this.accounts.values()], sessions: [...this.sessions.values()], audit: this.audit, ...this.orgs.snapshot() };
    // The file holds password hashes and session hashes: keep it private to the server user.
    writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
    renameSync(tmp, this.file);
  }
}
