import { furniDirToDir8, type Dir8, type Point } from './geometry';
import { idx, type Grid } from './pathfinding';

/**
 * Furniture catalog. Behaviour lives here as data so new objects can be added
 * without touching the engine. Rendering for each kind is registered on the client.
 */
export type FurniKind =
  | 'desk'
  | 'chair'
  | 'computer'
  | 'sofa'
  | 'plant'
  | 'bookshelf'
  | 'table'
  | 'rug'
  | 'coffee'
  | 'cooler'
  | 'whiteboard'
  | 'bin'
  | 'printer'
  | 'lamp'
  | 'frame'
  | 'basket'
  | 'divider'
  | 'counter'
  | 'fridge'
  | 'tv'
  | 'pouf'
  | 'armchair'
  | 'high_table'
  | 'stool'
  | 'glass_divider'
  | 'clock'
  | 'auditorium_seat'
  | 'stage'
  | 'podium'
  | 'screen'
  | 'router'
  | 'rack'
  | 'cable_tray'
  | 'reception_desk'
  | 'logo'
  | 'coffee_table'
  | 'tv_stand'
  | 'light_switch';

export interface FurniKindDef {
  label: string;
  /** Footprint at rotation 0 (w along +x, d along +y). */
  w: number;
  d: number;
  /** Blocks walking through its footprint. */
  blocks: boolean;
  /** Avatars can sit on any tile of the footprint, facing the furniture rotation. */
  seat: boolean;
  /** Has a "use" interaction. */
  usable: boolean;
  /**
   * Hangs on a wall: it must sit on the north row (dir 0/2) or the west column (dir 1/3)
   * and never blocks walking.
   */
  wall?: boolean;
}

export const FURNI_KINDS: Record<FurniKind, FurniKindDef> = {
  desk: { label: 'Mesa de trabalho', w: 2, d: 1, blocks: true, seat: false, usable: false },
  chair: { label: 'Cadeira', w: 1, d: 1, blocks: true, seat: true, usable: false },
  computer: { label: 'Computador', w: 1, d: 1, blocks: false, seat: false, usable: true },
  sofa: { label: 'Sofá', w: 1, d: 2, blocks: true, seat: true, usable: false },
  plant: { label: 'Planta', w: 1, d: 1, blocks: true, seat: false, usable: false },
  bookshelf: { label: 'Estante', w: 2, d: 1, blocks: true, seat: false, usable: false },
  table: { label: 'Mesa de reunião', w: 2, d: 2, blocks: true, seat: false, usable: false },
  rug: { label: 'Tapete', w: 3, d: 2, blocks: false, seat: false, usable: false },
  coffee: { label: 'Cafeteira', w: 1, d: 1, blocks: true, seat: false, usable: true },
  cooler: { label: 'Bebedouro', w: 1, d: 1, blocks: true, seat: false, usable: true },
  whiteboard: { label: 'Quadro branco', w: 2, d: 1, blocks: false, seat: false, usable: false, wall: true },
  bin: { label: 'Lixeira', w: 1, d: 1, blocks: true, seat: false, usable: false },
  printer: { label: 'Impressora', w: 1, d: 1, blocks: true, seat: false, usable: false },
  lamp: { label: 'Luminária de piso', w: 1, d: 1, blocks: true, seat: false, usable: false },
  frame: { label: 'Quadro decorativo', w: 1, d: 1, blocks: false, seat: false, usable: false, wall: true },
  basket: { label: 'Cesto com planta', w: 1, d: 1, blocks: true, seat: false, usable: false },
  divider: { label: 'Divisória', w: 2, d: 1, blocks: true, seat: false, usable: false },
  counter: { label: 'Bancada', w: 3, d: 1, blocks: true, seat: false, usable: false },
  fridge: { label: 'Geladeira', w: 1, d: 1, blocks: true, seat: false, usable: true },
  tv: { label: 'TV', w: 2, d: 1, blocks: false, seat: false, usable: false, wall: true },
  pouf: { label: 'Pufe', w: 1, d: 1, blocks: true, seat: true, usable: false },
  armchair: { label: 'Poltrona', w: 1, d: 1, blocks: true, seat: true, usable: false },
  high_table: { label: 'Mesa alta', w: 2, d: 1, blocks: true, seat: false, usable: false },
  stool: { label: 'Banco alto', w: 1, d: 1, blocks: true, seat: true, usable: false },
  glass_divider: { label: 'Divisória de vidro', w: 2, d: 1, blocks: true, seat: false, usable: false },
  clock: { label: 'Relógio de parede', w: 1, d: 1, blocks: false, seat: false, usable: false, wall: true },
  /** Interruptor na parede: alterna as luzes artificiais da sala. Estado `true` = luzes APAGADAS (o padrao `false` = acesas). */
  light_switch: { label: 'Interruptor de luz', w: 1, d: 1, blocks: false, seat: false, usable: true, wall: true },
  auditorium_seat: { label: 'Poltrona', w: 1, d: 1, blocks: true, seat: true, usable: false },
  /** Raised platform, drawn flat: avatars walk on it. */
  stage: { label: 'Palco', w: 8, d: 3, blocks: false, seat: false, usable: false },
  /** Interacting with it asks for the stage (see the auditorium rules on the server). */
  podium: { label: 'Púlpito', w: 1, d: 1, blocks: true, seat: false, usable: true },
  /** Projection screen on the north wall; the client paints the current slide on it. */
  screen: { label: 'Telão', w: 5, d: 1, blocks: false, seat: false, usable: false, wall: true },
  router: { label: 'Roteador Wi-Fi', w: 1, d: 1, blocks: false, seat: false, usable: false, wall: true },
  rack: { label: 'Rack de rede', w: 1, d: 1, blocks: true, seat: false, usable: false },
  cable_tray: { label: 'Calha de cabos', w: 2, d: 1, blocks: false, seat: false, usable: false, wall: true },
  reception_desk: { label: 'Balcão de recepção', w: 3, d: 1, blocks: true, seat: false, usable: false },
  logo: { label: 'Logo na parede', w: 2, d: 1, blocks: false, seat: false, usable: false, wall: true },
  /** Low table in front of a sofa: the focal point of a lounge corner. */
  coffee_table: { label: 'Mesa de centro', w: 2, d: 1, blocks: true, seat: false, usable: false },
  /** Flat-screen TV on a rolling stand: the presentation screen of a meeting room (see `presentationOf` in stage.ts). */
  tv_stand: { label: 'TV com suporte', w: 2, d: 1, blocks: true, seat: false, usable: true },
};

