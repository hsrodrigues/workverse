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
  DIR_MAX_RESULTS,
  MAX_DIR_QUERY,
  RECEPTIONIST_LINES,
  foldText,
  isGeneralDept,
  type DirEntry,
  type DirResult,
  isPresenceStatus,
  isActivity,
  isForbiddenChar,
  type PresenceStatus,
  type ClientMessage,
  type Dir8,
  type Emote,
  type Point,
  type ServerMessage,
  IT_ONLY_MESSAGE,
  MAX_HOST_ID_LENGTH,
  isInventoryAction,
  parseClimateSet,
} from '@workverse/shared';
import { isAvatarClientMessage, type AvatarClientMessage } from '@workverse/shared';
import { DEV_UNLOCK_ALL, handleWardrobeMessage, parseUnlockKey, setUnlock } from './wardrobe';
import { Player, RoomInstance, cleanChat } from './room';
import { StageManager, isStageMessage, type PermissionSync } from './stage';
import type { Account, AccountStore } from './store';
import { DEFAULT_ORG_ID, deptUnlockKeyOf, permissionsOf, type Role } from '@workverse/shared';
import { MESSAGE_POLICY, can, type Actor, type Decision, type Resource } from './authz';
import { DEFAULT_PASS_TEAM_NAMES, RoomConfig, normTeamName } from './roomConfig';
import { buildInventory, runInventoryAction, type InventoryContext } from './inventory';
import { RoomAdmin, isRoomAdminMessage } from './roomAdmin';
import { BookingService, isBookingMessage } from './bookings';
import { OrgService } from './org';
import { OrgWorld } from './orgWorld';
import { PetManager } from './pet';
import { StaffService, applyBootstrapStaff, isStaffMessage, parseStaffEmails } from './staff';
import { EventsService, parseCompanyDate, parseOptionalEvents, type EventsConfig } from './eventsService';
import { setActiveEventsProvider, setDeptKeysProvider } from './wardrobe';
import { accessBlock, isBanned, isDisabled } from './accountState';
import { roomAccessOf, type RoomAdminEntry, type RoomListEntry, type RoomOp } from '@workverse/shared';
import { cleanDisplayName, isBirthdayToday, localDate, prefsOf } from '@workverse/shared';
import { cardOf, stripOptionalProfile } from './profileService';

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
  /** Throws a person out of the LiveKit room (revoked access): `(orgId, roomId, identity)`. See media.ts. */
  removeMediaParticipant?: (orgId: string, roomId: string, identity: string) => void;
  /** Eventos/comemoracoes: data do aniversario da empresa e eventos opcionais (padrao: WORKVERSE_COMPANY_DATE / WORKVERSE_OPTIONAL_EVENTS). */
  events?: EventsConfig;
  /** Liga o pet do escritorio (Byte). Padrao: ligado, exceto com PET=off. */
  pet?: boolean;
}

const MAX_STRIKES = 20;

