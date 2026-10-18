import { createHash, randomUUID } from 'node:crypto';
import {
  DEFAULT_ROOM_ID,
  MAX_NAME_LENGTH,
  MIN_NAME_LENGTH,
  NAME_PATTERN,
  ROOM_DEFS,
  sanitizeAvatar,
  EMOTES,
  AUTO_AWAY_MS,
  DEFAULT_TEAM,
  MAX_DM_TARGET_LENGTH,
  isPresenceStatus,
  isActivity,
  type PresenceStatus,
  type ClientMessage,
  type Dir8,
  type Emote,
  type Point,
  type ServerMessage,
} from '@workverse/shared';
import { isAvatarClientMessage, type AvatarClientMessage } from '@workverse/shared';
import { DEV_UNLOCK_ALL, handleWardrobeMessage, parseUnlockKey, setUnlock } from './wardrobe';
import { Player, RoomInstance, cleanChat } from './room';
import { StageManager, isStageMessage, type PermissionSync } from './stage';
import type { Account, AccountStore } from './store';
import { DEFAULT_ORG_ID, permissionsOf, type Role } from '@workverse/shared';
import { MESSAGE_POLICY, can, type Actor, type Resource } from './authz';
import { OrgService } from './org';
import { OrgWorld } from './orgWorld';
import { StaffService, applyBootstrapStaff, isStaffMessage, parseStaffEmails } from './staff';
import { accessBlock } from './accountState';
import type { RoomAdminEntry, RoomOp } from '@workverse/shared';

export interface Connection {
  send(msg: ServerMessage): void;
  close(code?: number, reason?: string): void;
  player?: Player;
  /** Account authenticated by the session cookie during the WebSocket upgrade. */
  accountId?: string;
  /** Hash of the session cookie behind this connection, so logout only ends its own socket. */
  sessionHash?: string;
  /** Count of malformed messages; the connection is dropped past a threshold. */
  strikes: number;
}

export interface WorldOptions {
  store: AccountStore;
  /** Accept name-only `hello` (development, bots, e2e). Never enable in production. */
  allowDevLogin?: boolean;
  clock?: () => number;
  /** Inactivity before a player is marked away automatically. Default 5 minutes. */
  idleAwayMs?: number;
  log?: (event: string, data?: Record<string, unknown>) => void;
  /** Pushes publish-permission changes to LiveKit for people already connected (see media.ts). */
  permissionSync?: PermissionSync;
  /** E-mail that becomes owner of the default org when the first accounts are migrated (BOOTSTRAP_OWNER_EMAIL). */
  bootstrapOwnerEmail?: string;
  /** `email[:nivel],...` das contas que viram staff da plataforma (BOOTSTRAP_STAFF_EMAILS). Unica via de concessao alem do CLI. */
  bootstrapStaffEmails?: string;
}

const MAX_STRIKES = 20;

export function normalizeName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const name = raw.normalize('NFKC').replace(/\s+/g, ' ').trim();
  if (name.length < MIN_NAME_LENGTH || name.length > MAX_NAME_LENGTH) return null;
  if (!NAME_PATTERN.test(name)) return null;
  // Homoglyph spoofing ("Аdmin" with a Cyrillic A): Latin letters may not be mixed with Cyrillic or Greek ones.
  if (/\p{Script=Latin}/u.test(name) && /[\p{Script=Cyrillic}\p{Script=Greek}]/u.test(name)) return null;
  return name;
}

/** Names that would pass for the platform itself; refused at registration (staff are recognised by the server-enforced badge). */
const RESERVED_NAMES = /^(admin|administrador|administrator|root|staff|equipe|system|sistema|workverse|suporte|support|moderador|moderator|mod|bot|server|servidor|owner|dono)$/;
export function isReservedName(name: string): boolean {
  return RESERVED_NAMES.test(name.normalize('NFKC').toLowerCase().replace(/[\s_-]+/g, ''));
}

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && Math.abs(v) < 10_000;

