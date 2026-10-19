import { mix, shade } from '../../pixel';
import { AUX, MAIN, SIDE, armDepth, levelY, limbPt, surfLine, torsoHull, torsoPoint, type Ctx2, type P2, type Resolved } from '../engine';
import { tonesOf } from '../recolor';
import { registerDrawer } from '../registry';
import { body, button, done } from './outers2';
import { finish, foot, paintCapsule } from './shoes2';

/**
 * Feminine outer layers (fitted blazer, kimono, capelet, cropped jacket) and shoes (block heel, ballet flat, mary jane,
 * platform, heeled sandal, ankle boot with heel, knee-high boot, platform sneaker).
 */

const WHITE = '#f4f1ea';
const GOLD = '#d9b24a';

// ---- outer layers ---------------------------------------------------------------------------------------------------------------

registerDrawer('outer.blazer_fit', {
  draw: (c, it, e) =>
    e.part(0.05, () => {
      const col = it.t;
      const hem = -4.4;
      // nipped waist: the hull is slim, a flared peplum is added under the waist
      body(c, col, { hem, grow: 0.4, low: 1.5, open: [10.4, 26, 0.03, 0.4] });
      surfLine(c, -1.45, hem + 0.8, 1.45, hem + 0.8, col.sh, 0.9);
      surfLine(c, -1.45, 2.8, 1.45, 2.8, col.sh, 0.7);
      if (!c.back) {
        for (const sg of SIDE) {
          const pts: P2[] = [
            c.P(sg * 5.2, levelY(c, 22.6), c.rig.bz + 1.5),
            c.P(sg * 2.4, levelY(c, 24), c.rig.bz + 3.1),
            c.P(sg * 0.6, levelY(c, 11), c.rig.bz + 5.9),
            c.P(sg * 4.4, levelY(c, 12.4), c.rig.bz + 5.5),
            c.P(sg * 6.6, levelY(c, 18), c.rig.bz + 4.0),
          ].map((p) => [p[0], p[1]] as P2);
          AUX.clear();
          AUX.poly(pts);
          c.paint(AUX, tonesOf(shade(col.base, 0.12)), { lw: 1, sw: 2 });
          AUX.clear();
        }
        button(c, 0, 9.6, GOLD, 1.0);
        button(c, 0, 5.6, GOLD, 1.0);
        // bust and waist darts
        for (const sg of SIDE) {
          surfLine(c, sg * 0.62, 14.6, sg * 0.5, 8.6, col.sh, 0.7);
          surfLine(c, sg * 0.95, 6.8, sg * 0.85, 3.0, col.sh, 0.7);
        }
      } else {
        surfLine(c, Math.PI, 20, Math.PI, hem + 1.4, col.sh, 0.7);
        surfLine(c, Math.PI - 0.7, 10, Math.PI - 0.55, 3, col.sh, 0.7);
        surfLine(c, Math.PI + 0.7, 10, Math.PI + 0.55, 3, col.sh, 0.7);
        surfLine(c, Math.PI - 1.0, 21.4, Math.PI + 1.0, 21.4, col.lt, 0.7);
      }
      done(c);
    }),
  sleeve: () => ({ len: 1, cuff: 'plain' }),
});

