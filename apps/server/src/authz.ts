import { ROLE_RANK, roleHas, type Permission, type Role, type RoomAccess } from '@workverse/shared';

/**
 * Central authorization. Every WebSocket message (see MESSAGE_POLICY) and every HTTP route that touches an
 * organization goes through `can()`. The actor always comes from the server-side session / membership, and the
 * resource's orgId from the stored resource, never from a request body.
 */

/** The "organization" of actions that happen before any org exists (creating one). */
export const NO_ORG = '';

export interface Actor {
  accountId: string;
  orgId: string;
  role: Role;
  teamId: string | null;
}

export interface Resource {
  /** Organization that owns the resource. Different from the actor's: always denied. */
  orgId: string;
  /** Team the resource belongs to (announcements, team chat). */
  teamId?: string | null;
  // member.remove / member.role.set / member.invite
  targetAccountId?: string;
  targetRole?: Role;
  /** Role being granted (role change) or offered (invite). */
  newRole?: Role;
  /** Removing / demoting this person would leave the organization without an owner. */
  isLastOwner?: boolean;
  // room.enter
  guestAllowed?: boolean;
  /** Access policy of the target room (default `org`) and the team it admits when `team`. */
  roomAccess?: RoomAccess;
  roomTeamId?: string | null;
  /** The actor holds a live invitation to the room (`invited` / `private` rooms). */
  invited?: boolean;
  /** The actor's team is one the room lets through even when it is locked (see roomConfig.passTeamIds). */
  passTeam?: boolean;
  // dm.send
  sameRoom?: boolean;
  sameTeam?: boolean;
}

export interface Decision {
  allow: boolean;
  reason: string;
}

const ALLOW: Decision = { allow: true, reason: 'ok' };
const deny = (reason: string): Decision => ({ allow: false, reason });

export function can(actor: Actor, action: Permission, resource: Resource): Decision {
  // Rule zero: nothing crosses organizations.
  if (actor.orgId !== resource.orgId) return deny('cross_org');
  if (actor.orgId === NO_ORG && action !== 'org.create') return deny('no_org');
  if (!roleHas(actor.role, action)) return deny('role_forbidden');

  switch (action) {
    case 'room.enter':
      if (actor.role === 'guest' && resource.guestAllowed !== true) return deny('guest_room');
      return roomAccessDecision(actor, resource);

    case 'chat.team':
      if (!actor.teamId) return deny('no_team');
      if (resource.teamId !== undefined && resource.teamId !== actor.teamId) return deny('other_team');
      return ALLOW;

    case 'announce.team':
      // Admins and owners may address any team of their org; the team must be named.
      return resource.teamId ? ALLOW : deny('no_team');

    case 'dm.send':
      // A guest only talks with people who share the room or the team that invited them (and vice versa).
      if ((actor.role === 'guest' || resource.targetRole === 'guest') && !(resource.sameRoom || resource.sameTeam)) {
        return deny('guest_dm');
      }
      return ALLOW;

    case 'member.invite':
      if (!resource.newRole) return deny('no_role');
      if (ROLE_RANK[resource.newRole] > ROLE_RANK[actor.role]) return deny('escalation');
      return ALLOW;

    case 'member.remove': {
      if (!resource.targetRole) return deny('no_target');
      if (resource.isLastOwner) return deny('last_owner');
      if (actor.role !== 'owner' && ROLE_RANK[resource.targetRole] >= ROLE_RANK[actor.role]) return deny('hierarchy');
      return ALLOW;
    }

    case 'member.role.set': {
      if (!resource.targetRole || !resource.newRole) return deny('no_target');
      if (actor.role !== 'owner' && ROLE_RANK[resource.targetRole] >= ROLE_RANK[actor.role]) return deny('hierarchy');
      if (ROLE_RANK[resource.newRole] > ROLE_RANK[actor.role]) return deny('escalation');
      if (resource.isLastOwner && resource.newRole !== 'owner') return deny('last_owner');
      return ALLOW;
    }

    default:
      return ALLOW;
  }
}

/**
 * Who gets into a room by its access policy. Owners and admins of the organization always do (the platform staff admin on duty
 * is handled by the world, which knows about the duty state). Everybody else needs the team, or a live invitation.
 */
function roomAccessDecision(actor: Actor, resource: Resource): Decision {
  const access = resource.roomAccess ?? 'org';
  if (access === 'org') return ALLOW;
  if (actor.role === 'owner' || actor.role === 'admin') return ALLOW;
  // a team the room always lets through (e.g. IT into the IT room); guests were already refused for rooms closed to guests
  if (resource.passTeam === true) return ALLOW;
  if (access === 'team') return actor.teamId && actor.teamId === resource.roomTeamId ? ALLOW : deny('room_team');
  return resource.invited === true ? ALLOW : deny('room_invite');
}

// ---- WebSocket message policy ---------------------------------------------------------------------

/**
 * Permission each client-to-server message needs; `null` means it is allowed before/without a session
 * (handshake). A test (authz.test.ts) fails when a message type of the protocol is missing from this table,
 * and World.handle refuses types that are not listed here.
 */
export const MESSAGE_POLICY: Readonly<Record<string, Permission | null>> = {
  hello: null,
  ping: null,

  join: 'room.enter',
  move: 'room.enter',
  interact: 'room.enter',
  emote: 'room.enter',
  activity: 'room.enter',
  chat: 'chat.say',
  status: 'presence.set',
  dm: 'dm.send',
  team: 'chat.team',

  // avatar editor / wardrobe
  avatar: 'avatar.edit',
  wardrobe_get: 'avatar.edit',
  avatar_save: 'avatar.edit',
  outfit_save: 'avatar.edit',
  outfit_delete: 'avatar.edit',
  outfit_apply: 'avatar.edit',

  // auditorium: the audience may ask for the floor; the rest is the speaker's
  stage_alive: 'stage.attend',
  hand_raise: 'stage.attend',
  hand_lower: 'stage.attend',
  stage_take: 'stage.host',
  stage_release: 'stage.host',
  voice_grant: 'stage.host',
  voice_revoke: 'stage.host',
  deck_set: 'stage.host',
  present_start: 'stage.host',
  present_end: 'stage.host',
  slide_goto: 'stage.host',
  deck_clear: 'stage.host',
  stage_open: 'stage.host',
  stage_close: 'stage.host',

  // room editor and access (the platform staff admin on duty is let through by the world, see World.authorize)
  furnish_apply: 'room.furnish',
  furnish_reset: 'room.furnish',
  room_access_get: 'room.access.set',
  room_access_set: 'room.access.set',
  room_invite_add: 'room.access.set',
  room_invite_remove: 'room.access.set',
  meeting_invite: 'dm.send',
  dir_search: 'dir.search',

  // staff da plataforma: a checagem real (nível, serviço, alvo, taxa) fica em staff.ts; sem sessão nada chega até lá
  staff_duty: null,
  staff_invis: null,
  staff_list: null,
  staff_mute: null,
  staff_kick: null,
  staff_goto: null,
  staff_bring: null,
  staff_announce: null,
  staff_item: null,
  staff_dm: null,
  staff_rooms: null,
  staff_room: null,
  staff_event: null,
};

