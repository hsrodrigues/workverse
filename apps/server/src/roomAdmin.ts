import { randomUUID } from 'node:crypto';
import {
  MAX_FURNISH_OPS,
  checkOps,
  isRoomAccess,
  roomAccessOf,
  type ClientMessage,
  type FurnishOp,
  type RoomAccess,
  type RoomDef,
  type RoomInviteView,
  type ServerMessage,
} from '@workverse/shared';
import { can, type Actor, type Decision } from './authz';
import type { Player, RoomInstance } from './room';
import { OPEN_ROOMS, type RoomConfig } from './roomConfig';
import type { OrgService } from './org';
import type { AccountStore } from './store';
import type { OrgWorld } from './orgWorld';

/**
 * Room editor and room access, server side. Every message is re-validated here: the permission (`room.furnish` /
 * `room.access.set`, or a platform staff admin on duty), the room (always one of the caller's own organization), the
 * layout (the very same shared `checkOps` the editor uses), the version (optimistic concurrency) and the rate.
 * Nothing about WHO may edit is taken from the client.
 */

const ROOM_ADMIN_MESSAGES = new Set(['furnish_apply', 'furnish_reset', 'room_access_get', 'room_access_set', 'room_invite_add', 'room_invite_remove', 'meeting_invite']);
export const isRoomAdminMessage = (t: string) => ROOM_ADMIN_MESSAGES.has(t);

export const DEFAULT_INVITE_HOURS = 72;
export const MEETING_INVITE_HOURS = 8;
export const MAX_INVITE_HOURS = 24 * 90;
/** Live invitations one room may hold. */
export const MAX_ROOM_INVITES = 100;

export interface RoomAdminHost {
  store: AccountStore;
  orgService: OrgService;
  roomConfig: RoomConfig;
  clock: () => number;
  log: (event: string, data?: Record<string, unknown>) => void;
  org(orgId: string): OrgWorld;
  /** The organizations that already have a live world (never creates one). */
  orgWorlds(): Iterable<OrgWorld>;
  players(orgId: string): Iterable<Player>;
  isStaffAdmin(p: Player): boolean;
  actorOf(p: Player): Actor;
  canEnter(p: Player, roomId: string): Decision;
  /** Sends the person (and only the person) to a room they may use after losing access: tells them, moves them, drops their media. */
  evict(p: Player, roomId: string, message: string): void;
  sendRooms(p: Player): void;
  findOnline(actor: Pick<Player, 'orgId'>, target: string): { player: Player; send(msg: ServerMessage): void } | undefined;
  mutedFor(accountId: string, now: number): number;
}

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && Math.abs(v) < 1e9;
const isStr = (v: unknown, max = 64): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;

export class RoomAdmin {
  private nextSweep = 0;

  constructor(private readonly host: RoomAdminHost) {}

  /** Returns false for a malformed message (the world counts a strike). */
  handle(p: Player, msg: ClientMessage, now: number): boolean {
    switch (msg.t) {
      case 'furnish_apply':
        return this.furnishApply(p, msg, now);
      case 'furnish_reset':
        return this.furnishReset(p, msg, now);
      case 'room_access_get':
        if (!isStr(msg.roomId)) return false;
        this.accessGet(p, msg.roomId, now);
        return true;
      case 'room_access_set':
        return this.accessSet(p, msg, now);
      case 'room_invite_add':
        return this.inviteAdd(p, msg, now);
      case 'room_invite_remove':
        return this.inviteRemove(p, msg, now);
      case 'meeting_invite':
        return this.meetingInvite(p, msg, now);
      default:
        return false;
    }
  }

  // ---- permissions -----------------------------------------------------------------------------------

  private allowed(p: Player, permission: 'room.furnish' | 'room.access.set'): boolean {
    return this.host.isStaffAdmin(p) || can(this.host.actorOf(p), permission, { orgId: p.orgId }).allow;
  }

  private audit(p: Player, action: string, roomId: string, roomName: string, detail?: string) {
    const at = this.host.clock();
    this.host.store.appendAudit({
      id: randomUUID(),
      at,
      actorId: p.accountId,
      actor: p.name,
      level: p.staff && p.onDuty ? p.staff : null,
      action,
      targetId: `${p.orgId}/${roomId}`,
      target: roomName,
      ...(detail ? { detail: detail.slice(0, 300) } : {}),
    });
    this.host.log(action, { org: p.orgId, room: roomId, by: p.accountId, ...(detail ? { detail } : {}) });
  }

