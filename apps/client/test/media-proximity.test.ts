import { describe, expect, it } from 'vitest';
import { DEFAULT_PROXIMITY, distanceTiles, sanitizeParams, volumeFor, volumeForDistance } from '../src/media/proximity';

describe('proximity volume', () => {
  it('is full up to 2 tiles, linear down to 0 at 8 tiles', () => {
    expect(volumeForDistance(0)).toBe(1);
    expect(volumeForDistance(2)).toBe(1);
    expect(volumeForDistance(5)).toBeCloseTo(0.5);
    expect(volumeForDistance(8)).toBe(0);
    expect(volumeForDistance(20)).toBe(0);
    expect(volumeForDistance(NaN)).toBe(0);
  });
  it('respects custom parameters and sanitizes bad ones', () => {
    expect(volumeForDistance(4, { fullTiles: 1, zeroTiles: 5 })).toBeCloseTo(0.25);
    const s = sanitizeParams({ fullTiles: 6, zeroTiles: 3 });
    expect(s.zeroTiles).toBeGreaterThan(s.fullTiles);
    expect(sanitizeParams({ fullTiles: NaN, zeroTiles: Infinity })).toEqual(DEFAULT_PROXIMITY);
  });
  it('mode decides: room = 1, off = 0, proximity uses positions (unknown = silent)', () => {
    const a = { x: 0, y: 0 };
    const b = { x: 3, y: 4 }; // distance 5
    expect(distanceTiles(a, b)).toBe(5);
    expect(volumeFor('room', undefined, undefined)).toBe(1);
    expect(volumeFor('off', a, a)).toBe(0);
    expect(volumeFor('proximity', a, b)).toBeCloseTo(0.5);
    expect(volumeFor('proximity', a, undefined)).toBe(0);
  });
});