/** What a room is for. The server uses it for the default access policy and the furniture allow-list (furnish.ts). */
export type RoomType = 'reception' | 'team' | 'meeting' | 'private' | 'focus' | 'lounge' | 'auditorium' | 'office';
/**
 * Who may enter (enforced by the server, see docs/rooms.md):
 *  - `org`: every active member of the organization (guests still need `guestAllowed`);
 *  - `team`: only the members of the team `accessTeamId`;
 *  - `invited`: only people with a live invite (the room is listed, with a padlock);
 *  - `private`: like `invited`, and the name/description are hidden from people without access.
 * Owners and admins of the organization, and platform staff admins on duty, always get in.
 */
export type RoomAccess = 'org' | 'team' | 'invited' | 'private';
export const ROOM_ACCESS_LIST: readonly RoomAccess[] = ['org', 'team', 'invited', 'private'];
export const isRoomAccess = (v: unknown): v is RoomAccess => typeof v === 'string' && (ROOM_ACCESS_LIST as readonly string[]).includes(v);

export interface Furniture {
  id: string;
  kind: FurniKind;
  x: number;
  y: number;
  /** Rotation 0..3 (0 faces +x, 1 faces +y, 2 faces -x, 3 faces -y). */
  dir: number;
}

export interface Portal {
  x: number;
  y: number;
  toRoom: string;
  toX: number;
  toY: number;
  label: string;
}

export interface RoomDef {
  id: string;
  name: string;
  description: string;
  /** One string per row; '.' is floor and ' ' is void. */
  tiles: string[];
  spawn: Point & { dir: Dir8 };
  furniture: Furniture[];
  portals: Portal[];
  maxPlayers: number;
  /** Guests (role `guest`) may only enter rooms that set this. Absent means members only. */
  guestAllowed?: boolean;
  /** Purpose of the room (see RoomType). Optional metadata. */
  type?: RoomType;
  /** Access policy (see RoomAccess); when absent it follows the room type (`private` rooms are private, the rest are `org`). */
  access?: RoomAccess;
  /** Team allowed in when `access` is `team`. Only set at run time (the organization chooses it); never in ROOM_DEFS. */
  accessTeamId?: string | null;
}

/** Effective access policy of a room definition. */
export function roomAccessOf(def: Pick<RoomDef, 'access' | 'type'>): RoomAccess {
  return def.access ?? (def.type === 'private' ? 'private' : 'org');
}

/** A room as the person who asks may see it (the browser of rooms). Restricted rooms hide their population. */
export interface RoomListEntry {
  id: string;
  /** Hidden ("Sala privada") from people without access to a `private` room. */
  name: string;
  description: string;
  maxPlayers: number;
  access: RoomAccess;
  /** The viewer cannot enter: padlock in the UI. */
  locked: boolean;
  /** Why it is locked (for the tooltip): 'team' | 'invite' | 'guest'. */
  lockReason?: 'team' | 'invite' | 'guest';
  /** Present only when the viewer may enter; never reveals how many people are in a room one cannot access. */
  population?: number;
}

export function footprint(f: Furniture): { w: number; d: number } {
  const k = FURNI_KINDS[f.kind];
  return f.dir % 2 === 0 ? { w: k.w, d: k.d } : { w: k.d, d: k.w };
}

export function footprintTiles(f: Furniture): Point[] {
  const { w, d } = footprint(f);
  const out: Point[] = [];
  for (let dy = 0; dy < d; dy++) for (let dx = 0; dx < w; dx++) out.push({ x: f.x + dx, y: f.y + dy });
  return out;
}

export interface BuiltRoom {
  def: RoomDef;
  grid: Grid;
  /** All furniture covering a tile (bottom to top: file order). */
  furniAt: Map<number, Furniture[]>;
  furniById: Map<string, Furniture>;
  portalAt: Map<number, Portal>;
}

export function buildRoom(def: RoomDef): BuiltRoom {
  const height = def.tiles.length;
  const width = Math.max(...def.tiles.map((r) => r.length));
  const floor = new Array<boolean>(width * height).fill(false);
  const blocked = new Array<boolean>(width * height).fill(false);
  def.tiles.forEach((row, y) => {
    for (let x = 0; x < width; x++) floor[y * width + x] = row[x] === '.';
  });
  const grid: Grid = { width, height, floor, blocked };
  const furniAt = new Map<number, Furniture[]>();
  const furniById = new Map<string, Furniture>();
  for (const f of def.furniture) {
    if (furniById.has(f.id)) throw new Error(`Duplicate furniture id ${f.id} in room ${def.id}`);
    furniById.set(f.id, f);
    const kind = FURNI_KINDS[f.kind];
    for (const t of footprintTiles(f)) {
      if (t.x < 0 || t.y < 0 || t.x >= width || t.y >= height || !floor[idx(grid, t.x, t.y)]) {
        throw new Error(`Furniture ${f.id} in room ${def.id} is outside the floor at ${t.x},${t.y}`);
      }
      const i = idx(grid, t.x, t.y);
      const list = furniAt.get(i) ?? [];
      list.push(f);
      furniAt.set(i, list);
      if (kind.blocks) blocked[i] = true;
    }
  }
  const portalAt = new Map<number, Portal>();
  for (const p of def.portals) {
    const i = idx(grid, p.x, p.y);
    if (!floor[i]) throw new Error(`Portal outside the floor in room ${def.id}`);
    if (blocked[i]) throw new Error(`Portal blocked by furniture in room ${def.id}`);
    portalAt.set(i, p);
  }
  return { def, grid, furniAt, furniById, portalAt };
}

/** The furniture a click on this tile should act on: usable first, then seats. */
export function interactiveAt(room: BuiltRoom, x: number, y: number): Furniture | undefined {
  const list = room.furniAt.get(idx(room.grid, x, y));
  if (!list) return undefined;
  const reversed = [...list].reverse();
  return (
    reversed.find((f) => FURNI_KINDS[f.kind].usable) ?? reversed.find((f) => FURNI_KINDS[f.kind].seat)
  );
}