  private result(p: Player, rid: number, r: { ok: boolean; code?: string; message?: string; errors?: ServerMessageOf<'furnish_result'>['errors']; warnings?: ServerMessageOf<'furnish_result'>['warnings']; version?: number }) {
    p.send({ t: 'furnish_result', rid, ...r });
  }

  // ---- layout ----------------------------------------------------------------------------------------

  private editableRoom(p: Player, rid: number): { room: RoomInstance; base: RoomDef } | null {
    if (!this.allowed(p, 'room.furnish')) {
      this.result(p, rid, { ok: false, code: 'forbidden', message: 'Você não tem permissão para decorar salas.' });
      return null;
    }
    if (!p.adminBucket.take(this.host.clock())) {
      this.result(p, rid, { ok: false, code: 'rate_limited', message: 'Calma! Muitas alterações seguidas.' });
      return null;
    }
    // Only the room the person is standing in, of the person's own organization.
    const room = p.roomId ? this.host.org(p.orgId).rooms.get(p.roomId) : undefined;
    const base = room ? this.host.org(p.orgId).baseDefs.get(room.id) : undefined;
    if (!room || !base) {
      this.result(p, rid, { ok: false, code: 'no_room', message: 'Entre na sala que quer decorar.' });
      return null;
    }
    return { room, base };
  }

  private staleReply(p: Player, rid: number, room: RoomInstance) {
    this.result(p, rid, { ok: false, code: 'conflict', message: 'Outra pessoa alterou esta sala antes de você. O layout foi atualizado: refaça a mudança.', version: room.version });
    p.send({ t: 'furniture_changed', roomId: room.id, version: room.version, customized: room.customized, furniture: room.built.def.furniture });
  }

  private furnishApply(p: Player, msg: Extract<ClientMessage, { t: 'furnish_apply' }>, now: number): boolean {
    if (!isInt(msg.rid) || !isInt(msg.base) || !Array.isArray(msg.ops) || msg.ops.length === 0 || msg.ops.length > MAX_FURNISH_OPS) return false;
    for (const o of msg.ops) if (typeof o !== 'object' || o === null || typeof (o as { op?: unknown }).op !== 'string') return false;
    const ctx = this.editableRoom(p, msg.rid);
    if (!ctx) return true;
    const { room, base } = ctx;
    if (msg.base !== room.version) {
      this.staleReply(p, msg.rid, room);
      return true;
    }
    const checked = checkOps(base, room.built.def.furniture, msg.ops as FurnishOp[]);
    if (!checked.ok) {
      const first = checked.errors[0]!;
      this.result(p, msg.rid, { ok: false, code: first.code, message: first.message, errors: checked.errors.slice(0, 8), version: room.version });
      return true;
    }
    this.commit(p, room, checked.list, now, checked.warnings, msg.rid, `${msg.ops.length} alteração(ões)`);
    return true;
  }

  private furnishReset(p: Player, msg: Extract<ClientMessage, { t: 'furnish_reset' }>, now: number): boolean {
    if (!isInt(msg.rid) || !isInt(msg.base)) return false;
    const ctx = this.editableRoom(p, msg.rid);
    if (!ctx) return true;
    const { room } = ctx;
    if (msg.base !== room.version) {
      this.staleReply(p, msg.rid, room);
      return true;
    }
    if (!room.customized) {
      this.result(p, msg.rid, { ok: true, version: room.version });
      return true;
    }
    this.commit(p, room, null, now, [], msg.rid, 'layout original restaurado');
    return true;
  }

  /** Persists (version + 1) and applies live. `list` null = back to the original layout. */
  private commit(p: Player, room: RoomInstance, list: RoomDef['furniture'] | null, now: number, warnings: ServerMessageOf<'furnish_result'>['warnings'], rid: number, detail: string) {
    const orgId = p.orgId;
    const base = this.host.org(orgId).baseDefs.get(room.id)!;
    const version = room.version + 1;
    this.host.store.orgs.putRoomLayout({ orgId, roomId: room.id, version, furniture: list, updatedBy: p.accountId, updatedAt: now });
    const furniture = list ?? base.furniture.map((f) => ({ ...f }));
    room.applyLayout({ ...room.built.def, furniture }, { version, customized: list !== null, by: p.name }, now);
    this.result(p, rid, { ok: true, version, ...(warnings && warnings.length ? { warnings: warnings.slice(0, 8) } : {}) });
    this.audit(p, list === null ? 'room.restore' : 'room.furnish', room.id, room.built.def.name, `v${version}; ${detail}; ${furniture.length} peças`);
  }

  // ---- access ----------------------------------------------------------------------------------------

