import type { Point } from './geometry';
import { auditRoomLayout } from './layoutRules';
import { findPath, idx, isWalkable, type Grid } from './pathfinding';
import { FURNI_KINDS, ROOM_DEFS, buildRoom, footprint, footprintTiles, type FurniKind, type Furniture, type RoomDef, type RoomType } from './rooms';
import { stageSpots } from './stage';

/**
 * Validation of a room layout, PURE and shared: the editor uses it to paint the ghost green or red (with the reason) and the
 * server runs the very same code on every change, so what the screen allows is exactly what the server accepts.
 * Spawn and portals are immutable (they are not part of the editable layout); only `furniture` changes.
 */

/** Maximum number of pieces in one room. */
export const MAX_FURNITURE = 250;
/** Operations accepted in one `furnish_apply` message. */
export const MAX_FURNISH_OPS = 30;
const ID_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;

export type FurnishLevel = 'error' | 'warning';

export interface FurnishIssue {
  level: FurnishLevel;
  /** Stable machine code (`outside`, `overlap`, `wall_only`, `room_type`, `limit`, `unreachable`...). */
  code: string;
  /** Message in Portuguese, with the coordinate when there is one. */
  message: string;
  x?: number;
  y?: number;
  id?: string;
}

export interface FurnishResult {
  ok: boolean;
  errors: FurnishIssue[];
  warnings: FurnishIssue[];
}

export type FurnishOp =
  | { op: 'add'; piece: Furniture }
  | { op: 'update'; id: string; x: number; y: number; dir: number }
  | { op: 'remove'; id: string };

// ---- catalog data ------------------------------------------------------------------------------------

/** Pieces that only make sense in some kinds of room (an allow-list: absent = anywhere). */
export const KIND_ROOM_TYPES: Readonly<Partial<Record<FurniKind, readonly RoomType[]>>> = {
  stage: ['auditorium'],
  podium: ['auditorium'],
  screen: ['auditorium'],
  auditorium_seat: ['auditorium'],
  reception_desk: ['reception', 'office', 'lounge'],
  // the presentation TV: meeting-like rooms (the auditorium has its own stage and screen)
  tv_stand: ['meeting', 'team', 'private', 'office', 'lounge', 'focus'],
};

/** At most this many of a kind per room (the auditorium logic assumes a single stage and podium). */
export const KIND_MAX_PER_ROOM: Readonly<Partial<Record<FurniKind, number>>> = { stage: 1, podium: 1, tv_stand: 1 };

/** A computer must stand on one of these. */
export const SURFACE_KINDS: readonly FurniKind[] = ['desk', 'table', 'high_table', 'reception_desk', 'counter', 'coffee_table'];

/** Wall pieces that may overlap another wall piece (the router sits on the cable tray). */
const WALL_MOUNTS: ReadonlyArray<readonly [FurniKind, FurniKind]> = [['router', 'cable_tray']];

export type FurniCategory = 'work' | 'meeting' | 'lounge' | 'kitchen' | 'decor' | 'wall' | 'network' | 'auditorium';
export const FURNI_CATEGORY_LABELS: Readonly<Record<FurniCategory, string>> = {
  work: 'Trabalho',
  meeting: 'Reunião',
  lounge: 'Descanso',
  kitchen: 'Copa',
  decor: 'Decoração',
  wall: 'Parede',
  network: 'Rede',
  auditorium: 'Auditório',
};
/** Category of each piece in the palette; a kind missing here (a new piece) falls under `decor` until it is listed. */
const CATEGORY_TABLE: Readonly<Partial<Record<FurniKind, FurniCategory>>> = {
  desk: 'work',
  chair: 'work',
  computer: 'work',
  printer: 'work',
  divider: 'work',
  glass_divider: 'work',
  reception_desk: 'work',
  bookshelf: 'work',
  table: 'meeting',
  tv_stand: 'meeting',
  whiteboard: 'wall',
  tv: 'wall',
  sofa: 'lounge',
  armchair: 'lounge',
  pouf: 'lounge',
  coffee_table: 'lounge',
  rug: 'lounge',
  stool: 'kitchen',
  high_table: 'kitchen',
  counter: 'kitchen',
  coffee: 'kitchen',
  cooler: 'kitchen',
  fridge: 'kitchen',
  plant: 'decor',
  basket: 'decor',
  lamp: 'decor',
  bin: 'decor',
  frame: 'wall',
  clock: 'wall',
  logo: 'wall',
  router: 'network',
  rack: 'network',
  cable_tray: 'network',
  auditorium_seat: 'auditorium',
  stage: 'auditorium',
  podium: 'auditorium',
  screen: 'auditorium',
};
export const categoryOf = (kind: FurniKind): FurniCategory => CATEGORY_TABLE[kind] ?? 'decor';