export class World {
  /** Live state per organization. Nothing in here is shared between two organizations. */
  readonly orgWorlds = new Map<string, OrgWorld>();
  readonly orgService: OrgService;
  private readonly permissionSync?: PermissionSync;
  /** Staff da plataforma (moderacao, auditoria): ver staff.ts e docs/staff.md. */
  readonly staff: StaffService;
  private readonly online = new Map<string, { player: Player; conn: Connection; account: Account }>();
  /** Salas trancadas / fechadas pela staff (chave `org\0sala`). Em memoria: voltam abertas ao reiniciar o servidor. */
  private readonly roomLocks = new Map<string, 'locked' | 'closed'>();
  private readonly store: AccountStore;
  private readonly allowDevLogin: boolean;
  private readonly clock: () => number;
  private readonly idleAwayMs: number;
  private readonly log: (event: string, data?: Record<string, unknown>) => void;
  constructor(opts: WorldOptions) {
    this.store = opts.store;
    this.allowDevLogin = opts.allowDevLogin === true;
    this.clock = opts.clock ?? Date.now;
    this.idleAwayMs = opts.idleAwayMs ?? AUTO_AWAY_MS;
    this.log = opts.log ?? (() => undefined);
    this.permissionSync = opts.permissionSync;
    this.orgService = new OrgService(opts.store.orgs, {
      clock: this.clock,
      bootstrapOwnerEmail: opts.bootstrapOwnerEmail ?? process.env.BOOTSTRAP_OWNER_EMAIL,
      saveAccount: (a) => this.store.save(a),
      log: this.log,
    });
    this.org(DEFAULT_ORG_ID);
    const staffEmails = parseStaffEmails(opts.bootstrapStaffEmails ?? process.env.BOOTSTRAP_STAFF_EMAILS);
    applyBootstrapStaff(this.store, staffEmails, this.log);
    this.staff = new StaffService(
      {
        clock: this.clock,
        log: this.log,
        store: this.store,
        online: () => this.online.values(),
        byAccount: (id) => this.online.get(id),
        roomName: (p) => this.roomOf(p)?.built.def.name ?? '—',
        position: (p) => {
          const room = this.roomOf(p);
          if (!room || !p.roomId) return null;
          room.sync(p, this.clock());
          return { roomId: p.roomId, x: p.x, y: p.y, dir: p.dir };
        },
        enterRoom: (p, roomId, at) => this.enterRoom(p, roomId, at),
        landingRoom: (p) => this.landingRoom(p),
        endSession: (id, code, message) => this.kick(id, code, message, undefined, 4005),
        setAvatar: (p, avatar) => (p.roomId ? this.roomOf(p)!.setAvatar(p, avatar) : void (p.avatar = avatar)),
        setVisibility: (p) => this.roomOf(p)?.setVisibility(p, this.clock()),
        flag: (p) => this.roomOf(p)?.broadcast({ t: 'staff_flag', id: p.id, staff: p.staff && p.onDuty ? p.staff : null }),
        roomsOverview: () => this.roomsOverview(),
        roomControl: (orgId, roomId, op) => this.roomControl(orgId, roomId, op),
        roomExists: (orgId, roomId) => !!this.store.orgs.getOrg(orgId) && this.org(orgId).rooms.has(roomId),
      },
      staffEmails,
    );
  }

  /** Live state of an organization, created on first use. */
  org(orgId: string): OrgWorld {
    let w = this.orgWorlds.get(orgId);
    if (!w) {
      w = new OrgWorld(orgId, {
        onPortal: (player, toRoom, x, y) => this.enterRoom(player, toRoom, { x, y, dir: 2 as Dir8 }),
        log: this.log,
        clock: this.clock,
        permissionSync: this.permissionSync,
      });
      this.orgWorlds.set(orgId, w);
    }
    return w;
  }

  /** @deprecated Rooms of the DEFAULT organization only (kept for single-org code and tests). Use `org(id).rooms`. */
  get rooms() {
    return this.org(DEFAULT_ORG_ID).rooms;
  }

  /** @deprecated Auditorium of the DEFAULT organization only. Use `org(id).stage`. */
  get stage() {
    return this.org(DEFAULT_ORG_ID).stage;
  }

  private roomOf(player: Player, roomId: string | null = player.roomId): RoomInstance | undefined {
    return roomId ? this.orgWorlds.get(player.orgId)?.rooms.get(roomId) : undefined;
  }

  private stageOf(player: Player): StageManager {
    return this.org(player.orgId).stage;
  }

  get onlineCount() {
    return this.online.size;
  }

  /** Occupants per room of one organization (the default one when omitted). Never mixes organizations. */
  population(orgId: string = DEFAULT_ORG_ID): Record<string, number> {
    return this.orgWorlds.get(orgId)?.population() ?? {};
  }

  // ---- salas (painel de staff) -------------------------------------------------------------------------