  private roomOf(p: Player, roomId: string): RoomInstance | undefined {
    return this.host.org(p.orgId).rooms.get(roomId);
  }

  private teamsOf(orgId: string) {
    return this.host.store.orgs.teamsOf(orgId).map((t) => ({ id: t.id, name: t.name }));
  }

  private accessView(orgId: string, room: RoomInstance, now: number): ServerMessageOf<'room_access'> {
    const def = room.built.def;
    const invites: RoomInviteView[] = this.host.roomConfig.liveInvites(orgId, room.id, now).map((r) => {
      const acc = this.host.store.getById(r.accountId);
      const by = this.host.store.getById(r.invitedBy);
      return { accountId: r.accountId, name: acc?.displayName ?? '?', ...(acc ? { email: acc.email } : {}), invitedBy: by?.displayName ?? '—', createdAt: r.createdAt, expiresAt: r.expiresAt };
    });
    return { t: 'room_access', roomId: room.id, access: roomAccessOf(def), teamId: def.accessTeamId ?? null, invites, teams: this.teamsOf(orgId), passTeamIds: this.host.roomConfig.passTeamIds(orgId, room.id), passIsDefault: this.host.roomConfig.passIsDefault(orgId, room.id) };
  }

  private accessGet(p: Player, roomId: string, now: number) {
    if (!this.allowed(p, 'room.access.set')) return p.send({ t: 'error', code: 'forbidden', message: 'Você não tem permissão para isso.' });
    const room = this.roomOf(p, roomId);
    if (!room) return p.send({ t: 'error', code: 'no_room', message: 'Sala não encontrada.' });
    p.send(this.accessView(p.orgId, room, now));
  }

  private accessFail(p: Player, rid: number, code: string, message: string) {
    p.send({ t: 'room_access_result', rid, ok: false, code, message });
  }

  private gate(p: Player, rid: number, now: number): boolean {
    if (!this.allowed(p, 'room.access.set')) return this.accessFail(p, rid, 'forbidden', 'Você não tem permissão para mudar o acesso das salas.'), false;
    if (!p.adminBucket.take(now)) return this.accessFail(p, rid, 'rate_limited', 'Calma! Muitas alterações seguidas.'), false;
    return true;
  }

  private accessSet(p: Player, msg: Extract<ClientMessage, { t: 'room_access_set' }>, now: number): boolean {
    if (!isInt(msg.rid) || !isStr(msg.roomId) || !isRoomAccess(msg.access)) return false;
    if (msg.teamId !== undefined && msg.teamId !== null && !isStr(msg.teamId, 80)) return false;
    if (msg.passTeamIds !== undefined && (!Array.isArray(msg.passTeamIds) || msg.passTeamIds.length > 20 || !msg.passTeamIds.every((x) => isStr(x, 80)))) return false;
    if (!this.gate(p, msg.rid, now)) return true;
    const room = this.roomOf(p, msg.roomId);
    if (!room) return this.accessFail(p, msg.rid, 'no_room', 'Sala não encontrada.'), true;
    if (msg.access !== 'org' && OPEN_ROOMS.includes(room.id)) {
      return this.accessFail(p, msg.rid, 'landing_room', 'A sala inicial e a recepção precisam ficar abertas a toda a organização.'), true;
    }
    let teamId: string | null = null;
    if (msg.access === 'team') {
      const team = typeof msg.teamId === 'string' ? this.host.store.orgs.getTeam(msg.teamId) : undefined;
      // A team of another organization is simply "not found".
      if (!team || team.orgId !== p.orgId) return this.accessFail(p, msg.rid, 'bad_team', 'Escolha uma equipe da organização.'), true;
      teamId = team.id;
    }
    // teams that pass through the lock: only teams of THIS organization (anything else is simply "not found")
    let passTeamIds: string[] | undefined;
    if (msg.passTeamIds !== undefined) {
      const mine = new Set(this.host.store.orgs.teamsOf(p.orgId).filter((t) => t.orgId === p.orgId).map((t) => t.id));
      if (!msg.passTeamIds.every((id) => mine.has(id))) return this.accessFail(p, msg.rid, 'bad_team', 'Escolha equipes da organização.'), true;
      passTeamIds = [...new Set(msg.passTeamIds)];
    }
    this.applyAccess(p.orgId, room, msg.access, teamId, p.accountId, now, passTeamIds);
    this.audit(p, 'room.access', room.id, room.built.def.name, `${msg.access}${teamId ? `; equipe ${teamId}` : ''}${passTeamIds ? `; passam trancada: ${passTeamIds.join(',') || 'ninguém'}` : ''}`);
    p.send({ t: 'room_access_result', rid: msg.rid, ok: true });
    p.send(this.accessView(p.orgId, room, now));
    return true;
  }