export const labelOf = (kind: FurniKind) => FURNI_KINDS[kind]?.label ?? kind;
const isKind = (v: unknown): v is FurniKind => typeof v === 'string' && Object.prototype.hasOwnProperty.call(FURNI_KINDS, v);

/** Id for a piece created by the editor. The server only checks that it is well formed and unique. */
export function newPieceId(random: () => number = Math.random): string {
  let s = 'u';
  for (let i = 0; i < 8; i++) s += Math.floor(random() * 36).toString(36);
  return s;
}

/** Tiles where people ARRIVE through the portals of other rooms: they must stay free and reachable. */
export function arrivalTiles(roomId: string): Point[] {
  const out: Point[] = [];
  for (const d of ROOM_DEFS) for (const p of d.portals) if (p.toRoom === roomId) out.push({ x: p.toX, y: p.toY });
  return out;
}

// ---- helpers -----------------------------------------------------------------------------------------

type Layer = 'floor' | 'wall' | 'top' | 'object';
function layerOf(kind: FurniKind): Layer {
  const k = FURNI_KINDS[kind];
  if (k.wall) return 'wall';
  if (kind === 'computer') return 'top';
  return k.blocks ? 'object' : 'floor';
}

const err = (code: string, message: string, extra: Partial<FurnishIssue> = {}): FurnishIssue => ({ level: 'error', code, message, ...extra });
const where = (x: number, y: number) => `(${x}, ${y})`;

function floorOf(def: RoomDef): { width: number; height: number; floor: boolean[] } {
  const height = def.tiles.length;
  const width = Math.max(0, ...def.tiles.map((r) => r.length));
  const floor = new Array<boolean>(width * height).fill(false);
  def.tiles.forEach((row, y) => {
    for (let x = 0; x < width; x++) floor[y * width + x] = row[x] === '.';
  });
  return { width, height, floor };
}

/** Tiles reachable from `start`, with the same movement rules as findPath (8 directions, no corner cutting). */
function reachableFrom(g: Grid, start: Point): Uint8Array {
  const seen = new Uint8Array(g.width * g.height);
  if (!isWalkable(g, start.x, start.y)) return seen;
  const queue = [idx(g, start.x, start.y)];
  seen[queue[0]!] = 1;
  const steps = [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, 1], [-1, -1], [1, -1]] as const;
  for (let head = 0; head < queue.length; head++) {
    const cur = queue[head]!;
    const cx = cur % g.width;
    const cy = (cur / g.width) | 0;
    for (const [dx, dy] of steps) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!isWalkable(g, nx, ny)) continue;
      if (dx !== 0 && dy !== 0 && (!isWalkable(g, cx + dx, cy) || !isWalkable(g, cx, cy + dy))) continue;
      const ni = idx(g, nx, ny);
      if (seen[ni]) continue;
      seen[ni] = 1;
      queue.push(ni);
    }
  }
  return seen;
}

export interface ValidateOptions {
  /** Where people arrive from other rooms; default: derived from ROOM_DEFS. */
  arrivals?: Point[];
  /** Skip the (soft) layout warnings. */
  noWarnings?: boolean;
  maxPieces?: number;
}

/**
 * Full validation of a layout of `base` (tiles, spawn, portals, type) with `furniture` instead of its own list.
 * Errors block a change; warnings (sofa facing a wall, shelf away from the wall...) never do.
 */