export function seatDir(f: Furniture): Dir8 {
  return furniDirToDir8(f.dir);
}

/**
 * Direction the FRONT of a piece faces (0 = +x, 1 = +y, 2 = -x, 3 = -y).
 * Seats and single-tile appliances use `dir` directly. Pieces whose catalog footprint is wider than deep
 * (bookshelf, counter, reception desk...) turn with their footprint instead: dir 0 runs along x and shows its
 * front to +y (north wall), dir 1 runs along y and shows its front to +x (west wall), 2/3 are the opposite sides.
 */
export function furniFront(f: Furniture): 0 | 1 | 2 | 3 {
  const k = FURNI_KINDS[f.kind];
  const dir = (((f.dir % 4) + 4) % 4) as 0 | 1 | 2 | 3;
  if (k.w > k.d) return ([1, 0, 3, 2] as const)[dir];
  return dir;
}

/** Pieces that belong against the north or west wall with their front toward the room (see furniFront). */
export const WALL_BACKED_KINDS: readonly FurniKind[] = ['bookshelf', 'fridge', 'cooler', 'coffee', 'printer', 'rack', 'counter'];

const rect = (w: number, h: number) => Array.from({ length: h }, () => '.'.repeat(w));

let n = 0;
const fid = (p: string) => `${p}${++n}`;

/** One side of a back-to-back work island: a row of chairs, desks and one computer per chair. */
const workRow = (x0: number, chairY: number, deskY: number, side: 'north' | 'south'): Furniture[] => {
  const out: Furniture[] = [];
  const north = side === 'north';
  for (const dx of [0, 2]) out.push({ id: fid('desk'), kind: 'desk', x: x0 + dx, y: deskY, dir: 0 });
  for (let dx = 0; dx < 4; dx++) {
    // computers on the north side show their back to the camera (dir 3); the screen faces the sitter
    out.push({ id: fid('pc'), kind: 'computer', x: x0 + dx, y: deskY, dir: north ? 3 : 0 });
    out.push({ id: fid('chair'), kind: 'chair', x: x0 + dx, y: chairY, dir: north ? 1 : 3 });
  }
  return out;
};

const OFFICE: RoomDef = {
  id: 'office',
  type: 'office',
  name: 'Escritório Compartilhado',
  description: 'Open space com ilhas de trabalho, sala de reunião, cantinho de descanso e a porta para a copa.',
  tiles: rect(16, 12),
  spawn: { x: 7, y: 6, dir: 2 },
  maxPlayers: 40,
  portals: [
    { x: 7, y: 0, toRoom: 'lounge', toX: 1, toY: 4, label: 'Copa e Lounge' },
    { x: 0, y: 2, toRoom: 'auditorium', toX: 1, toY: 9, label: 'Auditório' },
    { x: 0, y: 4, toRoom: 'reception', toX: 2, toY: 1, label: 'Recepção Central' },
  ],
  furniture: [
    { id: fid('rug'), kind: 'rug', x: 6, y: 6, dir: 0 },
    { id: fid('rug'), kind: 'rug', x: 1, y: 8, dir: 0 },
    // Work islands: chairs on both sides, desks back to back, glass screens at the aisles
    ...workRow(2, 2, 3, 'north'),
    ...workRow(2, 5, 4, 'south'),
    ...workRow(10, 2, 3, 'north'),
    ...workRow(10, 5, 4, 'south'),
    { id: fid('glass'), kind: 'glass_divider', x: 6, y: 3, dir: 1 },
    { id: fid('glass'), kind: 'glass_divider', x: 9, y: 3, dir: 1 },
    // Meeting table with eight seats
    { id: fid('table'), kind: 'table', x: 11, y: 8, dir: 0 },
    { id: fid('chair'), kind: 'chair', x: 10, y: 8, dir: 0 },
    { id: fid('chair'), kind: 'chair', x: 10, y: 9, dir: 0 },
    { id: fid('chair'), kind: 'chair', x: 13, y: 8, dir: 2 },
    { id: fid('chair'), kind: 'chair', x: 13, y: 9, dir: 2 },
    { id: fid('chair'), kind: 'chair', x: 11, y: 7, dir: 1 },
    { id: fid('chair'), kind: 'chair', x: 12, y: 7, dir: 1 },
    { id: fid('chair'), kind: 'chair', x: 11, y: 10, dir: 3 },
    { id: fid('chair'), kind: 'chair', x: 12, y: 10, dir: 3 },
    // Lounge corner: sofa with its back on the west wall, facing a coffee table; armchair and poufs close the circle
    { id: fid('sofa'), kind: 'sofa', x: 0, y: 8, dir: 0 },
    { id: fid('ctable'), kind: 'coffee_table', x: 2, y: 8, dir: 1 },
    { id: fid('armchair'), kind: 'armchair', x: 2, y: 7, dir: 1 },
    { id: fid('pouf'), kind: 'pouf', x: 3, y: 8, dir: 1 },
    { id: fid('pouf'), kind: 'pouf', x: 3, y: 9, dir: 1 },
    { id: fid('lamp'), kind: 'lamp', x: 4, y: 7, dir: 0 },
    { id: fid('plant'), kind: 'plant', x: 0, y: 7, dir: 0 },
    { id: fid('plant'), kind: 'plant', x: 0, y: 10, dir: 0 },
    // Stand-up bar
    { id: fid('bar'), kind: 'high_table', x: 8, y: 9, dir: 0 },
    { id: fid('stool'), kind: 'stool', x: 8, y: 8, dir: 1 },
    { id: fid('stool'), kind: 'stool', x: 9, y: 8, dir: 1 },
    { id: fid('stool'), kind: 'stool', x: 8, y: 10, dir: 3 },
    { id: fid('stool'), kind: 'stool', x: 9, y: 10, dir: 3 },
    // Equipment and storage
    { id: fid('shelf'), kind: 'bookshelf', x: 2, y: 0, dir: 0 },
    { id: fid('printer'), kind: 'printer', x: 12, y: 0, dir: 1 },
    { id: fid('bin'), kind: 'bin', x: 15, y: 5, dir: 0 },
    { id: fid('plant'), kind: 'plant', x: 15, y: 2, dir: 0 },
    { id: fid('plant'), kind: 'plant', x: 5, y: 1, dir: 0 },
    { id: fid('plant'), kind: 'plant', x: 9, y: 1, dir: 0 },
    { id: fid('plant'), kind: 'plant', x: 15, y: 10, dir: 0 },
    // Network corner: rack in the north-east corner, Wi-Fi router and cable tray on the wall above it
    { id: fid('rack'), kind: 'rack', x: 15, y: 0, dir: 1 },
    { id: fid('router'), kind: 'router', x: 14, y: 0, dir: 0 },
    { id: fid('tray'), kind: 'cable_tray', x: 14, y: 0, dir: 0 },
    // Water cooler against the west wall, next to the lounge corner (the coffee machine and the fridge live in the lounge)
    { id: fid('basket'), kind: 'basket', x: 5, y: 10, dir: 0 },
    { id: fid('cooler'), kind: 'cooler', x: 0, y: 6, dir: 0 },
    { id: fid('lamp'), kind: 'lamp', x: 15, y: 3, dir: 0 },
    { id: fid('lamp'), kind: 'lamp', x: 1, y: 5, dir: 0 },
    // Wall decor
    { id: fid('frame'), kind: 'frame', x: 4, y: 0, dir: 0 },
    { id: fid('clock'), kind: 'clock', x: 5, y: 0, dir: 0 },
    { id: fid('board'), kind: 'whiteboard', x: 9, y: 0, dir: 0 },
    { id: fid('frame'), kind: 'frame', x: 12, y: 0, dir: 0 },
    { id: fid('frame'), kind: 'frame', x: 0, y: 5, dir: 1 },
    { id: fid('clock'), kind: 'clock', x: 0, y: 8, dir: 1 },
    { id: fid('frame'), kind: 'frame', x: 0, y: 10, dir: 1 },
  ],
};

