import { mix, shade } from '../pixel';

/**
 * Recoloring by RAMP SUBSTITUTION, never by a filter or tint over pixels.
 *
 * Every material of an item is described by ONE base color. A fixed rule turns it into five tones
 * (light, base, shadow, contour, contour-in-light). The drawers paint every pixel with one of these five tones
 * (light comes from the upper left, the contour is a darkened version of the material itself), so any palette color
 * keeps the item's shading, outline and details crisp and consistent. Fixed details (a white sole, a gold buckle)
 * are written as literal colors or as `fixedRamp`.
 */
export interface Tones {
  lt: string;
  base: string;
  sh: string;
  ol: string;
  olLt: string;
}

const memo = new Map<string, Tones>();

/** Ramp of a material color. `warm` is used for skin (warmer shadows). */
export function tonesOf(hex: string, warm = false): Tones {
  const key = hex + (warm ? 'w' : '');
  let t = memo.get(key);
  if (!t) {
    t = warm
      ? {
          lt: mix(shade(hex, 0.12), '#fff1dc', 0.22),
          base: hex,
          sh: mix(shade(hex, -0.17), '#b0476a', 0.2),
          ol: mix(shade(hex, -0.55), '#3a1530', 0.4),
          olLt: mix(shade(hex, -0.34), '#5a2a3a', 0.3),
        }
      : {
          lt: mix(shade(hex, 0.2), '#fff6e0', 0.08),
          base: hex,
          sh: mix(shade(hex, -0.25), '#352a6a', 0.16),
          ol: mix(shade(hex, -0.6), '#1a1230', 0.42),
          olLt: mix(shade(hex, -0.4), '#1a1230', 0.28),
        };
    memo.set(key, t);
  }
  return t;
}

export const rampOf = tonesOf;
export const fixedRamp = (hex: string): Tones => tonesOf(hex);

/** Ramp of a color nudged lighter/darker first (e.g. the lapels are a touch lighter than the jacket). */
export const shadedRamp = (hex: string, amt: number): Tones => tonesOf(shade(hex, amt));