registerDrawer('outer.kimono', {
  draw: (c, it, e) => {
    const col = it.t;
    e.part(0.05, () => {
      const hem = -9.2;
      body(c, col, { hem, grow: 0.6, low: 0.8, open: [hem - 1, 26, 0.3, 0.52] });
      const trim = tonesOf(mix(it.hex, WHITE, 0.45));
      if (!c.back) {
        // contrast bands along both front edges, and a sash at the waist
        for (const sg of SIDE) {
          for (let k = 0; k < 2; k++) surfLine(c, sg * (0.3 + k * 0.06), hem + 0.4, sg * (0.52 + k * 0.06), 23, k === 0 ? trim.lt : trim.base, 1.2);
          surfLine(c, sg * 0.28, hem + 0.4, sg * 0.5, 22.4, col.sh, 1.2);
        }
        surfLine(c, -1.4, 5.6, 1.4, 5.6, col.sh, 0.9);
        surfLine(c, -1.4, 4.6, 1.4, 4.6, trim.base, 0.9);
        surfLine(c, -1.4, 3.8, 1.4, 3.8, col.sh, 0.9);
      } else {
        surfLine(c, Math.PI, 21, Math.PI, hem + 1, col.sh, 0.8);
        surfLine(c, Math.PI - 1.2, 5.6, Math.PI + 1.2, 5.6, col.sh, 0.9);
        surfLine(c, Math.PI - 1.2, 4.6, Math.PI + 1.2, 4.6, trim.base, 0.9);
        // a large circle motif on the back
        for (let a = 0; a < 6.28; a += 0.3) {
          const p = torsoPoint(c, Math.PI + Math.cos(a) * 0.5, 14 + Math.sin(a) * 3.6, 0.8);
          if (p[2] > 0.3) c.px(p[0], p[1], trim.base);
        }
      }
      done(c);
    });
    // wide, flared sleeves: a bell around the forearm
    for (const i of [0, 1] as const) {
      e.part(armDepth(c, i) + 0.03, () => {
        const el = c.Pv(c.rig.elbow[i]);
        const wr = c.Pv(c.rig.wrist[i]);
        const elS: P2 = [el[0], el[1]];
        const wrS: P2 = [wr[0], wr[1]];
        const mid = limbPt(elS, wrS, 0.42, 0, 0);
        const end = limbPt(elS, wrS, 1.08, 0, 0);
        MAIN.clear();
        MAIN.capsule(mid[0], mid[1], end[0], end[1], 4.0, 5.8);
        c.paint(MAIN, col, { lw: 2, sw: 3 });
        const t = tonesOf(mix(it.hex, WHITE, 0.45));
        const a = limbPt(elS, wrS, 1.04, -1, 5.8);
        const b = limbPt(elS, wrS, 1.04, 1, 5.8);
        c.line(a[0], a[1], b[0], b[1], t.base);
        const a2 = limbPt(elS, wrS, 0.96, -1, 5.4);
        const b2 = limbPt(elS, wrS, 0.96, 1, 5.4);
        c.line(a2[0], a2[1], b2[0], b2[1], t.lt);
        done(c);
      });
    }
  },
  sleeve: () => ({ len: 1, cuff: 'plain' }),
});

registerDrawer('outer.capelet', {
  draw: (c, it, e) =>
    e.part(0.06, () => {
      const col = it.t;
      MAIN.clear();
      torsoHull(c, MAIN, 7.2, 23.4, 2.4, 2.1);
      if (!c.back) {
        AUX.clear();
        const l: P2[] = [];
        const r: P2[] = [];
        for (let n = 0; n <= 6; n++) {
          const yo = 7 + ((26 - 7) * n) / 6;
          const h = 0.04 + (0.34 * n) / 6;
          const a = torsoPoint(c, -h, yo, 2.6);
          const b = torsoPoint(c, h, yo, 2.6);
          l.push([a[0], a[1]]);
          r.push([b[0], b[1]]);
        }
        AUX.poly([...l, ...r.reverse()]);
        MAIN.sub(AUX);
        AUX.clear();
      }
      c.paint(MAIN, col, { lw: 2, sw: 4 });
      // scalloped hem and a collar band with a gold clasp
      for (let n = 0; n < 40; n++) {
        const psi = (n / 40) * Math.PI * 2;
        const p = torsoPoint(c, psi, 7.4 + (n % 2 ? 0 : 0.9), 2.4);
        if (p[2] > 0.1) c.px(p[0], p[1], n % 2 ? col.sh : col.lt);
      }
      surfLine(c, -1.45, 21.6, 1.45, 21.6, col.lt, 2.2);
      surfLine(c, -1.45, 20.6, 1.45, 20.6, col.sh, 2.2);
      if (!c.back) {
        for (const yy of [16.4, 12.2]) button(c, 0, yy, GOLD, 2.4);
        const k = torsoPoint(c, 0, 20.8, 2.6);
        if (k[2] > 0.3) {
          c.px(k[0], k[1], '#f2cf63');
          c.px(k[0] + 1, k[1], GOLD);
        }
      } else {
        surfLine(c, Math.PI, 21, Math.PI, 8.4, col.sh, 2.3);
      }
      done(c);
    }),
  sleeve: () => null,
});