  private lockKey = (orgId: string, roomId: string) => `${orgId}\0${roomId}`;

  /** Estado de acesso de uma sala: 'open', 'locked' (sem novas entradas) ou 'closed' (sem entradas e esvaziada). */
  roomState(orgId: string, roomId: string): 'open' | 'locked' | 'closed' {
    return this.roomLocks.get(this.lockKey(orgId, roomId)) ?? 'open';
  }

  /** Populacao e estado das salas de todas as organizacoes. So presenca (nomes), nunca conversas. */
  roomsOverview(): RoomAdminEntry[] {
    const out: RoomAdminEntry[] = [];
    for (const o of this.store.orgs.listOrgs()) {
      for (const [roomId, room] of this.org(o.id).rooms) {
        out.push({
          orgId: o.id,
          orgName: o.name,
          roomId,
          name: room.built.def.name,
          count: room.players.size,
          max: room.built.def.maxPlayers,
          state: this.roomState(o.id, roomId),
          landing: roomId === DEFAULT_ROOM_ID,
          players: [...room.players.values()].filter((p) => !p.invisible).map((p) => ({ id: p.id, name: p.name })),
        });
      }
    }
    return out;
  }

  /** Aplica trancar / fechar / reabrir / esvaziar. A sala inicial nunca e trancada nem esvaziada (e para onde as pessoas vao). */
  roomControl(orgId: string, roomId: string, op: RoomOp): { ok: true; moved: number; name: string } | { ok: false; message: string } {
    if (!this.store.orgs.getOrg(orgId) || !this.org(orgId).rooms.has(roomId)) return { ok: false, message: 'Sala não encontrada.' };
    const room = this.org(orgId).rooms.get(roomId)!;
    const name = room.built.def.name;
    const keep = op === 'unlock' || op === 'open';
    if (!keep && roomId === DEFAULT_ROOM_ID) return { ok: false, message: 'A sala inicial não pode ser trancada, fechada nem esvaziada.' };
    const key = this.lockKey(orgId, roomId);
    if (op === 'lock') this.roomLocks.set(key, this.roomLocks.get(key) ?? 'locked');
    else if (op === 'close') this.roomLocks.set(key, 'closed');
    else if (op === 'unlock' || op === 'open') this.roomLocks.delete(key);
    let moved = 0;
    if (op === 'close' || op === 'empty') {
      for (const p of [...room.players.values()]) {
        // Staff em servico fica (e quem age); as demais pessoas vao para a sala inicial.
        if (p.staff && p.onDuty) continue;
        p.send({ t: 'error', code: 'kicked_room', message: `A equipe ${op === 'close' ? 'fechou' : 'esvaziou'} a sala ${name}.` });
        this.enterRoom(p, this.landingRoom(p));
        if (p.roomId !== roomId) moved++;
      }
    }
    return { ok: true, moved, name };
  }

  /** Live player of an account, whatever org/room it is in. */
  findPlayerByAccount(accountId: string): Player | undefined {
    return this.online.get(accountId)?.player;
  }

  /** Called on a timer by the network layer (and directly by tests). */
  tick(now = this.clock()) {
    for (const org of this.orgWorlds.values()) for (const room of org.rooms.values()) room.tick(now);
    for (const { player } of this.online.values()) {
      if (player.status !== 'away' && now - player.lastActive >= this.idleAwayMs) {
        // a "focus" that only came from sitting at a PC is not worth restoring
        player.autoAwayFrom = player.autoFocus ? 'available' : player.status;
        player.autoFocus = false;
        this.applyStatus(player, 'away');
      }
    }
    for (const org of this.orgWorlds.values()) {
      if (!org.populationDirty) continue;
      org.populationDirty = false;
      // Only people of this org learn its numbers.
      const msg: ServerMessage = { t: 'population', population: org.population() };
      for (const { player, conn } of this.online.values()) if (player.orgId === org.id) conn.send(msg);
    }
  }

  // ---- authorization ---------------------------------------------------------------------------------

  actorOf(player: Player): Actor {
    return { accountId: player.accountId, orgId: player.orgId, role: player.role, teamId: player.teamId };
  }

  /** Resource facts that depend on the message (target room, current room...). The org is always the player's own. */
  private resourceFor(player: Player, msg: ClientMessage): Resource {
    let roomId: string | null = player.roomId;
    if (msg.t === 'join') roomId = typeof msg.roomId === 'string' && this.roomOf(player, msg.roomId) ? msg.roomId : this.landingRoom(player);
    return { orgId: player.orgId, guestAllowed: this.roomOf(player, roomId)?.built.def.guestAllowed === true };
  }

