import { mix, shade } from '../../pixel';
import { AUX, MAIN, SIDE, levelY, surfLine, torsoHull, torsoPoint, type Ctx2, type P2, type Resolved } from '../engine';
import { tonesOf } from '../recolor';
import { registerDrawer } from '../registry';

/**
 * Layers worn over the top: bomber jacket, cardigan, vest and apron. Like the blazer they repaint the torso on a
 * part just above the shirt (depth 0.05) and bring their own sleeves, so the top and the jacket recolor independently.
 */

const TOP_Y = 22.4;

/** Screen-space strip along the front opening, from `y0` up to the neck; half width in torso angle units. */
function openingStrip(c: Ctx2, y0: number, y1: number, half0: number, half1: number): P2[] {
  const left: P2[] = [];
  const right: P2[] = [];
  const steps = 7;
  for (let n = 0; n <= steps; n++) {
    const yo = y0 + ((y1 - y0) * n) / steps;
    const h = half0 + ((half1 - half0) * n) / steps;
    const l = torsoPoint(c, -h, yo, 1.4);
    const r = torsoPoint(c, h, yo, 1.4);
    left.push([l[0], l[1]]);
    right.push([r[0], r[1]]);
  }
  return [...left, ...right.reverse()];
}

function standCollar(c: Ctx2, col: ReturnType<typeof tonesOf>, high = 22.6, depth = 1.6) {
  const front = !c.back;
  for (let n = 0; n <= 12; n++) {
    const psi = -Math.PI * 0.5 + (n / 12) * Math.PI;
    const p = c.P(5.6 * Math.sin(psi), levelY(c, high - (front ? depth * Math.cos(psi) : 0.2 * Math.cos(psi))), c.rig.bz + 4.6 * Math.cos(psi) * (front ? 1 : -1));
    if (front && p[2] < -0.5) continue;
    c.px(p[0], p[1] - 1, col.lt);
    c.px(p[0], p[1], col.base);
    c.px(p[0], p[1] + 1, col.sh);
  }
}

// ---- bomber ----------------------------------------------------------------------------------------------------

registerDrawer('outer.bomber', {
  draw: (c, it, e) =>
    e.part(0.05, () => {
      const col = it.t;
      const hem = -3.4;
      MAIN.clear();
      torsoHull(c, MAIN, hem, TOP_Y, 0.55, 0.65);
      c.paint(MAIN, col, { lw: 2, sw: 4 });
      // ribbed hem band
      surfLine(c, -1.45, hem + 0.9, 1.45, hem + 0.9, col.sh, 0.7);
      surfLine(c, -1.45, hem + 1.9, 1.45, hem + 1.9, mix(col.sh, col.base, 0.5), 0.7);
      surfLine(c, -1.45, hem + 2.9, 1.45, hem + 2.9, col.sh, 0.7);
      if (!c.back) {
        // zipper with a pull, and diagonal pockets
        surfLine(c, 0, 21, 0, hem + 3, '#d4d7de', 0.8);
        surfLine(c, 0.12, 21, 0.12, hem + 3, col.sh, 0.8);
        const pull = torsoPoint(c, 0, 14, 0.9);
        if (pull[2] > 0.3) {
          c.px(pull[0], pull[1], '#8a8f9a');
          c.px(pull[0], pull[1] + 1, '#8a8f9a');
        }
        for (const sg of SIDE) {
          surfLine(c, sg * 0.5, 8.6, sg * 0.95, 4.2, col.sh, 0.7);
          surfLine(c, sg * 0.5, 9.6, sg * 0.92, 5.2, col.lt, 0.7);
        }
        // small patch on the chest (wearer's left = screen right)
        const patch = torsoPoint(c, 0.6, 15.4, 0.9);
        if (patch[2] > 0.4) {
          c.px(patch[0], patch[1], '#ff9a3c');
          c.px(patch[0] + 1, patch[1], '#ff9a3c');
          c.px(patch[0], patch[1] + 1, mix('#ff9a3c', '#000000', 0.3));
          c.px(patch[0] + 1, patch[1] + 1, mix('#ff9a3c', '#000000', 0.3));
        }
      } else {
        surfLine(c, Math.PI, 21, Math.PI, hem + 3, col.sh, 0.7);
        surfLine(c, Math.PI - 0.7, 15, Math.PI + 0.7, 15, col.lt, 0.7);
      }
      standCollar(c, col);
      MAIN.clear();
      c.clip = null;
    }),
  sleeve: () => ({ len: 1, cuff: 'rib' }),
});

