import type { Point } from './geometry';

/** Walkability grid used by both the server (authoritative) and the client (previews). */
export interface Grid {
  width: number;
  height: number;
  /** true when a tile exists in the room (not void). */
  floor: boolean[];
  /** true when furniture or another rule blocks the tile. */
  blocked: boolean[];
}

export const idx = (g: Pick<Grid, 'width'>, x: number, y: number) => y * g.width + x;

export function inBounds(g: Grid, x: number, y: number): boolean {
  return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < g.width && y < g.height;
}

export function isWalkable(g: Grid, x: number, y: number): boolean {
  return inBounds(g, x, y) && g.floor[idx(g, x, y)] && !g.blocked[idx(g, x, y)];
}

const NEIGHBOURS: ReadonlyArray<readonly [number, number]> = [
  [1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, 1], [-1, -1], [1, -1],
];

class MinHeap {
  private items: { k: number; f: number }[] = [];
  get size() {
    return this.items.length;
  }
  push(k: number, f: number) {
    const a = this.items;
    a.push({ k, f });
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].f <= a[i].f) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop(): number {
    const a = this.items;
    const top = a[0];
    const last = a.pop()!;
    if (a.length > 0) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l].f < a[m].f) m = l;
        if (r < a.length && a[r].f < a[m].f) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top.k;
  }
}

export interface PathOptions {
  /** Allows the goal tile itself to be blocked (e.g. a chair the avatar will sit on). */
  allowBlockedGoal?: boolean;
  maxLength?: number;
}

/**
 * A* over 8 directions. Diagonal moves are not allowed to cut corners: both
 * orthogonal neighbours must be walkable. Returns the tiles to walk through,
 * excluding the start and including the goal, or null when unreachable.
 */
export function findPath(g: Grid, from: Point, to: Point, opts: PathOptions = {}): Point[] | null {
  if (!inBounds(g, from.x, from.y) || !inBounds(g, to.x, to.y)) return null;
  if (!g.floor[idx(g, to.x, to.y)]) return null;
  if (!opts.allowBlockedGoal && g.blocked[idx(g, to.x, to.y)]) return null;
  if (from.x === to.x && from.y === to.y) return [];

  const size = g.width * g.height;
  const gScore = new Float64Array(size).fill(Infinity);
  const parent = new Int32Array(size).fill(-1);
  const closed = new Uint8Array(size);
  const heap = new MinHeap();
  const start = idx(g, from.x, from.y);
  const goal = idx(g, to.x, to.y);
  const h = (x: number, y: number) => {
    const dx = Math.abs(x - to.x);
    const dy = Math.abs(y - to.y);
    return dx + dy + (Math.SQRT2 - 2) * Math.min(dx, dy);
  };
  gScore[start] = 0;
  heap.push(start, h(from.x, from.y));

  const stepOk = (x: number, y: number) =>
    isWalkable(g, x, y) || (opts.allowBlockedGoal === true && x === to.x && y === to.y);

  while (heap.size > 0) {
    const cur = heap.pop();
    if (closed[cur]) continue;
    closed[cur] = 1;
    if (cur === goal) break;
    const cx = cur % g.width;
    const cy = (cur / g.width) | 0;
    for (const [dx, dy] of NEIGHBOURS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!inBounds(g, nx, ny) || !stepOk(nx, ny)) continue;
      if (dx !== 0 && dy !== 0 && (!isWalkable(g, cx + dx, cy) || !isWalkable(g, cx, cy + dy))) continue;
      const ni = idx(g, nx, ny);
      if (closed[ni]) continue;
      const cost = gScore[cur] + (dx !== 0 && dy !== 0 ? Math.SQRT2 : 1);
      if (cost < gScore[ni]) {
        gScore[ni] = cost;
        parent[ni] = cur;
        heap.push(ni, cost + h(nx, ny));
      }
    }
  }

  if (parent[goal] === -1) return null;
  const out: Point[] = [];
  for (let c = goal; c !== start; c = parent[c]) out.push({ x: c % g.width, y: (c / g.width) | 0 });
  out.reverse();
  if (opts.maxLength && out.length > opts.maxLength) return null;
  return out;
}

/** Validates that a path is contiguous, within the grid and respects walkability. */
export function isValidPath(g: Grid, from: Point, path: Point[], allowBlockedGoal = false): boolean {
  let px = from.x;
  let py = from.y;
  for (let i = 0; i < path.length; i++) {
    const { x, y } = path[i];
    const last = i === path.length - 1;
    if (!inBounds(g, x, y)) return false;
    if (Math.abs(x - px) > 1 || Math.abs(y - py) > 1 || (x === px && y === py)) return false;
    const ok = isWalkable(g, x, y) || (last && allowBlockedGoal && g.floor[idx(g, x, y)]);
    if (!ok) return false;
    if (x !== px && y !== py && (!isWalkable(g, x, py) || !isWalkable(g, px, y))) return false;
    px = x;
    py = y;
  }
  return true;
}