  /** Every client message passes through here: unknown types are refused, known ones need their permission. */
  private authorize(player: Player, msg: ClientMessage) {
    if (!Object.prototype.hasOwnProperty.call(MESSAGE_POLICY, msg.t)) return { allow: false, reason: 'unknown_message' };
    const action = MESSAGE_POLICY[msg.t];
    if (action === null || action === undefined) return { allow: true, reason: 'ok' };
    return can(this.actorOf(player), action, this.resourceFor(player, msg));
  }

  /** Called after a membership changed (role, team, removal): updates live sessions and tells the client. */
  refreshMembership(accountId: string, orgId: string) {
    const entry = this.online.get(accountId);
    if (!entry || entry.player.orgId !== orgId) return;
    const actor = this.orgService.actorFor(accountId, orgId);
    if (!actor) return this.kick(accountId, 'removed_from_org', 'Você não faz mais parte dessa organização.');
    const p = entry.player;
    p.role = actor.role;
    p.teamId = actor.teamId;
    // A guest cannot stay in a room that is not open to guests.
    if (p.role === 'guest' && p.roomId && this.roomOf(p)?.built.def.guestAllowed !== true) {
      this.enterRoom(p, this.landingRoom(p));
    }
    entry.conn.send(this.permsMessage(p));
  }

  private permsMessage(p: Player): Extract<ServerMessage, { t: 'perms' }> {
    const team = p.teamId ? this.store.orgs.getTeam(p.teamId) : undefined;
    return { t: 'perms', orgId: p.orgId, role: p.role, teamId: p.teamId, team: team?.name ?? DEFAULT_TEAM, perms: permissionsOf(p.role) };
  }

  /** First room a person may use: their last one when allowed, else the default one, else the first open to guests. */
  private landingRoom(p: Player, preferred?: string): string {
    const rooms = this.org(p.orgId).rooms;
    const ok = (id: string | undefined) => !!id && rooms.has(id) && (p.role !== 'guest' || rooms.get(id)!.built.def.guestAllowed === true);
    if (ok(preferred)) return preferred!;
    if (ok(DEFAULT_ROOM_ID)) return DEFAULT_ROOM_ID;
    for (const [id, r] of rooms) if (p.role !== 'guest' || r.built.def.guestAllowed === true) return id;
    return DEFAULT_ROOM_ID;
  }

  // ---- connection lifecycle --------------------------------------------