// ---- cardigan --------------------------------------------------------------------------------------------------

registerDrawer('outer.cardigan', {
  draw: (c, it, e) =>
    e.part(0.05, () => {
      const col = it.t;
      const hem = -3.2;
      MAIN.clear();
      torsoHull(c, MAIN, hem, TOP_Y, 0.55, 0.6);
      if (!c.back) {
        // the opening shows the top underneath
        AUX.clear();
        AUX.poly(openingStrip(c, hem - 1, 26, 0.2, 0.46));
        MAIN.sub(AUX);
        AUX.clear();
      }
      c.paint(MAIN, col, {
        lw: 2,
        sw: 4,
        deco: (x, y, tone) => (y % 3 === 0 && x % 2 === 0 ? (tone === 2 ? col.ol : col.sh) : undefined),
      });
      surfLine(c, -1.45, hem + 0.9, 1.45, hem + 0.9, col.sh, 0.7);
      surfLine(c, -1.45, hem + 1.9, 1.45, hem + 1.9, col.lt, 0.7);
      if (!c.back) {
        // front bands along the opening and buttons
        for (const sg of SIDE) {
          for (let k = 0; k < 2; k++) {
            surfLine(c, sg * (0.2 + k * 0.07), hem + 0.5, sg * (0.46 + k * 0.07), 22, k === 0 ? col.lt : col.sh, 1.2);
          }
        }
        for (const yy of [13, 8.4, 3.8]) {
          const p = torsoPoint(c, -0.3 - (22 - yy) * 0.004, yy, 0.9);
          if (p[2] > 0.3) {
            c.px(p[0], p[1], '#f1e6c8');
            c.px(p[0] + 1, p[1], '#a89a74');
          }
        }
        // patch pockets
        for (const sg of SIDE) {
          const a = torsoPoint(c, sg * 0.62, 6.6, 0.8);
          const b = torsoPoint(c, sg * 1.05, 6.6, 0.8);
          const d = torsoPoint(c, sg * 0.62, 1.4, 0.8);
          const f = torsoPoint(c, sg * 1.05, 1.4, 0.8);
          if (a[2] > 0.2 && b[2] > 0.2) {
            c.line(a[0], a[1], b[0], b[1], col.sh);
            c.line(a[0], a[1], d[0], d[1], col.sh);
            c.line(b[0], b[1], f[0], f[1], col.sh);
            c.line(d[0], d[1], f[0], f[1], col.sh);
          }
        }
      } else {
        surfLine(c, Math.PI, 20, Math.PI, hem + 3, col.sh, 0.7);
      }
      MAIN.clear();
      c.clip = null;
    }),
  sleeve: () => ({ len: 1, cuff: 'rib' }),
});

// ---- corporate vest ----------------------------------------------------------------------------------------------

registerDrawer('outer.vest', {
  draw: (c, it, e) =>
    e.part(0.05, () => {
      const col = it.t;
      const hem = -1.6;
      MAIN.clear();
      torsoHull(c, MAIN, hem, 21.6, 0.5, 0.6);
      if (!c.back) {
        AUX.clear();
        AUX.poly(openingStrip(c, 8.2, 26, 0.04, 0.5));
        MAIN.sub(AUX);
        AUX.clear();
      }
      c.paint(MAIN, col, { lw: 2, sw: 4 });
      surfLine(c, -1.45, hem + 0.8, 1.45, hem + 0.8, col.sh, 0.7);
      if (!c.back) {
        // V edge (piping), buttons and welt pockets
        surfLine(c, -0.04, 8.2, -0.5, 22, col.lt, 1.2);
        surfLine(c, 0.04, 8.2, 0.5, 22, col.lt, 1.2);
        surfLine(c, 0, 8.2, 0, hem + 0.8, col.sh, 0.9);
        for (const yy of [6.4, 3.4, 0.6]) {
          const p = torsoPoint(c, 0, yy, 0.9);
          if (p[2] > 0.3) {
            c.px(p[0], p[1], '#e9e4d6');
            c.px(p[0] + 1, p[1], col.sh);
          }
        }
        for (const sg of SIDE) surfLine(c, sg * 0.55, 3.8, sg * 1.0, 4.4, col.sh, 0.8);
        // tiny company pin on the chest
        const pin = torsoPoint(c, 0.62, 13.4, 1.0);
        if (pin[2] > 0.4) {
          c.px(pin[0], pin[1], '#ffe27a');
          c.px(pin[0] + 1, pin[1], '#c99a2e');
        }
      } else {
        // back panel with adjuster strap and buckle
        surfLine(c, Math.PI - 0.8, 4.4, Math.PI + 0.8, 4.4, shade(col.base, -0.3), 0.7);
        const b = torsoPoint(c, Math.PI, 4.4, 0.7);
        if (b[2] > -0.2) c.px(b[0], b[1], '#c9ccd4');
      }
      MAIN.clear();
      c.clip = null;
    }),
  sleeve: () => null,
});

