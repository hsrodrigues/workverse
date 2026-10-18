import { mix, shade } from '../../pixel';
import {
  AUX,
  HEAD_RX,
  HEAD_RY,
  MAIN,
  SIDE,
  armDepth,
  facePoint,
  headCenter,
  levelY,
  limbPt,
  surfLine,
  torsoPoint,
  type Ctx2,
  type P2,
  type Resolved,
} from '../engine';
import { tonesOf } from '../recolor';
import { registerDrawer } from '../registry';

/** Hats, AR glasses, backpack and wrist gear: the accessories that need their own geometry. */

// ---- brimmed hats ------------------------------------------------------------------------------------------------

function brimmedHat(c: Ctx2, it: Resolved, kind: 'fedora' | 'bucket') {
  const [cx, cy] = headCenter(c);
  const col = it.t;
  const fedora = kind === 'fedora';
  const by = cy + (fedora ? -9.2 : -7.4);

  // brim
  MAIN.clear();
  MAIN.ellipse(cx, by, fedora ? 18.6 : 17.4, fedora ? 5.2 : 4.9);
  c.paint(MAIN, tonesOf(shade(col.base, -0.08)), { lw: 2, sw: 3 });
  if (fedora) {
    // upturned edge catches the light on the left, shades on the right
    for (let a = 0; a < 6.28; a += 0.2) {
      const x = cx + Math.cos(a) * 17.6;
      const y = by + Math.sin(a) * 4.3;
      if (Math.cos(a) < -0.4) c.px(x, y, col.lt);
    }
  } else {
    // stitch rows follow the droopy brim
    for (let a = 0; a < 6.28; a += 0.24) {
      c.px(cx + Math.cos(a) * 14.6, by + Math.sin(a) * 3.2, col.sh);
    }
  }
  MAIN.clear();
  c.clip = null;

  // crown
  MAIN.clear();
  if (fedora) {
    MAIN.ellipse(cx, cy - 14.6, 12.6, 7.4);
    for (let y = Math.floor(cy - 14.6); y <= Math.floor(by - 0.5); y++) for (let x = Math.round(cx - 12.4); x <= Math.round(cx + 12.4); x++) MAIN.set(x, y);
  } else {
    MAIN.ellipse(cx, cy - 13.2, 12.2, 6.6);
    for (let y = Math.floor(cy - 13.2); y <= Math.floor(by - 0.5); y++) for (let x = Math.round(cx - 12); x <= Math.round(cx + 12); x++) MAIN.set(x, y);
  }
  c.paint(MAIN, col, { lw: 3, sw: 4 });
  // band
  const bandTop = Math.round(by - 3.4);
  const bandCol = fedora ? shade(col.base, -0.5) : col.sh;
  for (let y = bandTop; y <= bandTop + 2; y++) {
    for (let x = Math.round(cx - 13); x <= Math.round(cx + 13); x++) {
      if (!MAIN.has(x, y)) continue;
      c.px(x, y, y === bandTop ? mix(bandCol, '#ffffff', 0.12) : bandCol);
    }
  }
  if (fedora) {
    // pinched crown: two dents and a center crease
    c.px(cx - 6, cy - 19.6, col.sh);
    c.px(cx - 5, cy - 19.0, col.sh);
    c.px(cx + 6, cy - 19.6, col.sh);
    c.px(cx + 5, cy - 19.0, col.sh);
    for (let k = 0; k < 4; k++) c.px(cx, cy - 20.6 + k, col.sh);
    c.px(cx - 8, cy - 15, col.lt);
    c.px(cx - 8, cy - 14, col.lt);
    // feather-less pin on the band (the corporate look)
    c.px(cx + 8, bandTop + 1, '#d9c36a');
  } else {
    c.px(cx - 9, cy - 13, col.lt);
    c.px(cx - 9, cy - 12, col.lt);
    c.px(cx + 8, bandTop - 1, col.sh); // eyelets
    c.px(cx + 9, bandTop - 1, col.sh);
    c.px(cx - 9, bandTop - 1, '#1d1a24');
    c.px(cx - 8, bandTop - 1, '#1d1a24');
  }
  MAIN.clear();
  c.clip = null;
}