const LOUNGE: RoomDef = {
  id: 'lounge',
  type: 'lounge',
  guestAllowed: true,
  name: 'Copa e Lounge',
  description: 'Café, conversa solta e descanso: bancada, mesa alta, sofás e TV.',
  tiles: rect(12, 9),
  spawn: { x: 1, y: 4, dir: 0 },
  maxPlayers: 30,
  portals: [
    { x: 0, y: 4, toRoom: 'office', toX: 7, toY: 1, label: 'Escritório Compartilhado' },
    { x: 0, y: 7, toRoom: 'reception', toX: 4, toY: 1, label: 'Recepção Central' },
  ],
  furniture: [
    { id: fid('rug'), kind: 'rug', x: 1, y: 1, dir: 0 },
    { id: fid('rug'), kind: 'rug', x: 9, y: 4, dir: 0 },
    // Kitchenette along the north wall
    { id: fid('counter'), kind: 'counter', x: 7, y: 0, dir: 0 },
    { id: fid('coffee'), kind: 'coffee', x: 10, y: 0, dir: 1 },
    { id: fid('fridge'), kind: 'fridge', x: 11, y: 0, dir: 1 },
    // TV corner: the sofa looks at the TV across a coffee table, armchair and poufs on the sides
    { id: fid('sofa'), kind: 'sofa', x: 2, y: 3, dir: 3 },
    { id: fid('ctable'), kind: 'coffee_table', x: 2, y: 2, dir: 0 },
    { id: fid('armchair'), kind: 'armchair', x: 1, y: 2, dir: 0 },
    { id: fid('pouf'), kind: 'pouf', x: 4, y: 2, dir: 1 },
    { id: fid('pouf'), kind: 'pouf', x: 4, y: 1, dir: 1 },
    { id: fid('lamp'), kind: 'lamp', x: 5, y: 1, dir: 0 },
    // High table with stools
    { id: fid('bar'), kind: 'high_table', x: 6, y: 4, dir: 0 },
    { id: fid('stool'), kind: 'stool', x: 6, y: 3, dir: 1 },
    { id: fid('stool'), kind: 'stool', x: 7, y: 3, dir: 1 },
    { id: fid('stool'), kind: 'stool', x: 6, y: 5, dir: 3 },
    { id: fid('stool'), kind: 'stool', x: 7, y: 5, dir: 3 },
    // Dining table
    { id: fid('table'), kind: 'table', x: 3, y: 6, dir: 0 },
    { id: fid('chair'), kind: 'chair', x: 2, y: 6, dir: 0 },
    { id: fid('chair'), kind: 'chair', x: 2, y: 7, dir: 0 },
    { id: fid('chair'), kind: 'chair', x: 5, y: 6, dir: 2 },
    { id: fid('chair'), kind: 'chair', x: 5, y: 7, dir: 2 },
    { id: fid('chair'), kind: 'chair', x: 3, y: 5, dir: 1 },
    { id: fid('chair'), kind: 'chair', x: 4, y: 5, dir: 1 },
    { id: fid('chair'), kind: 'chair', x: 3, y: 8, dir: 3 },
    { id: fid('chair'), kind: 'chair', x: 4, y: 8, dir: 3 },
    // East lounge: sofa facing a coffee table on the rug, armchair on the side, poufs on the far side
    { id: fid('sofa'), kind: 'sofa', x: 9, y: 3, dir: 1 },
    { id: fid('ctable'), kind: 'coffee_table', x: 9, y: 4, dir: 0 },
    { id: fid('armchair'), kind: 'armchair', x: 8, y: 4, dir: 0 },
    { id: fid('pouf'), kind: 'pouf', x: 9, y: 5, dir: 1 },
    { id: fid('pouf'), kind: 'pouf', x: 10, y: 5, dir: 1 },
    { id: fid('lamp'), kind: 'lamp', x: 8, y: 3, dir: 0 },
    { id: fid('plant'), kind: 'plant', x: 11, y: 7, dir: 0 },
    { id: fid('plant'), kind: 'plant', x: 11, y: 8, dir: 0 },
    { id: fid('plant'), kind: 'plant', x: 0, y: 0, dir: 0 },
    { id: fid('plant'), kind: 'plant', x: 0, y: 8, dir: 0 },
    { id: fid('basket'), kind: 'basket', x: 7, y: 8, dir: 0 },
    { id: fid('bin'), kind: 'bin', x: 6, y: 1, dir: 0 },
    // Wall decor
    { id: fid('tv'), kind: 'tv', x: 2, y: 0, dir: 0 },
    { id: fid('frame'), kind: 'frame', x: 4, y: 0, dir: 0 },
    { id: fid('clock'), kind: 'clock', x: 5, y: 0, dir: 0 },
    { id: fid('frame'), kind: 'frame', x: 0, y: 6, dir: 1 },
    { id: fid('frame'), kind: 'frame', x: 0, y: 3, dir: 1 },
  ],
};