// ---- barista apron -----------------------------------------------------------------------------------------------

registerDrawer('outer.apron', {
  draw: (c, it, e) =>
    e.part(0.06, () => {
      const col = it.t;
      const { rig } = c;
      const bz = rig.bz;
      if (c.back) {
        // waist ties and the neck loop only
        const tie = mix(col.sh, col.base, 0.4);
        const a = torsoPoint(c, Math.PI - 0.95, 4.6, 0.7);
        const b = torsoPoint(c, Math.PI + 0.95, 4.6, 0.7);
        c.line(a[0], a[1], b[0], b[1], col.sh);
        c.px((a[0] + b[0]) / 2, a[1] + 1, tie);
        c.px((a[0] + b[0]) / 2 - 1, a[1] + 2, col.lt);
        c.px((a[0] + b[0]) / 2 + 1, a[1] + 2, col.lt);
        c.px((a[0] + b[0]) / 2, a[1] + 2, col.sh);
        const n0 = torsoPoint(c, Math.PI - 0.5, 22.4, 0.5);
        const n1 = torsoPoint(c, Math.PI + 0.5, 22.4, 0.5);
        c.line(n0[0], n0[1], n1[0], n1[1], col.sh);
        return;
      }
      const hipY = rig.hipY;
      const pt = (x: number, yo: number, z: number) => {
        const p = c.P(x, levelY(c, yo), bz + z);
        return [p[0], p[1]] as P2;
      };
      const low = c.P(0, hipY - (rig.sit ? 0 : 10.5), bz + (rig.sit ? 9 : 6.6));
      const lowY = low[1];
      void lowY;
      MAIN.clear();
      MAIN.poly([
        pt(-5.6, 19, 5.4),
        pt(5.6, 19, 5.4),
        pt(7.8, 6, 6.2),
        rig.sit ? pt(9.4, -3, 9.4) : pt(9.2, -10.5, 6.8),
        rig.sit ? pt(-9.4, -3, 9.4) : pt(-9.2, -10.5, 6.8),
        pt(-7.8, 6, 6.2),
      ]);
      c.paint(MAIN, col, { lw: 2, sw: 3 });
      // neck strap
      for (const sg of SIDE) {
        const a = pt(sg * 5.0, 19, 5.4);
        const b = pt(sg * 3.4, 24, 3.6);
        c.line(a[0], a[1], b[0], b[1], col.sh);
        c.line(a[0] + sg, a[1], b[0] + sg, b[1], col.lt);
      }
      // waist seam, pocket and a chalk-white logo stripe
      const w0 = pt(-7.8, 6, 6.4);
      const w1 = pt(7.8, 6, 6.4);
      c.line(w0[0], w0[1], w1[0], w1[1], col.sh);
      const p0 = pt(-4.4, 1.2, 6.9);
      const p1 = pt(4.4, 1.2, 6.9);
      const p2 = pt(-4.4, -5.6, 7.1);
      const p3 = pt(4.4, -5.6, 7.1);
      if (!rig.sit) {
        c.line(p0[0], p0[1], p1[0], p1[1], col.lt);
        c.line(p0[0], p0[1], p2[0], p2[1], col.sh);
        c.line(p1[0], p1[1], p3[0], p3[1], col.sh);
        c.line(p2[0], p2[1], p3[0], p3[1], col.sh);
      }
      const lg = pt(0, 14, 5.8);
      for (let k = -2; k <= 2; k++) c.px(lg[0] + k, lg[1], '#f4f1ea');
      c.px(lg[0] - 1, lg[1] + 1, '#f4f1ea');
      c.px(lg[0], lg[1] + 1, '#f4f1ea');
      c.px(lg[0] + 1, lg[1] + 1, '#f4f1ea');
      c.px(lg[0], lg[1] + 2, '#cfc9bd');
      MAIN.clear();
      c.clip = null;
    }),
  sleeve: () => null,
});

void tonesOf;
export type { Resolved };