registerDrawer('acc.fedora', (c, it, e) => e.part(20.5, () => brimmedHat(c, it, 'fedora')));
registerDrawer('acc.bucket', (c, it, e) => e.part(20.5, () => brimmedHat(c, it, 'bucket')));

// ---- AR glasses --------------------------------------------------------------------------------------------------

registerDrawer('acc.ar', (c, it, e) =>
  e.part(20.5, () => {
    const [cx, cy] = headCenter(c);
    const frame = '#2b2f3a';
    if (!c.face) {
      for (const sg of SIDE) {
        const p = facePoint(c, cx, cy, sg * 1.25, -1.2);
        if (p.vis > -0.1) {
          c.px(p.x, p.y, frame);
          c.px(p.x, p.y - 1, it.hex);
        }
      }
      return;
    }
    const pts = SIDE.map((sg) => facePoint(c, cx, cy, sg * 0.5, -1.6)).filter((p) => p.vis > 0.1);
    if (pts.length === 0) return;
    const xa = Math.round(Math.min(...pts.map((p) => p.x)) - 4);
    const xb = Math.round(Math.max(...pts.map((p) => p.x)) + 4);
    const y0 = Math.round(pts[0].y - 4);
    const lens = tonesOf(it.hex);
    // one wide visor: dark frame, glowing lens in the accent color
    for (let y = 0; y < 7; y++) {
      for (let x = xa; x <= xb; x++) {
        const edge = y === 0 || y === 6 || x === xa || x === xb;
        const corner = (y === 0 || y === 6) && (x === xa || x === xb);
        if (corner) continue;
        c.px(x, y0 + y, edge ? frame : y < 3 ? lens.base : y < 5 ? lens.sh : mix(lens.sh, frame, 0.4));
      }
    }
    // reflections and a HUD tick
    c.px(xa + 2, y0 + 1, '#ffffff');
    c.px(xa + 3, y0 + 1, mix(lens.lt, '#ffffff', 0.6));
    c.px(xb - 2, y0 + 4, lens.lt);
    c.px(xb - 3, y0 + 4, lens.lt);
    // glowing temple tips
    for (const sg of SIDE) {
      const t = facePoint(c, cx, cy, sg * 1.2, -1.2);
      const q = facePoint(c, cx, cy, sg * 0.8, -1.6);
      if (t.vis > 0.02 && q.vis > 0.02) {
        c.line(q.x, q.y - 3, t.x, t.y - 3, frame);
        c.px(t.x, t.y - 3, it.hex);
      }
    }
  }),
);

// ---- backpack ----------------------------------------------------------------------------------------------------

registerDrawer('acc.backpack', (c, it, e) => {
  const col = it.t;
  const body = () => {
    const { rig } = c;
    const bz = rig.bz;
    const pt = (x: number, yo: number, z: number): P2 => {
      const p = c.P(x, levelY(c, yo), bz + z);
      return [p[0], p[1]];
    };
    // bag behind the torso: top rounded, a front pocket on the outer face
    const corners: P2[] = [];
    for (const z of [-5.2, -11.4]) {
      for (const [x, yo] of [
        [-7.6, 0.6],
        [7.6, 0.6],
        [-8, 15.6],
        [8, 15.6],
        [-5.8, 19.2],
        [5.8, 19.2],
      ] as const) {
        corners.push(pt(x, yo, z));
      }
    }
    MAIN.clear();
    MAIN.hull(corners);
    c.paint(MAIN, col, { lw: 2, sw: 4 });
    if (c.back) {
      // outer face towards the camera: pocket, zip and buckle
      const a = pt(-5.6, 9, -11.6);
      const b = pt(5.6, 9, -11.6);
      const d = pt(-5.6, 2.2, -11.6);
      const f = pt(5.6, 2.2, -11.6);
      c.line(a[0], a[1], b[0], b[1], col.sh);
      c.line(a[0], a[1] + 1, b[0], b[1] + 1, col.lt);
      c.line(a[0], a[1], d[0], d[1], col.sh);
      c.line(b[0], b[1], f[0], f[1], col.sh);
      c.line(d[0], d[1], f[0], f[1], col.sh);
      const top = pt(-6, 14.4, -11.6);
      const top2 = pt(6, 14.4, -11.6);
      c.line(top[0], top[1], top2[0], top2[1], col.sh);
      const hb = pt(0, 14.4, -11.8);
      c.px(hb[0], hb[1] + 1, '#d9c36a');
      c.px(hb[0] + 1, hb[1] + 1, '#d9c36a');
      c.px(hb[0] - 1, hb[1] - 1, col.sh);
      c.px(hb[0] + 2, hb[1] - 1, col.sh);
      c.px(hb[0] - 4, hb[1] + 9, col.lt);
    } else {
      // top handle visible over the shoulders
      const h0 = pt(-1.8, 19.6, -9);
      const h1 = pt(1.8, 19.6, -9);
      c.line(h0[0], h0[1] - 1, h1[0], h1[1] - 1, col.sh);
    }
    MAIN.clear();
    c.clip = null;
  };
  const straps = () => {
    // shoulder straps over the chest (seen from the front) with a chest buckle
    for (const sg of SIDE) {
      surfLine(c, sg * 1.0, 21.4, sg * 0.92, 9, col.sh, 0.9);
      surfLine(c, sg * 1.0 - sg * 0.05, 21.4, sg * 0.88, 9, col.base, 0.9);
    }
    const b = torsoPoint(c, 0, 13.4, 1.0);
    if (b[2] > 0.4) {
      surfLine(c, -0.9, 13.4, 0.9, 13.4, col.sh, 1.0);
      c.px(b[0], b[1], '#d9c36a');
      c.px(b[0], b[1] - 1, '#d9c36a');
    }
  };
  e.part(c.back ? 5 : -12, body);
  if (!c.back) e.part(0.12, straps);
});

