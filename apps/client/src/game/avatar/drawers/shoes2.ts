import { mix, shade } from '../../pixel';
import { MAIN, SIDE, drawShoe, v3, type Ctx2, type P2, type Resolved, type V3 } from '../engine';
import { tonesOf, type Tones } from '../recolor';
import { registerDrawer } from '../registry';

/**
 * More footwear: open shoes (sandals, flip-flops, heels), boots (chelsea, combat, rain) and flat shoes (slip-on, colorblock).
 * They use the same foot rig as `drawShoe` (heel, toe and ankle points that follow the leg pose), drawn on the leg's `shoe` layer.
 */

const WHITE = '#f4f1ea';

interface Foot {
  heel: P2;
  toe: P2;
  ankleTop: P2;
  rot: (dz: number, dy: number) => V3;
  along: (t: number, o: number) => P2;
  pv: (p: V3) => P2;
}

function foot(c: Ctx2, i: 0 | 1): Foot {
  const { rig } = c;
  const an = rig.ankle[i];
  const pitch = rig.pitch[i];
  const yaw = rig.toeYaw[i] * SIDE[i];
  const rot = (dz: number, dy: number): V3 => {
    const z = dz * Math.cos(pitch) - dy * Math.sin(pitch);
    const y = dy * Math.cos(pitch) + dz * Math.sin(pitch);
    return v3(an[0] + z * Math.sin(yaw), an[1] + y, an[2] + z * Math.cos(yaw));
  };
  const pv = (p: V3): P2 => {
    const q = c.Pv(p);
    return [q[0], q[1]];
  };
  const heel = pv(rot(-2.4, -2.6));
  const toe = pv(rot(5.4, -2.8));
  const ankleTop = pv(rot(-0.6, 1.8));
  const tip: P2 = [toe[0] - heel[0], toe[1] - heel[1]];
  const tl = Math.hypot(tip[0], tip[1]) || 1;
  const along = (t: number, o: number): P2 => [heel[0] + tip[0] * t + (-tip[1] / tl) * o, heel[1] + tip[1] * t + (tip[0] / tl) * o];
  return { heel, toe, ankleTop, rot, along, pv };
}

function paintCapsule(c: Ctx2, a: P2, b: P2, r0: number, r1: number, t: Tones, dy = 0, o: { lw?: number; sw?: number } = {}) {
  MAIN.clear();
  MAIN.capsule(a[0], a[1] + dy, b[0], b[1] + dy, r0, r1);
  c.paint(MAIN, t, { lw: o.lw ?? 2, sw: o.sw ?? 3 });
}

function finish(c: Ctx2) {
  c.clip = null;
  MAIN.clear();
}

// ---- open shoes ----------------------------------------------------------------------------------------------------------

function openShoe(c: Ctx2, i: 0 | 1, it: Resolved) {
  const f = foot(c, i);
  const v = it.item.params?.variant;
  const col = it.t;
  const skin = c.skin;
  if (v === 'heel') {
    // dark thin sole, upper at the toe box and heel counter, the instep shows skin, a stiletto under the heel
    const darkSole = tonesOf(shade(it.hex, -0.45));
    paintCapsule(c, f.heel, f.toe, 3.2, 2.6, darkSole, 1.4, { lw: 1, sw: 2 });
    paintCapsule(c, f.heel, f.toe, 3.3, 2.7, skin, -0.2);
    paintCapsule(c, f.heel, f.ankleTop, 3.0, 2.8, skin, -0.2);
    const toeBox = f.along(0.7, 0);
    paintCapsule(c, toeBox, f.toe, 3.0, 2.2, col, -0.2);
    const heelCup = f.along(0.12, 0);
    paintCapsule(c, f.heel, heelCup, 3.0, 3.0, col, -0.2);
    // ankle strap-less pump edge and shine
    c.px(toeBox[0] - 1, toeBox[1] - 3, col.lt);
    c.px(f.toe[0] - 1, f.toe[1] - 2, col.lt);
    c.px(f.heel[0] + 1, f.heel[1] - 3, col.sh);
    // stiletto
    const sx = Math.round(f.heel[0]);
    const sy = Math.round(f.heel[1] + 3);
    for (let k = 0; k < 3; k++) c.px(sx, sy + k, k === 2 ? darkSole.sh : darkSole.base);
    c.px(sx - 1, sy, darkSole.base);
    finish(c);
    return;
  }
  const flip = v === 'flip';
  const soleT = flip ? col : tonesOf(shade(it.hex, -0.1));
  paintCapsule(c, f.heel, f.toe, 3.6, 3.6, soleT, 1.6, { lw: 1, sw: 2 });
  // the bare foot on top of the sole
  paintCapsule(c, f.heel, f.toe, 3.2, 3.0, skin, -0.1);
  paintCapsule(c, f.heel, f.ankleTop, 3.0, 2.8, skin, -0.1);
  const strap = flip ? tonesOf(mix(it.hex, WHITE, 0.25)) : col;
  const line = (a: P2, b: P2, hex: string) => c.line(a[0], a[1], b[0], b[1], hex);
  if (flip) {
    // V strap from the toe post to both sides of the foot
    const post = f.along(0.82, 0);
    for (const sg of SIDE) {
      const side = f.along(0.42, sg * 2.8);
      line([post[0], post[1] - 1], [side[0], side[1] - 1], strap.base);
      line([post[0], post[1] - 2], [side[0], side[1] - 2], strap.lt);
    }
    c.px(post[0], post[1] - 1, strap.sh);
  } else {
    // two cross straps and an ankle strap
    for (const t of [0.34, 0.62]) {
      const a = f.along(t, -3);
      const b = f.along(t, 3);
      line([a[0], a[1] - 1], [b[0], b[1] - 1], strap.base);
      line([a[0], a[1] - 2], [b[0], b[1] - 2], strap.lt);
    }
    const a = f.along(0.04, -2.6);
    const b = f.along(0.04, 2.6);
    line([a[0], a[1] - 3], [b[0], b[1] - 3], strap.base);
    c.px(f.heel[0] + 2, f.heel[1] - 3, '#d9c36a');
  }
  finish(c);
}
registerDrawer('shoes.open', { draw: (c, it, e) => e.leg('shoe', (i) => openShoe(c, i, it)) });

