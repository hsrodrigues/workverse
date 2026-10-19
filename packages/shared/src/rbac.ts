/**
 * Roles and permissions of an organization. The server is the only authority (apps/server/src/authz.ts);
 * the client uses the same table just to hide UI the person cannot use.
 */

export const ROLES = ['owner', 'admin', 'member', 'guest'] as const;
export type Role = (typeof ROLES)[number];

/** Higher is more powerful. */
export const ROLE_RANK: Record<Role, number> = { owner: 4, admin: 3, member: 2, guest: 1 };
export const isRole = (v: unknown): v is Role => typeof v === 'string' && (ROLES as readonly string[]).includes(v);

export const PERMISSIONS = [
  // organization administration
  'org.create',
  'org.manage',
  'member.invite',
  'member.remove',
  'member.role.set',
  'team.manage',
  'audit.read',
  // rooms (the layout of an org's rooms)
  'room.create',
  'room.edit',
  'room.furnish',
  'room.access.set',
  // announcements, work tools
  'announce.team',
  'announce.org',
  'file.upload',
  'task.manage',
  'event.create',
  // day-to-day presence in the office
  'room.enter',
  'chat.say',
  'chat.team',
  'dm.send',
  'presence.set',
  'avatar.edit',
  'media.use',
  'stage.attend',
  'stage.host',
  // diretorio da recepcao (buscar colegas por setor e nome); visitantes nao listam a organizacao
  'dir.search',
] as const;
export type Permission = (typeof PERMISSIONS)[number];
export const isPermission = (v: unknown): v is Permission => typeof v === 'string' && (PERMISSIONS as readonly string[]).includes(v);

const DAILY: Permission[] = ['room.enter', 'chat.say', 'dm.send', 'presence.set', 'avatar.edit', 'media.use', 'stage.attend'];
const MEMBER: Permission[] = [...DAILY, 'dir.search', 'chat.team', 'stage.host', 'file.upload', 'task.manage', 'event.create'];
const ADMIN: Permission[] = [
  ...MEMBER,
  'member.invite',
  'member.remove',
  'member.role.set',
  'team.manage',
  'audit.read',
  'room.create',
  'room.edit',
  'room.furnish',
  'room.access.set',
  'announce.team',
  'announce.org',
];

/** Role -> permissions. Nothing is implied: a permission missing here is denied. */
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  owner: [...ADMIN, 'org.manage', 'org.create'],
  admin: [...ADMIN, 'org.create'],
  member: [...MEMBER, 'org.create'],
  // Guests: talk, listen and show up; chat.team only applies when the invite put them on a team.
  guest: [...DAILY, 'chat.team'],
};

export const roleHas = (role: Role, permission: Permission): boolean => ROLE_PERMISSIONS[role].includes(permission);
export const permissionsOf = (role: Role): Permission[] => [...ROLE_PERMISSIONS[role]];

// ---- API views ---------------------------------------------------------------------------------

export type MemberStatus = 'active' | 'suspended';

export interface OrgSummary {
  id: string;
  slug: string;
  name: string;
  role: Role;
  teamId: string | null;
  perms: Permission[];
}

export interface TeamView {
  id: string;
  name: string;
  color: string;
}

export interface MemberView {
  accountId: string;
  displayName: string;
  /** Cargo (texto curto) definido por quem administra. */
  title?: string;
  /** Only visible to people who can manage members. */
  email?: string;
  role: Role;
  teamId: string | null;
  status: MemberStatus;
}

export interface InviteView {
  id: string;
  email: string | null;
  role: Role;
  teamId: string | null;
  expiresAt: number;
  maxUses: number;
  uses: number;
  revokedAt: number | null;
  createdBy: string;
}

/** Answer of GET /api/orgs/me. `active` carries the lists for one org (the one chosen with ?orgId=, or the current). */
export interface OrgsMeResponse {
  orgs: OrgSummary[];
  active: {
    org: OrgSummary;
    teams: TeamView[];
    members: MemberView[];
    invites: InviteView[];
  } | null;
}

export interface InvitePreview {
  orgName: string;
  role: Role;
  teamName: string | null;
  expiresAt: number;
  /** True when the invite is tied to an e-mail (which is not revealed). */
  emailBound: boolean;
}

/** Slug of the organization every legacy account is migrated into. */
export const DEFAULT_ORG_ID = 'default';
export const DEFAULT_ORG_NAME = 'WorkVerse';
export const DEFAULT_TEAM_ID = 'default-geral';