/** Seats of the audience: 3 rows facing the stage, split by a central aisle; the outer seats curve toward the stage. */
const auditoriumSeats = (): Furniture[] => {
  const seats: Furniture[] = [];
  for (const y of [5, 7, 9]) {
    for (const x of [2, 3, 4, 5, 6, 7, 10, 11, 12, 13, 14, 15]) {
      const curve = Math.abs(x - 8.5) > 6 ? -1 : 0;
      seats.push({ id: fid('seat'), kind: 'auditorium_seat', x, y: y + curve, dir: 3 });
    }
  }
  return seats;
};

const AUDITORIUM: RoomDef = {
  id: 'auditorium',
  type: 'auditorium',
  guestAllowed: true,
  name: 'Auditório',
  description: 'Palco, telão e plateia: apresentações, treinamentos e palestras com slides e compartilhamento de tela.',
  tiles: rect(18, 12),
  spawn: { x: 1, y: 9, dir: 0 },
  maxPlayers: 40,
  portals: [
    { x: 0, y: 9, toRoom: 'office', toX: 1, toY: 2, label: 'Escritório Compartilhado' },
    { x: 0, y: 4, toRoom: 'reception', toX: 1, toY: 3, label: 'Recepção Central' },
  ],
  furniture: [
    { id: fid('stage'), kind: 'stage', x: 5, y: 1, dir: 0 },
    { id: fid('screen'), kind: 'screen', x: 6, y: 0, dir: 0 },
    { id: fid('podium'), kind: 'podium', x: 10, y: 2, dir: 0 },
    // aisle carpet
    { id: fid('rug'), kind: 'rug', x: 8, y: 4, dir: 1 },
    { id: fid('rug'), kind: 'rug', x: 8, y: 7, dir: 1 },
    ...auditoriumSeats(),
    // stage and room decor
    { id: fid('plant'), kind: 'plant', x: 4, y: 1, dir: 0 },
    { id: fid('plant'), kind: 'plant', x: 13, y: 1, dir: 0 },
    { id: fid('lamp'), kind: 'lamp', x: 4, y: 3, dir: 0 },
    { id: fid('lamp'), kind: 'lamp', x: 13, y: 3, dir: 0 },
    { id: fid('coffee'), kind: 'coffee', x: 16, y: 0, dir: 1 },
    { id: fid('cooler'), kind: 'cooler', x: 17, y: 0, dir: 1 },
    { id: fid('frame'), kind: 'frame', x: 0, y: 2, dir: 1 },
    { id: fid('frame'), kind: 'frame', x: 0, y: 6, dir: 1 },
    { id: fid('plant'), kind: 'plant', x: 17, y: 11, dir: 0 },
    { id: fid('basket'), kind: 'basket', x: 0, y: 11, dir: 0 },
    { id: fid('bin'), kind: 'bin', x: 1, y: 11, dir: 0 },
    { id: fid('plant'), kind: 'plant', x: 15, y: 11, dir: 0 },
    { id: fid('plant'), kind: 'plant', x: 17, y: 5, dir: 0 },
    // Wall decor: side display, clock and the Wi-Fi router
    { id: fid('tv'), kind: 'tv', x: 1, y: 0, dir: 0 },
    { id: fid('clock'), kind: 'clock', x: 3, y: 0, dir: 0 },
    { id: fid('router'), kind: 'router', x: 15, y: 0, dir: 0 },
  ],
};

/** Chairs around a table whose top-left tile is (x, y) and which spans w x h tiles; every chair faces the table. */
const chairsAround = (x: number, y: number, w: number, h: number): Furniture[] => {
  const out: Furniture[] = [];
  for (let i = 0; i < w; i++) {
    out.push({ id: fid('chair'), kind: 'chair', x: x + i, y: y - 1, dir: 1 });
    out.push({ id: fid('chair'), kind: 'chair', x: x + i, y: y + h, dir: 3 });
  }
  for (let j = 0; j < h; j++) {
    out.push({ id: fid('chair'), kind: 'chair', x: x - 1, y: y + j, dir: 0 });
    out.push({ id: fid('chair'), kind: 'chair', x: x + w, y: y + j, dir: 2 });
  }
  return out;
};

/** Glass partitions along a column (tiles x, from y0 to y1 inclusive, two tiles each), leaving the gaps as doorways. */
const glassWall = (x: number, ys: number[]): Furniture[] => ys.map((y) => ({ id: fid('glass'), kind: 'glass_divider', x, y, dir: 1 }));