registerDrawer('outer.crop_jacket', {
  draw: (c, it, e) =>
    e.part(0.05, () => {
      const col = it.t;
      const hem = 7.8;
      body(c, col, { hem, grow: 0.5, low: 0.6 });
      surfLine(c, -1.45, hem + 0.9, 1.45, hem + 0.9, col.sh, 0.7);
      surfLine(c, -1.45, hem + 1.9, 1.45, hem + 1.9, mix(col.sh, col.base, 0.5), 0.7);
      if (!c.back) {
        surfLine(c, 0, 21, 0, hem + 1.2, '#2a2a34', 0.8);
        surfLine(c, 0.09, 21, 0.09, hem + 1.2, GOLD, 0.8);
        const pull = torsoPoint(c, 0.09, 14, 0.9);
        if (pull[2] > 0.3) {
          c.px(pull[0], pull[1], '#f2cf63');
          c.px(pull[0], pull[1] + 1, GOLD);
        }
        // pointed collar flaps
        for (const sg of SIDE) {
          const a = c.P(sg * 4.8, levelY(c, 23.6), c.rig.bz + 2.2);
          const b = c.P(sg * 0.4, levelY(c, 17.4), c.rig.bz + 5.4);
          const m = c.P(sg * 0.3, levelY(c, 22.0), c.rig.bz + 4.6);
          AUX.clear();
          AUX.poly([[a[0], a[1]], [b[0], b[1]], [m[0], m[1]]]);
          c.paint(AUX, tonesOf(shade(col.base, 0.12)), { lw: 1, sw: 1 });
          AUX.clear();
        }
        for (const sg of SIDE) surfLine(c, sg * 0.55, 12.4, sg * 1.0, 11.4, col.sh, 0.8);
      } else {
        surfLine(c, Math.PI, 20, Math.PI, hem + 1.2, col.sh, 0.7);
        surfLine(c, Math.PI - 1.0, 21.6, Math.PI + 1.0, 21.6, col.lt, 0.7);
      }
      done(c);
    }),
  sleeve: () => ({ len: 1, cuff: 'rib' }),
});

// ---- shoes ----------------------------------------------------------------------------------------------------------------------

type Foot = ReturnType<typeof foot>;

function heelBlock(c: Ctx2, f: Foot, w: number, h: number, hex: string) {
  const t = tonesOf(hex);
  const x0 = Math.round(f.heel[0]) - Math.floor(w / 2);
  const y0 = Math.round(f.heel[1] + 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) c.px(x0 + x, y0 + y, x === 0 ? t.lt : x === w - 1 ? t.sh : t.base);
}

