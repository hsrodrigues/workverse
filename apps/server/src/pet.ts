import {
  PET_ACT_LINES,
  PET_DEFAULT_NAME,
  PET_EAT_MS,
  PET_EMPTY_ROOM_MOVE_MS,
  PET_FOLLOW_MS,
  PET_HAPPY_MS,
  PET_IDLE_MAX_MS,
  PET_IDLE_MIN_MS,
  PET_LINES,
  PET_PLAY_MS,
  PET_REACH,
  PET_ROOM_CHANGE_CHANCE,
  PET_SAY_CHANCE,
  PET_SAY_MIN_GAP_MS,
  PET_SIT_MS,
  PET_SLEEP_MS,
  PET_TREAT_COOLDOWN_MS,
  STEP_MS,
  WORKSTATION_KINDS,
  cleanPetName,
  dirFromDelta,
  findPath,
  footprintTiles,
  idx,
  inBounds,
  isPetAct,
  isWalkable,
  petRoomAllowed,
  pickLine,
  roomAccessOf,
  seatDir,
  type Dir8,
  type Furniture,
  type Point,
  type PetAdminEntry,
  type PetFx,
  type PetState,
  type PetView,
  type Portal,
  type ServerMessage,
} from '@workverse/shared';
import { TokenBucket } from './limiter';
import type { Player, RoomInstance } from './room';

/**
 * Byte, o pet do escritorio (docs/pet.md). Um por organizacao, estado so em memoria. NAO e um Player: nao entra em
 * `room.players`, portanto nao conta em populacao, presenca, listas, diretorio nem inventario. Os jogadores recebem
 * mensagens `pet`, `pet_path` e `pet_act` da propria sala. Custo: uma checagem barata por tick; uma decisao a cada alguns
 * segundos; nada acontece enquanto a organizacao nao tem ninguem online.
 */

export interface PetHost {
  /** Salas ao vivo da organizacao (ausente = organizacao sem estado vivo). */
  rooms(orgId: string): ReadonlyMap<string, RoomInstance> | undefined;
  roomState(orgId: string, roomId: string): 'open' | 'locked' | 'closed';
  /** Ha apresentador no palco/TV da sala. */
  stageActive(orgId: string, roomId: string): boolean;
  /** Reserva de sala em andamento (a sala privada e reservavel, mas o Byte ja nunca entra nela). */
  reserved?(orgId: string, roomId: string): boolean;
  orgName(orgId: string): string;
  /** Todas as organizacoes (lista da staff). */
  orgs(): Array<{ id: string; name: string }>;
  log?(event: string, data?: Record<string, unknown>): void;
}

type Arrive = 'none' | 'eat' | 'sit' | 'portal';

interface PetData {
  orgId: string;
  roomId: string;
  x: number;
  y: number;
  dir: Dir8;
  /** Postura quando parado (com caminho ele anda). */
  state: PetState;
  path: Point[];
  origin: Point;
  pathStart: number;
  arrive: Arrive;
  portal: Portal | null;
  seatDir: Dir8 | null;
  /** Quando termina a postura atual / acontece a proxima decisao. */
  nextAt: number;
  /** Dormindo porque a sala esta vazia (acorda logo quando alguem chega). */
  emptySleep: boolean;
  /** Organizacao sem ninguem online: congelado ate alguem voltar. */
  frozen: boolean;
  follow: { accountId: string; until: number; replanAt: number } | null;
  play: { x: number; y: number; until: number; replanAt: number } | null;
  lastSayAt: number;
  treats: Map<string, number>;
  readonly bucket: TokenBucket;
}

interface OrgSettings {
  enabled: boolean;
  name: string;
}

const PET_PREFERRED_ROOMS = ['lounge', 'office', 'reception'];
const rangeMs = (rng: () => number, [a, b]: readonly [number, number]) => a + Math.floor(rng() * (b - a));

export class PetManager {
  private readonly pets = new Map<string, PetData>();
  private readonly settings = new Map<string, OrgSettings>();
  private readonly playerBuckets = new WeakMap<Player, TokenBucket>();

  constructor(
    private readonly host: PetHost,
    private readonly opts: { enabled: boolean; rng?: () => number } = { enabled: true },
  ) {}