// Doors only exist on the north (y = 0) and west (x = 0) walls, so the hub puts six on the north wall
// and two on the west wall. Each destination room returns to the tile just below / beside its door here.
const RECEPTION: RoomDef = {
  id: 'reception',
  type: 'reception',
  access: 'org',
  guestAllowed: true,
  name: 'Recepção Central',
  description: 'Hall de entrada: balcão de recepção, área de espera e as portas para todas as salas.',
  tiles: rect(22, 12),
  spawn: { x: 10, y: 6, dir: 2 },
  maxPlayers: 50,
  portals: [
    { x: 2, y: 0, toRoom: 'office', toX: 1, toY: 4, label: 'Escritório Compartilhado' },
    { x: 4, y: 0, toRoom: 'lounge', toX: 1, toY: 7, label: 'Copa e Lounge' },
    { x: 6, y: 0, toRoom: 'team', toX: 1, toY: 4, label: 'Sala de Equipe' },
    { x: 16, y: 0, toRoom: 'meeting1', toX: 1, toY: 4, label: 'Sala de Reunião 1' },
    { x: 18, y: 0, toRoom: 'meeting2', toX: 1, toY: 4, label: 'Sala de Reunião 2' },
    { x: 20, y: 0, toRoom: 'private', toX: 1, toY: 3, label: 'Sala Privada' },
    { x: 0, y: 3, toRoom: 'auditorium', toX: 1, toY: 4, label: 'Auditório' },
    { x: 0, y: 7, toRoom: 'focus', toX: 1, toY: 4, label: 'Espaço de Concentração' },
  ],
  furniture: [
    { id: fid('rug'), kind: 'rug', x: 9, y: 6, dir: 0 },
    { id: fid('rug'), kind: 'rug', x: 1, y: 9, dir: 0 },
    { id: fid('rug'), kind: 'rug', x: 9, y: 10, dir: 0 },
    { id: fid('rug'), kind: 'rug', x: 14, y: 9, dir: 0 },
    { id: fid('rug'), kind: 'rug', x: 18, y: 9, dir: 0 },
    // Reception desk under the logo, with the receptionist's chair behind it
    { id: fid('desk'), kind: 'reception_desk', x: 9, y: 3, dir: 0 },
    { id: fid('chair'), kind: 'chair', x: 10, y: 2, dir: 1 },
    { id: fid('plant'), kind: 'plant', x: 8, y: 2, dir: 0 },
    { id: fid('plant'), kind: 'plant', x: 12, y: 2, dir: 0 },
    // Waiting area, west: sofa on the west wall and sofa on the north side look at the coffee table, poufs close the circle
    { id: fid('sofa'), kind: 'sofa', x: 0, y: 9, dir: 0 },
    { id: fid('sofa'), kind: 'sofa', x: 2, y: 8, dir: 1 },
    { id: fid('ctable'), kind: 'coffee_table', x: 2, y: 9, dir: 1 },
    { id: fid('pouf'), kind: 'pouf', x: 3, y: 9, dir: 1 },
    { id: fid('pouf'), kind: 'pouf', x: 3, y: 10, dir: 1 },
    { id: fid('lamp'), kind: 'lamp', x: 4, y: 8, dir: 0 },
    { id: fid('plant'), kind: 'plant', x: 0, y: 11, dir: 0 },
    // Waiting area, south-center
    { id: fid('sofa'), kind: 'sofa', x: 10, y: 9, dir: 1 },
    { id: fid('ctable'), kind: 'coffee_table', x: 10, y: 10, dir: 0 },
    { id: fid('armchair'), kind: 'armchair', x: 9, y: 10, dir: 0 },
    { id: fid('pouf'), kind: 'pouf', x: 10, y: 11, dir: 1 },
    { id: fid('pouf'), kind: 'pouf', x: 11, y: 11, dir: 1 },
    { id: fid('lamp'), kind: 'lamp', x: 12, y: 9, dir: 0 },
    // Waiting area, east: two groups, each a sofa facing a coffee table
    { id: fid('sofa'), kind: 'sofa', x: 15, y: 8, dir: 1 },
    { id: fid('ctable'), kind: 'coffee_table', x: 15, y: 9, dir: 0 },
    { id: fid('armchair'), kind: 'armchair', x: 14, y: 9, dir: 0 },
    { id: fid('pouf'), kind: 'pouf', x: 15, y: 10, dir: 1 },
    { id: fid('pouf'), kind: 'pouf', x: 16, y: 10, dir: 1 },
    { id: fid('sofa'), kind: 'sofa', x: 18, y: 8, dir: 1 },
    { id: fid('ctable'), kind: 'coffee_table', x: 18, y: 9, dir: 0 },
    { id: fid('pouf'), kind: 'pouf', x: 18, y: 10, dir: 1 },
    { id: fid('pouf'), kind: 'pouf', x: 19, y: 10, dir: 1 },
    { id: fid('lamp'), kind: 'lamp', x: 20, y: 8, dir: 0 },
    { id: fid('plant'), kind: 'plant', x: 21, y: 9, dir: 0 },
    { id: fid('plant'), kind: 'plant', x: 21, y: 11, dir: 0 },
    { id: fid('plant'), kind: 'plant', x: 0, y: 0, dir: 0 },
    // Water cooler on the north wall, in the corner next to the last door
    { id: fid('cooler'), kind: 'cooler', x: 21, y: 0, dir: 1 },
    // Wall: logo above the desk, TV, clock and frames
    { id: fid('frame'), kind: 'frame', x: 8, y: 0, dir: 0 },
    { id: fid('logo'), kind: 'logo', x: 10, y: 0, dir: 0 },
    { id: fid('clock'), kind: 'clock', x: 13, y: 0, dir: 0 },
    { id: fid('tv'), kind: 'tv', x: 14, y: 0, dir: 0 },
    { id: fid('frame'), kind: 'frame', x: 0, y: 5, dir: 1 },
    { id: fid('frame'), kind: 'frame', x: 0, y: 10, dir: 1 },
  ],
};

const TEAM: RoomDef = {
  id: 'team',
  type: 'team',
  access: 'org',
  name: 'Sala de Equipe',
  description: 'Mesa grande para trabalhar junto, lousa, TV e um canto de sofá para o papo da equipe.',
  tiles: rect(14, 10),
  spawn: { x: 1, y: 4, dir: 0 },
  maxPlayers: 12,
  portals: [{ x: 0, y: 4, toRoom: 'reception', toX: 6, toY: 1, label: 'Recepção Central' }],
  furniture: [
    { id: fid('rug'), kind: 'rug', x: 4, y: 4, dir: 0 },
    { id: fid('rug'), kind: 'rug', x: 7, y: 4, dir: 0 },
    // Team table: two tables side by side with twelve seats
    { id: fid('table'), kind: 'table', x: 5, y: 4, dir: 0 },
    { id: fid('table'), kind: 'table', x: 7, y: 4, dir: 0 },
    ...chairsAround(5, 4, 4, 2),
    // Sofa corner: the sofa faces a coffee table on its own rug, armchair and poufs around it
    { id: fid('rug'), kind: 'rug', x: 9, y: 8, dir: 0 },
    { id: fid('sofa'), kind: 'sofa', x: 10, y: 7, dir: 1 },
    { id: fid('ctable'), kind: 'coffee_table', x: 10, y: 8, dir: 0 },
    { id: fid('armchair'), kind: 'armchair', x: 9, y: 8, dir: 0 },
    { id: fid('pouf'), kind: 'pouf', x: 10, y: 9, dir: 1 },
    { id: fid('pouf'), kind: 'pouf', x: 11, y: 9, dir: 1 },
    { id: fid('lamp'), kind: 'lamp', x: 12, y: 7, dir: 0 },
    // Storage and equipment against the walls: bookshelf on the west wall, printer on the north wall
    { id: fid('shelf'), kind: 'bookshelf', x: 0, y: 8, dir: 1 },
    { id: fid('printer'), kind: 'printer', x: 12, y: 0, dir: 1 },
    { id: fid('bin'), kind: 'bin', x: 13, y: 1, dir: 0 },
    { id: fid('plant'), kind: 'plant', x: 0, y: 6, dir: 0 },
    { id: fid('plant'), kind: 'plant', x: 13, y: 0, dir: 0 },
    // Wall
    { id: fid('board'), kind: 'whiteboard', x: 2, y: 0, dir: 0 },
    { id: fid('frame'), kind: 'frame', x: 5, y: 0, dir: 0 },
    { id: fid('tv'), kind: 'tv', x: 7, y: 0, dir: 0 },
    { id: fid('clock'), kind: 'clock', x: 10, y: 0, dir: 0 },
    // Presentation TV on a rolling stand, screen toward the table (see presentationOf in stage.ts)
    { id: 'tvstand-team', kind: 'tv_stand', x: 6, y: 1, dir: 0 },
    { id: fid('frame'), kind: 'frame', x: 12, y: 0, dir: 0 },
    { id: fid('frame'), kind: 'frame', x: 0, y: 2, dir: 1 },
    { id: fid('frame'), kind: 'frame', x: 0, y: 7, dir: 1 },
  ],
};

