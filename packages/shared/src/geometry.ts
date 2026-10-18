/** Isometric 2:1 geometry. A tile (x,y) has its north vertex at tileToScreen(x,y). */
export const TILE_W = 64;
export const TILE_H = 32;

export interface Point {
  x: number;
  y: number;
}

/** Screen position of the north vertex of the tile (works for fractional tile coords). */
export function tileToScreen(x: number, y: number): Point {
  return { x: (x - y) * (TILE_W / 2), y: (x + y) * (TILE_H / 2) };
}

/** Inverse of tileToScreen: continuous tile coordinates for a world position. */
export function screenToTile(sx: number, sy: number): Point {
  const u = sx / (TILE_W / 2);
  const v = sy / (TILE_H / 2);
  return { x: (v + u) / 2, y: (v - u) / 2 };
}

/**
 * Eight facing directions, clockwise on screen starting at south-east (+x).
 * 0:+x  1:+x+y  2:+y  3:-x+y  4:-x  5:-x-y  6:-y  7:+x-y
 */
export type Dir8 = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

const DIR_TABLE: Record<string, Dir8> = {
  '1,0': 0,
  '1,1': 1,
  '0,1': 2,
  '-1,1': 3,
  '-1,0': 4,
  '-1,-1': 5,
  '0,-1': 6,
  '1,-1': 7,
};

export function dirFromDelta(dx: number, dy: number, fallback: Dir8 = 2): Dir8 {
  const key = `${Math.sign(dx)},${Math.sign(dy)}`;
  return DIR_TABLE[key] ?? fallback;
}

/** Furniture rotations are 0..3 and map to the even Dir8 values. */
export function furniDirToDir8(d: number): Dir8 {
  return ((((d % 4) + 4) % 4) * 2) as Dir8;
}
