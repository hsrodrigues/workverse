import { FURNI_KINDS, type FurniKind } from '@workverse/shared';
import { renderFurniture } from '../../game/furniture';

/**
 * Thumbnails of the palette: the piece drawn by the very same constructor the scene uses (game/furniture.ts), cropped to its
 * visible pixels. Cached as data URLs; shown with `image-rendering: pixelated`.
 */
const cache = new Map<FurniKind, string>();

export function thumbUrl(kind: FurniKind): string {
  const hit = cache.get(kind);
  if (hit) return hit;
  let url = '';
  try {
    const dir = FURNI_KINDS[kind]?.wall ? 0 : 0;
    const src = renderFurniture({ id: `thumb-${kind}`, kind, x: 0, y: 0, dir }, false).canvas;
    const ctx = src.getContext('2d');
    if (ctx) {
      const { data, width, height } = ctx.getImageData(0, 0, src.width, src.height);
      let x0 = width;
      let y0 = height;
      let x1 = -1;
      let y1 = -1;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          if (data[(y * width + x) * 4 + 3]! > 8) {
            if (x < x0) x0 = x;
            if (x > x1) x1 = x;
            if (y < y0) y0 = y;
            if (y > y1) y1 = y;
          }
        }
      }
      if (x1 >= x0) {
        const out = document.createElement('canvas');
        out.width = x1 - x0 + 1;
        out.height = y1 - y0 + 1;
        out.getContext('2d')!.drawImage(src, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
        url = out.toDataURL('image/png');
      }
    }
  } catch {
    url = '';
  }
  cache.set(kind, url);
  return url;
}