export function validateLayout(base: RoomDef, furniture: readonly Furniture[], opts: ValidateOptions = {}): FurnishResult {
  const errors: FurnishIssue[] = [];
  const max = opts.maxPieces ?? MAX_FURNITURE;
  if (furniture.length > max) errors.push(err('limit', `Limite de ${max} peças por sala (a sala teria ${furniture.length}).`));

  // 1. shape of every piece
  const ids = new Set<string>();
  const shapeOk: Furniture[] = [];
  for (const f of furniture) {
    if (typeof f !== 'object' || f === null || !isKind(f.kind) || typeof f.id !== 'string' || !ID_PATTERN.test(f.id)) {
      errors.push(err('bad_piece', 'Peça inválida.'));
      continue;
    }
    const intOk = Number.isInteger(f.x) && Number.isInteger(f.y) && Number.isInteger(f.dir) && Math.abs(f.x) < 1000 && Math.abs(f.y) < 1000 && f.dir >= 0 && f.dir <= 3;
    if (!intOk) {
      errors.push(err('bad_piece', `${labelOf(f.kind)} com posição ou giro inválido.`, { id: f.id }));
      continue;
    }
    if (ids.has(f.id)) {
      errors.push(err('duplicate_id', `Identificador repetido: ${f.id}.`, { id: f.id }));
      continue;
    }
    ids.add(f.id);
    shapeOk.push(f);
  }

  const { width, height, floor } = floorOf(base);
  const at = new Map<number, Furniture[]>();
  const counts = new Map<FurniKind, number>();
  const portalAt = new Set(base.portals.map((p) => p.y * width + p.x));

  // 2. geometry of every piece
  for (const f of shapeOk) {
    const kind = FURNI_KINDS[f.kind];
    counts.set(f.kind, (counts.get(f.kind) ?? 0) + 1);
    const types = KIND_ROOM_TYPES[f.kind];
    if (types && !(base.type && types.includes(base.type))) {
      errors.push(err('room_type', `${kind.label} só pode ser usado em ${types.map(typeLabel).join(' ou ')}.`, { id: f.id, x: f.x, y: f.y }));
    }
    let outside = false;
    for (const t of footprintTiles(f)) {
      if (t.x < 0 || t.y < 0 || t.x >= width || t.y >= height || !floor[t.y * width + t.x]) {
        if (!outside) errors.push(err('outside', `${kind.label} fica fora do piso em ${where(t.x, t.y)}.`, { id: f.id, x: t.x, y: t.y }));
        outside = true;
        continue;
      }
      const i = t.y * width + t.x;
      const list = at.get(i) ?? [];
      list.push(f);
      at.set(i, list);
      if (kind.wall) {
        if ((f.dir % 2 === 0 ? t.y : t.x) !== 0) {
          errors.push(err('wall_only', `${kind.label} é de parede: só pode ficar na linha norte (y = 0) ou na coluna oeste (x = 0). Posição ${where(t.x, t.y)}.`, { id: f.id, x: t.x, y: t.y }));
          break;
        }
        if (portalAt.has(i)) errors.push(err('wall_covers_door', `${kind.label} cobriria a porta em ${where(t.x, t.y)}.`, { id: f.id, x: t.x, y: t.y }));
      } else if (kind.blocks && portalAt.has(i)) {
        errors.push(err('blocks_portal', `${kind.label} bloquearia a porta em ${where(t.x, t.y)}.`, { id: f.id, x: t.x, y: t.y }));
      }
    }
  }
  for (const [kind, limit] of Object.entries(KIND_MAX_PER_ROOM) as Array<[FurniKind, number]>) {
    if ((counts.get(kind) ?? 0) > limit) errors.push(err('too_many', `A sala comporta no máximo ${limit} ${labelOf(kind).toLowerCase()}.`));
  }

  // 3. overlaps (once per pair)
  const reported = new Set<string>();
  for (const [i, list] of at) {
    if (errors.length > 40) break; // a hopeless layout: the first few reasons are enough
    for (let a = 0; a < list.length; a++) {
      for (let b = a + 1; b < list.length; b++) {
        const A = list[a]!;
        const B = list[b]!;
        const la = layerOf(A.kind);
        const lb = layerOf(B.kind);
        let bad = false;
        if (la === lb) {
          bad = !(la === 'wall' && WALL_MOUNTS.some(([x, y]) => (A.kind === x && B.kind === y) || (A.kind === y && B.kind === x)));
        } else if ((la === 'top' && lb === 'object') || (la === 'object' && lb === 'top')) {
          const solid = la === 'object' ? A : B;
          bad = !SURFACE_KINDS.includes(solid.kind);
        }
        if (!bad) continue;
        const key = [A.id, B.id].sort().join('|');
        if (reported.has(key)) continue;
        reported.add(key);
        const x = i % width;
        const y = (i / width) | 0;
        errors.push(err('overlap', `${labelOf(A.kind)} e ${labelOf(B.kind)} ficariam sobrepostos em ${where(x, y)}.`, { id: A.id, x, y }));
      }
    }
  }
  // a computer needs a surface under every tile
  for (const f of shapeOk.filter((p) => p.kind === 'computer')) {
    for (const t of footprintTiles(f)) {
      if (t.x < 0 || t.y < 0 || t.x >= width || t.y >= height) continue;
      if (!(at.get(t.y * width + t.x) ?? []).some((o) => SURFACE_KINDS.includes(o.kind))) {
        errors.push(err('computer_surface', `O computador precisa ficar sobre uma mesa (${where(t.x, t.y)}).`, { id: f.id, x: t.x, y: t.y }));
      }
    }
  }

  // 4. the pieces the room cannot work without
  for (const kind of ['podium', 'stage'] as const) {
    if (base.furniture.some((f) => f.kind === kind) && !shapeOk.some((f) => f.kind === kind)) {
      errors.push(err('required', `A sala precisa manter ${kind === 'podium' ? 'o púlpito' : 'o palco'}.`));
    }
  }

  // 5. walking: proved with findPath over the grid rebuilt from the candidate layout
  if (errors.length === 0) walkChecks(base, shapeOk, { width, height, floor }, opts.arrivals ?? arrivalTiles(base.id), errors);

  const warnings: FurnishIssue[] = [];
  if (errors.length === 0 && !opts.noWarnings) {
    try {
      for (const w of auditRoomLayout({ ...base, furniture: [...shapeOk] })) {
        warnings.push({ level: 'warning', code: w.code, message: friendly(w.message), id: w.id, x: w.x, y: w.y });
      }
    } catch {
      /* the soft rules never block */
    }
  }
  return { ok: errors.length === 0, errors, warnings };
}