  handle(conn: Connection, data: unknown) {
    const now = this.clock();
    if (typeof data !== 'object' || data === null || typeof (data as { t?: unknown }).t !== 'string') {
      return this.strike(conn);
    }
    const msg = data as ClientMessage;
    if (msg.t === 'ping') {
      if (typeof msg.ts === 'number') conn.send({ t: 'pong', ts: msg.ts });
      return;
    }
    if (msg.t === 'hello') return this.hello(conn, msg);
    const player = conn.player;
    if (!player) return conn.send({ t: 'error', code: 'no_session', message: 'Envie hello antes.' });

    // Authorization gate: every message type has an entry in MESSAGE_POLICY and is checked with can().
    const verdict = this.authorize(player, msg);
    if (!verdict.allow) {
      if (verdict.reason === 'unknown_message') return this.strike(conn);
      this.log('authz.denied', { player: player.id, org: player.orgId, msg: msg.t, reason: verdict.reason });
      return conn.send({ t: 'error', code: 'forbidden', message: 'Você não tem permissão para isso.' });
    }

    this.touch(player, now);

    switch (msg.t) {
      case 'status': {
        if (!isPresenceStatus(msg.status)) return this.strike(conn);
        if (!player.miscBucket.take(now)) return;
        // a manual choice is never undone by leaving the desk
        player.autoFocus = false;
        this.applyStatus(player, msg.status);
        const entry = this.online.get(player.accountId);
        if (entry) {
          entry.account.status = msg.status;
          this.store.save(entry.account);
        }
        return;
      }
      case 'activity': {
        // The client may only put down what it holds. Every other state is decided by the server from the
        // furniture the player used, so a name that exists but is not allowed is refused without a strike.
        if (!isActivity(msg.activity)) return this.strike(conn);
        if (!player.miscBucket.take(now)) return;
        if (msg.activity !== 'idle') return conn.send({ t: 'error', code: 'activity_not_allowed', message: 'Essa ação só acontece usando o ambiente.' });
        if (player.roomId) this.roomOf(player)!.dropHeld(player);
        return;
      }
      case 'dm':
        return this.directMessage(conn, player, msg, now);
      case 'team':
        return this.teamMessage(conn, player, msg, now);
      case 'join': {
        const id = typeof msg.roomId === 'string' && this.roomOf(player, msg.roomId) ? msg.roomId : undefined;
        const account = this.online.get(player.accountId)?.account;
        this.enterRoom(player, id ?? this.landingRoom(player, account?.lastRoom));
        return;
      }
      case 'move': {
        if (!player.roomId || !isInt(msg.x) || !isInt(msg.y)) return this.strike(conn);
        if (!player.moveBucket.take(now)) return;
        const ok = this.roomOf(player)!.move(player, msg.x, msg.y, now);
        if (!ok) conn.send({ t: 'error', code: 'blocked', message: 'Não é possível ir até lá.' });
        return;
      }
      case 'interact': {
        if (!player.roomId || typeof msg.furniId !== 'string' || !isInt(msg.x) || !isInt(msg.y)) return this.strike(conn);
        if (!player.miscBucket.take(now)) return;
        this.roomOf(player)!.interact(player, msg.furniId, msg.x, msg.y, now);
        return;
      }
      case 'chat': {
        if (!player.roomId || typeof msg.text !== 'string') return this.strike(conn);
        if (this.allowDevLogin && /^\/desbloquear(\s|$)/i.test(msg.text.trim())) return this.devUnlock(conn, player, msg.text.trim());
        // Comandos de staff (/goto, /aviso...): so existem para staff; para os demais o chat segue como antes.
        if (msg.text.trimStart().startsWith('/') && this.staff.tryCommand(player, msg.text, now)) return;
        if (!msg.text.trimStart().startsWith('/') && this.muted(conn, player, now)) return;
        const res = this.roomOf(player)!.chat(player, msg.text, now);
        if (res === 'rate_limited') conn.send({ t: 'error', code: 'rate_limited', message: 'Calma! Você está falando rápido demais.' });
        return;
      }
      case 'emote': {
        if (!player.roomId || !EMOTES.includes(msg.emote as Emote)) return this.strike(conn);
        if (!player.miscBucket.take(now)) return;
        this.roomOf(player)!.emote(player, msg.emote);
        return;
      }
      case 'avatar': {
        // Legacy message: same strict validation as `avatar_save` (see wardrobe.ts), answered with `avatar_result`.
        return this.wardrobe(conn, player, { t: 'avatar_save', avatar: msg.avatar }, now);
      }
      default:
        if (isStaffMessage(msg.t)) {
          if (!this.staff.handle(player, msg as never, now)) this.strike(conn);
          return;
        }
        if (isAvatarClientMessage(msg.t)) return this.wardrobe(conn, player, msg as AvatarClientMessage, now);
        if (isStageMessage(msg.t)) {
          this.stageOf(player).handle(player, msg, now);
          return;
        }
        return this.strike(conn);
    }
  }

  /** Development only (ALLOW_DEV_LOGIN): `/desbloquear <chave|todos>` grants unlock keys to yourself, for testing. */
  private devUnlock(conn: Connection, player: Player, text: string) {
    const entry = this.online.get(player.accountId);
    const arg = text.split(/\s+/)[1];
    const say = (t: string) => conn.send({ t: 'chat', id: null, name: '', text: t, kind: 'system' });
    if (!entry || !arg) return say('Uso: /desbloquear <staff | achievement:nome | event:nome | item:id | todos> (apenas em desenvolvimento).');
    const keys = arg.toLowerCase() === 'todos' ? [...DEV_UNLOCK_ALL] : [arg];
    for (const k of keys) {
      const parsed = parseUnlockKey(k);
      if (!parsed.ok) return say(parsed.message);
      setUnlock(this.store, entry.account, parsed.key, true);
    }
    say('Desbloqueado: ' + keys.join(', ') + '. Reabra o editor de visual.');
  }

