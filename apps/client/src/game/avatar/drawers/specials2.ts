import { mix, shade } from '../../pixel';
import { HEAD_RX, HEAD_RY, MAIN, SIDE, armDepth, facePoint, headCenter, torsoPoint, v3, vAdd, vNorm, vSub, type Ctx2, type P2, type Resolved, type Rig } from '../engine';
import { tonesOf, type Tones } from '../recolor';
import { registerDrawer } from '../registry';

/**
 * Special wearables: head pieces (cat ears, horns, hard hat, halo, crown), gamer headset, back pieces (cape, wings, cat tail)
 * and the aura. They follow the head/torso anchors of the rig, so all four views and every pose use the same description.
 */

const WHITE = '#f4f1ea';
const GOLD = tonesOf('#e3b03a');

function done(c: Ctx2) {
  MAIN.clear();
  c.clip = null;
}

// ---- head pieces -------------------------------------------------------------------------------------------------------------

function catEars(c: Ctx2, it: Resolved, horns: boolean) {
  const [cx, cy] = headCenter(c);
  const col = it.t;
  // thin band over the crown, hidden under the hair line from the front
  for (let n = -22; n <= 22; n++) {
    const p = facePoint(c, cx, cy, (n / 22) * 1.35, 11.6);
    if (p.vis < 0.03) continue;
    const x = cx + (p.x - cx) * ((HEAD_RX + 1.2) / HEAD_RX);
    c.px(x, p.y - 1, col.lt);
    c.px(x, p.y, col.base);
    c.px(x, p.y + 1, col.sh);
  }
  for (const sg of SIDE) {
    const b = facePoint(c, cx, cy, sg * (horns ? 0.7 : 0.95), 11.4);
    if (b.vis < -0.25) continue;
    const w = (horns ? 3 : 10) * (0.62 + 0.38 * Math.max(0, b.vis));
    const bx = cx + (b.x - cx) * ((HEAD_RX + 1.2) / HEAD_RX);
    const by = b.y - 1;
    MAIN.clear();
    if (horns) {
      // a curved horn: base thick, tip bending outward
      MAIN.capsule(bx, by + 1, bx + sg * 1.2, by - 5, 2.6, 1.6);
      MAIN.capsule(bx + sg * 1.2, by - 5, bx + sg * 3.4, by - 9.2, 1.7, 0.6);
      c.paint(MAIN, col, { lw: 1, sw: 2 });
      c.px(bx + sg * 3.4, by - 9.4, col.lt);
    } else {
      MAIN.poly([
        [bx - w / 2, by + 2],
        [bx + w / 2, by + 2],
        [bx + sg * 1.6, by - 12.6],
      ]);
      c.paint(MAIN, col, { lw: 1, sw: 2 });
      MAIN.clear();
      const pink = tonesOf('#f4a6c0');
      MAIN.poly([
        [bx - w / 3, by + 1],
        [bx + w / 3, by + 1],
        [bx + sg * 1.4, by - 8.2],
      ]);
      if (w > 3.5) c.paint(MAIN, pink, { lw: 1, sw: 1, outline: false });
    }
    done(c);
  }
}

function hardHat(c: Ctx2, it: Resolved) {
  const [cx, cy] = headCenter(c);
  const col = it.t;
  const by = cy - 9.4;
  MAIN.clear();
  MAIN.ellipse(cx, by, 15.6, 4.4);
  c.paint(MAIN, tonesOf(shade(col.base, -0.16)), { lw: 2, sw: 2 });
  MAIN.clear();
  MAIN.ellipse(cx, cy - 13.2, 13.2, 8.4);
  for (let y = Math.floor(cy - 13.2); y <= Math.floor(by - 0.5); y++) for (let x = Math.round(cx - 13); x <= Math.round(cx + 13); x++) MAIN.set(x, y);
  c.paint(MAIN, col, { lw: 3, sw: 4 });
  // central ridge, side ribs and a reflective band along the rim
  for (let y = Math.floor(cy - 21); y <= Math.floor(by - 1); y++) {
    if (!MAIN.has(cx, y)) continue;
    c.px(cx - 1, y, col.lt);
    c.px(cx, y, mix(col.base, col.lt, 0.5));
    c.px(cx + 1, y, col.sh);
  }
  for (const dx of [-6, 6]) for (let y = Math.floor(cy - 19 + Math.abs(dx) * 0.3); y <= Math.floor(by - 4); y++) if (MAIN.has(cx + dx, y)) c.px(cx + dx, y, col.sh);
  for (let x = Math.round(cx - 12); x <= Math.round(cx + 12); x++) {
    if (MAIN.has(x, Math.floor(by - 3))) c.px(x, Math.floor(by - 3), x % 4 === 0 ? '#c9ccd4' : '#e8ebf2');
  }
  if (c.face) {
    const vis = tonesOf(shade(col.base, -0.22));
    MAIN.clear();
    MAIN.ellipse(cx, by + 2.2, 10.4, 2.4);
    c.paint(MAIN, vis, { lw: 1, sw: 1 });
  }
  done(c);
}