  /** Stores and applies a policy, then removes whoever no longer qualifies and refreshes everybody's list of rooms. */
  applyAccess(orgId: string, room: RoomInstance, access: RoomAccess, teamId: string | null, by: string, now: number, passTeamIds?: string[]) {
    const prev = this.host.store.orgs.getRoomSetting(orgId, room.id);
    this.host.store.orgs.putRoomSetting({ orgId, roomId: room.id, access, teamId, passTeamIds: passTeamIds ?? prev?.passTeamIds ?? null, updatedBy: by, updatedAt: now });
    room.built = { ...room.built, def: { ...room.built.def, access, accessTeamId: teamId } };
    this.enforceRoom(orgId, room);
    for (const q of this.host.players(orgId)) this.host.sendRooms(q);
  }

  private resolveTarget(p: Player, who: string): { id: string; name: string } | null {
    const acc = who.includes('@') ? this.host.store.getByEmail(who) : this.host.store.getByName(who.normalize('NFKC').trim());
    if (!acc) return null;
    // Only active members of THIS organization can be invited to its rooms.
    return this.host.orgService.actorFor(acc.id, p.orgId) ? { id: acc.id, name: acc.displayName } : null;
  }

  private inviteAdd(p: Player, msg: Extract<ClientMessage, { t: 'room_invite_add' }>, now: number): boolean {
    if (!isInt(msg.rid) || !isStr(msg.roomId) || !isStr(msg.who, 120)) return false;
    if (msg.hours !== undefined && (typeof msg.hours !== 'number' || !Number.isFinite(msg.hours) || msg.hours < 0 || msg.hours > MAX_INVITE_HOURS)) return false;
    if (!this.gate(p, msg.rid, now)) return true;
    const room = this.roomOf(p, msg.roomId);
    if (!room) return this.accessFail(p, msg.rid, 'no_room', 'Sala não encontrada.'), true;
    const access = roomAccessOf(room.built.def);
    if (access !== 'invited' && access !== 'private') {
      return this.accessFail(p, msg.rid, 'not_invite_room', 'Só salas por convite ou privadas usam convites. Mude o acesso primeiro.'), true;
    }
    const target = this.resolveTarget(p, msg.who);
    if (!target) return this.accessFail(p, msg.rid, 'unknown_person', 'Não encontrei essa pessoa na organização (use o nome ou o e-mail).'), true;
    const live = this.host.roomConfig.liveInvites(p.orgId, room.id, now);
    if (live.length >= MAX_ROOM_INVITES && !live.some((r) => r.accountId === target.id)) {
      return this.accessFail(p, msg.rid, 'invite_limit', `A sala já tem ${MAX_ROOM_INVITES} convites.`), true;
    }
    const hours = msg.hours === undefined ? DEFAULT_INVITE_HOURS : msg.hours;
    this.grant(p.orgId, room, target.id, p.accountId, hours === 0 ? null : now + hours * 3_600_000, now);
    this.audit(p, 'room.invite', room.id, room.built.def.name, `${target.name}; ${hours === 0 ? 'sem validade' : `${hours} h`}`);
    p.send({ t: 'room_access_result', rid: msg.rid, ok: true });
    p.send(this.accessView(p.orgId, room, now));
    return true;
  }

  /** Writes an invitation and tells the guest their list of rooms changed. */
  grant(orgId: string, room: RoomInstance, accountId: string, by: string, expiresAt: number | null, now: number) {
    this.host.store.orgs.putRoomInvite({ orgId, roomId: room.id, accountId, invitedBy: by, createdAt: now, expiresAt });
    for (const q of this.host.players(orgId)) if (q.accountId === accountId) this.host.sendRooms(q);
  }