// ---- boots ---------------------------------------------------------------------------------------------------------------

function bootShoe(c: Ctx2, i: 0 | 1, it: Resolved) {
  const f = foot(c, i);
  const v = it.item.params?.variant;
  const rain = v === 'rain';
  const combat = v === 'combat';
  const height = rain ? 8.6 : combat ? 8.2 : 5.4;
  const solePal = rain ? tonesOf('#1d1a24') : combat ? tonesOf('#17131a') : tonesOf('#241a18');
  const upper = rain ? it.t : it.t;
  paintCapsule(c, f.heel, f.toe, 3.7, 3.7, solePal, combat ? 2.2 : 1.6, { lw: 1, sw: 2 });
  MAIN.clear();
  MAIN.capsule(f.heel[0], f.heel[1] - 0.2, f.toe[0], f.toe[1] - 0.2, 3.6, 3.6);
  const high = f.pv(f.rot(-0.8, height));
  MAIN.capsule(f.ankleTop[0], f.ankleTop[1], high[0], high[1], rain ? 4.1 : 3.7, rain ? 4.3 : 3.9);
  c.paint(MAIN, upper, { lw: 2, sw: 3 });
  const lt = upper.lt;
  const dk = upper.sh;
  if (v === 'chelsea') {
    // elastic gusset on the side, pull tab behind, welt line
    const g0 = f.pv(f.rot(0.6, 2.2));
    const g1 = f.pv(f.rot(0.6, 4.8));
    c.line(g0[0] - 1, g0[1], g1[0] - 1, g1[1] - 1, '#2a2630');
    c.line(g0[0] + 1, g0[1], g1[0] + 1, g1[1] - 1, '#2a2630');
    c.px(g0[0], g0[1] - 2, '#4a4452');
    c.px(high[0] - 3, high[1] - 1, dk);
    c.px(high[0] - 3, high[1], lt);
    const w = f.along(0.5, -0.4);
    c.px(w[0], w[1] + 1, lt);
  } else if (combat) {
    // lace rows up the shaft, chunky sole edge, toe cap
    for (const yy of [1.8, 3.4, 5.0, 6.6]) {
      const p = f.pv(f.rot(0.2, yy));
      c.line(p[0] - 2, p[1], p[0] + 2, p[1], '#e9e4d6');
      c.px(p[0], p[1] + 1, '#8a8472');
    }
    const edge = f.along(0.5, 0);
    c.line(f.heel[0] - 3, f.heel[1] + 3, f.toe[0] + 3, f.toe[1] + 3, '#4a4452');
    c.px(edge[0], edge[1] + 3, '#6a6474');
    const tc = f.along(0.88, 0);
    c.line(tc[0] - 2, tc[1] - 2, tc[0] + 2, tc[1] - 2, lt);
    c.line(high[0] - 3, high[1], high[0] + 3, high[1], dk);
  } else {
    // rain boot: glossy streaks, a darker top band and a light sole
    c.line(high[0] - 3, high[1] + 1, high[0] + 3, high[1] + 1, dk);
    c.line(high[0] - 3, high[1], high[0] + 3, high[1], lt);
    const s0 = f.pv(f.rot(-0.4, 3.2));
    const s1 = f.pv(f.rot(-0.4, 7.2));
    c.line(s0[0] - 2, s0[1], s1[0] - 2, s1[1], mix(lt, WHITE, 0.55));
    const t = f.along(0.8, 0);
    c.px(t[0] - 1, t[1] - 3, mix(lt, WHITE, 0.55));
    c.px(t[0], t[1] - 3, lt);
    c.line(f.heel[0] - 3, f.heel[1] + 2, f.toe[0] + 3, f.toe[1] + 2, '#d8d2c2');
  }
  finish(c);
}
registerDrawer('shoes.boot_kit', { draw: (c, it, e) => e.leg('shoe', (i) => bootShoe(c, i, it)) });

