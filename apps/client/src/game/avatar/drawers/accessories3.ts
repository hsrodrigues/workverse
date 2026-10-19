import { mix, shade } from '../../pixel';
import {
  AUX,
  HEAD_RX,
  MAIN,
  SIDE,
  armDepth,
  earMask,
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
import { tonesOf, type Tones } from '../recolor';
import { registerDrawer } from '../registry';

/**
 * More accessories: hats (straw, beret, headband, hair bow), eyewear shapes, earrings and earbuds, neck pieces
 * (scarf, tie, bow tie, necklace), wrist pieces and a crossbody bag. Each drawer reads `params.shape`.
 */

const INK = '#1d1a24';
const WHITE = '#f4f1ea';

function done(c: Ctx2) {
  MAIN.clear();
  AUX.clear();
  c.clip = null;
}

// ---- hats ------------------------------------------------------------------------------------------------------------------

function strawHat(c: Ctx2, it: Resolved) {
  const [cx, cy] = headCenter(c);
  const col = it.t;
  const by = cy - 8.4;
  const weave = (x: number, y: number, tone: 0 | 1 | 2) => ((x + y * 2) % 5 === 0 ? (tone === 2 ? col.ol : col.sh) : (x - y) % 7 === 0 && tone !== 2 ? col.lt : undefined);
  MAIN.clear();
  MAIN.ellipse(cx, by, 21, 5.8);
  c.paint(MAIN, tonesOf(shade(col.base, -0.06)), { lw: 2, sw: 3, deco: weave });
  // crown
  MAIN.clear();
  MAIN.ellipse(cx, cy - 13.6, 11.8, 6.4);
  for (let y = Math.floor(cy - 13.6); y <= Math.floor(by - 0.5); y++) for (let x = Math.round(cx - 11.6); x <= Math.round(cx + 11.6); x++) MAIN.set(x, y);
  c.paint(MAIN, col, { lw: 3, sw: 4, deco: weave });
  // ribbon with a small knot on the side
  const bandTop = Math.round(by - 3.2);
  const rib = '#b3361f';
  for (let y = bandTop; y <= bandTop + 2; y++) {
    for (let x = Math.round(cx - 12.6); x <= Math.round(cx + 12.6); x++) {
      if (!MAIN.has(x, y)) continue;
      c.px(x, y, y === bandTop ? mix(rib, WHITE, 0.2) : y === bandTop + 2 ? shade(rib, -0.35) : rib);
    }
  }
  c.px(cx + 8, bandTop + 3, rib);
  c.px(cx + 9, bandTop + 4, shade(rib, -0.3));
  c.px(cx + 7, bandTop + 4, shade(rib, -0.3));
  c.px(cx - 8, cy - 14, col.lt);
  c.px(cx - 8, cy - 13, col.lt);
  done(c);
}

function beret(c: Ctx2, it: Resolved) {
  const [cx, cy] = headCenter(c);
  const col = it.t;
  const by = cy - 9.6;
  MAIN.clear();
  // a wide flat disc leaning to one side, hugging the head at the forehead
  MAIN.ellipse(cx + 2.2, cy - 13.4, 16.2, 7.4);
  for (let y = Math.floor(cy - 13.4); y <= Math.floor(by); y++) for (let x = Math.round(cx - 12); x <= Math.round(cx + 12); x++) if (MAIN.has(x, y - 1) || y <= by - 2) MAIN.set(x, y);
  c.paint(MAIN, col, { lw: 3, sw: 4, deco: (x, y, tone) => (tone !== 2 && (x * 3 + y) % 9 === 0 ? col.sh : undefined) });
  // inner band edge and the little stalk
  for (let x = Math.round(cx - 12); x <= Math.round(cx + 12); x++) if (MAIN.has(x, Math.floor(by))) c.px(x, Math.floor(by), col.sh);
  c.px(cx + 3, cy - 21, col.sh);
  c.px(cx + 3, cy - 20, col.base);
  c.px(cx + 4, cy - 21, col.ol);
  c.px(cx - 6, cy - 17, col.lt);
  c.px(cx - 5, cy - 18, col.lt);
  done(c);
}

/** Band around the head at a latitude (dy above the head center), following the visible hemisphere. */
function headRing(c: Ctx2, cx: number, cy: number, dy: number, grow: number, rows: number, hexAt: (row: number) => string) {
  for (let n = -30; n <= 30; n++) {
    const a = (n / 30) * Math.PI;
    const p = facePoint(c, cx, cy, a, dy);
    if (p.vis < 0.03) continue;
    const x = cx + (p.x - cx) * ((HEAD_RX + grow) / HEAD_RX);
    for (let r = 0; r < rows; r++) c.px(x, p.y + r, hexAt(r));
  }
}

function headband(c: Ctx2, it: Resolved) {
  const [cx, cy] = headCenter(c);
  const col = it.t;
  headRing(c, cx, cy, 6.2, 1.5, 4, (r) => (r === 0 ? col.lt : r === 3 ? col.sh : col.base));
  // a small knot at the side
  const k = facePoint(c, cx, cy, 1.15, 5.2);
  if (k.vis > -0.1) {
    c.px(k.x, k.y - 2, col.lt);
    c.px(k.x + 1, k.y - 2, col.base);
    c.px(k.x, k.y + 1, col.sh);
    c.px(k.x + 1, k.y + 1, col.sh);
  }
  done(c);
}

function hairBow(c: Ctx2, it: Resolved) {
  const [cx, cy] = headCenter(c);
  const col = it.t;
  const p = facePoint(c, cx, cy, -0.62, 12.0);
  if (p.vis < -0.35) return;
  const x = Math.round(p.x);
  const y = Math.round(p.y - 5);
  for (const sg of SIDE) {
    MAIN.clear();
    MAIN.poly([
      [x, y],
      [x + sg * 7, y - 4],
      [x + sg * 7.5, y + 4.5],
    ]);
    c.paint(MAIN, col, { lw: 1, sw: 2 });
  }
  MAIN.clear();
  MAIN.ellipse(x + 0.5, y + 0.2, 2.2, 2.2);
  c.paint(MAIN, tonesOf(shade(col.base, -0.12)), { lw: 1, sw: 1 });
  done(c);
}

function pamela(c: Ctx2, it: Resolved) {
  const [cx, cy] = headCenter(c);
  const col = it.t;
  const by = cy - 8.6;
  const weave = (x: number, y: number, tone: 0 | 1 | 2) => ((x + y * 2) % 5 === 0 ? (tone === 2 ? col.ol : col.sh) : (x - y) % 7 === 0 && tone !== 2 ? col.lt : undefined);
  MAIN.clear();
  MAIN.ellipse(cx, by, 25.5, 6.8);
  c.paint(MAIN, tonesOf(shade(col.base, -0.05)), { lw: 2, sw: 3, deco: weave });
  MAIN.clear();
  MAIN.ellipse(cx, cy - 12.6, 10.6, 5.8);
  for (let y = Math.floor(cy - 12.6); y <= Math.floor(by - 0.5); y++) for (let x = Math.round(cx - 10.4); x <= Math.round(cx + 10.4); x++) MAIN.set(x, y);
  c.paint(MAIN, col, { lw: 3, sw: 4, deco: weave });
  // wide ribbon with a big bow on the side
  const rib = tonesOf('#e88aa8');
  const bandTop = Math.round(by - 3);
  for (let y = bandTop; y <= bandTop + 2; y++) for (let x = Math.round(cx - 11.4); x <= Math.round(cx + 11.4); x++) if (MAIN.has(x, y)) c.px(x, y, y === bandTop ? rib.lt : y === bandTop + 2 ? rib.sh : rib.base);
  const bx = cx + 9;
  const byy = bandTop + 1;
  for (const sg of [-1, 1]) {
    MAIN.clear();
    MAIN.poly([[bx, byy], [bx + sg * 6, byy - 3], [bx + sg * 6.5, byy + 4]]);
    c.paint(MAIN, rib, { lw: 1, sw: 1 });
  }
  c.clip = null;
  c.px(bx, byy, rib.sh);
  c.px(bx - 1, byy + 5, rib.base);
  c.px(bx + 1, byy + 6, rib.sh);
  done(c);
}

function tiara(c: Ctx2, it: Resolved) {
  const [cx, cy] = headCenter(c);
  const col = it.t;
  headRing(c, cx, cy, 10.2, 1.4, 2, (r) => (r === 0 ? col.lt : col.base));
  for (let k = -3; k <= 3; k++) {
    const p = facePoint(c, cx, cy, k * 0.3, 10.2);
    if (p.vis < 0.2) continue;
    const x = Math.round(cx + (p.x - cx) * ((HEAD_RX + 1.4) / HEAD_RX));
    const h = 4 - Math.abs(k) * 0.9;
    for (let y = 0; y < h; y++) c.px(x, p.y - 1 - y, y === 0 ? col.base : col.lt);
    c.px(x, p.y - 1 - Math.round(h), k === 0 ? '#e04858' : '#bfe6ff');
    if (k === 0) c.px(x, p.y - 2 - Math.round(h), WHITE);
  }
  done(c);
}

function flowerClip(c: Ctx2, it: Resolved) {
  const [cx, cy] = headCenter(c);
  const col = it.t;
  const p = facePoint(c, cx, cy, 1.05, 8.4);
  if (p.vis < -0.15) return;
  const x = Math.round(p.x + 1);
  const y = Math.round(p.y - 2);
  for (const [dx, dy] of [[0, -2], [-2, 0], [2, 0], [0, 2], [-1, -1], [1, -1], [-1, 1], [1, 1]] as const) c.px(x + dx, y + dy, Math.abs(dx) + Math.abs(dy) === 2 && dx !== 0 && dy !== 0 ? col.base : dy < 0 || dx < 0 ? col.lt : col.base);
  c.px(x, y, '#f0c93a');
  c.px(x + 3, y + 2, '#5fae6a');
  c.px(x + 4, y + 3, '#3f8a4f');
  c.px(x - 3, y + 3, '#5fae6a');
  done(c);
}

registerDrawer('acc.hat_kit', (c, it, e) => {
  const shape = it.item.params?.shape;
  e.part(20.5, () => {
    if (shape === 'straw') strawHat(c, it);
    else if (shape === 'beret') beret(c, it);
    else if (shape === 'headband') headband(c, it);
    else if (shape === 'pamela') pamela(c, it);
    else if (shape === 'tiara') tiara(c, it);
    else if (shape === 'clip') flowerClip(c, it);
    else hairBow(c, it);
  });
});

// ---- eyewear ---------------------------------------------------------------------------------------------------------------

registerDrawer('acc.eyewear_kit', (c, it, e) =>
  e.part(20.5, () => {
    const [cx, cy] = headCenter(c);
    const shape = String(it.item.params?.shape);
    const frame = it.hex;
    if (!c.face) {
      for (const sg of SIDE) {
        const p = facePoint(c, cx, cy, sg * 1.25, -1.2);
        if (p.vis > -0.1) c.px(p.x, p.y, frame);
      }
      return;
    }
    const sun = shape === 'aviator' || shape === 'roundsun';
    const h = shape === 'square' ? 8 : shape === 'cat' ? 7 : shape === 'oversized' ? 11 : 9;
    const pts: { x: number; y: number; w: number; sg: number }[] = [];
    for (const sg of SIDE) {
      const p = facePoint(c, cx, cy, sg * 0.4, -1.6);
      if (p.vis < 0.12) continue;
      pts.push({ x: p.x, y: p.y, w: Math.max(3, Math.round((shape === 'aviator' ? 9 : shape === 'oversized' ? 10.6 : 8.2) * p.vis)), sg });
    }
    const lensOf = (yy: number) => {
      if (shape === 'aviator') return yy < 3 ? '#6f8f6a' : yy < 6 ? '#4f6c52' : '#3a5440';
      if (shape === 'roundsun') return yy < 3 ? '#2a2f44' : '#171a28';
      if (shape === 'oversized') return yy < 4 ? '#7a5a48' : yy < 8 ? '#6a4a3a' : '#5a4030';
      if (shape === 'heart') return yy < 4 ? '#f8b4c8' : '#e88aa8';
      return yy > h - 3 ? '#b4d6f0' : '#cfe9ff';
    };
    for (const p of pts) {
      const x0 = Math.round(p.x - p.w / 2);
      const y0 = Math.round(p.y - 4 - (shape === 'oversized' ? 1 : 0));
      for (let yy = 0; yy < h; yy++) {
        for (let xx = 0; xx < p.w; xx++) {
          const edge = yy === 0 || yy === h - 1 || xx === 0 || xx === p.w - 1;
          const corner = (yy === 0 || yy === h - 1) && (xx === 0 || xx === p.w - 1);
          if (corner && p.w > 4) continue;
          const d = Math.min(xx, p.w - 1 - xx) + Math.min(yy, h - 1 - yy);
          if (shape === 'roundsun' && d < 2) continue;
          if (shape === 'oversized' && d < 3) continue;
          if (shape === 'heart' && ((yy === 0 && xx === Math.floor(p.w / 2)) || (yy >= 3 && (xx < (yy - 2) * 0.9 || xx > p.w - 1 - (yy - 2) * 0.9)))) continue;
          // aviator: tear drop, the lower corners are cut deeper
          if (shape === 'aviator' && yy > h - 4 && Math.min(xx, p.w - 1 - xx) + (h - 1 - yy) < 3) continue;
          // cat eye: the outer top corner rises
          const thick = shape === 'square' && (yy === 1 || (xx === 1 && p.w > 4));
          if (edge || thick) c.px(x0 + xx, y0 + yy, frame);
          else c.px(x0 + xx, y0 + yy, lensOf(yy));
        }
      }
      if (shape === 'cat') {
        const ox = p.sg === 1 ? x0 + p.w : x0 - 1;
        c.px(ox, y0 - 1, frame);
        c.px(ox + (p.sg === 1 ? -1 : 1), y0, frame);
        c.px(ox, y0, frame);
      }
      c.px(x0 + 1, y0 + 1, mix(lensOf(1), '#ffffff', 0.7));
      if (p.w > 5) c.px(x0 + 2, y0 + 2, mix(lensOf(2), '#ffffff', 0.45));
    }
    if (pts.length === 2) {
      const left = pts[0].x < pts[1].x ? pts[0] : pts[1];
      const right = pts[0].x < pts[1].x ? pts[1] : pts[0];
      const xa = Math.round(left.x + left.w / 2);
      const xb = Math.round(right.x - right.w / 2);
      for (let x = xa; x < xb; x++) {
        c.px(x, Math.round(left.y - 2), frame);
        if (shape === 'aviator') c.px(x, Math.round(left.y - 4), frame);
      }
    }
    for (const sg of SIDE) {
      const p = facePoint(c, cx, cy, sg * 1.2, -1.2);
      const q = facePoint(c, cx, cy, sg * 0.75, -1.6);
      if (p.vis > 0.02 && q.vis > 0.02) c.line(q.x, q.y - 3, p.x, p.y - 3, frame);
    }
    void sun;
    void INK;
  }),
);

// ---- earrings and earbuds ----------------------------------------------------------------------------------------------------

registerDrawer('acc.ear_kit', (c, it, e) =>
  e.part(20.6, () => {
    const [cx, cy] = headCenter(c);
    const shape = it.item.params?.shape;
    const buds = shape === 'buds';
    for (const sg of SIDE) {
      MAIN.clear();
      const ear = earMask(c, MAIN, cx, cy, sg);
      MAIN.clear();
      if (ear.vis < -0.15) continue;
      const x = Math.round(ear.x);
      const y = Math.round(cy + 1.4);
      if (shape === 'pearl') {
        for (const [dx, dy] of [[0, 3], [1, 3], [0, 4], [1, 4]] as const) c.px(x + dx, y + dy, dx === 0 && dy === 3 ? '#ffffff' : dx === 1 && dy === 4 ? '#b8b2c4' : '#e8e4ee');
      } else if (shape === 'hoopbig') {
        const r = 4.6;
        for (let a = 0; a < 6.28; a += 0.32) c.px(x + Math.cos(a) * r * 0.8, y + 8 + Math.sin(a) * r, a < 3.14 ? it.t.lt : it.hex);
        c.px(x, y + 3, it.t.base);
      } else if (shape === 'drop') {
        c.px(x, y + 3, it.t.base);
        c.px(x, y + 4, it.t.lt);
        c.px(x, y + 5, it.t.base);
        for (const [dx, dy] of [[0, 6], [-1, 7], [0, 7], [1, 7], [0, 8], [0, 9]] as const) c.px(x + dx, y + dy, dy < 7 || dx === -1 ? '#ff9aa8' : '#d03a5a');
      } else if (buds) {
        c.px(x, y - 1, it.hex);
        c.px(x, y, it.t.lt);
        c.px(x, y + 1, it.hex);
        c.px(x, y + 2, it.hex);
        c.px(x + sg, y + 3, it.t.sh);
        c.px(x, y + 3, it.hex);
        c.px(x, y + 4, it.t.lt);
      } else {
        // hoop hanging from the lobe
        const r = 2.6;
        for (let a = 0; a < 6.28; a += 0.5) c.px(x + Math.cos(a) * r * 0.8, y + 6 + Math.sin(a) * r, a < 3.14 ? it.t.lt : it.hex);
        c.px(x, y + 3, it.t.base);
      }
    }
    done(c);
  }),
);

// ---- neck pieces -------------------------------------------------------------------------------------------------------------

function ring(c: Ctx2, yo: number, rx: number, rz: number, n = 16): P2[] {
  const out: P2[] = [];
  for (let k = 0; k < n; k++) {
    const psi = (k / n) * Math.PI * 2;
    const q = c.P(Math.sin(psi) * rx, levelY(c, yo), c.rig.bz + Math.cos(psi) * rz);
    out.push([q[0], q[1]]);
  }
  return out;
}

function poly(c: Ctx2, pts: ReadonlyArray<[number, number, number]>, t: Tones, o: { lw?: number; sw?: number } = {}) {
  AUX.clear();
  AUX.poly(pts.map(([psi, yo, g]) => {
    const p = torsoPoint(c, psi, yo, g);
    return [p[0], p[1]] as P2;
  }));
  c.paint(AUX, t, { lw: o.lw ?? 1, sw: o.sw ?? 2 });
  AUX.clear();
}

registerDrawer('acc.neck_kit', (c, it, e) => {
  const shape = it.item.params?.shape;
  const col = it.t;
  if (shape === 'scarf') {
    e.part(0.15, () => {
      MAIN.clear();
      MAIN.hull([...ring(c, 19.6, 6.8, 5.4), ...ring(c, 25.4, 5.2, 4.4)]);
      c.paint(MAIN, col, { lw: 2, sw: 3, deco: (x, y, tone) => (tone !== 2 && (x + y) % 4 === 0 ? col.lt : (x - y) % 6 === 0 ? col.sh : undefined) });
      for (const [yo, hex] of [[22.6, col.sh], [23.8, col.lt]] as const) {
        for (let k = 0; k < 14; k++) {
          const psi = (k / 14) * Math.PI * 2;
          const q = c.P(Math.sin(psi) * 6, levelY(c, yo), c.rig.bz + Math.cos(psi) * 5);
          if ((q[2] > 0) === !c.back) c.px(q[0], q[1], hex);
        }
      }
      done(c);
      if (!c.back) {
        // the hanging end over the chest, with fringe
        poly(c, [[0.12, 21, 1.2], [0.62, 21, 1.2], [0.7, 8.4, 1.2], [0.2, 7.6, 1.2]], col, { lw: 1, sw: 2 });
        for (const psi of [0.3, 0.4, 0.5, 0.6]) {
          const p = torsoPoint(c, psi, 7.2, 1.2);
          if (p[2] > 0.2) {
            c.px(p[0], p[1], col.sh);
            c.px(p[0], p[1] + 1, col.lt);
          }
        }
        surfLine(c, 0.25, 17, 0.28, 9, col.sh, 1.2);
      }
    });
    return;
  }
  if (shape === 'pearls') {
    e.part(0.15, () => {
      for (let k = -9; k <= 9; k++) {
        const t = k / 9;
        for (const base of [0, Math.PI]) {
          const p = torsoPoint(c, base + t * 0.95, 22.2 - 5.4 * (1 - t * t), 1.0);
          if (p[2] > 0.3 && (base === 0 ? k % 1 === 0 : Math.abs(k) < 7)) {
            c.px(p[0], p[1], '#f6f3ec');
            c.px(p[0] + 1, p[1], '#cfc9d6');
            c.px(p[0], p[1] + 1, it.t.sh);
          }
        }
      }
    });
    return;
  }
  if (shape === 'pendant') {
    e.part(0.15, () => {
      if (c.back) {
        surfLine(c, Math.PI - 0.7, 22.4, Math.PI + 0.7, 22.4, col.base, 0.8);
        return;
      }
      surfLine(c, -0.72, 22.4, 0, 12.6, col.base, 1.0);
      surfLine(c, 0.72, 22.4, 0, 12.6, col.base, 1.0);
      surfLine(c, -0.66, 23, -0.02, 13.4, col.lt, 1.0);
      const p = torsoPoint(c, 0, 11.2, 1.3);
      if (p[2] > 0.2) {
        for (const [dx, dy] of [[0, -2], [-1, -1], [0, -1], [1, -1], [-1, 0], [0, 0], [1, 0], [0, 1]] as const) c.px(p[0] + dx, p[1] + dy, dy < 0 && dx <= 0 ? '#ff9aa8' : dx > 0 || dy > 0 ? '#a82040' : '#e04858');
        c.px(p[0] - 1, p[1] - 1, '#ffffff');
      }
    });
    return;
  }
  if (shape === 'choker' || shape === 'silk') {
    e.part(0.15, () => {
      const silk = shape === 'silk';
      for (let k = 0; k < 28; k++) {
        const psi = (k / 28) * Math.PI * 2;
        const q = c.P(Math.sin(psi) * 4.0, levelY(c, 23.4), c.rig.bz + Math.cos(psi) * 3.4);
        if (q[2] <= 0) continue;
        c.px(q[0], q[1] - 1, col.lt);
        c.px(q[0], q[1], col.base);
        if (silk) {
          c.px(q[0], q[1] + 1, col.base);
          c.px(q[0], q[1] + 2, col.sh);
          if (k % 3 === 0) c.px(q[0], q[1], WHITE);
        } else c.px(q[0], q[1] + 1, col.sh);
      }
      if (!c.back) {
        const m = torsoPoint(c, silk ? 0.3 : 0, 21.6, 1.0);
        if (silk) {
          for (const [dx, dy, hex] of [[0, 0, col.base], [1, 0, col.lt], [0, 1, col.sh], [1, 1, col.base], [-1, 2, col.base], [2, 2, col.sh], [-1, 3, col.sh], [2, 3, col.base]] as const) c.px(m[0] + dx, m[1] + dy, hex);
          c.px(m[0], m[1] + 1, WHITE);
        } else if (m[2] > 0.2) {
          for (const [dx, dy] of [[0, 0], [-1, -1], [1, -1], [0, 1]] as const) c.px(m[0] + dx, m[1] + dy + 1, dy === 1 ? '#a82040' : '#e04858');
        }
      }
    });
    return;
  }
  if (shape === 'tie') {
    e.part(0.16, () => {
      if (c.back) return;
      // knot, blade and tip
      poly(c, [[-0.2, 21.4, 1.3], [0.2, 21.4, 1.3], [0.24, 19.2, 1.3], [-0.24, 19.2, 1.3]], col, { lw: 1, sw: 1 });
      poly(c, [[-0.14, 19.4, 1.3], [0.14, 19.4, 1.3], [0.3, 8.6, 1.3], [0, 6.6, 1.3], [-0.3, 8.6, 1.3]], tonesOf(shade(col.base, 0.04)), { lw: 1, sw: 2 });
      surfLine(c, 0, 18.6, 0, 8.4, col.sh, 1.3);
      const k = torsoPoint(c, -0.08, 20.4, 1.4);
      if (k[2] > 0.2) c.px(k[0], k[1], col.lt);
      done(c);
    });
    return;
  }
  if (shape === 'bow') {
    e.part(0.16, () => {
      if (c.back) return;
      poly(c, [[0, 21.2, 1.3], [-0.62, 23.4, 1.3], [-0.62, 19.2, 1.3]], col, { lw: 1, sw: 2 });
      poly(c, [[0, 21.2, 1.3], [0.62, 23.4, 1.3], [0.62, 19.2, 1.3]], col, { lw: 1, sw: 2 });
      const k = torsoPoint(c, 0, 21.2, 1.5);
      if (k[2] > 0.2) {
        c.px(k[0], k[1] - 1, col.lt);
        c.px(k[0], k[1], tonesOf(shade(col.base, -0.2)).base);
        c.px(k[0], k[1] + 1, col.sh);
      }
      done(c);
    });
    return;
  }
  // necklace: a fine chain in a V with a pendant; just the chain seen from behind
  e.part(0.15, () => {
    if (c.back) {
      surfLine(c, Math.PI - 0.7, 22.4, Math.PI + 0.7, 22.4, col.base, 0.8);
      return;
    }
    surfLine(c, -0.75, 22.2, 0, 17, col.base, 1.0);
    surfLine(c, 0.75, 22.2, 0, 17, col.base, 1.0);
    surfLine(c, -0.7, 22.9, -0.05, 17.8, col.lt, 1.0);
    const p = torsoPoint(c, 0, 16.2, 1.2);
    if (p[2] > 0.2) {
      c.px(p[0], p[1], col.lt);
      c.px(p[0] + 1, p[1], col.base);
      c.px(p[0], p[1] + 1, col.base);
      c.px(p[0] + 1, p[1] + 1, col.sh);
    }
  });
});

// ---- wrist pieces ------------------------------------------------------------------------------------------------------------

registerDrawer('acc.wrist_kit', (c, it, e) =>
  e.part(armDepth(c, 1) + 0.02, () => {
    const { rig } = c;
    const el = c.Pv(rig.elbow[1]);
    const wr = c.Pv(rig.wrist[1]);
    const elS: P2 = [el[0], el[1]];
    const wrS: P2 = [wr[0], wr[1]];
    const col = it.t;
    if (it.item.params?.shape === 'scrunchie') {
      // gathered fabric ring with a ruffle edge
      for (const [t, hex] of [[0.8, col.lt], [0.87, col.base], [0.94, col.sh]] as const) {
        const a = limbPt(elS, wrS, t, -1, 3.4);
        const b = limbPt(elS, wrS, t, 1, 3.4);
        c.line(a[0], a[1], b[0], b[1], hex);
        c.line(a[0], a[1] + 1, b[0], b[1] + 1, hex);
      }
      for (let k = 0; k < 7; k++) {
        const q = limbPt(elS, wrS, 0.8 + (k % 2) * 0.16, -1 + k / 3.5, 3.6);
        c.px(q[0], q[1], k % 2 ? col.lt : col.sh);
      }
      return;
    }
    if (it.item.params?.shape === 'bangles') {
      // a stack of thin rings
      for (const [t, hex] of [[0.72, col.lt], [0.8, col.base], [0.88, col.lt], [0.96, col.base]] as const) {
        const a = limbPt(elS, wrS, t, -1, 3.0);
        const b = limbPt(elS, wrS, t, 1, 3.0);
        c.line(a[0], a[1], b[0], b[1], hex);
        c.px(a[0], a[1] + 1, col.sh);
      }
      return;
    }
    if (it.item.params?.shape === 'sweat') {
      // terry band: three rows, a stripe in the middle
      for (const [t, hex] of [[0.78, col.base], [0.86, col.lt], [0.94, col.base], [1.0, col.sh]] as const) {
        const a = limbPt(elS, wrS, t, -1, 3.0);
        const b = limbPt(elS, wrS, t, 1, 3.0);
        c.line(a[0], a[1], b[0], b[1], hex);
        c.line(a[0], a[1] + 1, b[0], b[1] + 1, hex);
      }
      const a = limbPt(elS, wrS, 0.89, -0.9, 3.0);
      const b = limbPt(elS, wrS, 0.89, 0.9, 3.0);
      c.line(a[0], a[1], b[0], b[1], '#e04848');
      return;
    }
    // beads: alternating colors across the wrist
    const hexes = [col.base, '#f0c93a', col.lt, '#3d82d6', col.base];
    for (let k = 0; k < 5; k++) {
      const p = limbPt(elS, wrS, 0.9, -1 + k * 0.5, 2.9);
      c.px(p[0], p[1], hexes[k]);
      c.px(p[0], p[1] + 1, mix(hexes[k], '#000000', 0.3));
    }
    const q = limbPt(elS, wrS, 0.82, 0, 2.9);
    c.px(q[0], q[1], '#d9c36a');
  }),
);

// ---- crossbody bag -------------------------------------------------------------------------------------------------------------

registerDrawer('acc.bag_kit', (c, it, e) => {
  const col = it.t;
  const hipP = (x: number, y: number, z: number): P2 => {
    const p = c.P(x, c.rig.hipY + y, c.rig.bz + z);
    return [p[0], p[1]];
  };
  // strap across the chest (or back) from the right shoulder to the left hip
  e.part(c.back ? 5 : 0.14, () => {
    const s = c.back ? [Math.PI + 0.9, Math.PI - 1.25] : [-0.9, 1.25];
    for (const d of [0, 1]) {
      surfLine(c, s[0], 21 - d * 0.0, s[1], 4.6, d === 0 ? col.base : col.sh, 1.0 + d * 0.0);
      surfLine(c, s[0] + 0.05, 21.4 - d, s[1] + 0.05, 5 - d, d === 0 ? col.lt : col.sh, 1.0);
    }
    done(c);
  });
  e.part(armDepth(c, 1) + 0.02, () => {
    const a = hipP(8.2, 2.6, 3.2);
    const x0 = Math.round(a[0] - 4);
    const y0 = Math.round(a[1] - 3);
    MAIN.clear();
    for (let y = 0; y < 7; y++) for (let x = 0; x < 8; x++) if (!((y === 0 || y === 6) && (x === 0 || x === 7))) MAIN.set(x0 + x, y0 + y);
    c.paint(MAIN, col, { lw: 1, sw: 2 });
    for (let x = 1; x < 7; x++) c.px(x0 + x, y0 + 2, col.sh);
    c.px(x0 + 4, y0 + 3, '#d9c36a');
    c.px(x0 + 4, y0 + 4, '#8a7a3a');
    c.px(x0 + 1, y0 + 1, col.lt);
    done(c);
  });
});

void SIDE;

// ---- flat-brim cap ---------------------------------------------------------------------------------------------------------------

import { HEAD_RY, drawAccessory } from '../engine';

/** The regular cap dome, plus a wide flat visor and a sticker on the front panel (the dome is `drawAccessory`'s style 3). */
registerDrawer('acc.snapback', (c, it, e) =>
  e.part(20.5, () => {
    const [cx, cy] = headCenter(c);
    drawAccessory(c, cx, cy, it);
    if (c.face) {
      const col = it.t;
      const visor = tonesOf(shade(col.base, -0.22));
      const pts: P2[] = [];
      for (let n = 0; n <= 12; n++) {
        const a = -1.2 + (n / 12) * 2.4;
        pts.push([cx + Math.sin(a) * (HEAD_RX + 3.4), cy - HEAD_RY * 0.48 + Math.cos(a) * 4.6]);
      }
      MAIN.clear();
      MAIN.poly([...pts, [cx + 9, cy - HEAD_RY * 0.48 - 1.5], [cx - 9, cy - HEAD_RY * 0.48 - 1.5]]);
      c.paint(MAIN, visor, { lw: 1, sw: 2 });
      for (let k = 0; k + 1 < pts.length; k++) c.line(pts[k][0], pts[k][1] - 1, pts[k + 1][0], pts[k + 1][1] - 1, mix(visor.lt, WHITE, 0.2));
      // front panel sticker
      c.px(cx - 1, cy - HEAD_RY * 0.48 - 5, '#f0c93a');
      c.px(cx, cy - HEAD_RY * 0.48 - 5, '#f0c93a');
      c.px(cx - 1, cy - HEAD_RY * 0.48 - 4, '#c98a12');
      c.px(cx, cy - HEAD_RY * 0.48 - 4, '#c98a12');
      done(c);
    }
  }),
);
