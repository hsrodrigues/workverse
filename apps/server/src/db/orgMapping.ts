import type { Furniture, Role, MemberStatus, RoomAccess } from '@workverse/shared';
import type { Invite, Org, OrgData, OrgMember, OrgOp, RoomInviteRow, RoomLayout, RoomSetting, Team } from '../orgStore';

/** Mapeamento OrgStore <-> tabelas orgs / teams / org_members / invites (migracao 0002). */

export interface OrgRows {
  orgs: Array<{ id: string; slug: string; name: string; settings: Record<string, unknown> | null; created_at: Date }>;
  teams: Array<{ id: string; org_id: string; name: string; color: string }>;
  members: Array<{ org_id: string; account_id: string; role: string; team_id: string | null; status: string; created_at: Date; title?: string | null }>;
  invites: Array<{
    id: string;
    org_id: string;
    email: string | null;
    role: string;
    team_id: string | null;
    token_hash: string;
    created_by: string | null;
    created_at: Date;
    expires_at: Date;
    max_uses: number;
    uses: number;
    revoked_at: Date | null;
  }>;
  /** Migracao 0005; ausentes em bancos antigos (lista vazia). */
  roomFurniture?: Array<{ org_id: string; room_id: string; version: number; furniture: Furniture[] | null; updated_by: string | null; updated_at: Date }>;
  roomSettings?: Array<{ org_id: string; room_id: string; access: string; team_id: string | null; updated_by: string | null; updated_at: Date }>;
  roomInvites?: Array<{ org_id: string; room_id: string; account_id: string; invited_by: string | null; created_at: Date; expires_at: Date | null }>;
}

export function orgDataFromRows(r: OrgRows): OrgData {
  return {
    orgs: r.orgs.map((o): Org => ({ id: o.id, slug: o.slug, name: o.name, settings: o.settings ?? {}, createdAt: o.created_at.getTime() })),
    teams: r.teams.map((t): Team => ({ id: t.id, orgId: t.org_id, name: t.name, color: t.color })),
    members: r.members.map(
      (m): OrgMember => ({
        orgId: m.org_id,
        accountId: m.account_id,
        role: m.role as Role,
        teamId: m.team_id,
        status: m.status as MemberStatus,
        createdAt: m.created_at.getTime(),
        ...(m.title ? { title: m.title } : {}),
      }),
    ),
    invites: r.invites.map(
      (i): Invite => ({
        id: i.id,
        orgId: i.org_id,
        email: i.email,
        role: i.role as Role,
        teamId: i.team_id,
        tokenHash: i.token_hash,
        createdBy: i.created_by ?? '',
        createdAt: i.created_at.getTime(),
        expiresAt: i.expires_at.getTime(),
        maxUses: i.max_uses,
        uses: i.uses,
        revokedAt: i.revoked_at ? i.revoked_at.getTime() : null,
      }),
    ),
    roomLayouts: (r.roomFurniture ?? []).map(
      (l): RoomLayout => ({ orgId: l.org_id, roomId: l.room_id, version: l.version, furniture: l.furniture, updatedBy: l.updated_by ?? '', updatedAt: l.updated_at.getTime() }),
    ),
    roomSettings: (r.roomSettings ?? []).map(
      (l): RoomSetting => ({ orgId: l.org_id, roomId: l.room_id, access: l.access as RoomAccess, teamId: l.team_id, updatedBy: l.updated_by ?? '', updatedAt: l.updated_at.getTime() }),
    ),
    roomInvites: (r.roomInvites ?? []).map(
      (l): RoomInviteRow => ({
        orgId: l.org_id,
        roomId: l.room_id,
        accountId: l.account_id,
        invitedBy: l.invited_by ?? '',
        createdAt: l.created_at.getTime(),
        expiresAt: l.expires_at ? l.expires_at.getTime() : null,
      }),
    ),
  };
}

export const UPSERT_ORG_SQL = `INSERT INTO orgs (id, slug, name, settings, created_at) VALUES ($1, $2, $3, $4::jsonb, $5)
  ON CONFLICT (id) DO UPDATE SET slug = EXCLUDED.slug, name = EXCLUDED.name, settings = EXCLUDED.settings`;

export const UPSERT_TEAM_SQL = `INSERT INTO teams (id, org_id, name, color) VALUES ($1, $2, $3, $4)
  ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, color = EXCLUDED.color`;

export const UPSERT_MEMBER_SQL = `INSERT INTO org_members (org_id, account_id, role, team_id, status, created_at, title) VALUES ($1, $2, $3, $4, $5, $6, $7)
  ON CONFLICT (org_id, account_id) DO UPDATE SET role = EXCLUDED.role, team_id = EXCLUDED.team_id, status = EXCLUDED.status, title = EXCLUDED.title`;

