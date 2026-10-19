import { mix, shade } from '../../pixel';
import { AUX, MAIN, SIDE, levelY, surfLine, torsoHull, torsoPoint, type Ctx2, type P2, type Resolved } from '../engine';
import { tonesOf, type Tones } from '../recolor';
import { registerDrawer } from '../registry';
import { TOP_Y, openingStrip, standCollar } from './outers';

/**
 * More layers worn over the top: denim and leather jackets, parka, double-breasted blazer, raincoat, lab coat and puffer.
 * Same recipe as `outers.ts`: a torso hull on a part just above the shirt (depth 0.05), own sleeves, details that follow
 * the torso surface (`surfLine`/`torsoPoint`) so every view and pose stays coherent.
 */

const WHITE = '#f4f1ea';

/** Shared body of a jacket: hull + paint + optional opening that shows the top underneath. */
function body(c: Ctx2, col: Tones, o: { hem: number; top?: number; grow?: number; low?: number; open?: [number, number, number, number]; deco?: (x: number, y: number, tone: 0 | 1 | 2) => string | undefined }) {
  MAIN.clear();
  torsoHull(c, MAIN, o.hem, o.top ?? TOP_Y, o.grow ?? 0.55, o.low ?? 0.65);
  if (o.open && !c.back) {
    AUX.clear();
    AUX.poly(openingStrip(c, o.open[0], o.open[1], o.open[2], o.open[3]));
    MAIN.sub(AUX);
    AUX.clear();
  }
  c.paint(MAIN, col, { lw: 2, sw: 4, deco: o.deco });
}

function done(c: Ctx2) {
  MAIN.clear();
  c.clip = null;
}

const button = (c: Ctx2, psi: number, yo: number, hex = '#d6d0c2', grow = 0.9) => {
  const p = torsoPoint(c, psi, yo, grow);
  if (p[2] > 0.3) {
    c.px(p[0], p[1], hex);
    c.px(p[0] + 1, p[1], shade(hex, -0.4));
  }
};

/** Pair of collar flaps lying open on the chest (front view). */
function flaps(c: Ctx2, t: Tones, drop = 18.6) {
  const bz = c.rig.bz;
  for (const sg of SIDE) {
    const poly = [
      c.P(sg * 4.8, levelY(c, 23.8), bz + 2.3),
      c.P(sg * 0.5, levelY(c, drop), bz + 5.7),
      c.P(sg * 0.3, levelY(c, 22.4), bz + 4.6),
      c.P(sg * 4.0, levelY(c, 25), bz + 1),
    ].map((p) => [p[0], p[1]] as P2);
    AUX.clear();
    AUX.poly(poly);
    c.paint(AUX, t, { lw: 1, sw: 2 });
    AUX.clear();
  }
}

/** Fur-trimmed or plain hood: the visible front arc around the neck, and the hood body behind the neck seen from the back. */
function hood(c: Ctx2, jacket: Tones, rim: Tones, o: { width: number; rimW?: number }) {
  const { rig } = c;
  const bz = rig.bz;
  const rx = o.width;
  const ring = (yo: number, rrx: number, rz: number) => {
    const out: P2[] = [];
    for (let n = 0; n < 16; n++) {
      const psi = (n / 16) * Math.PI * 2;
      const q = c.P(Math.sin(psi) * rrx, levelY(c, yo), bz + Math.cos(psi) * rz);
      out.push([q[0], q[1]]);
    }
    return out;
  };
  if (c.back) {
    MAIN.clear();
    MAIN.hull([...ring(15.4, rx + 0.4, 6.4), ...ring(24.6, rx - 1.2, 5.4)]);
    c.paint(MAIN, jacket, { lw: 2, sw: 3 });
    // seam down the hood and a soft fold
    surfLine(c, Math.PI, 24, Math.PI, 16, jacket.sh, 0.6);
    surfLine(c, Math.PI - 0.5, 22, Math.PI - 0.7, 16.4, jacket.lt, 0.6);
    done(c);
    return;
  }
  // front: rim around the neck opening
  const w = o.rimW ?? 2;
  for (let n = 0; n <= 14; n++) {
    const psi = -Math.PI * 0.5 + (n / 14) * Math.PI;
    const q = c.P(Math.sin(psi) * (rx - 0.6), levelY(c, 22.6 - 4.2 * Math.cos(psi)), bz + Math.cos(psi) * 5.2);
    for (let k = 0; k < w; k++) c.px(q[0], q[1] + k, k === 0 ? rim.lt : k === w - 1 ? rim.sh : rim.base);
    if (n % 2 === 0) c.px(q[0], q[1] + w, rim.sh);
  }
  for (const sg of SIDE) {
    const q = c.P(sg * (rx - 0.2), levelY(c, 22.8), bz + 1);
    c.px(q[0], q[1], rim.base);
    c.px(q[0], q[1] - 1, rim.lt);
  }
}

