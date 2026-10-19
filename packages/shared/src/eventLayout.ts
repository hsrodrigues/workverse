import { FURNI_KINDS, buildRoom, footprintTiles, furniFront, type BuiltRoom, type RoomDef } from './rooms';

/**
 * Onde a decoracao de eventos pode ir numa sala. Funcoes PURAS (o desenho fica no cliente, apps/client/src/game/eventDecor.ts)
 * para a regra "decoracao nunca bloqueia caminho nem cobre porta, interruptor ou movel" ser testavel.
 *
 *  - `props`: tiles do chao para objetos em pe (abobora, arvore, balões...). So cantos e encostos livres, longe de portas,
 *    do ponto de nascimento e de moveis, e que, mesmo tratados como bloqueados, deixam todo o resto da sala conectado e
 *    cada movel de sentar/usar com pelo menos um tile de acesso (o cliente nao bloqueia o movimento; a regra garante que
 *    ninguem precisaria atravessar a decoracao).
 *  - `wallFree`: trechos de parede (1 tile) livres para pecas penduradas: sem porta, janela, peca de parede, estante alta
 *    nem movel encostado.
 *  - `wallTop`: trechos livres para a faixa alta (bandeirolas, guirlandas): so ficam de fora as placas de porta.
 * Parede norte = linha y = 0 (`side: 'n'`, indice t = x); parede oeste = coluna x = 0 (`side: 'w'`, t = y).
 */
export interface WallSlot {
  side: 'n' | 'w';
  /** Indice do tile ao longo da parede. */
  t: number;
}

export interface EventDecorPlan {
  props: Array<{ x: number; y: number }>;
  wallFree: WallSlot[];
  wallTop: WallSlot[];
}

const DIRS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

const hash = (a: number, b: number, seed: number): number => {
  let h = (a * 374761393 + b * 668265263 + seed * 2246822519) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

/** Maior numero de objetos em pe por sala (salas pequenas ficam mais enxutas). */
export const maxDecorProps = (walkableTiles: number): number => Math.max(2, Math.min(6, Math.floor(walkableTiles / 20)));

const walkableAt = (room: BuiltRoom, x: number, y: number, extra: ReadonlySet<number>): boolean => {
  const { width, height, floor, blocked } = room.grid;
  if (x < 0 || y < 0 || x >= width || y >= height) return false;
  const i = y * width + x;
  return floor[i] && !blocked[i] && !extra.has(i);
};

/** Tiles andaveis alcancaveis (4 vizinhos) a partir de `from`, tratando `extra` como bloqueados. */
export function reachableTiles(room: BuiltRoom, from: { x: number; y: number }, extra: ReadonlySet<number> = new Set()): Set<number> {
  const { width } = room.grid;
  const seen = new Set<number>();
  if (!walkableAt(room, from.x, from.y, extra)) return seen;
  const stack = [from.y * width + from.x];
  seen.add(stack[0]!);
  while (stack.length) {
    const cur = stack.pop()!;
    const cx = cur % width;
    const cy = Math.floor(cur / width);
    for (const [dx, dy] of DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!walkableAt(room, nx, ny, extra)) continue;
      const ni = ny * width + nx;
      if (seen.has(ni)) continue;
      seen.add(ni);
      stack.push(ni);
    }
  }
  return seen;
}

/** Andaveis a partir do nascimento (ou, se ele estiver coberto, do primeiro tile andavel). */
function startOf(room: BuiltRoom): { x: number; y: number } | null {
  const { spawn } = room.def;
  const none = new Set<number>();
  if (walkableAt(room, spawn.x, spawn.y, none)) return { x: spawn.x, y: spawn.y };
  const { width, floor, blocked } = room.grid;
  for (let i = 0; i < floor.length; i++) if (floor[i] && !blocked[i]) return { x: i % width, y: Math.floor(i / width) };
  return null;
}

/** Pecas que ficam na parede ou altas encostadas nela (as mesmas que escondem uma janela). */
function wallBusy(room: BuiltRoom): { n: Set<number>; w: Set<number> } {
  const n = new Set<number>();
  const w = new Set<number>();
  for (const f of room.def.furniture) {
    const tall = f.kind === 'bookshelf' || f.kind === 'rack' || f.kind === 'fridge' || f.kind === 'snack_machine' || f.kind === 'soda_machine' || f.kind === 'server_rack';
    const hangs = !!FURNI_KINDS[f.kind].wall;
    if (!hangs && !tall) continue;
    const north = hangs ? f.dir % 2 === 0 : furniFront(f) === 1;
    for (const t of footprintTiles(f)) {
      if (!hangs && (north ? t.y : t.x) !== 0) continue;
      (north ? n : w).add(north ? t.x : t.y);
    }
  }
  return { n, w };
}