  get enabled() {
    return this.opts.enabled;
  }
  private rng = () => (this.opts.rng ?? Math.random)();

  // ---- consulta ---------------------------------------------------------------------------------------

  /** Estado vivo do pet da organizacao (testes e painel). */
  petOf(orgId: string): Readonly<PetData> | undefined {
    return this.pets.get(orgId);
  }

  private settingsOf(orgId: string): OrgSettings {
    let s = this.settings.get(orgId);
    if (!s) {
      s = { enabled: true, name: PET_DEFAULT_NAME };
      this.settings.set(orgId, s);
    }
    return s;
  }

  private roomsOf(orgId: string) {
    return this.host.rooms(orgId);
  }

  /** O Byte pode estar nesta sala agora? (regra pura em shared/pet.ts + estado vivo). */
  roomAllowed(orgId: string, roomId: string): boolean {
    const room = this.roomsOf(orgId)?.get(roomId);
    if (!room) return false;
    const def = room.built.def;
    return petRoomAllowed({
      type: def.type,
      access: roomAccessOf(def),
      state: this.host.roomState(orgId, roomId),
      stageActive: this.host.stageActive(orgId, roomId),
      reserved: this.host.reserved?.(orgId, roomId) ?? false,
    });
  }

  private playersOfOrg(orgId: string): number {
    let n = 0;
    for (const r of this.roomsOf(orgId)?.values() ?? []) n += r.players.size;
    return n;
  }

  // ---- mensagens ----------------------------------------------------------------------------------------

  private viewOf(pet: PetData, now: number): PetView {
    this.sync(pet, now);
    const elapsed = now - pet.pathStart;
    const i = pet.path.length && elapsed >= 0 ? Math.floor(elapsed / STEP_MS) : -1;
    return {
      name: this.settingsOf(pet.orgId).name,
      x: pet.x,
      y: pet.y,
      dir: pet.dir,
      state: pet.path.length > 0 ? 'walk' : pet.state,
      path: pet.path.slice(i + 1),
      stepRemainingMs: this.stepRemaining(pet, now),
    };
  }

  private stepRemaining(pet: PetData, now: number): number {
    if (pet.path.length === 0) return 0;
    const elapsed = now - pet.pathStart;
    if (elapsed < 0) return -elapsed;
    const i = Math.floor(elapsed / STEP_MS);
    return i >= pet.path.length ? 0 : (i + 1) * STEP_MS - elapsed;
  }

  private sendRoom(orgId: string, roomId: string, msg: ServerMessage) {
    const room = this.roomsOf(orgId)?.get(roomId);
    if (!room) return;
    for (const p of room.players.values()) p.send(msg);
  }

  private snapshot(pet: PetData, now: number): ServerMessage {
    return { t: 'pet', pet: this.viewOf(pet, now) };
  }

  private act(pet: PetData, fx?: PetFx, say?: string) {
    const state: PetState = pet.path.length > 0 ? 'walk' : pet.state;
    this.sendRoom(pet.orgId, pet.roomId, { t: 'pet_act', state, x: pet.x, y: pet.y, dir: pet.dir, ...(fx ? { fx } : {}), ...(say ? { say } : {}) });
  }

  /** Uma pessoa entrou numa sala: ela fica sabendo se o Byte esta la (ou limpa o que tinha). */
  onEnter(player: Player, roomId: string, now: number) {
    if (!this.opts.enabled) return;
    const settings = this.settingsOf(player.orgId);
    if (!settings.enabled) return player.send({ t: 'pet', pet: null });
    let pet = this.pets.get(player.orgId);
    if (!pet) pet = this.create(player.orgId, roomId, now);
    if (pet && pet.roomId === roomId && !pet.frozen) {
      if (pet.emptySleep) {
        pet.emptySleep = false;
        pet.nextAt = now + 2500;
      }
      return player.send(this.snapshot(pet, now));
    }
    if (pet && pet.frozen && pet.roomId === roomId) {
      // primeira pessoa depois de um tempo sozinho: descongela dormindo e acorda em instantes
      this.thaw(pet, now);
      return player.send(this.snapshot(pet, now));
    }
    player.send({ t: 'pet', pet: null });
  }

