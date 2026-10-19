import { FURNI_KINDS, WALL_BACKED_KINDS, buildRoom, footprint, footprintTiles, furniFront, type FurniKind, type Furniture, type RoomDef } from './rooms';

/**
 * Layout rules of the isometric rooms (shared by the layout test and by the furniture editor, where they are WARNINGS,
 * never a block). Only the north (y = 0) and west (x = 0) walls are drawn; south and east are open edges.
 * Facing: 0 = +x, 1 = +y (toward the camera), 2 = -x, 3 = -y.
 */
export interface LayoutIssue {
  /** Stable code: `seat_wall`, `seat_back`, `seat_no_focus`, `wall_not_north`, `wall_not_west`, `wall_front_wall`, `wall_no_room`. */
  code: string;
  /** Human text, in Portuguese, prefixed with `room/piece` like the layout test always did. */
  message: string;
  id: string;
  x: number;
  y: number;
}

const VEC: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
];

/** Seats that must look at something. Poufs and stools are round and have no front. */
const FACING_SEATS: readonly FurniKind[] = ['sofa', 'armchair'];
/** Pieces with a back and a front: looking at their back or side from close by is wrong. */
const ORIENTED: readonly FurniKind[] = ['sofa', 'armchair', 'chair', 'ergo_chair', 'auditorium_seat', ...WALL_BACKED_KINDS, 'reception_desk'];
/** What a seat may look at: furniture people gather around, a screen, or a conversation. */
const FOCUS: readonly FurniKind[] = ['table', 'high_table', 'desk', 'tv', 'tv_stand', 'screen', 'whiteboard', 'coffee_table', 'videowall', 'arch_board', 'command_desk', 'stage', 'podium', 'reception_desk', 'counter', 'sofa', 'armchair', 'pouf', 'stool', 'chair', 'fridge', 'coffee', 'cooler', 'snack_machine', 'soda_machine', 'microwave'];
/** How far (in tiles) the gaze looks for something to land on. */
const GAZE = 6;

export function auditRoomLayout(def: RoomDef): LayoutIssue[] {
  const room = buildRoom(def);
  const { width, height } = room.grid;
  const out: LayoutIssue[] = [];
  const at = (x: number, y: number) => room.furniAt.get(y * width + x) ?? [];
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height && room.grid.floor[y * width + x];
  const mine = (f: Furniture, x: number, y: number) => footprintTiles(f).some((t) => t.x === x && t.y === y);
  const issue = (code: string, f: Furniture, message: string) => out.push({ code, id: f.id, x: f.x, y: f.y, message: `${def.id}/${f.id} ${message}` });

  // 1. seats look at a focal point, never at a wall, an empty edge or the back of another piece
  for (const f of def.furniture.filter((x) => FACING_SEATS.includes(x.kind))) {
    const [dx, dy] = VEC[furniFront(f)];
    const tiles = footprintTiles(f);
    // front-edge tiles: the footprint tiles whose neighbour ahead is not part of the piece
    const edge = tiles.filter((t) => !mine(f, t.x + dx, t.y + dy));
    let focused = false;
    for (const t of edge) {
      const ax = t.x + dx;
      const ay = t.y + dy;
      if (!inside(ax, ay)) {
        issue('seat_wall', f, `(${f.kind} ${f.x},${f.y} dir ${f.dir}) olha direto para ${ax < 0 || ay < 0 ? 'a parede' : 'a borda vazia'}`);
        continue;
      }
      // directly in front: the back or side of another oriented piece is not a view
      for (const g of at(ax, ay)) {
        if (g !== f && ORIENTED.includes(g.kind) && furniFront(g) !== (furniFront(f) + 2) % 4) {
          issue('seat_back', f, `(${f.kind} ${f.x},${f.y}) olha para o costado de ${g.id} (${g.kind} ${g.x},${g.y} dir ${g.dir})`);
        }
      }
      for (let i = 1; i <= GAZE && !focused; i++) {
        const x = t.x + dx * i;
        const y = t.y + dy * i;
        if (!inside(x, y)) break;
        if (at(x, y).some((g) => g !== f && FOCUS.includes(g.kind))) focused = true;
        // a rug right in front of the seat is a conversation area too
        if (i <= 2 && at(x, y).some((g) => g.kind === 'rug')) focused = true;
      }
    }
    if (!focused) issue('seat_no_focus', f, `(${f.kind} ${f.x},${f.y} dir ${f.dir}) não olha para nenhum ponto focal (mesa, TV, tapete, conversa)`);
  }

  // 2. wall pieces stand against the north or west wall, front toward the room
  for (const f of def.furniture.filter((x) => WALL_BACKED_KINDS.includes(x.kind))) {
    const front = furniFront(f);
    const tiles = footprintTiles(f);
    const fp = footprint(f);
    if (front === 1) {
      if (!tiles.every((t) => t.y >= 0) || Math.min(...tiles.map((t) => t.y)) !== 0) issue('wall_not_north', f, `(${f.kind} ${f.x},${f.y} dir ${f.dir}) não está encostado na parede norte`);
    } else if (front === 0) {
      if (Math.min(...tiles.map((t) => t.x)) !== 0) issue('wall_not_west', f, `(${f.kind} ${f.x},${f.y} dir ${f.dir}) não está encostado na parede oeste`);
    } else {
      issue('wall_front_wall', f, `(${f.kind} ${f.x},${f.y} dir ${f.dir}) tem a frente virada para ${front === 3 ? 'o norte (parede)' : 'o oeste (parede)'}`);
    }
    // the tile in front of it must be floor so the piece can be used
    const [dx, dy] = VEC[front];
    const free = tiles.some((t) => inside(t.x + dx, t.y + dy));
    if (!free) issue('wall_no_room', f, `sem espaço livre na frente (${fp.w}x${fp.d})`);
  }
  return out;
}

/** True when the kind is one of the pieces that belong against a wall (see WALL_BACKED_KINDS). */
export const isWallBacked = (kind: FurniKind) => WALL_BACKED_KINDS.includes(kind) && !!FURNI_KINDS[kind];