// ---- denim jacket --------------------------------------------------------------------------------------------------

registerDrawer('outer.denim', {
  draw: (c, it, e) =>
    e.part(0.05, () => {
      const col = it.t;
      const hem = -3.4;
      const stitch = mix(col.lt, '#e8b86a', 0.45);
      body(c, col, { hem });
      surfLine(c, -1.45, hem + 1.1, 1.45, hem + 1.1, col.sh, 0.7);
      surfLine(c, -1.45, hem + 2.1, 1.45, hem + 2.1, stitch, 0.7);
      if (!c.back) {
        surfLine(c, 0, 21, 0, hem + 1.6, col.sh, 0.9);
        surfLine(c, 0.1, 21, 0.1, hem + 1.6, stitch, 0.9);
        for (const yy of [17.6, 12.6, 7.6, 2.6]) button(c, 0, yy, '#c9a24a');
        for (const sg of SIDE) {
          // chest flap pocket with a button
          const a = torsoPoint(c, sg * 0.35, 16.8, 0.9);
          const b = torsoPoint(c, sg * 0.85, 16.8, 0.9);
          const d = torsoPoint(c, sg * 0.35, 12.4, 0.9);
          const f = torsoPoint(c, sg * 0.85, 12.4, 0.9);
          if (a[2] > 0.2 && b[2] > 0.2) {
            c.line(a[0], a[1], b[0], b[1], col.sh);
            c.line(d[0], d[1], f[0], f[1], col.sh);
            c.line(a[0], a[1], d[0], d[1], col.sh);
            c.line(b[0], b[1], f[0], f[1], col.sh);
            c.line(a[0] + 1, a[1] + 1, b[0] - 1, b[1] + 1, stitch);
            const m = torsoPoint(c, sg * 0.6, 14.4, 1.0);
            c.px(m[0], m[1], '#c9a24a');
          }
        }
        flaps(c, tonesOf(shade(col.base, 0.1)));
      } else {
        // back yoke seam and waist tab
        surfLine(c, Math.PI - 1.1, 17, Math.PI + 1.1, 17, stitch, 0.7);
        surfLine(c, Math.PI - 1.0, 16, Math.PI + 1.0, 16, col.sh, 0.7);
        surfLine(c, Math.PI, 17, Math.PI, hem + 2, col.sh, 0.7);
        surfLine(c, Math.PI - 0.7, 5.6, Math.PI + 0.7, 5.6, col.sh, 0.7);
        surfLine(c, Math.PI - 1.0, 21.6, Math.PI + 1.0, 21.6, col.lt, 0.7);
      }
      done(c);
    }),
  sleeve: () => ({ len: 1, cuff: 'plain' }),
});

// ---- leather jacket ------------------------------------------------------------------------------------------------

