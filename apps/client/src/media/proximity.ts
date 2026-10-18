/** Pure helpers for proximity audio; no browser or LiveKit dependency so they are unit-testable. */

export type ProximityMode = 'room' | 'proximity' | 'off';
export const PROXIMITY_MODES: readonly ProximityMode[] = ['room', 'proximity', 'off'];

export interface ProximityParams {
  /** Up to this distance (tiles) the volume is 1. */
  fullTiles: number;
  /** From this distance on the volume is 0; linear in between. */
  zeroTiles: number;
}

export const DEFAULT_PROXIMITY: ProximityParams = { fullTiles: 2, zeroTiles: 8 };

export interface TilePosition {
  x: number;
  y: number;
}

/** Supplied by the game scene: logical tile of a participant (by LiveKit identity = player id), or undefined if unknown. */
export type TilePositionProvider = (identity: string) => TilePosition | undefined;

export function sanitizeParams(p: Partial<ProximityParams> | undefined): ProximityParams {
  const full = Number.isFinite(p?.fullTiles) ? Math.max(0, p!.fullTiles!) : DEFAULT_PROXIMITY.fullTiles;
  const zeroRaw = Number.isFinite(p?.zeroTiles) ? p!.zeroTiles! : DEFAULT_PROXIMITY.zeroTiles;
  return { fullTiles: full, zeroTiles: Math.max(full + 0.5, Math.min(64, zeroRaw)) };
}

export function volumeForDistance(distanceTiles: number, params: ProximityParams = DEFAULT_PROXIMITY): number {
  if (!Number.isFinite(distanceTiles)) return 0;
  if (distanceTiles <= params.fullTiles) return 1;
  if (distanceTiles >= params.zeroTiles) return 0;
  return 1 - (distanceTiles - params.fullTiles) / (params.zeroTiles - params.fullTiles);
}

export function distanceTiles(a: TilePosition, b: TilePosition): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Volume (0..1) of a remote participant for the chosen mode. Unknown positions are silent in proximity mode. */
export function volumeFor(
  mode: ProximityMode,
  self: TilePosition | undefined,
  other: TilePosition | undefined,
  params: ProximityParams = DEFAULT_PROXIMITY,
): number {
  if (mode === 'off') return 0;
  if (mode === 'room') return 1;
  if (!self || !other) return 0;
  return volumeForDistance(distanceTiles(self, other), params);
}

export function isProximityMode(v: unknown): v is ProximityMode {
  return typeof v === 'string' && (PROXIMITY_MODES as readonly string[]).includes(v);
}