  private thaw(pet: PetData, now: number) {
    pet.frozen = false;
    pet.emptySleep = false;
    pet.nextAt = now + 2500;
  }

  private create(orgId: string, hintRoom: string, now: number): PetData | undefined {
    const rooms = this.roomsOf(orgId);
    if (!rooms) return undefined;
    const roomId = this.roomAllowed(orgId, hintRoom) ? hintRoom : [...PET_PREFERRED_ROOMS, ...rooms.keys()].find((r) => this.roomAllowed(orgId, r));
    if (!roomId) return undefined;
    const room = rooms.get(roomId)!;
    const spot = this.freeNear(room, room.built.def.spawn);
    const pet: PetData = {
      orgId,
      roomId,
      x: spot.x,
      y: spot.y,
      dir: 2,
      state: 'idle',
      path: [],
      origin: { ...spot },
      pathStart: now,
      arrive: 'none',
      portal: null,
      seatDir: null,
      nextAt: now + 2000,
      emptySleep: false,
      frozen: false,
      follow: null,
      play: null,
      lastSayAt: now,
      treats: new Map(),
      bucket: new TokenBucket(10, 2, now),
    };
    this.pets.set(orgId, pet);
    return pet;
  }

  // ---- movimento ------------------------------------------------------------------------------------------

  /** Avanca a posicao logica pelo caminho (como RoomInstance.sync) e roda a chegada. */
  private sync(pet: PetData, now: number) {
    if (pet.path.length === 0) return;
    const elapsed = now - pet.pathStart;
    if (elapsed < 0) return;
    const i = Math.floor(elapsed / STEP_MS);
    if (i >= pet.path.length) {
      const last = pet.path[pet.path.length - 1]!;
      pet.x = last.x;
      pet.y = last.y;
      pet.path = [];
      this.arrived(pet, now);
      return;
    }
    const prev = i === 0 ? pet.origin : pet.path[i - 1]!;
    const cur = pet.path[i]!;
    pet.x = cur.x;
    pet.y = cur.y;
    pet.dir = dirFromDelta(cur.x - prev.x, cur.y - prev.y, pet.dir);
  }

  private startPath(pet: PetData, room: RoomInstance, to: Point, now: number, arrive: Arrive, extra: { portal?: Portal; seat?: Furniture } = {}): boolean {
    this.sync(pet, now);
    const g = room.built.grid;
    const goalBlocked = arrive === 'sit' && !!extra.seat;
    const path = findPath(g, { x: pet.x, y: pet.y }, to, { allowBlockedGoal: goalBlocked, maxLength: 40 });
    if (!path) return false;
    const remaining = this.stepRemaining(pet, now);
    pet.origin = { x: pet.x, y: pet.y };
    pet.path = path;
    pet.pathStart = now + remaining;
    pet.arrive = arrive;
    pet.portal = extra.portal ?? null;
    pet.seatDir = extra.seat ? seatDir(extra.seat) : null;
    pet.state = 'idle';
    pet.emptySleep = false;
    if (path.length === 0) {
      this.arrived(pet, now);
      return true;
    }
    this.sendRoom(pet.orgId, pet.roomId, { t: 'pet_path', from: pet.origin, path, stepRemainingMs: remaining });
    // enquanto anda, so decide de novo ao chegar
    pet.nextAt = Number.POSITIVE_INFINITY;
    return true;
  }

  private stopHere(pet: PetData, now: number) {
    this.sync(pet, now);
    if (pet.path.length === 0) return;
    pet.path = [];
    pet.origin = { x: pet.x, y: pet.y };
    this.sendRoom(pet.orgId, pet.roomId, { t: 'pet_path', from: pet.origin, path: [], stepRemainingMs: 0 });
  }

  private setPosture(pet: PetData, state: PetState, durationMs: number, now: number, fx?: PetFx, say?: string) {
    pet.state = state;
    pet.nextAt = now + durationMs;
    this.act(pet, fx, say);
  }