function topHat(c: Ctx2, it: Resolved) {
  const [cx, cy] = headCenter(c);
  const col = it.t;
  const by = cy - 9.2;
  MAIN.clear();
  MAIN.ellipse(cx, by, 15.6, 4.6);
  c.paint(MAIN, tonesOf(shade(col.base, -0.1)), { lw: 2, sw: 3 });
  MAIN.clear();
  MAIN.ellipse(cx, cy - 23.6, 9.8, 3.4);
  for (let y = Math.floor(cy - 23.6); y <= Math.floor(by - 0.5); y++) for (let x = Math.round(cx - 9.8); x <= Math.round(cx + 9.8); x++) MAIN.set(x, y);
  c.paint(MAIN, col, { lw: 2, sw: 3 });
  // gold band, a small gold star, and a shine along the left side of the crown
  const gold = tonesOf('#d9b24a');
  for (let y = Math.round(by - 4.4); y <= Math.round(by - 1.6); y++) {
    for (let x = Math.round(cx - 10); x <= Math.round(cx + 10); x++) {
      if (!MAIN.has(x, y)) continue;
      c.px(x, y, y === Math.round(by - 4.4) ? gold.lt : y === Math.round(by - 1.6) ? gold.sh : gold.base);
    }
  }
  for (const [dx, dy] of [[0, -1], [-1, 0], [0, 0], [1, 0], [0, 1]] as const) c.px(cx + dx, Math.round(by - 3) + dy - (dy === 0 ? 0 : 0), dx === 0 && dy === 0 ? WHITE : '#fff3b8');
  for (let y = Math.round(cy - 22); y <= Math.round(by - 6); y++) c.px(cx - 7, y, col.lt);
  done(c);
}

function halo(c: Ctx2) {
  const [cx, cy] = headCenter(c);
  const ry = 3.4;
  const rx = 9.4;
  const y0 = cy - 24;
  for (let a = 0; a < Math.PI * 2; a += 0.09) {
    const x = cx + Math.cos(a) * rx;
    const y = y0 + Math.sin(a) * ry;
    const back = Math.sin(a) < 0;
    c.px(x, y - 1, back ? GOLD.base : mix(GOLD.lt, WHITE, 0.4));
    c.px(x, y, back ? GOLD.sh : GOLD.base);
    c.px(x, y + 1, GOLD.sh);
  }
  // soft glow above the ring and a pair of sparkles
  for (let a = 3.3; a < 6.1; a += 0.35) c.px(cx + Math.cos(a) * (rx + 2), y0 + Math.sin(a) * (ry + 2), mix('#fff3b8', '#e3b03a', 0.5));
  c.px(cx + rx + 3, y0 - 2, WHITE);
  c.px(cx + rx + 3, y0 - 3, '#fff3b8');
  c.px(cx + rx + 3, y0 - 1, '#fff3b8');
  c.px(cx + rx + 2, y0 - 2, '#fff3b8');
  c.px(cx + rx + 4, y0 - 2, '#fff3b8');
  done(c);
}