  /** Avatar editor / wardrobe messages (validation and persistence live in wardrobe.ts). */
  private wardrobe(conn: Connection, player: Player, msg: AvatarClientMessage, now: number) {
    const entry = this.online.get(player.accountId);
    if (!entry) return;
    if (!player.miscBucket.take(now)) {
      return conn.send({ t: 'avatar_result', rid: msg.rid, ok: false, code: 'rate_limited', message: 'Calma! Muitas alterações seguidas.' });
    }
    handleWardrobeMessage(
      {
        store: this.store,
        now: () => now,
        reply: (m) => conn.send(m),
        apply: (avatar) => {
          // Em servico, o cracha dourado de staff e imposto pelo servidor (nao da para tirar); fora dele, nao aparece.
          const shown = this.staff.decorate(player, avatar);
          if (player.roomId) this.roomOf(player)!.setAvatar(player, shown);
          else player.avatar = shown;
        },
      },
      entry.account,
      msg,
    );
  }

  /** Any player action counts as activity and undoes an automatic away. */
  private touch(player: Player, now: number) {
    player.lastActive = now;
    if (player.autoAwayFrom) {
      const back = player.autoAwayFrom;
      player.autoAwayFrom = null;
      this.applyStatus(player, back);
    }
  }

  private applyStatus(player: Player, status: PresenceStatus) {
    if (player.roomId) this.roomOf(player)!.setStatus(player, status);
    else player.status = status;
    // Someone who is away cannot hold the stage.
    if (status === 'away') this.stageOf(player).onAway(player);
  }

  /** Looks up an online person by account id or name, inside the actor's organization only. */
  findOnline(actor: Pick<Player, 'orgId'>, target: string) {
    let entry = this.online.get(target);
    if (!entry) {
      const acc = this.store.getByName(target.normalize('NFKC').trim());
      entry = acc ? this.online.get(acc.id) : undefined;
    }
    // Someone from another org is indistinguishable from someone who is offline.
    return entry && entry.player.orgId === actor.orgId ? entry : undefined;
  }

  private directMessage(conn: Connection, player: Player, msg: Extract<ClientMessage, { t: 'dm' }>, now: number) {
    if (typeof msg.to !== 'string' || typeof msg.text !== 'string' || msg.to.length === 0 || msg.to.length > MAX_DM_TARGET_LENGTH) {
      return this.strike(conn);
    }
    const text = cleanChat(msg.text);
    if (!text) return;
    if (this.muted(conn, player, now)) return;
    if (!player.chatBucket.take(now)) {
      return conn.send({ t: 'error', code: 'rate_limited', message: 'Calma! Você está falando rápido demais.' });
    }
    const target = this.findOnline(player, msg.to);
    if (!target) return conn.send({ t: 'error', code: 'dm_offline', message: 'Essa pessoa não está online.' });
    if (target.player.accountId === player.accountId) {
      return conn.send({ t: 'error', code: 'dm_self', message: 'Você não pode enviar mensagem para si mesmo.' });
    }
    // Guests only talk with people in their room or on the team that invited them (either direction).
    const t = target.player;
    const dm = can(this.actorOf(player), 'dm.send', {
      orgId: t.orgId,
      targetAccountId: t.accountId,
      targetRole: t.role,
      sameRoom: !!player.roomId && player.roomId === t.roomId,
      sameTeam: !!player.teamId && player.teamId === t.teamId,
    });
    if (!dm.allow) return conn.send({ t: 'error', code: 'dm_forbidden', message: 'Você não pode enviar mensagem para essa pessoa.' });
    target.conn.send({ t: 'dm', peerId: player.accountId, peer: player.name, self: false, text, at: now });
    conn.send({ t: 'dm', peerId: target.player.accountId, peer: target.player.name, self: true, text, at: now });
  }

  /** Silenciado por staff: chat, mensagem privada e de equipe ficam bloqueados ate o fim do prazo. */
  private muted(conn: Connection, player: Player, now: number): boolean {
    const left = this.staff.mutedFor(player.accountId, now);
    if (left <= 0) return false;
    conn.send({ t: 'error', code: 'muted', message: `Você está silenciado por mais ${Math.ceil(left / 60_000)} min.` });
    return true;
  }

  private teamMessage(conn: Connection, player: Player, msg: Extract<ClientMessage, { t: 'team' }>, now: number) {
    if (typeof msg.text !== 'string') return this.strike(conn);
    const text = cleanChat(msg.text);
    if (!text) return;
    if (this.muted(conn, player, now)) return;
    if (!player.chatBucket.take(now)) {
      return conn.send({ t: 'error', code: 'rate_limited', message: 'Calma! Você está falando rápido demais.' });
    }
    const d = can(this.actorOf(player), 'chat.team', { orgId: player.orgId, teamId: player.teamId });
    if (!d.allow) return conn.send({ t: 'error', code: 'no_team', message: 'Você não está em uma equipe.' });
    const team = this.store.orgs.getTeam(player.teamId!)?.name ?? DEFAULT_TEAM;
    // Same organization AND same team id: names of teams in two orgs may be equal, ids never are.
    for (const { player: p, conn: c } of this.online.values()) {
      if (p.orgId === player.orgId && p.teamId === player.teamId) c.send({ t: 'team', team, from: player.name, self: p === player, text, at: now });
    }
  }