  private arrived(pet: PetData, now: number) {
    const how = pet.arrive;
    pet.arrive = 'none';
    pet.nextAt = now + this.idleDelay();
    if (how === 'eat') {
      this.setPosture(pet, 'eat', PET_EAT_MS, now, 'eat', pickLine(PET_ACT_LINES.treat, this.rng()));
    } else if (how === 'sit') {
      if (pet.seatDir !== null) pet.dir = pet.seatDir;
      this.setPosture(pet, 'sit', rangeMs(this.rng, PET_SIT_MS), now);
    } else if (how === 'portal' && pet.portal) {
      const p = pet.portal;
      pet.portal = null;
      if (this.roomAllowed(pet.orgId, p.toRoom)) this.moveToRoom(pet, p.toRoom, { x: p.toX, y: p.toY }, now);
      else this.setPosture(pet, 'idle', this.idleDelay(), now);
    } else {
      // chegou passeando: olha em volta
      pet.state = 'idle';
      this.act(pet);
    }
  }

  private idleDelay() {
    return PET_IDLE_MIN_MS + Math.floor(this.rng() * (PET_IDLE_MAX_MS - PET_IDLE_MIN_MS));
  }

  private occupiedTiles(room: RoomInstance): Set<number> {
    const g = room.built.grid;
    const s = new Set<number>();
    for (const p of room.players.values()) s.add(idx(g, p.x, p.y));
    return s;
  }