function crown(c: Ctx2) {
  const [cx, cy] = headCenter(c);
  const baseY = cy - 14.2;
  const spikes: [number, number][] = [[-9, 7.4], [-4.5, 5.2], [0, 9.2], [4.5, 5.2], [9, 7.4]];
  MAIN.clear();
  for (let x = -10; x <= 10; x++) {
    // sag of the rim seen from above, and the zigzag silhouette
    const sag = 1.6 * (1 - (x / 10.4) ** 2);
    let top = 3.4;
    for (const [sx, sh] of spikes) top = Math.max(top, sh - Math.abs(x - sx) * 1.1);
    for (let y = Math.floor(baseY + sag - top); y <= Math.floor(baseY + sag + 2.4); y++) MAIN.set(Math.round(cx + x), y);
  }
  c.paint(MAIN, GOLD, { lw: 2, sw: 3 });
  // jewels on the band and tips
  const band = Math.round(baseY + 1.4);
  for (const [dx, hex] of [[0, '#e04858'], [-5, '#3d82d6'], [5, '#3d82d6']] as const) {
    c.px(cx + dx, band, hex);
    c.px(cx + dx, band + 1, shade(hex, -0.35));
    c.px(cx + dx - 1, band, mix(hex, WHITE, 0.5));
  }
  for (const [sx, sh] of spikes) c.px(cx + sx, Math.floor(baseY + 1.6 - sh), WHITE);
  for (let x = -9; x <= 9; x++) c.px(cx + x, band - 1, x % 3 === 0 ? GOLD.lt : GOLD.base);
  done(c);
}

registerDrawer('sp.head_kit', (c, it, e) => {
  const shape = it.item.params?.shape;
  e.part(20.6, () => {
    if (shape === 'cat') catEars(c, it, false);
    else if (shape === 'horns') catEars(c, it, true);
    else if (shape === 'hardhat') hardHat(c, it);
    else if (shape === 'halo') halo(c);
    else if (shape === 'tophat') topHat(c, it);
    else crown(c);
  });
});

// ---- gamer headset ---------------------------------------------------------------------------------------------------------------

registerDrawer('sp.gamer_headset', (c, it, e) =>
  e.part(20.5, () => {
    const [cx, cy] = headCenter(c);
    const hc = c.rig.head;
    const band = '#2b2f3a';
    const glow = it.hex;
    const rx = HEAD_RX + 1.8;
    const ry = HEAD_RY + 2.6;
    const arc: [number, number, number][] = [];
    for (let n = 0; n <= 18; n++) {
      const a = Math.PI - (n / 18) * Math.PI;
      arc.push(c.P(Math.cos(a) * rx, hc[1] - 1 + Math.sin(a) * ry * 0.98, hc[2] - 0.5));
    }
    MAIN.clear();
    for (let i = 0; i + 1 < arc.length; i++) MAIN.capsule(arc[i][0], arc[i][1], arc[i + 1][0], arc[i + 1][1], 1.7, 1.7);
    c.paint(MAIN, tonesOf(band), { lw: 1, sw: 2 });
    MAIN.clear();
    c.clip = null;
    // RGB strip on the band
    for (let n = 3; n <= 15; n += 2) c.px(arc[n][0], arc[n][1], n % 4 === 3 ? glow : mix(glow, WHITE, 0.45));
    for (const sg of SIDE) {
      const cupP = c.P(sg * (HEAD_RX + 2), hc[1] - 1, hc[2] + 0.5);
      if (cupP[2] < -2.2) continue;
      MAIN.clear();
      const near = cupP[2] > 0 || Math.abs(c.sn) < 0.1;
      const w = near ? 4.2 : 3.2;
      MAIN.ellipse(cupP[0], cupP[1], w, 6);
      c.paint(MAIN, tonesOf(band), { lw: 2, sw: 3 });
      // glowing ring on the face of the cup
      MAIN.clear();
      MAIN.ellipse(cupP[0], cupP[1], Math.max(1.4, w - 1.8), 3.4);
      c.paint(MAIN, tonesOf(glow), { lw: 1, sw: 2, outline: false });
      c.px(cupP[0], cupP[1] - 1, mix(glow, WHITE, 0.6));
      MAIN.clear();
      c.clip = null;
      if (c.face && sg === -1 && cupP[2] > 0) {
        const m = facePoint(c, cx, cy, -0.72, -8.2);
        c.line(cupP[0], cupP[1] + 5, cupP[0] + 1, cupP[1] + 9, band);
        c.line(cupP[0] + 1, cupP[1] + 9, m.x + 1, m.y - 1, band);
        c.px(m.x + 1, m.y - 1, glow);
        c.px(m.x + 2, m.y - 1, '#1c1f27');
      }
    }
  }),
);

// ---- back pieces: cape, wings, tail ------------------------------------------------------------------------------------------

function bodyPt(c: Ctx2, x: number, y: number, z: number): P2 {
  const p = c.P(x, c.rig.hipY + y, c.rig.bz + z);
  return [p[0], p[1]];
}