function pumpShoe(c: Ctx2, i: 0 | 1, it: Resolved) {
  const f = foot(c, i);
  const v = String(it.item.params?.variant);
  const col = it.t;
  const darkSole = tonesOf(shade(it.hex, -0.45));
  const skin = c.skin;
  if (v === 'ballet') {
    // flat slipper: covers the toes and sides, bare instep, a little bow at the toe
    paintCapsule(c, f.heel, f.toe, 3.3, 2.9, tonesOf(shade(it.hex, -0.3)), 1.2, { lw: 1, sw: 2 });
    paintCapsule(c, f.heel, f.toe, 3.3, 2.9, col, -0.2);
    const inst = f.along(0.4, 0);
    paintCapsule(c, f.along(0.1, 0), inst, 2.2, 2.2, skin, -1.2);
    const b = f.along(0.7, 0);
    c.px(b[0] - 1, b[1] - 3, col.lt);
    c.px(b[0] + 1, b[1] - 3, col.lt);
    c.px(b[0], b[1] - 3, col.sh);
    c.px(b[0] - 2, b[1] - 2, col.base);
    c.px(b[0] + 2, b[1] - 2, col.base);
    finish(c);
    return;
  }
  if (v === 'platform') {
    // chunky platform with a block heel
    const sole = tonesOf(shade(it.hex, -0.25));
    paintCapsule(c, f.heel, f.toe, 3.7, 3.7, sole, 3.2, { lw: 1, sw: 2 });
    paintCapsule(c, f.heel, f.toe, 3.7, 3.4, tonesOf(shade(it.hex, -0.1)), 1.6, { lw: 1, sw: 2 });
    paintCapsule(c, f.heel, f.toe, 3.3, 2.9, col, -0.2);
    paintCapsule(c, f.heel, f.ankleTop, 3.1, 2.8, col, -0.2);
    const t = f.along(0.8, 0);
    c.px(t[0] - 1, t[1] - 3, col.lt);
    c.px(f.heel[0] + 1, f.heel[1] - 3, col.sh);
    const st = f.along(0.04, 0);
    c.line(st[0] - 3, st[1] - 3, st[0] + 3, st[1] - 3, GOLD);
    finish(c);
    return;
  }
  // block heel / mary jane: pump with bare instep
  paintCapsule(c, f.heel, f.toe, 3.2, 2.7, darkSole, 1.4, { lw: 1, sw: 2 });
  paintCapsule(c, f.heel, f.toe, 3.3, 2.8, skin, -0.2);
  paintCapsule(c, f.heel, f.ankleTop, 3.0, 2.8, skin, -0.2);
  const mary = v === 'mary';
  paintCapsule(c, f.along(mary ? 0.42 : 0.64, 0), f.toe, 3.1, mary ? 2.9 : 2.4, col, -0.2);
  paintCapsule(c, f.heel, f.along(0.14, 0), 3.0, 3.0, col, -0.2);
  c.px(f.along(0.8, 0)[0] - 1, f.along(0.8, 0)[1] - 3, col.lt);
  c.px(f.heel[0] + 1, f.heel[1] - 3, col.sh);
  if (mary) {
    // ankle strap with a small buckle
    const a = f.along(0.3, -2.6);
    const b = f.along(0.3, 2.6);
    c.line(a[0], a[1] - 3, b[0], b[1] - 3, col.base);
    c.line(a[0], a[1] - 4, b[0], b[1] - 4, col.lt);
    c.px(b[0] - 1, b[1] - 3, GOLD);
    heelBlock(c, f, 3, 2, shade(it.hex, -0.45));
  } else {
    heelBlock(c, f, 3, 3, shade(it.hex, -0.45));
  }
  finish(c);
}
registerDrawer('shoes.pump_kit', { draw: (c, it, e) => e.leg('shoe', (i) => pumpShoe(c, i, it)) });

function heeledSandal(c: Ctx2, i: 0 | 1, it: Resolved) {
  const f = foot(c, i);
  const col = it.t;
  paintCapsule(c, f.heel, f.toe, 3.2, 3.0, tonesOf(shade(it.hex, -0.3)), 1.5, { lw: 1, sw: 2 });
  paintCapsule(c, f.heel, f.toe, 3.2, 3.0, c.skin, -0.1);
  paintCapsule(c, f.heel, f.ankleTop, 3.0, 2.8, c.skin, -0.1);
  // thin straps: across the toes, across the instep, around the ankle
  for (const [t, o] of [[0.78, 0], [0.5, 0], [0.04, 0]] as const) {
    const a = f.along(t, -3 + o);
    const b = f.along(t, 3 + o);
    c.line(a[0], a[1] - (t < 0.1 ? 3 : 1), b[0], b[1] - (t < 0.1 ? 3 : 1), col.base);
    c.line(a[0], a[1] - (t < 0.1 ? 4 : 2), b[0], b[1] - (t < 0.1 ? 4 : 2), col.lt);
  }
  c.px(f.heel[0] + 2, f.heel[1] - 3, GOLD);
  heelBlock(c, f, 2, 4, shade(it.hex, -0.4));
  finish(c);
}
registerDrawer('shoes.sandal_heel', { draw: (c, it, e) => e.leg('shoe', (i) => heeledSandal(c, i, it)) });