const MEETING1: RoomDef = {
  id: 'meeting1',
  type: 'meeting',
  access: 'org',
  name: 'Sala de Reunião 1',
  description: 'Mesa para até doze pessoas, telão, lousa e divisória de vidro. Feche a porta e converse.',
  tiles: rect(11, 10),
  spawn: { x: 1, y: 4, dir: 0 },
  maxPlayers: 12,
  portals: [{ x: 0, y: 4, toRoom: 'reception', toX: 16, toY: 1, label: 'Recepção Central' }],
  furniture: [
    { id: fid('rug'), kind: 'rug', x: 4, y: 4, dir: 0 },
    { id: fid('rug'), kind: 'rug', x: 7, y: 4, dir: 0 },
    ...glassWall(2, [0, 2, 6, 8]),
    { id: fid('table'), kind: 'table', x: 5, y: 4, dir: 0 },
    { id: fid('table'), kind: 'table', x: 7, y: 4, dir: 0 },
    ...chairsAround(5, 4, 4, 2),
    { id: fid('plant'), kind: 'plant', x: 1, y: 1, dir: 0 },
    { id: fid('plant'), kind: 'plant', x: 1, y: 9, dir: 0 },
    { id: fid('cooler'), kind: 'cooler', x: 4, y: 0, dir: 1 },
    { id: fid('bin'), kind: 'bin', x: 10, y: 9, dir: 0 },
    { id: fid('lamp'), kind: 'lamp', x: 10, y: 8, dir: 0 },
    { id: fid('tv'), kind: 'tv', x: 5, y: 0, dir: 0 },
    { id: 'tvstand-meeting1', kind: 'tv_stand', x: 6, y: 1, dir: 0 },
    { id: fid('board'), kind: 'whiteboard', x: 8, y: 0, dir: 0 },
    { id: fid('clock'), kind: 'clock', x: 10, y: 0, dir: 0 },
    { id: fid('frame'), kind: 'frame', x: 0, y: 2, dir: 1 },
    { id: fid('frame'), kind: 'frame', x: 0, y: 7, dir: 1 },
  ],
};

const MEETING2: RoomDef = {
  id: 'meeting2',
  type: 'meeting',
  access: 'org',
  name: 'Sala de Reunião 2',
  description: 'Sala menor para até oito pessoas, com TV, lousa e divisória de vidro.',
  tiles: rect(10, 9),
  spawn: { x: 1, y: 4, dir: 0 },
  maxPlayers: 8,
  portals: [{ x: 0, y: 4, toRoom: 'reception', toX: 18, toY: 1, label: 'Recepção Central' }],
  furniture: [
    { id: fid('rug'), kind: 'rug', x: 4, y: 4, dir: 0 },
    ...glassWall(2, [0, 2, 6]),
    { id: fid('plant'), kind: 'plant', x: 2, y: 8, dir: 0 },
    { id: fid('table'), kind: 'table', x: 5, y: 4, dir: 0 },
    ...chairsAround(5, 4, 2, 2),
    { id: fid('plant'), kind: 'plant', x: 1, y: 1, dir: 0 },
    { id: fid('plant'), kind: 'plant', x: 1, y: 7, dir: 0 },
    { id: fid('bin'), kind: 'bin', x: 9, y: 8, dir: 0 },
    { id: fid('lamp'), kind: 'lamp', x: 9, y: 1, dir: 0 },
    { id: fid('board'), kind: 'whiteboard', x: 4, y: 0, dir: 0 },
    { id: fid('tv'), kind: 'tv', x: 7, y: 0, dir: 0 },
    { id: 'tvstand-meeting2', kind: 'tv_stand', x: 5, y: 1, dir: 0 },
    { id: fid('frame'), kind: 'frame', x: 0, y: 2, dir: 1 },
    { id: fid('clock'), kind: 'clock', x: 0, y: 7, dir: 1 },
  ],
};