export function normalizeName(raw: unknown): string | null {
  const name = cleanDisplayName(raw); // regra unica no shared (profile.ts), usada tambem pelo formulario do cliente
  if (name === null) return null;
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
  /** Eventos e comemoracoes ativos (data do relogio + controle manual da staff): ver eventsService.ts. */
  readonly events: EventsService;
  private readonly online = new Map<string, { player: Player; conn: Connection; account: Account }>();
  /** Salas trancadas / fechadas pela staff (chave `org\0sala`). Em memoria: voltam abertas ao reiniciar o servidor. */
  private readonly roomLocks = new Map<string, 'locked' | 'closed'>();
  /** Customized layouts and access policies of the rooms, per organization (see roomConfig.ts). */
  readonly roomConfig: RoomConfig;
  /** Room editor and access control (see roomAdmin.ts). */
  readonly roomAdmin: RoomAdmin;
  /** Reserva de sala com fila (ver bookings.ts e docs/bookings.md). */
  readonly bookings: BookingService;
  private readonly removeMedia?: WorldOptions['removeMediaParticipant'];
  /** Byte, o pet do escritorio (nao e jogador; ver pet.ts). */
  readonly pets: PetManager;
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
    this.removeMedia = opts.removeMediaParticipant;
    this.roomConfig = new RoomConfig(opts.store.orgs, this.log);
    this.orgService = new OrgService(opts.store.orgs, {
      clock: this.clock,
      bootstrapOwnerEmail: opts.bootstrapOwnerEmail ?? process.env.BOOTSTRAP_OWNER_EMAIL,
      saveAccount: (a) => this.store.save(a),
      log: this.log,
    });
    this.roomAdmin = new RoomAdmin({
      store: opts.store,
      orgService: this.orgService,
      roomConfig: this.roomConfig,
      clock: this.clock,
      log: this.log,
      org: (id) => this.org(id),
      orgWorlds: () => this.orgWorlds.values(),
      players: (orgId) => this.playersOfOrg(orgId),
      isStaffAdmin: (p) => this.isStaffAdmin(p),
      actorOf: (p) => this.actorOf(p),
      canEnter: (p, roomId) => this.canEnter(p, roomId, { stay: true }),
      evict: (p, roomId, message) => this.evict(p, roomId, message),
      sendRooms: (p) => this.sendRooms(p),
      findOnline: (actor, target) => {
        const e = this.findOnline(actor, target);
        return e ? { player: e.player, send: (m) => e.conn.send(m) } : undefined;
      },
      mutedFor: (id, now) => this.staff.mutedFor(id, now),
    });
    this.bookings = new BookingService({
      store: opts.store,
      orgService: this.orgService,
      clock: this.clock,
      log: this.log,
      org: (id) => this.org(id),
      orgWorlds: () => this.orgWorlds.values(),
      players: (orgId) => this.playersOfOrg(orgId),
      playerOf: (accountId) => this.online.get(accountId)?.player,
      isStaffAdmin: (p) => this.isStaffAdmin(p),
      actorOf: (p) => this.actorOf(p),
      canEnter: (p, roomId, o) => this.canEnter(p, roomId, o),
      evict: (p, roomId, message) => this.evict(p, roomId, message),
      sendRooms: (p) => this.sendRooms(p),
    });
    this.events = new EventsService(this.clock, opts.events ?? { companyDate: parseCompanyDate(process.env.WORKVERSE_COMPANY_DATE), optional: parseOptionalEvents(process.env.WORKVERSE_OPTIONAL_EVENTS) });
    // itens de avatar `event:<id>` ficam liberados enquanto o evento estiver ativo (wardrobe.ts)
    setActiveEventsProvider(() => this.events.activeIds());
    setDeptKeysProvider((accountId) => {
      const out = new Set<string>();
      for (const m of this.store.orgs.membershipsOf(accountId)) {
        if (m.status !== 'active' || m.role === 'guest' || !m.teamId) continue;
        const team = this.store.orgs.getTeam(m.teamId);
        const key = team && team.orgId === m.orgId ? deptUnlockKeyOf(team.name) : null;
        if (key) out.add(key);
      }
      return [...out];
    });
    this.org(DEFAULT_ORG_ID);
    this.pets = new PetManager(
      {
        rooms: (orgId) => this.orgWorlds.get(orgId)?.rooms,
        roomState: (orgId, roomId) => this.roomState(orgId, roomId),
        stageActive: (orgId, roomId) => this.orgWorlds.get(orgId)?.stage.view(roomId)?.speakerId != null,
        orgName: (orgId) => this.store.orgs.getOrg(orgId)?.name ?? orgId,
        orgs: () => this.store.orgs.listOrgs().map((o) => ({ id: o.id, name: o.name })),
        log: this.log,
      },
      { enabled: opts.pet ?? process.env.PET?.trim().toLowerCase() !== 'off' },
    );
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
        pets: {
          list: () => this.pets.list(),
          setEnabled: (orgId, on) => this.pets.setEnabled(orgId, on, this.clock()),
          rename: (orgId, name) => this.pets.rename(orgId, name, this.clock()),
          bring: (orgId, roomId, at) => this.pets.bring(orgId, roomId, at, this.clock()),
        },
        setEvent: (id, mode) => {
          const changed = this.events.setMode(id, mode);
          if (changed) this.broadcastEvents();
          return { changed, view: this.events.view() };
        },
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
        onTerminal: (player, furniId) => this.terminal(player, furniId),
        log: this.log,
        clock: this.clock,
        permissionSync: this.permissionSync,
        resolveRoom: (base) => this.roomConfig.resolve(orgId, base),
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

  // ---- acesso as salas ---------------------------------------------------------------------------------

  isStaffAdmin(p: Player): boolean {
    return p.staff === 'admin' && p.onDuty;
  }

  *playersOfOrg(orgId: string): Iterable<Player> {
    for (const { player } of this.online.values()) if (player.orgId === orgId) yield player;
  }

  /**
   * May this person be in this room right now? One answer for every way in: join, portal, reconnect, media token, and the
   * periodic check that throws out whoever lost access. Org owners/admins and platform staff admins on duty always pass.
   */
  canEnter(player: Player, roomId: string, opts?: { stay?: boolean }): Decision {
    const room = this.roomOf(player, roomId);
    if (!room) return { allow: false, reason: 'no_room' };
    if (this.isStaffAdmin(player)) return { allow: true, reason: 'staff_admin' };
    const def = room.built.def;
    // Reserva em curso: durante a janela a sala so aceita o dono, os convidados e donos/admins da organizacao (como uma sala por
    // convite, sem mexer na configuracao permanente). Fora de reservas valem as regras normais da sala.
    const booked = this.bookings.restriction(player, roomId, this.clock(), opts?.stay === true);
    if (booked === 'blocked') return { allow: false, reason: 'room_booked' };
    if (booked === 'participant') {
      return can(this.actorOf(player), 'room.enter', { orgId: player.orgId, guestAllowed: def.guestAllowed === true, roomAccess: 'org' });
    }
    return can(this.actorOf(player), 'room.enter', {
      orgId: player.orgId,
      guestAllowed: def.guestAllowed === true,
      roomAccess: roomAccessOf(def),
      roomTeamId: def.accessTeamId ?? null,
      invited: !!this.roomConfig.liveInvite(player.orgId, roomId, player.accountId, this.clock()),
      passTeam: roomAccessOf(def) !== 'org' && this.roomConfig.passes(player.orgId, roomId, player.teamId),
    });
  }

  /** Head count per room, ONLY for the rooms this person may enter (a restricted room never reveals who is inside). */
  visiblePopulation(player: Player): Record<string, number> {
    const out: Record<string, number> = {};
    const w = this.orgWorlds.get(player.orgId);
    if (!w) return out;
    for (const [id, r] of w.rooms) if (this.canEnter(player, id).allow) out[id] = r.players.size;
    return out;
  }

  /** The rooms as this person sees them in the browser: padlock on the restricted ones, no population for those. */
  roomListFor(player: Player): RoomListEntry[] {
    const w = this.org(player.orgId);
    const out: RoomListEntry[] = [];
    for (const [id, r] of w.rooms) {
      const def = r.built.def;
      const access = roomAccessOf(def);
      const d = this.canEnter(player, id);
      const hidden = !d.allow && access === 'private';
      out.push({
        id,
        name: hidden ? 'Sala privada' : def.name,
        description: hidden ? 'Acesso restrito.' : def.description,
        maxPlayers: def.maxPlayers,
        access,
        locked: !d.allow,
        ...(!d.allow
          ? { lockReason: d.reason === 'guest_room' ? ('guest' as const) : d.reason === 'room_team' ? ('team' as const) : d.reason === 'room_booked' ? ('booked' as const) : ('invite' as const) }
          : { population: r.players.size }),
      });
    }
    return out;
  }

  sendRooms(player: Player) {
    player.send({ t: 'rooms', rooms: this.roomListFor(player) });
  }

  /** The person lost access to a room they are in: tell them, move them to a room they may use, and drop their media. */
  evict(player: Player, roomId: string, message: string) {
    if (player.roomId !== roomId) return;
    this.removeMedia?.(player.orgId, roomId, player.id);
    this.permissionSync?.(roomId, player.id, 'none', player.orgId);
    player.send({ t: 'error', code: 'kicked_room', message });
    this.enterRoom(player, this.landingRoom(player, 'reception'));
    this.sendRooms(player);
    this.log('room.evict', { player: player.id, org: player.orgId, room: roomId });
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
    // a room with teams that pass through the lock (IT room): locking it sends everybody else out; those teams stay
    if (op === 'lock' && this.roomConfig.passTeamIds(orgId, roomId).length > 0) {
      for (const p of [...room.players.values()]) {
        if ((p.staff && p.onDuty) || this.roomConfig.passes(orgId, roomId, p.teamId) || p.role === 'owner' || p.role === 'admin') continue;
        p.send({ t: 'error', code: 'kicked_room', message: `A equipe trancou a sala ${name}.` });
        this.enterRoom(p, this.landingRoom(p));
        if (p.roomId !== roomId) moved++;
      }
    }
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
    this.pets.tick(now);
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
      // Only people of this org learn its numbers, and only of the rooms they may enter.
      for (const { player, conn } of this.online.values()) {
        if (player.orgId === org.id) conn.send({ t: 'population', population: this.visiblePopulation(player) });
      }
    }
    this.roomAdmin.sweep(now);
    this.bookings.tick(now);
    // virada do dia / evento forcado: todos veem a mesma decoracao
    if (this.events.changed(now)) this.broadcastEvents();
  }

  /** Manda a todos os online a lista de eventos ativos (e os controles manuais). */
  broadcastEvents() {
    const msg = { t: 'events' as const, ...this.events.view() };
    for (const { conn } of this.online.values()) conn.send(msg);
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
    // The platform staff admin on duty can decorate and manage access in the organization they are in.
    if ((action === 'room.furnish' || action === 'room.access.set' || action === 'room.book.manage') && this.isStaffAdmin(player)) return { allow: true, reason: 'staff_admin' };
    return can(this.actorOf(player), action, this.resourceFor(player, msg));
  }

  // ---- cargo e setor ---------------------------------------------------------------------------------

  /** Copia cargo/setor do vinculo para o jogador. Devolve true quando algo mudou. */
  private syncProfile(p: Player): boolean {
    const tag = this.orgService.profileOf(p.orgId, p.accountId);
    const changed = p.title !== tag.title || p.dept !== tag.dept || p.deptColor !== tag.deptColor;
    p.title = tag.title;
    p.dept = tag.dept;
    p.deptColor = tag.deptColor;
    return changed;
  }

  /** Copia o perfil opcional (sobre mim, pronomes, aniversario, preferencia de atividade) da conta. Devolve true se algo mudou. */
  private syncCard(p: Player, account: Account): boolean {
    const c = cardOf(account, this.clock());
    const changed = p.about !== c.about || p.pronouns !== c.pronouns || p.bday !== c.bday || p.hideWorking !== c.hideWorking;
    p.about = c.about;
    p.pronouns = c.pronouns;
    p.bday = c.bday;
    p.hideWorking = c.hideWorking;
    return changed;
  }

  /** Mensagem `profile` completa da pessoa (cargo, setor e, para membros, os campos opcionais). */
  private profileMessage(p: Player) {
    return {
      t: 'profile' as const,
      id: p.id,
      name: p.name,
      ...(p.title ? { title: p.title } : {}),
      ...(p.dept ? { dept: p.dept, deptColor: p.deptColor } : {}),
      ...(p.about ? { about: p.about } : {}),
      ...(p.pronouns ? { pronouns: p.pronouns } : {}),
      ...(p.bday ? { bday: true as const } : {}),
    };
  }

  /**
   * A conta mudou (nome, sobre mim, pronomes, aniversario, preferencias): quem esta online atualiza na hora. Visitantes
   * recebem so o nome (ver stripOptionalProfile no envio).
   */
  applyProfile(accountId: string) {
    const entry = this.online.get(accountId);
    if (!entry) return;
    const p = entry.player;
    const hadHidden = p.hideWorking;
    p.name = entry.account.displayName;
    this.syncCard(p, entry.account);
    const msg = this.profileMessage(p);
    const room = p.roomId ? this.roomOf(p) : undefined;
    if (room) {
      room.broadcast(msg);
      if (hadHidden !== p.hideWorking && p.activity === 'working') room.broadcast({ t: 'activity', id: p.id, activity: p.hideWorking ? 'idle' : 'working' });
    } else p.send(msg);
  }

  /** Parabens no chat do sistema (opt-in da pessoa), uma vez por dia no fuso dela. */
  private greetBirthday(player: Player, room: RoomInstance) {
    const account = this.online.get(player.accountId)?.account;
    const prof = account?.profile;
    if (!account || !prof?.birthday || prof.birthdayChat !== true) return;
    const now = this.clock();
    const tz = prefsOf(prof).tz;
    if (!isBirthdayToday(prof.birthday, now, tz)) return;
    const day = localDate(now, tz).key;
    if (prof.lastBdayGreet === day) return;
    prof.lastBdayGreet = day;
    this.store.save(account);
    room.broadcast({ t: 'chat', id: null, name: '', text: `Hoje é aniversário de ${player.name}. Parabéns!`, kind: 'system' });
  }

  /** Cargo ou setor de uma pessoa mudou: quem esta na sala dela (inclusive ela) ve a etiqueta nova na hora. */
  refreshProfile(accountId: string, orgId: string) {
    const entry = this.online.get(accountId);
    if (!entry || entry.player.orgId !== orgId) return;
    const p = entry.player;
    if (!this.syncProfile(p)) return;
    const msg = this.profileMessage(p);
    if (p.roomId) this.roomOf(p)?.broadcast(msg);
    else p.send(msg);
  }

  /** Um setor foi renomeado/recolorido: todos os online dele atualizam. */
  refreshTeam(orgId: string, teamId: string) {
    for (const p of [...this.playersOfOrg(orgId)]) if (p.teamId === teamId) this.refreshProfile(p.accountId, orgId);
  }

  // ---- diretorio da recepcao ---------------------------------------------------------------------------

  /** Setores da organizacao para os botoes do diretorio ("Geral" nao conta como setor). */
  deptsOf(orgId: string) {
    return this.store.orgs
      .teamsOf(orgId)
      .filter((t) => !isGeneralDept(t))
      .map((t) => ({ id: t.id, name: t.name, color: t.color }))
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  }

  /**
   * Busca de colegas. Isolada por organizacao (so os membros ativos da org de quem pergunta), sem e-mail, sem contas
   * desativadas/banidas, e staff invisivel aparece como offline. A sala so e dita quando quem pergunta pode entrar nela.
   */
  searchDirectory(player: Player, dept: string | null, q: string): DirResult {
    const orgId = player.orgId;
    const depts = this.deptsOf(orgId);
    const needle = foldText(q);
    const now = this.clock();
    const found: Array<DirEntry & { key: string }> = [];
    for (const m of this.store.orgs.membersOf(orgId)) {
      if (m.status !== 'active') continue;
      if (dept && m.teamId !== dept) continue;
      const acc = this.store.getById(m.accountId);
      if (!acc || isDisabled(acc) || isBanned(acc, now)) continue;
      if (needle && !foldText(acc.displayName).includes(needle)) continue;
      const tag = this.orgService.profileOf(orgId, m.accountId);
      const live = this.online.get(m.accountId)?.player;
      const visible = !!live && live.orgId === orgId && !live.invisible && !!live.roomId;
      const entry: DirEntry & { key: string } = {
        key: foldText(acc.displayName),
        name: acc.displayName,
        ...tag,
        ...(acc.profile?.about ? { about: acc.profile.about } : {}),
        avatar: live?.avatar ?? acc.avatar,
        ...(live && live.staff && live.onDuty && !live.invisible ? { staff: live.staff } : {}),
        online: visible,
        ...(m.accountId === player.accountId ? { you: true } : {}),
      };
      if (visible && live!.roomId) {
        if (this.canEnter(player, live!.roomId).allow) {
          entry.roomId = live!.roomId;
          entry.roomName = this.roomOf(live!)?.built.def.name;
        } else entry.roomHidden = true;
      }
      found.push(entry);
    }
    // online primeiro, depois ordem alfabetica
    found.sort((a, b) => Number(b.online) - Number(a.online) || a.key.localeCompare(b.key, 'pt-BR'));
    const results = found.slice(0, DIR_MAX_RESULTS).map(({ key: _k, ...e }) => e);
    return { depts, dept, q, results, truncated: found.length > DIR_MAX_RESULTS };
  }

  private dirSearch(conn: Connection, player: Player, msg: Extract<ClientMessage, { t: 'dir_search' }>, now: number) {
    const dept = msg.dept;
    const q = msg.q;
    if ((dept !== undefined && (typeof dept !== 'string' || dept.length === 0 || dept.length > 64)) || (q !== undefined && (typeof q !== 'string' || q.length > MAX_DIR_QUERY * 2))) return this.strike(conn);
    if (!player.dirBucket.take(now)) return conn.send({ t: 'error', code: 'rate_limited', message: RECEPTIONIST_LINES.slow });
    const cleanQ = typeof q === 'string' ? [...q].filter((c) => !isForbiddenChar(c.codePointAt(0)!)).join('').normalize('NFKC').replace(/\s+/g, ' ').trim().slice(0, MAX_DIR_QUERY) : '';
    // um setor de outra organizacao (ou inexistente) e tratado como "nenhum resultado", sem pista de que existe
    const deptOk = dept !== undefined && this.store.orgs.getTeam(dept)?.orgId === player.orgId;
    const res = this.searchDirectory(player, dept === undefined ? null : deptOk ? dept : '__none__', cleanQ);
    conn.send({ t: 'dir_result', ...res, dept: deptOk ? dept! : null });
  }

  // ---- inventario de PCs (servidores da Sala da TI) ----------------------------------------------------------------

  /** Quem pode ver o inventario: equipe de TI da organizacao (mesma regra de passagem da Sala da TI), dono/admin e staff em servico. */
  isIT(p: Player): boolean {
    if (p.staff && p.onDuty) return true;
    if (p.role === 'guest') return false;
    if (p.role === 'owner' || p.role === 'admin') return true;
    if (!p.teamId) return false;
    if (this.roomConfig.passes(p.orgId, 'ti', p.teamId)) return true;
    const team = this.store.orgs.getTeam(p.teamId);
    return !!team && team.orgId === p.orgId && (DEFAULT_PASS_TEAM_NAMES.ti ?? []).includes(normTeamName(team.name));
  }

  private inventoryContext(player: Player, now: number): InventoryContext {
    const rooms = this.org(player.orgId).rooms;
    return {
      rooms,
      canEnter: (roomId) => this.canEnter(player, roomId).allow,
      accountOk: (id) => {
        const acc = this.store.getById(id);
        return !!acc && !isDisabled(acc) && !isBanned(acc, now);
      },
      depts: this.deptsOf(player.orgId),
      now,
    };
  }

  /** Rack ou console usado na Sala da TI: quem e da TI abre o painel; os demais ouvem uma recusa simpatica. */
  private terminal(player: Player, _furniId: string) {
    if (this.isIT(player)) player.send({ t: 'inventory_open' });
    else player.send({ t: 'chat', id: null, name: '', text: IT_ONLY_MESSAGE, kind: 'system' });
  }

  private inventoryQuery(conn: Connection, player: Player, now: number) {
    if (!player.invBucket.take(now)) return conn.send({ t: 'error', code: 'rate_limited', message: 'Calma! Muitas consultas seguidas ao inventário.' });
    if (!this.isIT(player)) return conn.send({ t: 'error', code: 'it_only', message: IT_ONLY_MESSAGE });
    conn.send({ t: 'inventory_result', ...buildInventory(this.inventoryContext(player, now)) });
  }

  /** Reinicios por alvo: no maximo um a cada 20 s (chave organizacao + host), para ninguem encher o chat de uma pessoa. */
  private readonly rebootAt = new Map<string, number>();

  private inventoryAction(conn: Connection, player: Player, msg: Extract<ClientMessage, { t: 'inventory_action' }>, now: number) {
    if (typeof msg.host !== 'string' || msg.host.length === 0 || msg.host.length > MAX_HOST_ID_LENGTH || !isInventoryAction(msg.action)) return this.strike(conn);
    if (!player.invBucket.take(now)) return conn.send({ t: 'error', code: 'rate_limited', message: 'Calma! Muitas ações seguidas no inventário.' });
    if (!this.isIT(player)) return conn.send({ t: 'error', code: 'it_only', message: IT_ONLY_MESSAGE });
    if (msg.action === 'reboot') {
      const key = `${player.orgId} ${msg.host}`;
      const last = this.rebootAt.get(key) ?? 0;
      if (now - last < 20_000) return conn.send({ t: 'inventory_action_result', host: msg.host, action: 'reboot', ok: false, message: 'Esse PC acabou de ser reiniciado. Aguarde um pouco.' });
      this.rebootAt.set(key, now);
      if (this.rebootAt.size > 500) for (const [k, t] of this.rebootAt) if (now - t > 60_000) this.rebootAt.delete(k);
    }
    const res = runInventoryAction(this.inventoryContext(player, now), msg.host, msg.action, (to, m) => to.send(m));
    if (!res.ok && msg.action === 'reboot') this.rebootAt.delete(`${player.orgId} ${msg.host}`);
    conn.send(res);
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
    this.refreshProfile(accountId, orgId);
    // A guest cannot stay in a room that is not open to guests, and a new role/team may close the door of a restricted room.
    if (p.role === 'guest' && p.roomId && this.roomOf(p)?.built.def.guestAllowed !== true) {
      this.enterRoom(p, this.landingRoom(p));
    }
    this.roomAdmin.enforcePlayer(p);
    entry.conn.send(this.permsMessage(p));
    this.sendRooms(p);
  }

  private permsMessage(p: Player): Extract<ServerMessage, { t: 'perms' }> {
    const team = p.teamId ? this.store.orgs.getTeam(p.teamId) : undefined;
    return { t: 'perms', orgId: p.orgId, role: p.role, teamId: p.teamId, team: team?.name ?? DEFAULT_TEAM, perms: permissionsOf(p.role) };
  }

  /** First room a person may use: their last one when allowed, else the default one, else the first open to guests. */
  private landingRoom(p: Player, preferred?: string): string {
    const rooms = this.org(p.orgId).rooms;
    const ok = (id: string | undefined) => !!id && rooms.has(id) && this.canEnter(p, id).allow;
    if (ok(preferred)) return preferred!;
    // A last room that is gone or no longer allowed (access revoked while offline) falls back to the reception, the hub.
    if (preferred !== undefined && ok('reception')) return 'reception';
    if (ok(DEFAULT_ROOM_ID)) return DEFAULT_ROOM_ID;
    for (const id of rooms.keys()) if (ok(id)) return id;
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
      case 'dir_search':
        return this.dirSearch(conn, player, msg, now);
      case 'climate_set': {
        if (!player.roomId) return this.strike(conn);
        const req = parseClimateSet(msg);
        if (!req) return this.strike(conn);
        if (!player.miscBucket.take(now)) return;
        if (!this.roomOf(player)!.applyClimateSet(req, now)) conn.send({ t: 'error', code: 'no_climate', message: 'Esta sala não tem ar-condicionado.' });
        return;
      }
      case 'inventory_query':
        return this.inventoryQuery(conn, player, now);
      case 'inventory_action':
        return this.inventoryAction(conn, player, msg, now);
      case 'pet_do': {
        if (!player.roomId) return this.strike(conn);
        if (!this.pets.handle(player, msg, now)) this.strike(conn);
        return;
      }
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
        if (isRoomAdminMessage(msg.t)) {
          if (!this.roomAdmin.handle(player, msg, now)) this.strike(conn);
          return;
        }
        if (isBookingMessage(msg.t)) {
          if (!this.bookings.handle(player, msg, now)) this.strike(conn);
          return;
        }
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

    // Visitantes (guest) nunca recebem os campos opcionais do perfil dos colegas: o filtro fica no unico ponto de envio.
    const player: Player = new Player(randomUUID().slice(0, 8), account.id, account.displayName, account.avatar, (m) => conn.send(player.role === 'guest' ? stripOptionalProfile(m) : m), this.clock());
    player.status = isPresenceStatus(account.status) ? account.status : 'available';
    player.orgId = org.id;
    player.role = chosen.role;
    player.teamId = chosen.teamId;
    this.syncProfile(player);
    this.syncCard(player, account);
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
    this.sendRooms(player);
    this.bookings.sendDoors(player);
    conn.send({ t: 'events', ...this.events.view() });
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
    this.bookings.forget(player.accountId);
  }

  enterRoom(player: Player, roomId: string, at?: Point & { dir: Dir8 }) {
    const room = this.roomOf(player, roomId);
    if (!room) return;
    // Portals, joins, reconnections and staff moves all end here: a guest never gets into a room that is not open to guests,
    // and a restricted room only admits its team, its invited people and the organization's owners and admins.
    const verdict = this.canEnter(player, roomId);
    if (!verdict.allow) {
      const restricted = verdict.reason === 'room_team' || verdict.reason === 'room_invite' || verdict.reason === 'room_booked';
      const why = verdict.reason === 'room_team' ? 'Essa sala é restrita a uma equipe.' : verdict.reason === 'room_invite' ? 'Essa sala é só para convidados.' : verdict.reason === 'room_booked' ? 'Essa sala está reservada neste horário.' : 'Você não tem acesso a essa sala.';
      player.send({ t: 'error', code: restricted ? 'room_denied' : 'forbidden', message: why });
      this.log('room.denied', { player: player.id, org: player.orgId, room: roomId, reason: verdict.reason });
      // First entry (reconnecting into a room that is no longer allowed): land somewhere that is.
      if (!player.roomId) {
        const fallback = this.landingRoom(player, 'reception');
        if (fallback !== roomId) this.enterRoom(player, fallback);
      }
      return;
    }
    // the staff lock lets through the teams the room always admits (IT into the IT room); a closed room admits nobody
    const passes = this.roomState(player.orgId, roomId) === 'locked' && this.roomConfig.passes(player.orgId, roomId, player.teamId);
    if (player.roomId !== roomId && this.roomState(player.orgId, roomId) !== 'open' && !passes && !(player.staff && player.onDuty)) {
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
    room.add(player, at ?? room.built.def.spawn, now, this.visiblePopulation(player));
    this.bookings.onEnter(player, roomId, now);
    this.stageOf(player).onEnter(roomId, player);
    this.pets.onEnter(player, roomId, now);
    const entry = this.online.get(player.accountId);
    if (entry) {
      entry.account.lastRoom = roomId;
      this.store.save(entry.account);
    }
    this.greetBirthday(player, room);
    this.log('room.enter', { player: player.id, room: roomId });
  }
}