// ---- flat shoes ----------------------------------------------------------------------------------------------------------

function flatShoe(c: Ctx2, i: 0 | 1, it: Resolved) {
  const f = foot(c, i);
  const block = it.item.params?.variant === 'block';
  const sole = tonesOf(WHITE);
  paintCapsule(c, f.heel, f.toe, 3.6, 3.6, sole, 1.5, { lw: 1, sw: 2 });
  MAIN.clear();
  MAIN.capsule(f.heel[0], f.heel[1] - 0.2, f.toe[0], f.toe[1] - 0.2, 3.6, 3.6);
  MAIN.capsule(f.heel[0], f.heel[1] - 0.2, f.ankleTop[0], f.ankleTop[1], 3.4, 3.2);
  c.paint(MAIN, it.t, { lw: 2, sw: 3 });
  if (block) {
    // retro panels: yellow toe cap, red heel tab, blue side stripe, laces
    const cap = tonesOf('#f0c93a');
    const tc = f.along(0.84, 0);
    MAIN.clear();
    MAIN.capsule(tc[0], tc[1] + 0.4, f.toe[0], f.toe[1] + 0.4, 2.8, 2.9);
    c.paint(MAIN, cap, { lw: 1, sw: 2 });
    const tab = tonesOf('#e04848');
    MAIN.clear();
    MAIN.capsule(f.heel[0], f.heel[1] - 0.6, f.along(0.14, 0)[0], f.along(0.14, 0)[1] - 0.6, 2.1, 2.1);
    c.paint(MAIN, tab, { lw: 1, sw: 2 });
    for (const t of [0.5, 0.62]) {
      const p = f.along(t, 0);
      c.line(p[0] - 1, p[1] - 3, p[0] + 1, p[1] - 3, WHITE);
    }
    const s0 = f.along(0.28, 1.2);
    const s1 = f.along(0.7, 1.2);
    c.line(s0[0], s0[1] - 1, s1[0], s1[1] - 1, '#2f6fd4');
  } else {
    // slip-on: elastic V at the throat, side stripe on the sole, rubber toe cap
    const a = f.along(0.38, -2);
    const b = f.along(0.38, 2);
    const m = f.along(0.5, 0);
    c.line(a[0], a[1] - 2, m[0], m[1] - 3, it.t.sh);
    c.line(b[0], b[1] - 2, m[0], m[1] - 3, it.t.sh);
    c.line(f.heel[0] - 2, f.heel[1] + 1, f.toe[0] + 2, f.toe[1] + 1, '#d9423a');
    const tc = f.along(0.88, 0);
    c.line(tc[0] - 2, tc[1] - 1, tc[0] + 2, tc[1] - 1, '#f4f1ea');
    c.px(f.along(0.15, 0)[0], f.heel[1] - 2, it.t.lt);
  }
  finish(c);
}
registerDrawer('shoes.flat_kit', { draw: (c, it, e) => e.leg('shoe', (i) => flatShoe(c, i, it)) });

// ---- staff dress shoes -----------------------------------------------------------------------------------------------------

registerDrawer('staff.shoes', {
  draw: (c, it, e) =>
    e.leg('shoe', (i) => {
      drawShoe(c, i, it);
      const f = foot(c, i);
      const gold = '#d9b24a';
      // gold toe cap, a buckle on the instep and a gold heel edge
      const tc = f.along(0.88, 0);
      c.line(tc[0] - 2, tc[1] - 2, tc[0] + 2, tc[1] - 2, gold);
      c.px(tc[0], tc[1] - 3, '#f2cf63');
      const b = f.along(0.5, -0.4);
      c.px(b[0] - 1, b[1] - 3, gold);
      c.px(b[0], b[1] - 3, '#f2cf63');
      c.px(b[0] + 1, b[1] - 3, gold);
      c.px(b[0], b[1] - 2, '#a87a1a');
      c.line(f.heel[0] - 2, f.heel[1] + 3, f.heel[0] + 1, f.heel[1] + 3, gold);
      c.clip = null;
    }),
});