const PRIVATE: RoomDef = {
  id: 'private',
  type: 'private',
  access: 'private',
  name: 'Sala Privada',
  description: 'Escritório fechado para uma a quatro pessoas: mesa, sofá e conversa reservada.',
  tiles: rect(9, 7),
  spawn: { x: 1, y: 3, dir: 0 },
  maxPlayers: 4,
  portals: [{ x: 0, y: 3, toRoom: 'reception', toX: 20, toY: 1, label: 'Recepção Central' }],
  furniture: [
    { id: fid('rug'), kind: 'rug', x: 4, y: 3, dir: 0 },
    { id: fid('rug'), kind: 'rug', x: 1, y: 5, dir: 0 },
    { id: fid('desk'), kind: 'desk', x: 3, y: 2, dir: 0 },
    { id: fid('pc'), kind: 'computer', x: 3, y: 2, dir: 0 },
    { id: fid('pc'), kind: 'computer', x: 4, y: 2, dir: 0 },
    { id: fid('chair'), kind: 'chair', x: 3, y: 3, dir: 3 },
    { id: fid('chair'), kind: 'chair', x: 4, y: 3, dir: 3 },
    // Conversation corner: sofa on the west wall facing the coffee table, armchair on the north side, poufs opposite
    { id: fid('sofa'), kind: 'sofa', x: 0, y: 5, dir: 0 },
    { id: fid('ctable'), kind: 'coffee_table', x: 2, y: 5, dir: 1 },
    { id: fid('armchair'), kind: 'armchair', x: 2, y: 4, dir: 1 },
    { id: fid('pouf'), kind: 'pouf', x: 3, y: 5, dir: 1 },
    { id: fid('pouf'), kind: 'pouf', x: 3, y: 6, dir: 1 },
    { id: fid('lamp'), kind: 'lamp', x: 8, y: 4, dir: 0 },
    { id: fid('plant'), kind: 'plant', x: 8, y: 2, dir: 0 },
    { id: fid('plant'), kind: 'plant', x: 8, y: 6, dir: 0 },
    { id: fid('shelf'), kind: 'bookshelf', x: 6, y: 0, dir: 0 },
    { id: fid('frame'), kind: 'frame', x: 2, y: 0, dir: 0 },
    { id: fid('clock'), kind: 'clock', x: 4, y: 0, dir: 0 },
    { id: fid('frame'), kind: 'frame', x: 0, y: 5, dir: 1 },
  ],
};

/** Individual booths: a desk, a chair and a computer between fabric dividers, in two rows facing each other. */
const focusBooths = (): Furniture[] => {
  const out: Furniture[] = [];
  for (const x0 of [2, 5, 8]) {
    out.push({ id: fid('desk'), kind: 'desk', x: x0, y: 1, dir: 0 });
    out.push({ id: fid('pc'), kind: 'computer', x: x0, y: 1, dir: 0 });
    out.push({ id: fid('chair'), kind: 'chair', x: x0, y: 2, dir: 3 });
    out.push({ id: fid('desk'), kind: 'desk', x: x0, y: 6, dir: 0 });
    out.push({ id: fid('pc'), kind: 'computer', x: x0, y: 6, dir: 3 });
    out.push({ id: fid('chair'), kind: 'chair', x: x0, y: 5, dir: 1 });
  }
  for (const x of [1, 4, 7, 10]) {
    out.push({ id: fid('panel'), kind: 'divider', x, y: 1, dir: 1 });
    out.push({ id: fid('panel'), kind: 'divider', x, y: 5, dir: 1 });
  }
  return out;
};

const FOCUS: RoomDef = {
  id: 'focus',
  type: 'focus',
  access: 'org',
  name: 'Espaço de Concentração',
  description: 'Silêncio: baias individuais com divisórias, luz suave e nada de conversa.',
  tiles: rect(12, 8),
  spawn: { x: 1, y: 4, dir: 0 },
  maxPlayers: 8,
  portals: [{ x: 0, y: 4, toRoom: 'reception', toX: 1, toY: 7, label: 'Recepção Central' }],
  furniture: [
    ...focusBooths(),
    { id: fid('lamp'), kind: 'lamp', x: 0, y: 1, dir: 0 },
    { id: fid('plant'), kind: 'plant', x: 11, y: 7, dir: 0 },
    { id: fid('plant'), kind: 'plant', x: 0, y: 0, dir: 0 },
    { id: fid('frame'), kind: 'frame', x: 4, y: 0, dir: 0 },
    { id: fid('clock'), kind: 'clock', x: 8, y: 0, dir: 0 },
  ],
};

/**
 * Coloca um interruptor de luz na parede norte (ou oeste) de cada sala, perto da porta principal, num tile de parede livre
 * cujo vizinho do piso seja andavel. Assim o interruptor existe em toda sala sem editar cada layout a mao.
 */
function withLightSwitch(def: RoomDef): RoomDef {
  if (def.furniture.some((f) => f.kind === 'light_switch')) return def;
  const taken = new Set<string>();
  const solid = new Set<string>();
  for (const f of def.furniture) {
    for (const t of footprintTiles(f)) {
      taken.add(`${t.x},${t.y}`);
      if (FURNI_KINDS[f.kind].blocks) solid.add(`${t.x},${t.y}`);
    }
  }
  const floor = (x: number, y: number) => def.tiles[y]?.[x] === '.';
  const portalAt = (x: number, y: number) => def.portals.some((p) => p.x === x && p.y === y);
  const okNorth = (x: number) => floor(x, 0) && floor(x, 1) && !taken.has(`${x},0`) && !portalAt(x, 0) && !solid.has(`${x},1`);
  const okWest = (y: number) => floor(0, y) && floor(1, y) && !taken.has(`0,${y}`) && !portalAt(0, y) && !solid.has(`1,${y}`);
  const width = Math.max(...def.tiles.map((r) => r.length));
  const height = def.tiles.length;
  const near: Array<{ x: number; y: number; dir: number }> = [];
  for (const p of def.portals) {
    for (const d of [1, -1, 2, -2, 3, -3]) {
      if (p.y === 0) near.push({ x: p.x + d, y: 0, dir: 0 });
      else if (p.x === 0) near.push({ x: 0, y: p.y + d, dir: 1 });
    }
  }
  for (let x = 1; x < width; x++) near.push({ x, y: 0, dir: 0 });
  for (let y = 1; y < height; y++) near.push({ x: 0, y, dir: 1 });
  const spot = near.find((c) => (c.dir === 0 ? okNorth(c.x) : okWest(c.y)));
  if (spot) def.furniture.push({ id: `switch-${def.id}`, kind: 'light_switch', x: spot.x, y: spot.y, dir: spot.dir });
  return def;
}

export const ROOM_DEFS: RoomDef[] = [OFFICE, LOUNGE, AUDITORIUM, RECEPTION, TEAM, MEETING1, MEETING2, PRIVATE, FOCUS].map(withLightSwitch);
/**
 * First room of a new account. It stays the office on purpose: existing accounts and the store tests already
 * persist 'office' as `lastRoom`. Switching new accounts to the reception means changing only this constant.
 */
export const DEFAULT_ROOM_ID = 'office';

/** An auditorium is any room with a podium: it has a stage, a speaker and an audience. */
export const isStageRoom = (def: Pick<RoomDef, 'furniture'>): boolean => def.furniture.some((f) => f.kind === 'podium');