  private strike(conn: Connection) {
    conn.strikes++;
    conn.send({ t: 'error', code: 'bad_message', message: 'Mensagem inválida.' });
    if (conn.strikes >= MAX_STRIKES) conn.close(1008, 'too many invalid messages');
  }

  private hello(conn: Connection, msg: Extract<ClientMessage, { t: 'hello' }>) {
    if (conn.player) return;
    let account: Account | undefined;
    let isNew = false;

    if (conn.accountId) {
      account = this.store.getById(conn.accountId);
    } else if (this.allowDevLogin) {
      const name = normalizeName(msg.name);
      if (!name) {
        conn.send({ t: 'error', code: 'bad_name', message: `Use de ${MIN_NAME_LENGTH} a ${MAX_NAME_LENGTH} letras, números, espaço, _ ou -.` });
        return;
      }
      account = this.store.getByName(name);
      // Password accounts are never reachable through the name-only path.
      if (account && account.passwordHash !== '') {
        conn.send({ t: 'error', code: 'name_taken', message: 'Esse nome já está em uso por outra pessoa.' });
        return;
      }
      if (!account) {
        const key = createHash('sha256').update(name.normalize('NFKC').toLocaleLowerCase()).digest('hex').slice(0, 20);
        account = this.store.create({
          email: `dev-${key}@dev.invalid`,
          displayName: name,
          passwordHash: '',
          avatar: msg.avatar ? sanitizeAvatar(msg.avatar) : undefined,
        });
        isNew = true;
      }
    }

    if (!account) {
      conn.send({ t: 'error', code: 'unauthorized', message: 'Faça login para entrar.' });
      conn.close(4001, 'unauthorized');
      return;
    }
    // Conta banida / desativada por staff, ou com senha provisoria ainda nao trocada: nao entra no mundo.
    const block = accessBlock(account, this.clock());
    if (block) {
      conn.send({ t: 'error', code: 'kicked', message: block.message });
      conn.close(4005, block.code);
      return;
    }
    if (account.mustChangePassword) {
      conn.send({ t: 'error', code: 'password_change_required', message: 'Troque a senha provisória antes de entrar.' });
      conn.close(4001, 'password_change_required');
      return;
    }

    // Which organization this session lives in: always a membership the server holds, never a client claim.
    const memberships = this.orgService.ensureMembership(account).filter((m) => m.status === 'active' && this.store.orgs.getOrg(m.orgId));
    const wanted = typeof msg.orgId === 'string' ? msg.orgId : account.lastOrg;
    const chosen = memberships.find((m) => m.orgId === wanted) ?? memberships.find((m) => m.orgId === DEFAULT_ORG_ID) ?? memberships[0];
    if (!chosen || (typeof msg.orgId === 'string' && chosen.orgId !== msg.orgId && !memberships.some((m) => m.orgId === msg.orgId))) {
      // Not a member of the requested org (or of none): same answer, no hint about which orgs exist.
      conn.send({ t: 'error', code: 'no_org', message: 'Você não faz parte dessa organização.' });
      conn.close(4003, 'no_org');
      return;
    }
    const org = this.store.orgs.getOrg(chosen.orgId)!;

    // One live session per account: a newer connection replaces the older one.
    const existing = this.online.get(account.id);
    if (existing) {
      this.dropPlayer(existing.player);
      existing.conn.send({ t: 'error', code: 'replaced', message: 'Sua conta entrou em outro lugar.' });
      existing.conn.close(4000, 'replaced');
    }

    const player = new Player(randomUUID().slice(0, 8), account.id, account.displayName, account.avatar, (m) => conn.send(m), this.clock());
    player.status = isPresenceStatus(account.status) ? account.status : 'available';
    player.orgId = org.id;
    player.role = chosen.role;
    player.teamId = chosen.teamId;
    this.org(org.id);
    if (account.lastOrg !== org.id) {
      account.lastOrg = org.id;
      this.store.save(account);
    }
    conn.player = player;
    this.online.set(account.id, { player, conn, account });
    // Staff vem SEMPRE da conta guardada no servidor (nunca de nome, item ou mensagem do cliente).
    this.staff.attach(player, account);
    this.log('session.start', { player: player.id, name: player.name, isNew, org: org.id, role: player.role });
    const perms = this.permsMessage(player);
    conn.send({
      t: 'session',
      id: player.id,
      name: account.displayName,
      avatar: player.avatar,
      isNew,
      status: player.status,
      team: perms.team,
      orgId: org.id,
      orgName: org.name,
      role: player.role,
      teamId: player.teamId,
      perms: perms.perms,
      ...(this.staff.selfOf(player) ? { staff: this.staff.selfOf(player) } : {}),
    });
    this.staff.onSession(player);
  }