registerDrawer('outer.leather', {
  draw: (c, it, e) =>
    e.part(0.05, () => {
      const col = it.t;
      const hem = -2.6;
      body(c, col, { hem, grow: 0.5, low: 0.55 });
      const steel = '#b8bcc8';
      surfLine(c, -1.45, hem + 0.9, 1.45, hem + 0.9, col.sh, 0.7);
      if (!c.back) {
        // lapels folded back, a lighter leather
        for (const sg of SIDE) {
          const poly = [
            c.P(sg * 5.2, levelY(c, 23), c.rig.bz + 1.6),
            c.P(sg * 2.2, levelY(c, 23.4), c.rig.bz + 3.4),
            c.P(sg * 0.6, levelY(c, 9), c.rig.bz + 6),
            c.P(sg * 5.6, levelY(c, 11), c.rig.bz + 5.2),
            c.P(sg * 7.0, levelY(c, 18), c.rig.bz + 4),
          ].map((p) => [p[0], p[1]] as P2);
          AUX.clear();
          AUX.poly(poly);
          c.paint(AUX, tonesOf(shade(col.base, 0.12)), { lw: 1, sw: 2 });
          AUX.clear();
        }
        // diagonal zipper from the collar to the left hip, with a pull
        surfLine(c, 0.12, 22, -0.62, hem + 2, '#2a2a34', 0.95);
        surfLine(c, 0.2, 22, -0.54, hem + 2, steel, 0.95);
        const pull = torsoPoint(c, -0.2, 12.6, 1.0);
        if (pull[2] > 0.3) {
          c.px(pull[0], pull[1], steel);
          c.px(pull[0], pull[1] + 1, '#8a8f9a');
        }
        // belt at the waist with a small buckle, and zippered hip pocket
        surfLine(c, -1.3, 3.2, 1.3, 3.2, shade(col.base, -0.35), 0.8);
        surfLine(c, -1.3, 2.2, 1.3, 2.2, col.lt, 0.8);
        const bk = torsoPoint(c, 0.62, 2.8, 1.0);
        if (bk[2] > 0.3) {
          c.px(bk[0], bk[1], steel);
          c.px(bk[0] + 1, bk[1], steel);
        }
        surfLine(c, 0.55, 8.4, 1.05, 6.6, steel, 0.9);
      } else {
        surfLine(c, Math.PI - 1.2, 3.2, Math.PI + 1.2, 3.2, shade(col.base, -0.35), 0.8);
        surfLine(c, Math.PI - 1.1, 17, Math.PI + 1.1, 17, col.sh, 0.7);
        surfLine(c, Math.PI - 1.0, 21.8, Math.PI + 1.0, 21.8, col.lt, 0.7);
      }
      // shoulder shine
      for (const sg of SIDE) surfLine(c, sg * 1.0, 20.6, sg * 0.8, 18, col.lt, 0.7);
      done(c);
    }),
  sleeve: () => ({ len: 1, cuff: 'plain' }),
});

// ---- parka ---------------------------------------------------------------------------------------------------------

registerDrawer('outer.parka', {
  draw: (c, it, e) => {
    const col = it.t;
    const fur = tonesOf('#e9e4d6');
    // the hood sits behind the head; from the back it is the big shape between the shoulders
    e.part(c.back ? 12 : 0.1, () => hood(c, col, fur, { width: 7.4, rimW: 3 }));
    e.part(0.05, () => {
      const hem = -6.4;
      body(c, col, { hem, grow: 0.75, low: 0.9 });
      surfLine(c, -1.45, hem + 0.9, 1.45, hem + 0.9, col.sh, 0.9);
      if (!c.back) {
        surfLine(c, 0, 20, 0, hem + 1, col.sh, 1.0);
        surfLine(c, 0.1, 20, 0.1, hem + 1, col.lt, 1.0);
        for (const yy of [16.4, 11.6, 6.8, 2]) button(c, 0.0, yy, '#3a3a40', 1.1);
        // drawstring at the waist and big patch pockets
        surfLine(c, -1.3, 4.6, 1.3, 4.6, col.sh, 1.0);
        surfLine(c, -1.3, 3.8, 1.3, 3.8, col.lt, 1.0);
        for (const sg of SIDE) {
          const a = torsoPoint(c, sg * 0.55, 1.2, 1.0);
          const b = torsoPoint(c, sg * 1.1, 1.2, 1.0);
          const d = torsoPoint(c, sg * 0.55, -4.2, 1.0);
          const f = torsoPoint(c, sg * 1.1, -4.2, 1.0);
          if (a[2] > 0.2 && b[2] > 0.2) {
            c.line(a[0], a[1], b[0], b[1], col.lt);
            c.line(a[0], a[1], d[0], d[1], col.sh);
            c.line(b[0], b[1], f[0], f[1], col.sh);
            c.line(d[0], d[1], f[0], f[1], col.sh);
          }
        }
      } else {
        surfLine(c, Math.PI, 14, Math.PI, hem + 1, col.sh, 0.9);
        surfLine(c, Math.PI - 1.2, 4.6, Math.PI + 1.2, 4.6, col.sh, 0.9);
      }
      done(c);
    });
  },
  sleeve: () => ({ len: 1, cuff: 'rib' }),
});

// ---- double-breasted blazer ----------------------------------------------------------------------------------------