export function planEventDecor(def: RoomDef, windows: readonly WallSlot[] = [], seed = 0, maxProps?: number): EventDecorPlan {
  const room = buildRoom(def);
  const { width, height, floor } = room.grid;
  const isFloor = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height && floor[y * width + x];

  // ---- chao ---------------------------------------------------------------------------------------------------
  const props: Array<{ x: number; y: number }> = [];
  const start = startOf(room);
  if (start) {
    const base = reachableTiles(room, start);
    const nearPortal = (x: number, y: number) => def.portals.some((p) => Math.abs(p.x - x) <= 1 && Math.abs(p.y - y) <= 1);
    const cands: Array<{ x: number; y: number; score: number }> = [];
    for (const i of base) {
      const x = i % width;
      const y = Math.floor(i / width);
      if ((room.furniAt.get(i) ?? []).length > 0) continue;
      if (nearPortal(x, y)) continue;
      if (Math.abs(x - def.spawn.x) <= 1 && Math.abs(y - def.spawn.y) <= 1) continue;
      // encostos: vizinhos que nao sao chao andavel (parede, vazio, movel que bloqueia)
      let closed = 0;
      for (const [dx, dy] of DIRS) if (!walkableAt(room, x + dx, y + dy, new Set())) closed++;
      const onWall = x === 0 || y === 0;
      if (closed < 2 && !(closed >= 1 && onWall)) continue;
      cands.push({ x, y, score: closed * 2 + (x === 0 && y === 0 ? 6 : 0) + (onWall ? 1 : 0) });
    }
    cands.sort((a, b) => b.score - a.score || hash(a.x, a.y, seed) - hash(b.x, b.y, seed) || a.y - b.y || a.x - b.x);

    // movel de sentar/usar: precisa continuar com pelo menos um tile de acesso
    const access = room.def.furniture
      .filter((f) => FURNI_KINDS[f.kind].seat || FURNI_KINDS[f.kind].usable)
      .map((f) => {
        const own = new Set(footprintTiles(f).map((t) => t.y * width + t.x));
        const around = new Set<number>();
        for (const t of footprintTiles(f)) {
          for (const [dx, dy] of DIRS) {
            const nx = t.x + dx;
            const ny = t.y + dy;
            if (!isFloor(nx, ny) || own.has(ny * width + nx)) continue;
            if (base.has(ny * width + nx)) around.add(ny * width + nx);
          }
        }
        return around;
      })
      .filter((s) => s.size > 0);

    const picked = new Set<number>();
    const limit = maxProps ?? maxDecorProps(base.size);
    for (const c of cands) {
      if (props.length >= limit) break;
      if (props.some((p) => Math.abs(p.x - c.x) < 2 && Math.abs(p.y - c.y) < 2)) continue;
      const extra = new Set(picked);
      extra.add(c.y * width + c.x);
      if (reachableTiles(room, start, extra).size !== base.size - extra.size) continue;
      if (access.some((s) => [...s].every((i) => extra.has(i)))) continue;
      picked.add(c.y * width + c.x);
      props.push({ x: c.x, y: c.y });
    }
  }

  // ---- parede -------------------------------------------------------------------------------------------------
  const busy = wallBusy(room);
  const portalN = new Set(def.portals.filter((p) => p.y === 0).map((p) => p.x));
  const portalW = new Set(def.portals.filter((p) => p.x === 0).map((p) => p.y));
  const winN = new Set(windows.filter((s) => s.side === 'n').map((s) => s.t));
  const winW = new Set(windows.filter((s) => s.side === 'w').map((s) => s.t));
  const wallFree: WallSlot[] = [];
  const wallTop: WallSlot[] = [];
  for (let x = 0; x < width; x++) {
    if (!isFloor(x, 0)) continue;
    if (!portalN.has(x - 1) && !portalN.has(x) && !portalN.has(x + 1)) wallTop.push({ side: 'n', t: x });
    if (portalN.has(x) || busy.n.has(x) || winN.has(x)) continue;
    if ((room.furniAt.get(x) ?? []).length > 0) continue;
    wallFree.push({ side: 'n', t: x });
  }
  for (let y = 0; y < height; y++) {
    if (!isFloor(0, y)) continue;
    if (!portalW.has(y - 1) && !portalW.has(y) && !portalW.has(y + 1)) wallTop.push({ side: 'w', t: y });
    if (portalW.has(y) || busy.w.has(y) || winW.has(y)) continue;
    if ((room.furniAt.get(y * width) ?? []).length > 0) continue;
    wallFree.push({ side: 'w', t: y });
  }
  return { props, wallFree, wallTop };
}

/** Corridas de tiles consecutivos de uma mesma parede (para faixas e bandeirolas continuas). */
export function slotRuns(slots: readonly WallSlot[]): WallSlot[][] {
  const runs: WallSlot[][] = [];
  for (const s of [...slots].sort((a, b) => (a.side === b.side ? a.t - b.t : a.side === 'n' ? -1 : 1))) {
    const last = runs[runs.length - 1];
    const prev = last?.[last.length - 1];
    if (last && prev && prev.side === s.side && prev.t === s.t - 1) last.push(s);
    else runs.push([s]);
  }
  return runs;
}
