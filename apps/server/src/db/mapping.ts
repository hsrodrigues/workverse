import { isStaffLevel, sanitizeAvatar, type AuditRecord } from '@workverse/shared';
import { emailKey, nameKey, sanitizeOutfits, type Account, type SessionRecord } from '../store';

/** Propriedades de Account que tem coluna propria; todo o resto vai para accounts.extra. */
const COLUMN_FIELDS = new Set([
  'id',
  'email',
  'displayName',
  'passwordHash',
  'avatar',
  'lastRoom',
  'status',
  'team',
  'staff',
  'createdAt',
]);

export interface AccountRow {
  id: string;
  email: string;
  display_name: string;
  password_hash: string;
  avatar: unknown;
  last_room: string;
  status: string | null;
  team: string | null;
  staff: string | null;
  extra: Record<string, unknown> | null;
  created_at: Date;
}

export interface SessionRow {
  token_hash: string;
  account_id: string;
  created_at: Date;
  expires_at: Date;
}

const ACCOUNT_COLUMNS = 'id, email, email_key, display_name, name_key, password_hash, avatar, last_room, status, team, staff, extra, created_at';
const ACCOUNT_VALUES = '$1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11, $12::jsonb, $13';

export const UPSERT_ACCOUNT_SQL = `INSERT INTO accounts (${ACCOUNT_COLUMNS}) VALUES (${ACCOUNT_VALUES})
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email, email_key = EXCLUDED.email_key,
    display_name = EXCLUDED.display_name, name_key = EXCLUDED.name_key,
    password_hash = EXCLUDED.password_hash, avatar = EXCLUDED.avatar, last_room = EXCLUDED.last_room,
    status = EXCLUDED.status, team = EXCLUDED.team, staff = EXCLUDED.staff, extra = EXCLUDED.extra, updated_at = now()`;

/** Usado pelo importador: nao sobrescreve nada que ja exista (idempotente). */
export const INSERT_ACCOUNT_IGNORE_SQL = `INSERT INTO accounts (${ACCOUNT_COLUMNS}) VALUES (${ACCOUNT_VALUES})
  ON CONFLICT DO NOTHING`;

export const INSERT_SESSION_SQL = `INSERT INTO sessions (token_hash, account_id, created_at, expires_at, ip, user_agent, last_seen)
  VALUES ($1, $2, $3, $4, $5, $6, $7)
  ON CONFLICT (token_hash) DO NOTHING`;

export function accountParams(a: Account): unknown[] {
  const extra: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(a)) if (!COLUMN_FIELDS.has(k) && v !== undefined) extra[k] = v;
  return [
    a.id,
    a.email,
    emailKey(a.email),
    a.displayName,
    nameKey(a.displayName),
    a.passwordHash ?? '',
    JSON.stringify(a.avatar ?? {}),
    a.lastRoom,
    a.status ?? null,
    a.team ?? null,
    a.staff ?? null,
    JSON.stringify(extra),
    new Date(a.createdAt),
  ];
}

export function accountFromRow(r: AccountRow): Account {
  const account = {
    ...(r.extra ?? {}),
    id: r.id,
    email: r.email,
    displayName: r.display_name,
    passwordHash: r.password_hash,
    avatar: sanitizeAvatar(r.avatar as never),
    lastRoom: r.last_room,
    createdAt: r.created_at.getTime(),
  } as Account;
  if (account.outfits) account.outfits = sanitizeOutfits(account.outfits);
  if (r.status !== null) account.status = r.status as Account['status'];
  if (r.team !== null) account.team = r.team;
  if (isStaffLevel(r.staff)) account.staff = r.staff;
  return account;
}

export function sessionParams(s: SessionRecord): unknown[] {
  const extra = s as SessionRecord & { ip?: string; userAgent?: string; lastSeen?: number };
  return [
    s.tokenHash,
    s.accountId,
    new Date(s.createdAt),
    new Date(s.expiresAt),
    extra.ip ?? null,
    extra.userAgent ?? null,
    new Date(extra.lastSeen ?? s.createdAt),
  ];
}

export function sessionFromRow(r: SessionRow): SessionRecord {
  return {
    tokenHash: r.token_hash,
    accountId: r.account_id,
    createdAt: r.created_at.getTime(),
    expiresAt: r.expires_at.getTime(),
  };
}

export interface AuditRow {
  id: string;
  at: Date;
  actor_id: string;
  actor: string;
  level: string | null;
  action: string;
  target_id: string | null;
  target: string | null;
  detail: string | null;
}

export const INSERT_AUDIT_SQL = `INSERT INTO staff_audit (id, at, actor_id, actor, level, action, target_id, target, detail)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT (id) DO NOTHING`;

export function auditParams(r: AuditRecord): unknown[] {
  return [r.id, new Date(r.at), r.actorId, r.actor, r.level, r.action, r.targetId ?? null, r.target ?? null, r.detail ?? null];
}

export function auditFromRow(r: AuditRow): AuditRecord {
  return {
    id: r.id,
    at: r.at.getTime(),
    actorId: r.actor_id,
    actor: r.actor,
    level: isStaffLevel(r.level) ? r.level : null,
    action: r.action,
    ...(r.target_id !== null ? { targetId: r.target_id } : {}),
    ...(r.target !== null ? { target: r.target } : {}),
    ...(r.detail !== null ? { detail: r.detail } : {}),
  };
}
