import {
  FURNI_KINDS,
  FURNI_HOLDS,
  HELD_CHAT,
  HOLD_MS,
  heldOf,
  MAX_CHAT_LENGTH,
  STEP_MS,
  dirFromDelta,
  findPath,
  footprintTiles,
  idx,
  inBounds,
  isWalkable,
  seatDir,
  stageSpots,
  buildRoom,
  type Activity,
  type AvatarConfig,
  type BuiltRoom,
  type Dir8,
  type Emote,
  type Furniture,
  type PlayerView,
  type Point,
  type PresenceStatus,
  type Portal,
  type RoomDef,
  type Role,
  type ServerMessage,
  type StaffLevel,
} from '@workverse/shared';
import { TokenBucket } from './limiter';

type PendingAction =
  | { kind: 'sit'; x: number; y: number; dir: Dir8 }
  | { kind: 'use'; furniId: string }
  | { kind: 'face'; dir: Dir8 }
  | { kind: 'portal'; portal: Portal };

export class Player {
  /** Organization of the live session; everything this player can see or reach is inside it. Set by World.hello. */
  orgId = '';
  role: Role = 'member';
  teamId: string | null = null;
  /** Staff da plataforma (vem de Account.staff, definido pelo servidor). `onDuty` liga o selo e os poderes. */
  staff: StaffLevel | null = null;
  onDuty = false;
  /** Staff invisivel: some para os demais da sala (ver RoomInstance.broadcast). */
  invisible = false;
  roomId: string | null = null;
  x = 0;
  y = 0;
  dir: Dir8 = 2;
  sitting = false;
  path: Point[] = [];
  origin: Point = { x: 0, y: 0 };
  pathStart = 0;
  action: PendingAction | null = null;
  status: PresenceStatus = 'available';
  /** Time of the last player action, for automatic away. */
  lastActive: number;
  /** When set, `status` is an automatic away and this is the status to restore on activity. */
  autoAwayFrom: PresenceStatus | null = null;
  /** Server-owned interaction state (see shared/activity.ts). Never taken from the client. */
  activity: Activity = 'idle';
  /** When a held cup is put down automatically. */
  holdUntil = 0;
  /** Computer this player is working at, while `activity` is `working`. */
  workingAt: string | null = null;
  /** `status` was set to `focus` by working (not chosen by the player), so leaving the desk may undo it. */
  autoFocus = false;
  readonly moveBucket: TokenBucket;
  readonly chatBucket: TokenBucket;
  readonly miscBucket: TokenBucket;
  /** Auditorium actions (hands, slide changes...) and deck uploads. */
  readonly stageBucket: TokenBucket;
  readonly deckBucket: TokenBucket;

  constructor(
    readonly id: string,
    readonly accountId: string,
    public name: string,
    public avatar: AvatarConfig,
    readonly send: (msg: ServerMessage) => void,
    now: number,
  ) {
    this.lastActive = now;
    this.moveBucket = new TokenBucket(8, 6, now);
    this.chatBucket = new TokenBucket(4, 1.25, now);
    this.miscBucket = new TokenBucket(10, 5, now);
    this.stageBucket = new TokenBucket(20, 8, now);
    this.deckBucket = new TokenBucket(10, 1, now);
  }
}

export interface RoomHooks {
  onPortal(player: Player, portal: Portal): void;
  onChange(): void;
  /** A player used the podium. */
  onPodium?(player: Player): void;
}

/** Control, zero-width and bidi-override characters are never allowed in chat. */
function isForbiddenChar(code: number): boolean {
  return (
    code < 32 ||
    (code >= 0x7f && code <= 0x9f) ||
    (code >= 0x200b && code <= 0x200f) ||
    (code >= 0x2028 && code <= 0x202e) ||
    (code >= 0x2066 && code <= 0x2069)
  );
}