function cape(c: Ctx2, it: Resolved) {
  const col = it.t;
  const sit = c.rig.sit;
  const hem = sit ? -1 : -15;
  MAIN.clear();
  MAIN.hull([
    bodyPt(c, -6.2, 21.4, -3.2),
    bodyPt(c, 6.2, 21.4, -3.2),
    bodyPt(c, -10.4, 5, -6.2),
    bodyPt(c, 10.4, 5, -6.2),
    bodyPt(c, -12.6, hem, sit ? -11 : -8.4),
    bodyPt(c, 12.6, hem, sit ? -11 : -8.4),
  ]);
  c.paint(MAIN, col, { lw: 2, sw: 4 });
  // folds and a lighter lining peeking at the hem
  for (const [x, hex] of [[-6, col.sh], [-2, col.lt], [3, col.sh], [7, col.lt]] as const) {
    const a = bodyPt(c, x * 1.0, 18, -4.6);
    const b = bodyPt(c, x * 1.5, hem + 2, sit ? -10.4 : -8);
    c.line(a[0], a[1], b[0], b[1], hex);
  }
  const l0 = bodyPt(c, -12, hem + 0.6, sit ? -11 : -8.4);
  const l1 = bodyPt(c, 12, hem + 0.6, sit ? -11 : -8.4);
  c.line(l0[0], l0[1], l1[0], l1[1], mix(col.base, WHITE, 0.4));
  if (it.item.params?.gold) {
    // golden trim: hem band, borders down both edges, a star emblem on the back
    const g = '#d9b24a';
    c.line(l0[0], l0[1] + 1, l1[0], l1[1] + 1, g);
    c.line(l0[0], l0[1], l1[0], l1[1], '#f2cf63');
    for (const sg of SIDE) {
      const a = bodyPt(c, sg * 6.2, 21, -3.2);
      const b = bodyPt(c, sg * 10.4, 5, -6.2);
      const d = bodyPt(c, sg * 12.6, hem, sit ? -11 : -8.4);
      c.line(a[0], a[1], b[0], b[1], g);
      c.line(b[0], b[1], d[0], d[1], g);
    }
    const s = bodyPt(c, 0, 11, sit ? -6 : -5.6);
    for (const [dx, dy] of [[0, -2], [0, -1], [-2, 0], [-1, 0], [0, 0], [1, 0], [2, 0], [-1, 1], [1, 1], [-1, 2], [1, 2]] as const) c.px(s[0] + dx, s[1] + dy, dx === 0 && dy === 0 ? WHITE : '#f2cf63');
  }
  done(c);
}

function wings(c: Ctx2, it: Resolved) {
  const col = it.t;
  const dark = tonesOf(shade(col.base, -0.12));
  for (const sg of SIDE) {
    // one fan of feathers per side: long primaries on the outside, short coverts near the shoulder blade
    const root = bodyPt(c, sg * 3.6, 14, -4.4);
    const tips: P2[] = [
      bodyPt(c, sg * 22, 31, -6),
      bodyPt(c, sg * 25, 24, -6),
      bodyPt(c, sg * 25, 16, -6),
      bodyPt(c, sg * 22, 9, -6),
      bodyPt(c, sg * 17, 4, -6),
    ];
    const upper = bodyPt(c, sg * 12, 27, -5.4);
    MAIN.clear();
    MAIN.hull([root, upper, ...tips, bodyPt(c, sg * 9, 6, -5)]);
    c.paint(MAIN, col, { lw: 2, sw: 3 });
    // feather separations
    for (const t of tips) c.line(root[0], root[1], t[0], t[1], dark.base);
    for (let k = 0; k + 1 < tips.length; k++) {
      const m: P2 = [(tips[k][0] + tips[k + 1][0]) / 2, (tips[k][1] + tips[k + 1][1]) / 2];
      c.px(m[0], m[1], col.lt);
      c.px(m[0], m[1] - 1, col.lt);
    }
    // shorter inner covert row
    const inner = bodyPt(c, sg * 11, 15, -5.4);
    MAIN.clear();
    MAIN.ellipse(inner[0], inner[1], 4, 4.8);
    c.paint(MAIN, tonesOf(mix(it.hex, WHITE, 0.2)), { lw: 1, sw: 2, outline: false });
    done(c);
  }
}