  private inviteRemove(p: Player, msg: Extract<ClientMessage, { t: 'room_invite_remove' }>, now: number): boolean {
    if (!isInt(msg.rid) || !isStr(msg.roomId) || !isStr(msg.accountId, 80)) return false;
    if (!this.gate(p, msg.rid, now)) return true;
    const room = this.roomOf(p, msg.roomId);
    if (!room) return this.accessFail(p, msg.rid, 'no_room', 'Sala não encontrada.'), true;
    const row = this.host.store.orgs.getRoomInvite(p.orgId, room.id, msg.accountId);
    if (!row) return this.accessFail(p, msg.rid, 'not_found', 'Esse convite não existe.'), true;
    this.host.store.orgs.deleteRoomInvite(p.orgId, room.id, msg.accountId);
    // Revoking is immediate: whoever is inside and no longer qualifies is moved out, and the media token goes with them.
    this.enforceRoom(p.orgId, room);
    for (const q of this.host.players(p.orgId)) if (q.accountId === msg.accountId) this.host.sendRooms(q);
    this.audit(p, 'room.uninvite', room.id, room.built.def.name, this.host.store.getById(msg.accountId)?.displayName ?? msg.accountId);
    p.send({ t: 'room_access_result', rid: msg.rid, ok: true });
    p.send(this.accessView(p.orgId, room, now));
    return true;
  }

  private meetingInvite(p: Player, msg: Extract<ClientMessage, { t: 'meeting_invite' }>, now: number): boolean {
    if (!isStr(msg.target, 64)) return false;
    const room = p.roomId ? this.host.org(p.orgId).rooms.get(p.roomId) : undefined;
    if (!room) return true;
    if (this.host.mutedFor(p.accountId, now) > 0) return p.send({ t: 'error', code: 'muted', message: 'Você está silenciado.' }), true;
    if (!p.chatBucket.take(now)) return p.send({ t: 'error', code: 'rate_limited', message: 'Calma! Você está falando rápido demais.' }), true;
    const target = this.host.findOnline(p, msg.target);
    if (!target) return p.send({ t: 'error', code: 'dm_offline', message: 'Essa pessoa não está online.' }), true;
    const t = target.player;
    if (t.accountId === p.accountId) return p.send({ t: 'error', code: 'dm_self', message: 'Você não pode convidar a si mesmo.' }), true;
    const dm = can(this.host.actorOf(p), 'dm.send', { orgId: t.orgId, targetAccountId: t.accountId, targetRole: t.role, sameRoom: p.roomId === t.roomId, sameTeam: !!p.teamId && p.teamId === t.teamId });
    if (!dm.allow) return p.send({ t: 'error', code: 'dm_forbidden', message: 'Você não pode enviar mensagem para essa pessoa.' }), true;

    const def = room.built.def;
    const access = roomAccessOf(def);
    if (access === 'invited' || access === 'private') {
      // Letting somebody into a restricted room is a decision of whoever manages its access, never of any visitor.
      if (!this.allowed(p, 'room.access.set')) return p.send({ t: 'error', code: 'forbidden', message: 'Só quem administra o acesso pode convidar para uma sala restrita.' }), true;
      this.grant(p.orgId, room, t.accountId, p.accountId, now + MEETING_INVITE_HOURS * 3_600_000, now);
      this.audit(p, 'room.invite', room.id, def.name, `${t.name}; ${MEETING_INVITE_HOURS} h; reunião`);
    }
    const text = `${p.name} convidou você para a sala ${access === 'private' ? 'privada' : def.name}.`;
    target.send({ t: 'dm', peerId: p.accountId, peer: p.name, self: false, text, at: now, roomInvite: { roomId: room.id, roomName: def.name } });
    p.send({ t: 'dm', peerId: t.accountId, peer: t.name, self: true, text: `Convite enviado para ${t.name}.`, at: now });
    return true;
  }

  // ---- enforcement -----------------------------------------------------------------------------------

  /** Moves out everyone in the room who may no longer be there. */
  enforceRoom(orgId: string, room: RoomInstance) {
    for (const q of [...room.players.values()]) {
      if (q.orgId !== orgId) continue;
      const d = this.host.canEnter(q, room.id);
      if (!d.allow) this.host.evict(q, room.id, `Seu acesso à sala ${room.built.def.name} foi removido.`);
    }
  }

  /** After a role/team change or a removal: re-check the room the person is in. */
  enforcePlayer(p: Player) {
    if (!p.roomId) return;
    if (!this.host.canEnter(p, p.roomId).allow) this.host.evict(p, p.roomId, 'Seu acesso a essa sala foi removido.');
  }

  /** Invitations that ran out: runs about every two seconds from the world tick. */
  sweep(now: number) {
    if (now < this.nextSweep) return;
    this.nextSweep = now + 2000;
    for (const w of this.host.orgWorlds()) {
      for (const room of w.rooms.values()) {
        if (room.players.size === 0 || roomAccessOf(room.built.def) === 'org') continue;
        this.enforceRoom(w.id, room);
      }
    }
  }
}

type ServerMessageOf<T extends ServerMessage['t']> = Extract<ServerMessage, { t: T }>;