/** Strips forbidden characters and collapses whitespace. Rendering is always as plain text. */
export function cleanChat(raw: string): string {
  let out = '';
  for (const ch of raw) out += isForbiddenChar(ch.codePointAt(0)!) ? ' ' : ch;
  return out.replace(/\s+/g, ' ').trim().slice(0, MAX_CHAT_LENGTH);
}

export class RoomInstance {
  readonly built: BuiltRoom;
  readonly players = new Map<string, Player>();
  readonly furniState: Record<string, boolean> = {};
  /** Last clock value seen (arrival actions happen deep inside `sync`, which knows the time). */
  private lastNow = 0;

  constructor(
    def: RoomDef,
    private readonly hooks: RoomHooks,
  ) {
    this.built = buildRoom(def);
  }

  get id() {
    return this.built.def.id;
  }

  get isFull() {
    return this.players.size >= this.built.def.maxPlayers;
  }

  broadcast(msg: ServerMessage, exceptId?: string) {
    // Staff invisivel: tudo que fala DELE (caminho, chat, emote...) so volta para ele mesmo.
    const subject = (msg as { id?: unknown }).id;
    const ghost = typeof subject === 'string' && msg.t !== 'left' && msg.t !== 'staff_flag' ? this.players.get(subject) : undefined;
    if (ghost?.invisible) {
      if (ghost.id !== exceptId) ghost.send(msg);
      return;
    }
    for (const p of this.players.values()) if (p.id !== exceptId) p.send(msg);
  }

  /** Para os OUTROS da sala: sai de cena (ficou invisivel) ou reaparece. */
  setVisibility(p: Player, now: number) {
    if (!this.players.has(p.id)) return;
    for (const o of this.players.values()) {
      if (o.id === p.id) continue;
      o.send(p.invisible ? { t: 'left', id: p.id } : { t: 'joined', player: this.view(p, now) });
    }
  }

  // ---- membership -------------------------------------------------------

  add(p: Player, spawn: Point & { dir: Dir8 }, now: number, population: Record<string, number>) {
    const tile = this.freeTileNear(spawn);
    p.roomId = this.id;
    p.x = tile.x;
    p.y = tile.y;
    p.dir = spawn.dir;
    p.sitting = false;
    p.activity = 'idle';
    p.workingAt = null;
    p.autoFocus = false;
    p.path = [];
    p.action = null;
    p.origin = { ...tile };
    this.players.set(p.id, p);
    p.send({
      t: 'room',
      room: {
        def: this.built.def,
        youId: p.id,
        players: [...this.players.values()].filter((o) => !o.invisible || o.id === p.id).map((o) => this.view(o, now)),
        furniState: { ...this.furniState },
        population,
      },
    });
    if (!p.invisible) this.broadcast({ t: 'joined', player: this.view(p, now) }, p.id);
    this.hooks.onChange();
  }

  remove(p: Player) {
    if (!this.players.delete(p.id)) return;
    this.stopWork(p);
    p.activity = 'idle';
    p.roomId = null;
    p.path = [];
    p.action = null;
    if (!p.invisible) this.broadcast({ t: 'left', id: p.id });
    this.hooks.onChange();
  }