function tail(c: Ctx2, it: Resolved) {
  const col = it.t;
  const pts: P2[] = [
    bodyPt(c, 0.6, 3, -6.2),
    bodyPt(c, 3.2, 0, -10.6),
    bodyPt(c, 7.6, 2.4, -12.4),
    bodyPt(c, 10.6, 8.4, -12),
    bodyPt(c, 10, 15, -10.4),
  ];
  MAIN.clear();
  for (let i = 0; i + 1 < pts.length; i++) MAIN.capsule(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], i === 0 ? 2.4 : 2.7, i === pts.length - 2 ? 2.2 : 2.7);
  c.paint(MAIN, col, { lw: 1, sw: 2 });
  // fur ticks and a lighter tip
  for (let i = 1; i < pts.length; i++) c.px(pts[i][0] + 1, pts[i][1] - 1, col.lt);
  const tip = pts[pts.length - 1];
  MAIN.clear();
  MAIN.ellipse(tip[0], tip[1] - 0.6, 2.3, 2.2);
  c.paint(MAIN, tonesOf(mix(it.hex, WHITE, 0.55)), { lw: 1, sw: 1 });
  done(c);
}

registerDrawer('sp.back_kit', (c, it, e) => {
  const shape = it.item.params?.shape;
  // behind the body from the front, over it from behind (like the backpack)
  e.part(c.back ? 6 : -60, () => {
    if (shape === 'cape') cape(c, it);
    else if (shape === 'wings') wings(c, it);
    else tail(c, it);
  });
  if (shape === 'cape' && !c.back) {
    // front: a collar clasp joining the cape at the neck
    e.part(0.17, () => {
      const col = it.t;
      surfLine2(c, col);
      done(c);
    });
  }
});

function surfLine2(c: Ctx2, col: Tones) {
  const l = torsoPoint(c, -0.62, 21.4, 1.0);
  const r = torsoPoint(c, 0.62, 21.4, 1.0);
  c.line(l[0], l[1], r[0], r[1] + 1, col.sh);
  c.line(l[0], l[1] - 1, r[0], r[1], col.lt);
  for (const p of [l, r]) {
    c.px(p[0], p[1], '#e3b03a');
    c.px(p[0], p[1] + 1, '#b57a1e');
    c.px(p[0] + 1, p[1], '#fff3b8');
  }
}

// ---- aura ------------------------------------------------------------------------------------------------------------------------

registerDrawer('sp.aura', (c, it, e) =>
  e.part(-200, () => {
    const g = c.P(0, 0, 0);
    const t = tonesOf(it.hex);
    const bright = mix(it.hex, WHITE, 0.55);
    // two glowing rings on the floor, the far half is hidden by the body anyway
    for (const [rx, ry, hex] of [[17, 7.6, t.sh], [14, 6, t.base], [11, 4.6, t.lt]] as const) {
      for (let a = 0; a < Math.PI * 2; a += 0.05) c.px(g[0] + Math.cos(a) * rx, g[1] + 1 + Math.sin(a) * ry, hex);
    }
    for (let a = 0; a < Math.PI * 2; a += 0.12) c.px(g[0] + Math.cos(a) * 8, g[1] + 1 + Math.sin(a) * 3.2, mix(t.lt, WHITE, 0.4));
    // rising sparks: small crosses at fixed places around the body, brighter at the center
    const sparks: [number, number, number][] = [[-14, -8, 1], [15, -22, 1], [-12, -36, 0], [13, -44, 1], [-15, -52, 1], [9, -62, 0], [-7, -70, 1]];
    for (const [dx, dy, big] of sparks) {
      const x = g[0] + dx;
      const y = g[1] + dy;
      c.px(x, y, WHITE);
      c.px(x - 1, y, bright);
      c.px(x + 1, y, bright);
      c.px(x, y - 1, bright);
      c.px(x, y + 1, bright);
      if (big) {
        c.px(x, y - 2, t.lt);
        c.px(x, y + 2, t.lt);
        c.px(x - 2, y, t.lt);
        c.px(x + 2, y, t.lt);
      }
    }
    done(c);
  }),
);

// ---- held: scepter and trophy -------------------------------------------------------------------------------------------------