registerDrawer('outer.blazer_double', {
  draw: (c, it, e) =>
    e.part(0.05, () => {
      const col = it.t;
      const hem = -3.2;
      body(c, col, { hem, grow: 0.5, open: [9.6, 26, 0.03, 0.42] });
      surfLine(c, -1.45, hem + 0.8, 1.45, hem + 0.8, col.sh, 0.7);
      if (!c.back) {
        // peak lapels
        for (const sg of SIDE) {
          const poly = [
            c.P(sg * 5.6, levelY(c, 22.6), c.rig.bz + 1.4),
            c.P(sg * 2.6, levelY(c, 24), c.rig.bz + 3.0),
            c.P(sg * 0.8, levelY(c, 10), c.rig.bz + 5.9),
            c.P(sg * 4.2, levelY(c, 11.4), c.rig.bz + 5.6),
            c.P(sg * 7.2, levelY(c, 17.4), c.rig.bz + 4.0),
          ].map((p) => [p[0], p[1]] as P2);
          AUX.clear();
          AUX.poly(poly);
          c.paint(AUX, tonesOf(shade(col.base, 0.1)), { lw: 1, sw: 2 });
          AUX.clear();
        }
        // overlap edge, two columns of buttons
        surfLine(c, 0.5, 10, 0.5, hem + 1, col.sh, 0.9);
        surfLine(c, 0.56, 10, 0.56, hem + 1, col.lt, 0.9);
        for (const yy of [8, 4.4, 0.8]) {
          button(c, -0.42, yy, '#d9c36a', 1.0);
          button(c, 0.42, yy, '#d9c36a', 1.0);
        }
        for (const sg of SIDE) surfLine(c, sg * 0.9, 4.4, sg * 1.2, 3.8, col.sh, 0.7);
        // pocket square
        const q = torsoPoint(c, -0.95, 12.4, 0.8);
        if (q[2] > 0.2) {
          c.px(q[0], q[1], WHITE);
          c.px(q[0] + 1, q[1], '#cfc9bd');
          c.px(q[0] + 1, q[1] - 1, '#e04848');
        }
      } else {
        surfLine(c, Math.PI, 20, Math.PI, hem + 2, col.sh, 0.7);
        surfLine(c, Math.PI - 0.5, 3, Math.PI - 0.45, hem + 0.6, col.sh, 0.7);
        surfLine(c, Math.PI - 1.0, 21.4, Math.PI + 1.0, 21.4, col.lt, 0.7);
      }
      done(c);
    }),
  sleeve: () => ({ len: 1, cuff: 'plain' }),
});

// ---- raincoat ------------------------------------------------------------------------------------------------------

registerDrawer('outer.raincoat', {
  draw: (c, it, e) => {
    const col = it.t;
    e.part(c.back ? 12 : 0.1, () => hood(c, col, tonesOf(shade(col.base, 0.1)), { width: 7.0, rimW: 2 }));
    e.part(0.05, () => {
      const hem = -5.4;
      body(c, col, { hem, grow: 0.7, low: 0.85 });
      surfLine(c, -1.45, hem + 0.8, 1.45, hem + 0.8, col.sh, 0.8);
      if (!c.back) {
        surfLine(c, 0, 20, 0, hem + 1, col.sh, 1.0);
        for (const yy of [17, 12.6, 8.2, 3.8, -0.6]) {
          const p = torsoPoint(c, 0, yy, 1.1);
          if (p[2] > 0.3) {
            c.px(p[0], p[1], '#e9e4d6');
            c.px(p[0] + 1, p[1] + 1, col.sh);
          }
        }
        for (const sg of SIDE) {
          const a = torsoPoint(c, sg * 0.5, 2.8, 1.0);
          const b = torsoPoint(c, sg * 1.1, 2.8, 1.0);
          if (a[2] > 0.2 && b[2] > 0.2) {
            c.line(a[0], a[1], b[0], b[1], col.lt);
            c.line(a[0], a[1] + 1, b[0], b[1] + 1, col.sh);
          }
        }
        // glossy streak on the shoulder
        for (const sg of SIDE) surfLine(c, sg * 0.95, 19.4, sg * 1.1, 14.6, mix(col.lt, WHITE, 0.4), 0.8);
      } else {
        surfLine(c, Math.PI - 1.2, 12, Math.PI + 1.2, 12, col.sh, 0.8);
        surfLine(c, Math.PI, 12, Math.PI, hem + 1, col.sh, 0.8);
      }
      done(c);
    });
  },
  sleeve: () => ({ len: 1, cuff: 'rib' }),
});