/** `office/sofa12 (sofa 6,7 dir 1) não olha...` -> `Sofá em (6, 7): não olha...` for the people who read it. */
function friendly(raw: string): string {
  const m = /^[^/]+\/[^ ]+ \((\w+) (-?\d+),(-?\d+)(?: dir \d)?\)\s*(.*)$/.exec(raw);
  if (m && isKind(m[1])) return `${labelOf(m[1])} em (${m[2]}, ${m[3]}): ${m[4]}`;
  return raw.replace(/^[^/]+\/[^ ]+ /, '');
}

function typeLabel(t: RoomType): string {
  return ({ reception: 'recepção', team: 'sala de equipe', meeting: 'sala de reunião', private: 'sala privada', focus: 'sala de foco', lounge: 'lounge', auditorium: 'auditório', office: 'escritório' } as const)[t];
}

function walkChecks(base: RoomDef, pieces: Furniture[], f: { width: number; height: number; floor: boolean[] }, arrivals: Point[], errors: FurnishIssue[]) {
  const blocked = new Array<boolean>(f.width * f.height).fill(false);
  for (const p of pieces) if (FURNI_KINDS[p.kind].blocks) for (const t of footprintTiles(p)) blocked[t.y * f.width + t.x] = true;
  const grid: Grid = { width: f.width, height: f.height, floor: f.floor, blocked };
  const spawn = base.spawn;
  if (!isWalkable(grid, spawn.x, spawn.y)) {
    const blocker = pieces.find((p) => FURNI_KINDS[p.kind].blocks && footprintTiles(p).some((t) => t.x === spawn.x && t.y === spawn.y));
    errors.push(err('blocks_spawn', `${blocker ? labelOf(blocker.kind) : 'Uma peça'} bloquearia o ponto de entrada da sala em ${where(spawn.x, spawn.y)}.`, { x: spawn.x, y: spawn.y, ...(blocker ? { id: blocker.id } : {}) }));
    return;
  }
  for (const a of arrivals) {
    if (!isWalkable(grid, a.x, a.y)) errors.push(err('blocks_arrival', `Uma peça bloquearia o ponto de chegada das portas em ${where(a.x, a.y)}.`, { x: a.x, y: a.y }));
  }
  if (errors.length) return;
  for (const p of base.portals) {
    if (findPath(grid, spawn, p) === null) errors.push(err('portal_unreachable', `A porta para "${p.label}" ficaria inalcançável (${where(p.x, p.y)}).`, { x: p.x, y: p.y }));
  }
  for (const a of arrivals) {
    if (findPath(grid, spawn, a) === null) errors.push(err('arrival_unreachable', `O ponto de chegada em ${where(a.x, a.y)} ficaria inalcançável.`, { x: a.x, y: a.y }));
  }
  // every seat tile and every usable piece must have a reachable way in
  for (const p of pieces) {
    const k = FURNI_KINDS[p.kind];
    if (k.seat) {
      for (const t of footprintTiles(p)) {
        if (findPath(grid, spawn, t, { allowBlockedGoal: true }) === null) {
          errors.push(err('seat_unreachable', `${k.label} em ${where(t.x, t.y)} ficaria sem acesso (ninguém conseguiria sentar).`, { id: p.id, x: t.x, y: t.y }));
          break;
        }
      }
    } else if (k.usable && p.kind !== 'computer') {
      const ok = footprintTiles(p).some((t) =>
        [-1, 0, 1].some((dy) => [-1, 0, 1].some((dx) => isWalkable(grid, t.x + dx, t.y + dy) && findPath(grid, spawn, { x: t.x + dx, y: t.y + dy }) !== null)),
      );
      if (!ok) errors.push(err('usable_unreachable', `${k.label} em ${where(p.x, p.y)} ficaria sem acesso (ninguém conseguiria usar).`, { id: p.id, x: p.x, y: p.y }));
    }
  }
  // no walkable pocket cut off from the spawn
  const seen = reachableFrom(grid, spawn);
  let pockets = 0;
  for (let y = 0; y < f.height; y++) {
    for (let x = 0; x < f.width; x++) {
      if (isWalkable(grid, x, y) && !seen[y * f.width + x]) {
        if (pockets++ < 3) errors.push(err('isolated', `O piso em ${where(x, y)} ficaria isolado, sem caminho a partir da entrada.`, { x, y }));
      }
    }
  }
  if (pockets > 3) errors.push(err('isolated', `Mais ${pockets - 3} tile(s) de piso ficariam isolados.`));
  // the auditorium keeps a place for the speaker behind the podium
  if (!errors.length && pieces.some((p) => p.kind === 'podium')) {
    try {
      if (stageSpots(buildRoom({ ...base, furniture: pieces })).length === 0) errors.push(err('stage_spot', 'Não sobraria lugar livre atrás do púlpito para quem apresenta.'));
    } catch {
      /* geometry errors were reported above */
    }
  }
}