registerDrawer('sp.hand_kit', {
  hold: () => ({ side: 1, target: (rig: Rig) => v3(6.2, rig.hipY + 14.2, rig.bz + 9) }),
  draw: (c, it, e) => {
    const trophy = it.item.params?.shape === 'trophy';
    // the staff is tall: it is drawn over the head line (in front of the body) when seen from the front
    e.part(!trophy && !c.back ? 21 : armDepth(c, 1) + 0.02, () => {
      const { rig } = c;
      const wr = rig.wrist[1];
      const dir = vNorm(vSub(wr, rig.elbow[1]));
      const tip = c.Pv(vAdd(wr, [dir[0] * 3.4, dir[1] * 3.4, dir[2] * 3.4]));
      const hx = Math.round(tip[0]);
      const hy = Math.round(tip[1]);
      const GOLD_D = '#a87a1a';
      if (trophy) {
        // a cup on a stem and a base, with a loop handle on each side
        const x0 = hx - 4;
        const y0 = hy - 12;
        MAIN.clear();
        for (let y = 0; y < 6; y++) {
          const inset = y >= 4 ? y - 3 : 0;
          for (let x = inset; x < 8 - inset; x++) MAIN.set(x0 + x, y0 + y);
        }
        c.paint(MAIN, GOLD, { lw: 1, sw: 2 });
        c.clip = null;
        c.px(x0 + 1, y0 + 1, WHITE);
        c.px(x0 + 1, y0 + 2, GOLD.lt);
        c.px(x0 + 4, y0 + 2, GOLD_D);
        c.px(x0 + 3, y0 + 3, GOLD_D);
        c.px(x0 + 5, y0 + 3, GOLD_D);
        c.px(x0 + 4, y0 + 4, GOLD_D);
        for (const sg of SIDE) {
          const hxp = sg < 0 ? x0 - 1 : x0 + 8;
          c.px(hxp, y0 + 1, GOLD.base);
          c.px(hxp + sg, y0 + 2, GOLD_D);
          c.px(hxp + sg, y0 + 3, GOLD_D);
          c.px(hxp, y0 + 4, GOLD.sh);
        }
        c.px(x0 + 3, y0 + 6, GOLD.base);
        c.px(x0 + 4, y0 + 6, GOLD.sh);
        c.px(x0 + 3, y0 + 7, GOLD.base);
        c.px(x0 + 4, y0 + 7, GOLD.sh);
        for (let x = 1; x < 7; x++) {
          c.px(x0 + x, y0 + 8, x < 3 ? GOLD.lt : GOLD.base);
          c.px(x0 + x, y0 + 9, GOLD.sh);
        }
        done(c);
        return;
      }
      // royal staff: a long slim gold rod leaning outward (clear of the face), grip rings, a big golden orb with a red gem and a cross on top
      const topY = hy - 25;
      const lean = (y: number) => hx + Math.round((hy - y) * 0.3);
      for (let y = topY + 4; y <= hy + 6; y++) {
        c.px(lean(y), y, GOLD.lt);
        c.px(lean(y) + 1, y, GOLD.base);
        c.px(lean(y) + 2, y, GOLD.base);
        c.px(lean(y) + 3, y, GOLD.sh);
      }
      for (const y of [hy - 4, hy - 14]) {
        const x = lean(y);
        c.px(x - 1, y, GOLD.base);
        c.px(x + 4, y, GOLD_D);
        c.px(x, y, WHITE);
        c.px(x + 1, y, GOLD.lt);
        c.px(x + 2, y, GOLD.base);
        c.px(x + 3, y, GOLD.base);
      }
      const ox = lean(topY);
      MAIN.clear();
      MAIN.ellipse(ox + 0.5, topY, 4.4, 4.4);
      c.paint(MAIN, GOLD, { lw: 2, sw: 3 });
      c.clip = null;
      for (let x = -3; x <= 4; x++) {
        c.px(ox + x, topY + 2, GOLD_D);
        c.px(ox + x, topY - 2, GOLD_D);
      }
      c.px(ox, topY, '#e04858');
      c.px(ox + 1, topY, '#b02a45');
      c.px(ox, topY - 1, '#ff9aa8');
      c.px(ox + 1, topY + 1, '#7a1a30');
      c.px(ox - 2, topY - 3, WHITE);
      // cross above the orb
      for (let y = topY - 11; y <= topY - 5; y++) {
        c.px(ox, y, GOLD.lt);
        c.px(ox + 1, y, GOLD.sh);
      }
      for (const x of [-2, -1, 2, 3]) c.px(ox + x, topY - 9, x < 0 ? GOLD.lt : GOLD.sh);
      c.px(ox - 3, topY - 9, GOLD_D);
      c.px(ox + 4, topY - 9, GOLD_D);
      c.px(ox, topY - 12, WHITE);
      done(c);
    });
  },
});