  /** Ends the live session of an account (logout or revoked cookie). */
  kick(accountId: string, code = 'signed_out', message = 'Sessão encerrada.', onlySessionHash?: string, closeCode = 4001) {
    const entry = this.online.get(accountId);
    if (!entry) return;
    if (onlySessionHash && entry.conn.sessionHash !== onlySessionHash) return;
    this.dropPlayer(entry.player);
    entry.conn.send({ t: 'error', code, message });
    entry.conn.close(closeCode, code);
    this.log('session.end', { player: entry.player.id, name: entry.player.name, reason: code });
  }

  /** Ends every live session of the account except the one behind `keepHash` (password change). */
  kickOtherSessions(accountId: string, keepHash: string, message = 'Sua senha foi alterada em outro lugar.') {
    const entry = this.online.get(accountId);
    if (!entry || entry.conn.sessionHash === keepHash) return;
    this.kick(accountId, 'signed_out', message);
  }

  disconnect(conn: Connection) {
    const player = conn.player;
    if (!player) return;
    const entry = this.online.get(player.accountId);
    // Ignore the close of a connection that was already replaced.
    if (!entry || entry.conn !== conn) return;
    this.dropPlayer(player);
    this.log('session.end', { player: player.id, name: player.name });
  }

  private dropPlayer(player: Player) {
    const entry = this.online.get(player.accountId);
    if (player.roomId) {
      const roomId = player.roomId;
      const room = this.roomOf(player, roomId);
      if (entry) {
        entry.account.lastRoom = roomId;
        this.store.save(entry.account);
      }
      room?.remove(player);
      this.stageOf(player).onLeave(roomId, player);
    }
    this.online.delete(player.accountId);
  }

  enterRoom(player: Player, roomId: string, at?: Point & { dir: Dir8 }) {
    const room = this.roomOf(player, roomId);
    if (!room) return;
    // Portals and joins both end here: a guest never gets into a room that is not open to guests.
    const verdict = can(this.actorOf(player), 'room.enter', { orgId: player.orgId, guestAllowed: room.built.def.guestAllowed === true });
    if (!verdict.allow) {
      player.send({ t: 'error', code: 'forbidden', message: 'Você não tem acesso a essa sala.' });
      return;
    }
    if (player.roomId !== roomId && this.roomState(player.orgId, roomId) !== 'open' && !(player.staff && player.onDuty)) {
      const closed = this.roomState(player.orgId, roomId) === 'closed';
      player.send({ t: 'error', code: 'room_locked', message: `A sala está ${closed ? 'fechada' : 'trancada'} pela equipe.` });
      // Primeira entrada (ex.: reconexao na sala em que estava): cai na sala inicial em vez de ficar sem sala.
      if (!player.roomId && roomId !== DEFAULT_ROOM_ID) this.enterRoom(player, this.landingRoom(player));
      return;
    }
    if (room.isFull && player.roomId !== roomId) {
      player.send({ t: 'error', code: 'room_full', message: 'Essa sala está lotada.' });
      return;
    }
    const previous = player.roomId;
    if (previous) {
      this.roomOf(player, previous)?.remove(player);
      this.stageOf(player).onLeave(previous, player);
    }
    const now = this.clock();
    room.add(player, at ?? room.built.def.spawn, now, this.population(player.orgId));
    this.stageOf(player).onEnter(roomId, player);
    const entry = this.online.get(player.accountId);
    if (entry) {
      entry.account.lastRoom = roomId;
      this.store.save(entry.account);
    }
    this.log('room.enter', { player: player.id, room: roomId });
  }
}