// ---- operations --------------------------------------------------------------------------------------

export type ApplyResult = { ok: true; list: Furniture[] } | { ok: false; error: FurnishIssue };

/** Applies the operations to a copy of `current`, checking only what the operations themselves refer to. */
export function applyOps(current: readonly Furniture[], ops: readonly FurnishOp[]): ApplyResult {
  if (!Array.isArray(ops) || ops.length === 0 || ops.length > MAX_FURNISH_OPS) {
    return { ok: false, error: err('bad_op', `Envie de 1 a ${MAX_FURNISH_OPS} operações por vez.`) };
  }
  let list = current.map((f) => ({ ...f }));
  for (const o of ops) {
    const op = o as { op?: unknown; piece?: Partial<Furniture>; id?: unknown; x?: unknown; y?: unknown; dir?: unknown };
    if (op.op === 'add') {
      const p = op.piece;
      if (!p || typeof p !== 'object' || typeof p.id !== 'string' || !ID_PATTERN.test(p.id) || !isKind(p.kind)) return { ok: false, error: err('bad_op', 'Peça inválida.') };
      if (list.some((f) => f.id === p.id)) return { ok: false, error: err('duplicate_id', `Identificador repetido: ${p.id}.`, { id: p.id }) };
      list.push({ id: p.id, kind: p.kind, x: p.x as number, y: p.y as number, dir: p.dir as number });
    } else if (op.op === 'update') {
      const i = typeof op.id === 'string' ? list.findIndex((f) => f.id === op.id) : -1;
      if (i < 0) return { ok: false, error: err('not_found', 'Essa peça não existe mais.', { id: String(op.id) }) };
      list[i] = { ...list[i]!, x: op.x as number, y: op.y as number, dir: op.dir as number };
    } else if (op.op === 'remove') {
      const i = typeof op.id === 'string' ? list.findIndex((f) => f.id === op.id) : -1;
      if (i < 0) return { ok: false, error: err('not_found', 'Essa peça não existe mais.', { id: String(op.id) }) };
      list = list.filter((_, j) => j !== i);
    } else {
      return { ok: false, error: err('bad_op', 'Operação desconhecida.') };
    }
  }
  return { ok: true, list };
}

/**
 * Applies `ops` to `current` and validates the result. Warnings are only the NEW ones (a layout that already
 * had a sofa facing the wall does not nag about it again). `ok` is false when any error remains.
 */
export function checkOps(base: RoomDef, current: readonly Furniture[], ops: readonly FurnishOp[], opts: ValidateOptions = {}): FurnishResult & { list: Furniture[] } {
  const applied = applyOps(current, ops);
  if (!applied.ok) return { ok: false, errors: [applied.error], warnings: [], list: [...current] };
  const result = validateLayout(base, applied.list, opts);
  let warnings = result.warnings;
  if (warnings.length > 0) {
    const before = new Set(validateLayout(base, current, opts).warnings.map((w) => w.message));
    warnings = warnings.filter((w) => !before.has(w.message));
  }
  return { ...result, warnings, list: applied.list };
}

/** Helper for the ghost: the footprint of a candidate piece. */
export const footprintOf = (f: Furniture) => footprint(f);