// ---- wrist gear ---------------------------------------------------------------------------------------------------

function wristWatch(c: Ctx2, it: Resolved) {
  const { rig } = c;
  const i = 1 as const; // the wearer's left wrist (screen right when facing the camera)
  const el = c.Pv(rig.elbow[i]);
  const wr = c.Pv(rig.wrist[i]);
  const elS: P2 = [el[0], el[1]];
  const wrS: P2 = [wr[0], wr[1]];
  const smart = it.item.params?.variant === 'smart';
  const strap = it.t;
  // strap across the forearm just above the hand
  const a = limbPt(elS, wrS, 0.97, -1, 2.9);
  const b = limbPt(elS, wrS, 0.97, 1, 2.9);
  const a2 = limbPt(elS, wrS, 0.86, -1, 2.9);
  const b2 = limbPt(elS, wrS, 0.86, 1, 2.9);
  c.line(a[0], a[1], b[0], b[1], strap.base);
  c.line(a2[0], a2[1], b2[0], b2[1], strap.base);
  c.px(a[0], a[1], strap.sh);
  c.px(a2[0], a2[1], strap.sh);
  c.px(b[0], b[1], strap.lt);
  c.px(b2[0], b2[1], strap.lt);
  // case on the outside of the wrist
  const m = limbPt(elS, wrS, 0.92, 0, 0);
  const face = smart ? '#10131c' : '#f4f1ea';
  const bezel = smart ? '#3a4152' : '#c9b25a';
  if (c.back) {
    // seen from the back: case back and crown only
    c.px(m[0], m[1], bezel);
    c.px(m[0] + 1, m[1], mix(bezel, '#000000', 0.3));
    return;
  }
  for (let yy = -1; yy <= 1; yy++) for (let xx = -1; xx <= 1; xx++) c.px(m[0] + xx, m[1] + yy, bezel);
  c.px(m[0], m[1], face);
  if (smart) {
    c.px(m[0] - 1, m[1] - 1, '#10131c');
    c.px(m[0] + 1, m[1] + 1, '#10131c');
    c.px(m[0] - 1, m[1], '#58d0ff');
    c.px(m[0], m[1], '#58d0ff');
    c.px(m[0], m[1] - 1, '#58d0ff');
  } else {
    c.px(m[0] + 1, m[1], '#8a2616'); // hands
    c.px(m[0] - 1, m[1] - 1, '#ffffff');
  }
}

registerDrawer('acc.watch', (c, it, e) => e.part(armDepth(c, 1) + 0.02, () => wristWatch(c, it)));

void AUX;
void HEAD_RX;
void HEAD_RY;