// ---- lab coat ------------------------------------------------------------------------------------------------------

registerDrawer('outer.labcoat', {
  draw: (c, it, e) =>
    e.part(0.05, () => {
      const col = it.t;
      const hem = -8.2;
      body(c, col, { hem, grow: 0.6, low: 0.8 });
      surfLine(c, -1.45, hem + 0.8, 1.45, hem + 0.8, col.sh, 0.8);
      if (!c.back) {
        surfLine(c, 0, 21, 0, hem + 1, col.sh, 0.9);
        for (const yy of [14.6, 8.4, 2.2, -3.4]) button(c, 0.0, yy, '#b8bcc8', 1.0);
        flaps(c, tonesOf(shade(col.base, 0.06)), 16.6);
        // breast pocket with a pen, and two patch pockets at the hips
        const a = torsoPoint(c, 0.5, 15.6, 0.9);
        const b = torsoPoint(c, 1.0, 15.6, 0.9);
        const d = torsoPoint(c, 0.5, 11.8, 0.9);
        const f = torsoPoint(c, 1.0, 11.8, 0.9);
        if (a[2] > 0.2 && b[2] > 0.2) {
          c.line(a[0], a[1], b[0], b[1], col.sh);
          c.line(d[0], d[1], f[0], f[1], col.sh);
          c.line(a[0], a[1], d[0], d[1], col.sh);
          c.line(b[0], b[1], f[0], f[1], col.sh);
          c.px(a[0] + 2, a[1] - 1, '#3d82d6');
          c.px(a[0] + 2, a[1], '#3d82d6');
        }
        for (const sg of SIDE) {
          const g0 = torsoPoint(c, sg * 0.5, 0.4, 0.9);
          const g1 = torsoPoint(c, sg * 1.1, 0.4, 0.9);
          const g2 = torsoPoint(c, sg * 0.5, -4.8, 0.9);
          const g3 = torsoPoint(c, sg * 1.1, -4.8, 0.9);
          if (g0[2] > 0.2 && g1[2] > 0.2) {
            c.line(g0[0], g0[1], g1[0], g1[1], col.sh);
            c.line(g0[0], g0[1], g2[0], g2[1], col.sh);
            c.line(g1[0], g1[1], g3[0], g3[1], col.sh);
            c.line(g2[0], g2[1], g3[0], g3[1], col.sh);
          }
        }
      } else {
        surfLine(c, Math.PI, 20, Math.PI, hem + 1, col.sh, 0.8);
        surfLine(c, Math.PI - 1.0, 21.6, Math.PI + 1.0, 21.6, col.lt, 0.8);
        surfLine(c, Math.PI - 1.2, 8, Math.PI + 1.2, 8, col.sh, 0.8);
      }
      done(c);
    }),
  sleeve: () => ({ len: 1, cuff: 'plain' }),
});

// ---- puffer jacket -------------------------------------------------------------------------------------------------

const baffles = (col: Tones) => (_x: number, y: number, tone: 0 | 1 | 2): string | undefined => {
  const k = ((y % 5) + 5) % 5;
  if (k === 0) return tone === 2 ? col.ol : col.sh;
  if (k === 1 && tone !== 2) return col.lt;
  return undefined;
};

registerDrawer('outer.puffer', {
  draw: (c, it, e) =>
    e.part(0.05, () => {
      const col = it.t;
      const hem = -3.8;
      body(c, col, { hem, grow: 0.95, low: 1.0, deco: baffles(col) });
      if (!c.back) {
        surfLine(c, 0, 21.6, 0, hem + 0.6, '#2a2a34', 1.2);
        surfLine(c, 0.09, 21.6, 0.09, hem + 0.6, '#c9ccd4', 1.2);
        const pull = torsoPoint(c, 0.09, 13, 1.2);
        if (pull[2] > 0.3) {
          c.px(pull[0], pull[1], '#8a8f9a');
          c.px(pull[0], pull[1] + 1, '#8a8f9a');
        }
        // zip pockets
        for (const sg of SIDE) surfLine(c, sg * 0.55, 4.6, sg * 0.9, 1.2, '#2a2a34', 1.1);
      }
      standCollar(c, col, 22.8, 1.8);
      done(c);
    }),
  sleeve: (it) => ({ len: 1, cuff: 'rib', deco: baffles(it.t) }),
});

void (null as unknown as Resolved);
