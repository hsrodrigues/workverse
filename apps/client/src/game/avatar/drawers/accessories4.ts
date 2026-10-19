import { mix, shade } from '../../pixel';
import { MAIN, armDepth, facePoint, headCenter, v3, vAdd, vNorm, vSub, type Ctx2 } from '../engine';
import { tonesOf } from '../recolor';
import { registerDrawer } from '../registry';
import { FACE_YAW } from '../engine';
import { D_EYES, D_MOUTH, onFace } from './face';

/** Bags carried in the hand (handbag, clutch) and face make-up (blush, freckles, eye shadow). */

const GOLD = '#d9b24a';

function handPoint(c: Ctx2): [number, number] {
  const { rig } = c;
  const wr = rig.wrist[1];
  const dir = vNorm(vSub(wr, rig.elbow[1]));
  const tip = c.Pv(vAdd(wr, v3(dir[0] * 3.4, dir[1] * 3.4, dir[2] * 3.4)));
  return [Math.round(tip[0]), Math.round(tip[1])];
}

registerDrawer('acc.handbag', (c, it, e) =>
  e.part(armDepth(c, 1) + 0.04, () => {
    const [hx, hy] = handPoint(c);
    const col = it.t;
    const clutch = it.item.params?.shape === 'clutch';
    if (clutch) {
      // flat clutch held against the hip
      const x0 = hx - 5;
      const y0 = hy - 1;
      MAIN.clear();
      for (let y = 0; y < 5; y++) for (let x = 0; x < 10; x++) if (!((y === 0 || y === 4) && (x === 0 || x === 9))) MAIN.set(x0 + x, y0 + y);
      c.paint(MAIN, col, { lw: 1, sw: 2 });
      c.clip = null;
      for (let x = 1; x < 9; x++) c.px(x0 + x, y0 + 1, col.lt);
      c.px(x0 + 4, y0 + 2, GOLD);
      c.px(x0 + 5, y0 + 2, '#f2cf63');
      c.px(x0 + 1, y0 + 3, col.sh);
      MAIN.clear();
      return;
    }
    // handbag: a handle arc from the hand and a boxy body with a flap and gold clasp
    for (const [dx, dy] of [[-2, 3], [-3, 2], [-3, 1], [-2, 0], [-1, -1], [0, -1], [1, -1], [2, 0], [3, 1], [3, 2], [2, 3]] as const) c.px(hx + dx, hy + dy + 1, col.sh);
    const x0 = hx - 5;
    const y0 = hy + 4;
    MAIN.clear();
    for (let y = 0; y < 8; y++) for (let x = 0; x < 11; x++) if (!(y === 7 && (x === 0 || x === 10))) MAIN.set(x0 + x, y0 + y);
    c.paint(MAIN, col, { lw: 1, sw: 2 });
    c.clip = null;
    for (let x = 1; x < 10; x++) c.px(x0 + x, y0 + 3, col.sh);
    for (let x = 1; x < 10; x++) c.px(x0 + x, y0 + 2, col.lt);
    c.px(x0 + 5, y0 + 4, GOLD);
    c.px(x0 + 5, y0 + 5, '#8a7a3a');
    c.px(x0 + 1, y0 + 5, col.lt);
    MAIN.clear();
  }),
);

// ---- make-up ----------------------------------------------------------------------------------------------------------------------

registerDrawer('acc.blush', (c, it, e) =>
  e.part(20.09, () =>
    onFace(c, (cx, cy) => {
      for (const sg of [-1, 1] as const) {
        const p = facePoint(c, cx, cy, sg * 0.72, -5.0);
        if (p.vis < 0.25) continue;
        const w = p.vis > 0.6 ? 4 : 3;
        const strong = mix(c.skin.base, it.hex, 0.7);
        const soft = mix(c.skin.base, it.hex, 0.4);
        for (let k = 0; k < w; k++) {
          c.px(p.x - w / 2 + k, p.y, k === 0 || k === w - 1 ? soft : strong);
          c.px(p.x - w / 2 + k, p.y + 1, k === 0 || k === w - 1 ? c.skin.base : soft);
        }
      }
    }),
  ),
);

registerDrawer('acc.freckles', (c, it, e) =>
  e.part(20.09, () =>
    onFace(c, (cx, cy) => {
      const dot = mix(c.skin.base, '#7a4020', 0.55);
      const spots: [number, number, number][] = [[0.62, -3.6, 1], [0.8, -4.6, 1], [0.5, -5.2, 1], [0.74, -2.9, 1], [0.34, -3.4, 1], [0.15, -3.8, 0], [0.0, -4.4, 0]];
      for (const [a, dy] of spots.map(([a2, d2]) => [a2, d2])) {
        for (const sg of [-1, 1] as const) {
          if (a === 0 && sg === 1) continue;
          const p = facePoint(c, cx, cy, sg * a, dy);
          if (p.vis > 0.25) c.px(p.x, p.y, dot);
        }
      }
      void it;
    }),
  ),
);

registerDrawer('acc.eyeshadow', (c, it, e) =>
  e.part(20.105, () =>
    onFace(c, (cx, cy) => {
      const lt = shade(it.hex, 0.18);
      for (const sg of [-1, 1] as const) {
        const p = facePoint(c, cx, cy, sg * 0.4, -1.8);
        if (p.vis < 0.15) continue;
        const w = p.vis > 0.62 ? 4 : 3;
        const x0 = Math.round(p.x - w / 2);
        const y0 = Math.round(p.y - 3);
        for (let k = 0; k < w; k++) {
          c.px(x0 + k, y0, it.hex);
          c.px(x0 + k, y0 - 1, k === 0 || k === w - 1 ? mix(c.skin.base, it.hex, 0.5) : lt);
        }
      }
    }),
  ),
);

void D_EYES;
void headCenter;
void tonesOf;

// ---- lipstick (mouth items with a color) ---------------------------------------------------------------------------------------

registerDrawer('mouth.lips', (c, it, e) =>
  e.part(D_MOUTH, () =>
    onFace(c, (cx, cy) => {
      const open = c.rig.wave >= 0;
      const bold = it.item.params?.bold === true;
      const m = facePoint(c, cx, cy, 0, -8.2);
      const mw = Math.max(3, Math.round((bold ? 6 : 5) * Math.cos(c.th * FACE_YAW)));
      const mx = Math.round(m.x - mw / 2);
      const my = Math.round(m.y);
      const upper = shade(it.hex, -0.22);
      const lower = it.hex;
      const gloss = mix(it.hex, '#ffffff', 0.5);
      if (bold) for (let k = 1; k < mw - 1; k++) c.px(mx + k, my - 1, upper);
      for (let k = 0; k < mw; k++) c.px(mx + k, my, upper);
      if (open) for (let k = 1; k < mw - 1; k++) c.px(mx + k, my + 1, '#5a1624');
      for (let k = 0; k < mw; k++) c.px(mx + k, my + (open ? 2 : 1), lower);
      if (bold && !open) for (let k = 1; k < mw - 1; k++) c.px(mx + k, my + 2, shade(it.hex, -0.1));
      c.px(mx + 1, my + (open ? 2 : 1), gloss);
      c.px(mx - 1, my - 1, upper);
      c.px(mx + mw, my - 1, upper);
    }),
  ),
);