  private freeTileNear(want: Point): Point {
    const g = this.built.grid;
    const occupied = new Set([...this.players.values()].map((o) => idx(g, o.x, o.y)));
    const seen = new Set<number>();
    const queue: Point[] = [want];
    while (queue.length) {
      const c = queue.shift()!;
      if (!inBounds(g, c.x, c.y)) continue;
      const i = idx(g, c.x, c.y);
      if (seen.has(i)) continue;
      seen.add(i);
      if (isWalkable(g, c.x, c.y) && !occupied.has(i) && !this.built.portalAt.has(i)) return c;
      for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) queue.push({ x: c.x + dx, y: c.y + dy });
      if (seen.size > g.width * g.height) break;
    }
    return want;
  }

  // ---- movement ---------------------------------------------------------

  /** Milliseconds until the step in progress finishes. */
  stepRemaining(p: Player, now: number): number {
    if (p.path.length === 0) return 0;
    const elapsed = now - p.pathStart;
    if (elapsed < 0) return -elapsed;
    const i = Math.floor(elapsed / STEP_MS);
    return i >= p.path.length ? 0 : (i + 1) * STEP_MS - elapsed;
  }

  view(p: Player, now: number): PlayerView {
    this.sync(p, now);
    const elapsed = now - p.pathStart;
    const i = p.path.length && elapsed >= 0 ? Math.floor(elapsed / STEP_MS) : -1;
    return {
      id: p.id,
      name: p.name,
      avatar: p.avatar,
      x: p.x,
      y: p.y,
      dir: p.dir,
      sitting: p.sitting,
      status: p.status,
      activity: p.activity,
      path: p.path.slice(i + 1),
      stepRemainingMs: this.stepRemaining(p, now),
      ...(p.staff && p.onDuty ? { staff: p.staff } : {}),
    };
  }

  /** Advances the logical position of a player along its path and runs arrival actions. */
  sync(p: Player, now: number) {
    this.lastNow = now;
    if (p.path.length === 0) return;
    const elapsed = now - p.pathStart;
    if (elapsed < 0) return;
    const i = Math.floor(elapsed / STEP_MS);
    if (i >= p.path.length) {
      const last = p.path[p.path.length - 1];
      p.x = last.x;
      p.y = last.y;
      p.path = [];
      this.arrive(p);
      return;
    }
    const prev = i === 0 ? p.origin : p.path[i - 1];
    const cur = p.path[i];
    p.x = cur.x;
    p.y = cur.y;
    p.dir = dirFromDelta(cur.x - prev.x, cur.y - prev.y, p.dir);
  }

  tick(now: number) {
    for (const p of [...this.players.values()]) {
      this.sync(p, now);
      if (heldOf(p.activity) && now >= p.holdUntil) this.setActivity(p, 'idle');
    }
  }

  private arrive(p: Player) {
    const action = p.action;
    p.action = null;
    if (!action) return;
    if (action.kind === 'sit') {
      if (this.seatTaken(action.x, action.y, p.id)) return;
      p.sitting = true;
      p.dir = action.dir;
      this.broadcast({ t: 'sit', id: p.id, x: p.x, y: p.y, dir: p.dir });
      const pc = this.computerFacing(p.x, p.y);
      if (pc) this.startWork(p, pc);
    } else if (action.kind === 'use') {
      this.useFurniture(p, action.furniId);
    } else if (action.kind === 'face') {
      p.dir = action.dir;
      this.broadcast({ t: 'face', id: p.id, dir: p.dir });
    } else {
      this.hooks.onPortal(p, action.portal);
    }
  }

  move(p: Player, x: number, y: number, now: number): boolean {
    const g = this.built.grid;
    if (!Number.isInteger(x) || !Number.isInteger(y) || !isWalkable(g, x, y)) return false;
    return this.startPath(p, { x, y }, now, {}, null);
  }

  private startPath(
    p: Player,
    target: Point,
    now: number,
    opts: { allowBlockedGoal?: boolean },
    action: PendingAction | null,
  ): boolean {
    this.sync(p, now);
    const path = findPath(this.built.grid, { x: p.x, y: p.y }, target, { ...opts, maxLength: 80 });
    if (!path) return false;
    const targetPortal = this.built.portalAt.get(idx(this.built.grid, target.x, target.y));
    const pending = action ?? (targetPortal ? { kind: 'portal' as const, portal: targetPortal } : null);
    const remaining = this.stepRemaining(p, now);
    p.origin = { x: p.x, y: p.y };
    p.path = path;
    p.pathStart = now + remaining;
    p.sitting = false;
    if (p.activity === 'working') this.setActivity(p, 'idle');
    p.action = path.length === 0 ? null : pending;
    this.broadcast({ t: 'path', id: p.id, from: p.origin, path, stepRemainingMs: remaining });
    if (path.length === 0 && pending) {
      p.action = pending;
      this.arrive(p);
    }
    return true;
  }

  // ---- furniture --------------------------------------------------------

  seatTaken(x: number, y: number, exceptId: string): boolean {
    for (const o of this.players.values()) {
      if (o.id === exceptId) continue;
      if (o.sitting && o.x === x && o.y === y) return true;
      if (o.action?.kind === 'sit' && o.action.x === x && o.action.y === y) return true;
    }
    return false;
  }

  interact(p: Player, furniId: string, x: number, y: number, now: number): boolean {
    const f = this.built.furniById.get(furniId);
    if (!f) return false;
    const kind = FURNI_KINDS[f.kind];
    const tiles = footprintTiles(f);
    const tile = tiles.find((t) => t.x === x && t.y === y);
    if (!tile) return false;

    if (kind.seat) {
      if (this.seatTaken(tile.x, tile.y, p.id)) return false;
      if (p.sitting && p.x === tile.x && p.y === tile.y) return true;
      return this.startPath(p, tile, now, { allowBlockedGoal: true }, { kind: 'sit', x: tile.x, y: tile.y, dir: seatDir(f) });
    }
    if (kind.usable) {
      this.sync(p, now);
      const adjacent = tiles.some((t) => Math.max(Math.abs(t.x - p.x), Math.abs(t.y - p.y)) <= 1);
      if (adjacent && p.path.length === 0) {
        this.useFurniture(p, f.id);
        return true;
      }
      return this.walkNextTo(p, f, tiles, now);
    }
    return false;
  }

  private walkNextTo(p: Player, f: Furniture, tiles: Point[], now: number): boolean {
    const g = this.built.grid;
    const inside = new Set(tiles.map((t) => idx(g, t.x, t.y)));
    const seen = new Set<number>();
    let best: Point[] | null = null;
    for (const t of tiles) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = t.x + dx;
          const ny = t.y + dy;
          if (!inBounds(g, nx, ny)) continue;
          const i = idx(g, nx, ny);
          if (inside.has(i) || seen.has(i) || !isWalkable(g, nx, ny)) continue;
          seen.add(i);
          const path = findPath(g, { x: p.x, y: p.y }, { x: nx, y: ny });
          if (path && (!best || path.length < best.length)) best = path;
        }
      }
    }
    if (!best || best.length === 0) return false;
    return this.startPath(p, best[best.length - 1], now, {}, { kind: 'use', furniId: f.id });
  }

  /** Sends the speaker to the spot behind the podium and turns them to the audience (the first free one). */
  goToStageSpot(p: Player, now: number): boolean {
    const spots = stageSpots(this.built);
    const free = spots.find((s) => ![...this.players.values()].some((o) => o.id !== p.id && o.x === s.x && o.y === s.y && !o.sitting)) ?? spots[0];
    if (!free) return false;
    return this.startPath(p, free, now, {}, { kind: 'face', dir: free.dir });
  }

  private useFurniture(p: Player, furniId: string) {
    const f = this.built.furniById.get(furniId);
    if (!f) return;
    if (f.kind === 'computer') {
      // a monitor somebody is working at stays on
      if (this.isWorkedAt(f.id)) return;
      this.setFurni(f.id, !this.furniState[f.id]);
    } else if (f.kind === 'podium') {
      this.hooks.onPodium?.(p);
    } else if (FURNI_HOLDS[f.kind]) {
      const item = FURNI_HOLDS[f.kind]!;
      this.setActivity(p, `holding:${item}`);
      this.broadcast({ t: 'chat', id: null, name: '', text: `${p.name} ${HELD_CHAT[item]}`, kind: 'system' });
    }
  }

  // ---- activity (working at a PC, holding a cup) ------------------------------------------------------------------

  private setFurni(id: string, on: boolean) {
    if ((this.furniState[id] ?? false) === on) return;
    this.furniState[id] = on;
    this.broadcast({ t: 'furni', id, on });
  }

  private isWorkedAt(computerId: string): boolean {
    for (const o of this.players.values()) if (o.workingAt === computerId) return true;
    return false;
  }

  /** The computer a seat on (x,y) faces: the tile in front of the chair must hold one. */
  computerFacing(x: number, y: number): Furniture | undefined {
    const g = this.built.grid;
    const seat = (this.built.furniAt.get(idx(g, x, y)) ?? []).find((f) => FURNI_KINDS[f.kind].seat);
    if (!seat) return undefined;
    const [dx, dy] = [[1, 0], [0, 1], [-1, 0], [0, -1]][seat.dir % 4];
    if (!inBounds(g, x + dx, y + dy)) return undefined;
    return (this.built.furniAt.get(idx(g, x + dx, y + dy)) ?? []).find((f) => f.kind === 'computer');
  }

  private startWork(p: Player, pc: Furniture) {
    if (this.isWorkedAt(pc.id)) return;
    p.workingAt = pc.id;
    this.setFurni(pc.id, true);
    this.setActivity(p, 'working');
    // suggest "focus" only over the default status: a choice of the player (busy, meeting...) is never overwritten
    if (p.status === 'available' && !p.autoAwayFrom) {
      p.autoFocus = true;
      this.setStatus(p, 'focus');
    }
  }

  /** Releases the computer (monitor off when nobody else uses it) and undoes a suggested `focus`. */
  private stopWork(p: Player) {
    const pc = p.workingAt;
    p.workingAt = null;
    if (pc && !this.isWorkedAt(pc)) this.setFurni(pc, false);
    if (p.autoFocus) {
      p.autoFocus = false;
      if (p.status === 'focus' && this.players.has(p.id)) this.setStatus(p, 'available');
    }
  }

  /** Sets the activity and tells the room. Leaving `working` switches the monitor off. */
  setActivity(p: Player, activity: Activity) {
    const wasWorking = p.activity === 'working';
    if (p.activity === activity && !heldOf(activity)) return;
    p.activity = activity;
    if (wasWorking && activity !== 'working') this.stopWork(p);
    if (heldOf(activity)) p.holdUntil = this.lastNow + HOLD_MS;
    this.broadcast({ t: 'activity', id: p.id, activity });
  }

  /** The client asked to put down what it holds. Returns false when there was nothing to drop. */
  dropHeld(p: Player): boolean {
    if (!heldOf(p.activity)) return false;
    this.setActivity(p, 'idle');
    return true;
  }

  // ---- communication ----------------------------------------------------

  chat(p: Player, raw: string, now: number): 'ok' | 'rate_limited' | 'empty' {
    const text = cleanChat(raw);
    if (!text) return 'empty';
    if (!p.chatBucket.take(now)) return 'rate_limited';
    if (text.startsWith('/')) {
      const cmd = text.slice(1).split(' ')[0].toLowerCase();
      if (cmd === 'wave' || cmd === 'acenar') {
        this.emote(p, 'wave');
      } else {
        p.send({ t: 'chat', id: null, name: '', text: 'Comandos: /acenar', kind: 'system' });
      }
      return 'ok';
    }
    if (p.invisible) p.send({ t: 'chat', id: null, name: '', text: 'Você está invisível: só você vê o que escreve aqui. Use /aviso para falar com todos.', kind: 'system' });
    else this.broadcast({ t: 'chat', id: p.id, name: p.name, text, kind: 'say' });
    return 'ok';
  }

  emote(p: Player, emote: Emote) {
    this.broadcast({ t: 'emote', id: p.id, emote });
  }

  setStatus(p: Player, status: PresenceStatus) {
    p.status = status;
    this.broadcast({ t: 'status', id: p.id, status });
  }

  setAvatar(p: Player, avatar: AvatarConfig) {
    p.avatar = avatar;
    this.broadcast({ t: 'avatar', id: p.id, avatar });
  }
}