export const DELETE_MEMBER_SQL = 'DELETE FROM org_members WHERE org_id = $1 AND account_id = $2';

export const UPSERT_INVITE_SQL = `INSERT INTO invites (id, org_id, email, role, team_id, token_hash, created_by, created_at, expires_at, max_uses, uses, revoked_at)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
  ON CONFLICT (id) DO UPDATE SET uses = EXCLUDED.uses, revoked_at = EXCLUDED.revoked_at, expires_at = EXCLUDED.expires_at`;

export const UPSERT_ROOM_FURNITURE_SQL = `INSERT INTO room_furniture (org_id, room_id, version, furniture, updated_by, updated_at) VALUES ($1, $2, $3, $4::jsonb, $5, $6)
  ON CONFLICT (org_id, room_id) DO UPDATE SET version = EXCLUDED.version, furniture = EXCLUDED.furniture, updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at`;

export const UPSERT_ROOM_SETTING_SQL = `INSERT INTO room_settings (org_id, room_id, access, team_id, updated_by, updated_at) VALUES ($1, $2, $3, $4, $5, $6)
  ON CONFLICT (org_id, room_id) DO UPDATE SET access = EXCLUDED.access, team_id = EXCLUDED.team_id, updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at`;

export const UPSERT_ROOM_INVITE_SQL = `INSERT INTO room_invites (org_id, room_id, account_id, invited_by, created_at, expires_at) VALUES ($1, $2, $3, $4, $5, $6)
  ON CONFLICT (org_id, room_id, account_id) DO UPDATE SET invited_by = EXCLUDED.invited_by, created_at = EXCLUDED.created_at, expires_at = EXCLUDED.expires_at`;

export const DELETE_ROOM_INVITE_SQL = 'DELETE FROM room_invites WHERE org_id = $1 AND room_id = $2 AND account_id = $3';

/** SQL + parametros + chave de fusao para uma mudanca do OrgStore. */
export function opToSql(op: OrgOp): { sql: string; params: unknown[]; key?: string } {
  switch (op.kind) {
    case 'org': {
      const o = op.row;
      return { sql: UPSERT_ORG_SQL, params: [o.id, o.slug, o.name, JSON.stringify(o.settings ?? {}), new Date(o.createdAt)], key: `org:${o.id}` };
    }
    case 'team': {
      const t = op.row;
      return { sql: UPSERT_TEAM_SQL, params: [t.id, t.orgId, t.name, t.color], key: `team:${t.id}` };
    }
    case 'member': {
      const m = op.row;
      // Sem chave de fusao: remover e readicionar o mesmo vinculo precisa respeitar a ordem das operacoes.
      return { sql: UPSERT_MEMBER_SQL, params: [m.orgId, m.accountId, m.role, m.teamId, m.status, new Date(m.createdAt), m.title ?? null] };
    }
    case 'member_delete':
      return { sql: DELETE_MEMBER_SQL, params: [op.orgId, op.accountId] };
    case 'invite': {
      const i = op.row;
      return {
        sql: UPSERT_INVITE_SQL,
        params: [
          i.id,
          i.orgId,
          i.email,
          i.role,
          i.teamId,
          i.tokenHash,
          i.createdBy || null,
          new Date(i.createdAt),
          new Date(i.expiresAt),
          i.maxUses,
          i.uses,
          i.revokedAt === null ? null : new Date(i.revokedAt),
        ],
        key: `invite:${i.id}`,
      };
    }
    case 'room_layout': {
      const l = op.row;
      return {
        sql: UPSERT_ROOM_FURNITURE_SQL,
        params: [l.orgId, l.roomId, l.version, l.furniture === null ? null : JSON.stringify(l.furniture), l.updatedBy || null, new Date(l.updatedAt)],
        key: `room_furniture:${l.orgId}:${l.roomId}`,
      };
    }
    case 'room_setting': {
      const l = op.row;
      return { sql: UPSERT_ROOM_SETTING_SQL, params: [l.orgId, l.roomId, l.access, l.teamId, l.updatedBy || null, new Date(l.updatedAt)], key: `room_setting:${l.orgId}:${l.roomId}` };
    }
    // Sem chave de fusao: convidar, remover e convidar de novo precisa manter a ordem.
    case 'room_invite': {
      const l = op.row;
      return { sql: UPSERT_ROOM_INVITE_SQL, params: [l.orgId, l.roomId, l.accountId, l.invitedBy || null, new Date(l.createdAt), l.expiresAt === null ? null : new Date(l.expiresAt)] };
    }
    case 'room_invite_delete':
      return { sql: DELETE_ROOM_INVITE_SQL, params: [op.orgId, op.roomId, op.accountId] };
  }
}
