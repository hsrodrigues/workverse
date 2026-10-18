import type { MemberStatus, Role } from '@workverse/shared';

/**
 * Organizations, memberships, teams and invites, kept in memory and mirrored by the persistent stores
 * (JSON file / PostgreSQL) through `onOp`. Everything here is plain data: the rules live in org.ts and authz.ts.
 */

export interface Org {
  id: string;
  /** Unique, lowercase. */
  slug: string;
  name: string;
  settings: Record<string, unknown>;
  createdAt: number;
}

export interface OrgMember {
  orgId: string;
  accountId: string;
  role: Role;
  teamId: string | null;
  status: MemberStatus;
  createdAt: number;
}

export interface Team {
  id: string;
  orgId: string;
  name: string;
  color: string;
}

export interface Invite {
  id: string;
  orgId: string;
  /** When set, only the account with this e-mail can accept. */
  email: string | null;
  role: Role;
  teamId: string | null;
  /** sha256 of the token; the token itself is shown once and never stored. */
  tokenHash: string;
  createdBy: string;
  createdAt: number;
  expiresAt: number;
  maxUses: number;
  uses: number;
  revokedAt: number | null;
}

export interface OrgData {
  orgs: Org[];
  members: OrgMember[];
  teams: Team[];
  invites: Invite[];
}

/** Change notifications for persistence. Every put is an upsert. */
export type OrgOp =
  | { kind: 'org'; row: Org }
  | { kind: 'member'; row: OrgMember }
  | { kind: 'member_delete'; orgId: string; accountId: string }
  | { kind: 'team'; row: Team }
  | { kind: 'invite'; row: Invite };

const memberKey = (orgId: string, accountId: string) => `${orgId}\u0000${accountId}`;

export class OrgStore {
  private readonly orgs = new Map<string, Org>();
  private readonly members = new Map<string, OrgMember>();
  private readonly teams = new Map<string, Team>();
  private readonly invites = new Map<string, Invite>();
  /** Set by the persistent store; not called while loading. */
  onOp: ((op: OrgOp) => void) | null = null;

  // ---- orgs
  getOrg(id: string): Org | undefined {
    return this.orgs.get(id);
  }
  getOrgBySlug(slug: string): Org | undefined {
    for (const o of this.orgs.values()) if (o.slug === slug) return o;
    return undefined;
  }
  listOrgs(): Org[] {
    return [...this.orgs.values()];
  }
  putOrg(org: Org): void {
    const clash = this.getOrgBySlug(org.slug);
    if (clash && clash.id !== org.id) throw new Error(`duplicate slug ${org.slug}`);
    this.orgs.set(org.id, org);
    this.onOp?.({ kind: 'org', row: org });
  }

  // ---- members
  getMember(orgId: string, accountId: string): OrgMember | undefined {
    return this.members.get(memberKey(orgId, accountId));
  }
  membersOf(orgId: string): OrgMember[] {
    return [...this.members.values()].filter((m) => m.orgId === orgId);
  }
  membershipsOf(accountId: string): OrgMember[] {
    return [...this.members.values()].filter((m) => m.accountId === accountId);
  }
  putMember(m: OrgMember): void {
    this.members.set(memberKey(m.orgId, m.accountId), m);
    this.onOp?.({ kind: 'member', row: m });
  }
  deleteMember(orgId: string, accountId: string): void {
    if (this.members.delete(memberKey(orgId, accountId))) this.onOp?.({ kind: 'member_delete', orgId, accountId });
  }

  // ---- teams
  getTeam(id: string): Team | undefined {
    return this.teams.get(id);
  }
  teamsOf(orgId: string): Team[] {
    return [...this.teams.values()].filter((t) => t.orgId === orgId);
  }
  putTeam(t: Team): void {
    this.teams.set(t.id, t);
    this.onOp?.({ kind: 'team', row: t });
  }

  // ---- invites
  getInvite(id: string): Invite | undefined {
    return this.invites.get(id);
  }
  getInviteByHash(tokenHash: string): Invite | undefined {
    for (const i of this.invites.values()) if (i.tokenHash === tokenHash) return i;
    return undefined;
  }
  invitesOf(orgId: string): Invite[] {
    return [...this.invites.values()].filter((i) => i.orgId === orgId);
  }
  putInvite(i: Invite): void {
    this.invites.set(i.id, i);
    this.onOp?.({ kind: 'invite', row: i });
  }

  // ---- bulk (persistence)
  snapshot(): OrgData {
    return {
      orgs: [...this.orgs.values()],
      members: [...this.members.values()],
      teams: [...this.teams.values()],
      invites: [...this.invites.values()],
    };
  }

  /** Loads rows without notifying `onOp`. */
  load(data: Partial<OrgData>): void {
    for (const o of data.orgs ?? []) this.orgs.set(o.id, o);
    for (const t of data.teams ?? []) this.teams.set(t.id, t);
    for (const m of data.members ?? []) this.members.set(memberKey(m.orgId, m.accountId), m);
    for (const i of data.invites ?? []) this.invites.set(i.id, i);
  }

  get isEmpty(): boolean {
    return this.orgs.size === 0;
  }
}
