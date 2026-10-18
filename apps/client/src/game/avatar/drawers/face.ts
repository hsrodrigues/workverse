import { FACE_YAW, SIDE, facePoint, headCenter, type Ctx2 } from '../engine';
import { registerDrawer } from '../registry';

/** Face features are tiny flat marks clipped to the head silhouette. */
export function onFace(c: Ctx2, fn: (cx: number, cy: number) => void) {
  if (!c.face) return;
  const [cx, cy] = headCenter(c);
  c.clip = c.headClip;
  fn(cx, cy);
  c.clip = null;
}

export const D_EYES = 20.1;
export const D_BROWS = 20.11;
export const D_MOUTH = 20.12;
export const D_FACIAL = 20.13;

// ---- eyes -------------------------------------------------------------------

registerDrawer('eyes.dots', (c, it, e) =>
  e.part(D_EYES, () =>
    onFace(c, (cx, cy) => {
      for (const sg of SIDE) {
        const p = facePoint(c, cx, cy, sg * 0.4, -1.8);
        if (p.vis < 0.15) continue;
        const w = p.vis > 0.62 ? 2 : 1;
        const x0 = Math.round(p.x - w / 2);
        const y0 = Math.round(p.y - 2);
        for (let k = 0; k < w; k++) for (let r = 0; r < 4; r++) c.px(x0 + k, y0 + r, it.hex);
        // single glint, top corner
        if (w === 2 && p.vis > 0.8) c.px(x0, y0, '#ffffff');
      }
    }),
  ),
);

// ---- brows ------------------------------------------------------------------

registerDrawer('brows.none', () => {});

// ---- mouth ------------------------------------------------------------------

registerDrawer('mouth.smile', (c, _it, e) =>
  e.part(D_MOUTH, () =>
    onFace(c, (cx, cy) => {
      const open = c.rig.wave >= 0;
      const m = facePoint(c, cx, cy, 0, -8.2);
      const mw = Math.max(2, Math.round(4 * Math.cos(c.th * FACE_YAW)));
      const mx = Math.round(m.x - mw / 2);
      const my = Math.round(m.y);
      const lip = '#8a2f3a';
      if (open) {
        for (let k = 0; k < mw; k++) {
          c.px(mx + k, my, lip);
          c.px(mx + k, my + 1, '#d8606c');
        }
      } else {
        for (let k = 0; k < mw; k++) c.px(mx + k, my, lip);
        c.px(mx - 1, my - 1, lip);
        c.px(mx + mw, my - 1, lip);
      }
    }),
  ),
);