  /** Tile livre (andavel, nao portal, sem gente) mais perto de `want`. */
  private freeNear(room: RoomInstance, want: Point, avoidPlayers = true): Point {
    const g = room.built.grid;
    const occ = avoidPlayers ? this.occupiedTiles(room) : new Set<number>();
    const seen = new Set<number>();
    const queue: Point[] = [want];
    while (queue.length) {
      const c = queue.shift()!;
      if (!inBounds(g, c.x, c.y)) continue;
      const i = idx(g, c.x, c.y);
      if (seen.has(i)) continue;
      seen.add(i);
      if (isWalkable(g, c.x, c.y) && !occ.has(i) && !room.built.portalAt.has(i)) return c;
      for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]] as const) queue.push({ x: c.x + dx, y: c.y + dy });
      if (seen.size > g.width * g.height) break;
    }
    return want;
  }

  /** Move o Byte para outra sala (ou outro ponto): quem estava la o ve sumir, quem esta no destino o ve aparecer. */
  private moveToRoom(pet: PetData, roomId: string, at: Point, now: number) {
    const rooms = this.roomsOf(pet.orgId);
    const to = rooms?.get(roomId);
    if (!to) return;
    if (roomId !== pet.roomId) this.sendRoom(pet.orgId, pet.roomId, { t: 'pet', pet: null });
    const spot = this.freeNear(to, at);
    pet.roomId = roomId;
    pet.x = spot.x;
    pet.y = spot.y;
    pet.path = [];
    pet.origin = { ...spot };
    pet.pathStart = now;
    pet.arrive = 'none';
    pet.portal = null;
    pet.follow = null;
    pet.play = null;
    pet.state = 'idle';
    pet.emptySleep = false;
    pet.nextAt = now + 4000 + Math.floor(this.rng() * 3000);
    this.sendRoom(pet.orgId, roomId, this.snapshot(pet, now));
  }

  /** A sala deixou de ser permitida (trancada, palco, reserva): vai para uma sala permitida, de preferencia com gente. */
  private relocate(pet: PetData, now: number) {
    const rooms = this.roomsOf(pet.orgId);
    if (!rooms) return;
    const ok = [...rooms.keys()].filter((r) => this.roomAllowed(pet.orgId, r));
    if (ok.length === 0) {
      // nenhuma sala disponivel: some da cena ate haver uma
      this.sendRoom(pet.orgId, pet.roomId, { t: 'pet', pet: null });
      pet.roomId = '';
      pet.path = [];
      pet.nextAt = now + 5000;
      return;
    }
    const withPeople = ok.filter((r) => (rooms.get(r)?.players.size ?? 0) > 0);
    const pool = withPeople.length ? withPeople : ok;
    const preferred = pool.find((r) => PET_PREFERRED_ROOMS.includes(r)) ?? pool[0]!;
    this.moveToRoom(pet, preferred, rooms.get(preferred)!.built.def.spawn, now);
  }

  // ---- tick ------------------------------------------------------------------------------------------------

  tick(now: number) {
    if (!this.opts.enabled) return;
    for (const pet of this.pets.values()) {
      if (!this.settingsOf(pet.orgId).enabled) continue;
      const rooms = this.roomsOf(pet.orgId);
      const room = rooms?.get(pet.roomId);
      if (!rooms) continue;
      if (!room) {
        // sem sala permitida (todas trancadas/em palco): tenta voltar de tempos em tempos
        if (pet.roomId === '' && now >= pet.nextAt && this.playersOfOrg(pet.orgId) > 0) this.relocate(pet, now);
        continue;
      }
      if (!this.roomAllowed(pet.orgId, pet.roomId)) {
        this.relocate(pet, now);
        continue;
      }
      if (this.playersOfOrg(pet.orgId) === 0) {
        if (!pet.frozen) {
          // ninguem online na organizacao: o pet dorme e o servidor nao gasta mais nada com ele
          this.sync(pet, now);
          pet.path = [];
          pet.origin = { x: pet.x, y: pet.y };
          pet.state = 'sleep';
          pet.emptySleep = true;
          pet.follow = null;
          pet.play = null;
          pet.frozen = true;
        }
        continue;
      }
      if (pet.frozen) this.thaw(pet, now);
      this.sync(pet, now);

      if (room.players.size === 0) {
        this.tickEmptyRoom(pet, rooms, now);
        continue;
      }
      if (pet.follow || pet.play) {
        this.tickChase(pet, room, now);
        continue;
      }
      if (pet.path.length > 0) continue;
      // sentado: se alguem sentou em cima dele, levanta
      const bumped = pet.state === 'sit' && this.someoneOn(room, pet);
      if (now < pet.nextAt && !bumped) continue;
      this.decide(pet, room, now);
    }
  }

  private someoneOn(room: RoomInstance, pet: PetData) {
    for (const p of room.players.values()) if (p.x === pet.x && p.y === pet.y && p.sitting) return true;
    return false;
  }

  private tickEmptyRoom(pet: PetData, rooms: ReadonlyMap<string, RoomInstance>, now: number) {
    if (pet.path.length > 0) {
      // ninguem ve: termina a caminhada de uma vez
      const last = pet.path[pet.path.length - 1]!;
      pet.x = last.x;
      pet.y = last.y;
      pet.path = [];
      pet.origin = { x: pet.x, y: pet.y };
      pet.arrive = 'none';
      pet.portal = null;
    }
    pet.follow = null;
    pet.play = null;
    if (pet.state !== 'sleep') {
      pet.state = 'sleep';
      pet.emptySleep = true;
      pet.nextAt = now + PET_EMPTY_ROOM_MOVE_MS;
    }
    if (now < pet.nextAt) return;
    pet.nextAt = now + PET_EMPTY_ROOM_MOVE_MS;
    const targets = [...rooms.keys()].filter((r) => r !== pet.roomId && (rooms.get(r)?.players.size ?? 0) > 0 && this.roomAllowed(pet.orgId, r));
    if (targets.length === 0) return;
    const to = targets[Math.floor(this.rng() * targets.length)]!;
    this.moveToRoom(pet, to, rooms.get(to)!.built.def.spawn, now);
    // chega descansado: acorda em instantes
    pet.nextAt = now + 2500;
  }

  /** Segue quem o chamou / persegue o ponteiro da brincadeira. */
  private tickChase(pet: PetData, room: RoomInstance, now: number) {
    const f = pet.follow;
    const pl = pet.play;
    const until = f?.until ?? pl!.until;
    if (now >= until) {
      pet.follow = null;
      pet.play = null;
      this.stopHere(pet, now);
      this.setPosture(pet, 'happy', PET_HAPPY_MS, now);
      return;
    }
    const replanAt = f?.replanAt ?? pl!.replanAt;
    if (now < replanAt) return;
    let target: Point | null = null;
    if (f) {
      const who = [...room.players.values()].find((p) => p.accountId === f.accountId);
      if (!who) {
        pet.follow = null;
        return;
      }
      room.sync(who, now);
      target = { x: who.x, y: who.y };
      f.replanAt = now + 900;
    } else {
      target = { x: pl!.x, y: pl!.y };
      pl!.replanAt = now + 700;
    }
    const near = Math.max(Math.abs(pet.x - target.x), Math.abs(pet.y - target.y)) <= 1;
    if (near && pet.path.length === 0) {
      if (pet.state !== 'happy') {
        pet.state = 'happy';
        this.act(pet);
      }
      return;
    }
    const dest = this.tileBeside(room, target, pet);
    if (dest) this.startPath(pet, room, dest, now, 'none');
  }

  /** Tile andavel ao lado de `target` (nunca o proprio), o mais perto do pet. */
  private tileBeside(room: RoomInstance, target: Point, pet: Point): Point | null {
    const g = room.built.grid;
    const cands: Point[] = [];
    for (let r = 1; r <= 2 && cands.length === 0; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const x = target.x + dx;
          const y = target.y + dy;
          if (isWalkable(g, x, y) && !room.built.portalAt.has(idx(g, x, y))) cands.push({ x, y });
        }
      }
    }
    if (cands.length === 0) return null;
    cands.sort((a, b) => Math.hypot(a.x - pet.x, a.y - pet.y) - Math.hypot(b.x - pet.x, b.y - pet.y));
    return cands[0]!;
  }

  // ---- decisoes -----------------------------------------------------------------------------------------------

  private decide(pet: PetData, room: RoomInstance, now: number) {
    // acabou uma postura longa: levanta / acorda primeiro
    if (pet.state !== 'idle') {
      const wasSleeping = pet.state === 'sleep';
      pet.state = 'idle';
      pet.nextAt = now + (wasSleeping ? 1200 : 500);
      this.act(pet);
      return;
    }
    const roll = this.rng();
    let say: string | undefined;
    if (now - pet.lastSayAt >= PET_SAY_MIN_GAP_MS && this.rng() < PET_SAY_CHANCE) {
      say = pickLine(PET_LINES.random, this.rng());
      pet.lastSayAt = now;
    }
    pet.nextAt = now + this.idleDelay();
    if (roll < PET_ROOM_CHANGE_CHANCE && this.goToPortal(pet, room, now)) return;
    if (roll < 0.34 && this.goSit(pet, room, now)) return;
    if (roll < 0.46) return this.setPosture(pet, 'sleep', rangeMs(this.rng, PET_SLEEP_MS), now, undefined, say ? PET_LINES.sleepy[0] : undefined);
    if (roll < 0.85 && this.goWander(pet, room, now)) {
      if (say) this.act(pet, undefined, say);
      return;
    }
    // fica parado, olhando para um lado
    pet.dir = ([0, 2, 4, 6] as const)[Math.floor(this.rng() * 4)]!;
    this.act(pet, undefined, say);
  }

  private goWander(pet: PetData, room: RoomInstance, now: number): boolean {
    const g = room.built.grid;
    const occ = this.occupiedTiles(room);
    for (let attempt = 0; attempt < 6; attempt++) {
      const x = pet.x + Math.floor(this.rng() * 15) - 7;
      const y = pet.y + Math.floor(this.rng() * 15) - 7;
      if (!isWalkable(g, x, y) || room.built.portalAt.has(idx(g, x, y)) || occ.has(idx(g, x, y))) continue;
      if (x === pet.x && y === pet.y) continue;
      if (this.startPath(pet, room, { x, y }, now, 'none')) return true;
    }
    return false;
  }

  private goSit(pet: PetData, room: RoomInstance, now: number): boolean {
    const cushy = room.built.def.furniture.filter((f) => f.kind === 'sofa' || f.kind === 'pouf' || f.kind === 'armchair');
    const spots: Array<{ at: Point; seat?: Furniture }> = [];
    for (const f of cushy) for (const t of footprintTiles(f)) if (!room.seatTaken(t.x, t.y, '\0pet')) spots.push({ at: t, seat: f });
    // ou no chao, ao lado de uma estacao de trabalho
    const g = room.built.grid;
    for (const f of room.built.def.furniture) {
      if (!WORKSTATION_KINDS.includes(f.kind)) continue;
      for (const t of footprintTiles(f)) {
        for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]] as const) {
          const x = t.x + dx;
          const y = t.y + dy;
          if (isWalkable(g, x, y) && !room.built.portalAt.has(idx(g, x, y))) spots.push({ at: { x, y } });
        }
      }
    }
    if (spots.length === 0) return false;
    for (let attempt = 0; attempt < 4; attempt++) {
      const s = spots[Math.floor(this.rng() * spots.length)]!;
      if (s.at.x === pet.x && s.at.y === pet.y) continue;
      if (this.startPath(pet, room, s.at, now, 'sit', { seat: s.seat })) return true;
    }
    return false;
  }

  private goToPortal(pet: PetData, room: RoomInstance, now: number): boolean {
    const options = room.built.def.portals.filter((p) => this.roomAllowed(pet.orgId, p.toRoom));
    if (options.length === 0) return false;
    const p = options[Math.floor(this.rng() * options.length)]!;
    return this.startPath(pet, room, { x: p.x, y: p.y }, now, 'portal', { portal: p });
  }

  // ---- interacao ---------------------------------------------------------------------------------------------

  /** Trata `pet_do`. false = mensagem malformada (o mundo conta um strike). */
  handle(player: Player, msg: { t: 'pet_do'; act: unknown; x?: unknown; y?: unknown }, now: number): boolean {
    if (!isPetAct(msg.act)) return false;
    if ((msg.x !== undefined && !Number.isInteger(msg.x)) || (msg.y !== undefined && !Number.isInteger(msg.y))) return false;
    const act = msg.act;
    const fail = (code: string, message: string) => player.send({ t: 'error', code, message });
    let pb = this.playerBuckets.get(player);
    if (!pb) {
      pb = new TokenBucket(4, 0.7, now);
      this.playerBuckets.set(player, pb);
    }
    if (!pb.take(now)) {
      fail('pet_slow', PET_LINES.slow);
      return true;
    }
    const pet = this.pets.get(player.orgId);
    const room = player.roomId ? this.roomsOf(player.orgId)?.get(player.roomId) : undefined;
    if (!this.opts.enabled || !pet || !room || !this.settingsOf(player.orgId).enabled || pet.frozen || pet.roomId !== player.roomId) {
      fail('pet_off', PET_LINES.off);
      return true;
    }
    if (!pet.bucket.take(now)) {
      fail('pet_slow', PET_LINES.slow);
      return true;
    }
    this.sync(pet, now);
    room.sync(player, now);
    const dist = Math.max(Math.abs(pet.x - player.x), Math.abs(pet.y - player.y));
    if ((act === 'pat' || act === 'treat') && dist > PET_REACH) {
      fail('pet_far', PET_LINES.tooFar);
      return true;
    }
    pet.emptySleep = false;
    pet.follow = null;
    pet.play = null;
    const g = room.built.grid;
    const say = pickLine(PET_ACT_LINES[act], this.rng());
    switch (act) {
      case 'pat': {
        this.stopHere(pet, now);
        pet.dir = dirFromDelta(player.x - pet.x, player.y - pet.y, pet.dir);
        pet.lastSayAt = now;
        this.setPosture(pet, 'happy', PET_HAPPY_MS, now, 'hearts', say);
        return true;
      }
      case 'treat': {
        const last = pet.treats.get(player.accountId) ?? 0;
        if (now - last < PET_TREAT_COOLDOWN_MS) {
          fail('pet_cooldown', PET_LINES.cooldown);
          return true;
        }
        for (const [k, t] of pet.treats) if (now - t >= PET_TREAT_COOLDOWN_MS) pet.treats.delete(k);
        pet.treats.set(player.accountId, now);
        this.giveTreat(player, room, now);
        pet.lastSayAt = now;
        const dest = this.tileBeside(room, { x: player.x, y: player.y }, pet);
        if (dest && !(Math.max(Math.abs(pet.x - player.x), Math.abs(pet.y - player.y)) <= 1) && this.startPath(pet, room, dest, now, 'eat')) return true;
        this.stopHere(pet, now);
        pet.dir = dirFromDelta(player.x - pet.x, player.y - pet.y, pet.dir);
        this.setPosture(pet, 'eat', PET_EAT_MS, now, 'eat', say);
        return true;
      }
      case 'call': {
        pet.follow = { accountId: player.accountId, until: now + PET_FOLLOW_MS, replanAt: now };
        pet.lastSayAt = now;
        this.act(pet, undefined, say);
        return true;
      }
      case 'play': {
        const x = typeof msg.x === 'number' ? msg.x : player.x;
        const y = typeof msg.y === 'number' ? msg.y : player.y;
        if (!isWalkable(g, x, y)) {
          fail('pet_blocked', 'O Byte não consegue chegar lá.');
          return true;
        }
        pet.play = { x, y, until: now + PET_PLAY_MS, replanAt: now };
        pet.lastSayAt = now;
        this.act(pet, undefined, say);
        return true;
      }
    }
  }

  /** O petisco: se a pessoa ja segura um lanche, entrega; se esta ao lado de uma maquina de lanches, "compra" e entrega; senao e so carinho. */
  private giveTreat(player: Player, room: RoomInstance, now: number) {
    if (player.activity === 'holding:snack') {
      room.dropHeld(player);
      return;
    }
    if (player.activity !== 'idle' || player.path.length > 0) return;
    for (const f of room.built.def.furniture) {
      if (f.kind !== 'snack_machine') continue;
      const tiles = footprintTiles(f);
      if (!tiles.some((t) => Math.max(Math.abs(t.x - player.x), Math.abs(t.y - player.y)) <= 1)) continue;
      const t = tiles[0]!;
      if (room.interact(player, f.id, t.x, t.y, now)) room.dropHeld(player);
      return;
    }
  }

  /** Autoping bem-sucedido: o Byte da uma batidinha de coracao (so visual) onde estiver. */
  heartbeat() {
    if (!this.opts.enabled) return;
    for (const pet of this.pets.values()) {
      if (!this.settingsOf(pet.orgId).enabled || pet.frozen) continue;
      this.act(pet, 'beat');
    }
  }

  // ---- staff ---------------------------------------------------------------------------------------------------

  list(): PetAdminEntry[] {
    return this.host.orgs().map((o) => {
      const s = this.settingsOf(o.id);
      const pet = this.pets.get(o.id);
      const roomName = pet ? (this.roomsOf(o.id)?.get(pet.roomId)?.built.def.name ?? null) : null;
      return { orgId: o.id, orgName: o.name, enabled: this.opts.enabled && s.enabled, name: s.name, roomId: pet?.roomId ?? null, roomName };
    });
  }

  setEnabled(orgId: string, on: boolean, now: number): boolean {
    const s = this.settingsOf(orgId);
    if (s.enabled === on) return false;
    s.enabled = on;
    const pet = this.pets.get(orgId);
    if (!this.opts.enabled) return true;
    if (!on) {
      if (pet) this.sendRoom(orgId, pet.roomId, { t: 'pet', pet: null });
    } else {
      // volta onde estava; se ainda nao existe, nasce na sala de quem estiver online
      for (const [roomId, r] of this.roomsOf(orgId) ?? []) {
        if (r.players.size === 0) continue;
        for (const p of r.players.values()) this.onEnter(p, roomId, now);
      }
    }
    return true;
  }

  rename(orgId: string, raw: unknown, now: number): string | null {
    const name = cleanPetName(raw);
    if (!name) return null;
    this.settingsOf(orgId).name = name;
    const pet = this.pets.get(orgId);
    if (pet && this.settingsOf(orgId).enabled && this.opts.enabled && !pet.frozen) this.sendRoom(orgId, pet.roomId, this.snapshot(pet, now));
    return name;
  }

  /** Staff leva o Byte ate uma sala/ponto da propria organizacao (so salas permitidas). */
  bring(orgId: string, roomId: string, at: Point, now: number): { ok: true } | { ok: false; message: string } {
    if (!this.opts.enabled || !this.settingsOf(orgId).enabled) return { ok: false, message: 'O Byte está desligado.' };
    if (!this.roomAllowed(orgId, roomId)) return { ok: false, message: 'O Byte não pode entrar nessa sala.' };
    const pet = this.pets.get(orgId) ?? this.create(orgId, roomId, now);
    if (!pet) return { ok: false, message: 'O Byte não tem onde ficar.' };
    if (pet.frozen) this.thaw(pet, now);
    this.moveToRoom(pet, roomId, at, now);
    return { ok: true };
  }
}