function tallBoot(c: Ctx2, i: 0 | 1, it: Resolved) {
  const f = foot(c, i);
  const knee = it.item.params?.variant === 'knee';
  const col = it.t;
  const height = knee ? 12.8 : 5.8;
  const sole = tonesOf(shade(it.hex, -0.55));
  paintCapsule(c, f.heel, f.toe, 3.5, 3.2, sole, 1.5, { lw: 1, sw: 2 });
  MAIN.clear();
  MAIN.capsule(f.heel[0], f.heel[1] - 0.2, f.toe[0], f.toe[1] - 0.2, 3.5, 3.0);
  const high = f.pv(f.rot(-0.8, height));
  MAIN.capsule(f.ankleTop[0], f.ankleTop[1], high[0], high[1], knee ? 3.8 : 3.6, knee ? 4.2 : 3.8);
  c.paint(MAIN, col, { lw: 2, sw: 3 });
  c.clip = null;
  // leather shine, a side zipper and the top edge
  const s0 = f.pv(f.rot(-0.4, 3));
  const s1 = f.pv(f.rot(-0.4, height - 1.2));
  c.line(s0[0] - 2, s0[1], s1[0] - 2, s1[1], col.lt);
  c.line(s0[0] + 2, s0[1] + 1, s1[0] + 2, s1[1], '#8a8f9a');
  c.line(high[0] - 3, high[1], high[0] + 3, high[1], col.lt);
  c.line(high[0] - 3, high[1] + 1, high[0] + 3, high[1] + 1, col.sh);
  if (knee) c.px(high[0] + 3, high[1] + 3, GOLD);
  const t = f.along(0.82, 0);
  c.px(t[0] - 1, t[1] - 3, col.lt);
  heelBlock(c, f, 3, knee ? 3 : 3, shade(it.hex, -0.55));
  finish(c);
}
registerDrawer('shoes.boot_heel', { draw: (c, it, e) => e.leg('shoe', (i) => tallBoot(c, i, it)) });

function platformSneaker(c: Ctx2, i: 0 | 1, it: Resolved) {
  const f = foot(c, i);
  const col = it.t;
  const sole = tonesOf(WHITE);
  paintCapsule(c, f.heel, f.toe, 3.7, 3.7, tonesOf('#d8d2c2'), 3.0, { lw: 1, sw: 2 });
  paintCapsule(c, f.heel, f.toe, 3.7, 3.7, sole, 1.6, { lw: 1, sw: 2 });
  MAIN.clear();
  MAIN.capsule(f.heel[0], f.heel[1] - 0.2, f.toe[0], f.toe[1] - 0.2, 3.5, 3.5);
  MAIN.capsule(f.heel[0], f.heel[1] - 0.2, f.ankleTop[0], f.ankleTop[1], 3.4, 3.2);
  c.paint(MAIN, col, { lw: 2, sw: 3 });
  c.clip = null;
  // white toe cap, laces with a pink bow, a heart patch on the heel
  const tc = f.along(0.88, 0);
  c.line(tc[0] - 2, tc[1] - 2, tc[0] + 2, tc[1] - 2, WHITE);
  c.line(tc[0] - 2, tc[1] - 1, tc[0] + 2, tc[1] - 1, '#cfc9bd');
  for (const t of [0.34, 0.46, 0.58]) {
    const p = f.along(t, -0.3);
    c.px(p[0], p[1] - 1, WHITE);
    c.px(p[0] + 1, p[1] - 1, '#cfc9bd');
  }
  const bw = f.along(0.24, 0);
  c.px(bw[0] - 1, bw[1] - 3, '#f4a6c0');
  c.px(bw[0] + 1, bw[1] - 3, '#f4a6c0');
  c.px(bw[0], bw[1] - 3, '#c8607e');
  c.px(f.heel[0] + 1, f.heel[1] - 2, '#f4a6c0');
  finish(c);
}
registerDrawer('shoes.sneaker_fem', { draw: (c, it, e) => e.leg('shoe', (i) => platformSneaker(c, i, it)) });

void MAIN;
void AUX;
void torsoHull;
