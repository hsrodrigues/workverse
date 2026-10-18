import { footprint, type Furniture, type FurniKind } from '@workverse/shared';
import {
  Plane,
  blob,
  boxPlane,
  createCanvas,
  drawBoxes,
  fillPoly,
  hash2,
  mix,
  project,
  shade,
  softEllipse,
  type Box,
  type Ctx,
  type Pt,
} from './pixel';

/**
 * Procedural furniture. Each kind returns boxes in footprint tile-space; the
 * renderer draws them back to front into a sprite whose anchor is the north
 * vertex of the footprint. Registering a new kind = adding one function here
 * plus its entry in the shared FURNI_KINDS catalog.
 *
 * Palette rules: light comes from the upper left, so left (+y) faces are
 * lighter than right (+x) faces; every sprite gets a soft contact shadow that
 * falls toward +x, and the box renderer adds a lit bevel and a bottom AO band.
 */
export interface FurniSprite {
  canvas: HTMLCanvasElement;
  /** Unique texture key for this exact look (kind, rotation, state, variant). */
  key: string;
  /** Anchor (north vertex of the footprint) inside the canvas. */
  ax: number;
  ay: number;
  /** Optional overlay drawn in front of whoever sits here (chair backs on the near side). */
  front?: { canvas: HTMLCanvasElement; key: string };
  /** Vertical extent in px, used for sprite sorting. */
  z0: number;
  z1: number;
}

type Painter = (ctx: Ctx, ox: number, oy: number) => void;

interface Parts {
  boxes: Box[];
  front?: Box[];
  /** Painted on the floor before the shadow and boxes (rugs, light pools). */
  flat?: Painter;
  /** Painted after the boxes (foliage, wall hangings). */
  post?: Painter;
  /** Boxes drawn after `post` (things that must overlap what `post` painted). */
  after?: Box[];
  /** Contact shadow; `null` disables it. Defaults to the footprint pushed toward +x. */
  shadow?: { len?: number; alpha?: number } | null;
  z0?: number;
  z1: number;
}

const METAL = '#2b2f3a';
const LEAF: readonly [string, string, string, string] = ['#97e583', '#58bc60', '#3b9150', '#2a6a3e'];

type Builder = (fw: number, fd: number, f: Furniture, on: boolean) => Parts;

/** Stable per-position variation (colours, dual monitors) so neighbours differ but a reload looks the same. */
const seatVariant = (f: Furniture) => Math.floor(hash2(f.x, f.y, 31) * 3);
/** Office chairs stay mostly graphite with teal accents; coral is left to the lounge pieces. */
const chairVariant = (f: Furniture) => (hash2(f.x, f.y, 32) < 0.62 ? 0 : 1);
const pcDual = (f: Furniture) => hash2(f.x, f.y, 11) < 0.45;
const CHAIR_PAL: ReadonlyArray<readonly [string, string]> = [
  ['#3f4b60', '#2c3649'],
  ['#2a9a98', '#1d7473'],
  ['#e0714f', '#b9532f'],
];
const POUF_COLORS = ['#e0a63a', '#2a9a98', '#e0714f'] as const;
/** Top surface of kitchen cabinets. */
const CT = 27;

/** Sofa and armchair: low modern lounger with the backrest on the side opposite to where it faces. */
function lounger(fw: number, fd: number, f: Furniture, col: string): Parts {
  const fac = ((f.dir % 4) + 4) % 4;
  const long = fw === fd ? fac % 2 === 1 : fw > fd;
  const L = long ? fw : fd;
  const S = long ? fd : fw;
  const backAtSmall = long ? fac === 1 : fac === 0;
  const mk = (l0: number, l1: number, s0: number, s1: number, z: number, h: number, top: string, left?: string, right?: string): Box => {
    const sa = backAtSmall ? s0 : S - s1;
    return long ? { x: l0, y: sa, w: l1 - l0, d: s1 - s0, z, h, top, left, right } : { x: sa, y: l0, w: s1 - s0, d: l1 - l0, z, h, top, left, right };
  };
  const dark = shade(col, -0.38);
  const boxes: Box[] = [];
  const front: Box[] = [];
  for (const l of [0.08, L - 0.2]) for (const s of [0.08, S - 0.2]) boxes.push(mk(l, l + 0.12, s, s + 0.12, 0, 2, '#2b2f3a'));
  boxes.push(mk(0.02, L - 0.02, 0.04, S - 0.04, 2, 4, dark, shade(dark, 0.06), shade(dark, -0.1)));
  const inner = L - 0.44;
  const n = Math.max(1, Math.round(inner));
  const cw = inner / n;
  for (let i = 0; i < n; i++) {
    const l0 = 0.22 + i * cw;
    boxes.push(mk(l0 + 0.012, l0 + cw - 0.012, 0.3, S - 0.04, 6, 5, shade(col, 0.2), shade(col, 0.06), shade(col, -0.2)));
  }
  for (const l of [0.02, L - 0.22]) {
    boxes.push(mk(l, l + 0.2, 0.04, S - 0.04, 2, 15, shade(col, 0.02), shade(col, -0.02), shade(col, -0.24)));
    boxes.push(mk(l - 0.01, l + 0.21, 0.03, S - 0.03, 17, 3, shade(col, 0.28), shade(col, 0.14), shade(col, -0.08)));
  }
  const backBox = mk(0.02, L - 0.02, 0.04, 0.3, 2, 23, shade(col, -0.08), shade(col, -0.1), shade(col, -0.32));
  const cushions: Box[] = [];
  for (let i = 0; i < n; i++) {
    const l0 = 0.22 + i * cw;
    cushions.push(mk(l0 + 0.012, l0 + cw - 0.012, 0.28, 0.42, 11, 12, shade(col, 0.26), shade(col, 0.1), shade(col, -0.16)));
  }
  // a contrasting throw pillow on one end
  const pillowL = L - 0.5;
  cushions.push(mk(pillowL, pillowL + 0.2, 0.3, 0.44, 12, 9, '#f4f1ea', '#e0dbcd', '#b8b2a2'));
  (backAtSmall ? boxes : front).push(backBox, ...cushions);
  return { boxes, front, z1: 24 };
}

/** Kitchen cabinet run (counter) with a white stone top; `decorate` adds mugs, a bowl and a sink. */
function cabinet(fw: number, fd: number, decorate: boolean, face?: 'n' | 'w', back = false): Parts {
  // `face` is the visible side that carries the doors (1x1 pieces turn with their rotation); `back` = the doors face away
  const alongX = face ? face === 'n' : fw >= fd;
  const side: 'n' | 'w' = alongX ? 'n' : 'w';
  const wood = '#a2683f';
  const len = alongX ? fw : fd;
  const at = (l0: number, l1: number, s0: number, s1: number, z: number, h: number, top: string, left?: string, right?: string, extra: Partial<Box> = {}): Box =>
    alongX ? { x: l0, y: s0, w: l1 - l0, d: s1 - s0, z, h, top, left, right, ...extra } : { x: s0, y: l0, w: s1 - s0, d: l1 - l0, z, h, top, left, right, ...extra };
  const carcass = withDetail(at(0.02, len - 0.02, 0.12, 0.84, 3, 21, shade(wood, 0.1), wood, shade(wood, -0.28)), (ctx, ox, oy, b) => {
    const p = boxPlane(ctx, ox, oy, b, side);
    const W = Math.round((alongX ? b.w : b.d) * 32);
    const t = (c: string) => tone(side, c);
    if (back) {
      // the visible side is the rear of the run: plain panels with a few seams
      p.rect(0, W, 0, 21, t(shade(wood, -0.1)));
      for (let a0 = 0; a0 < W; a0 += 32) p.rect(a0, a0 + 1, 0, 21, t(shade(wood, -0.35)));
      p.rect(0, W, 0, 1, t(shade(wood, -0.4)));
      return;
    }
    for (let a0 = 0; a0 < W; a0 += 32) {
      const a1 = Math.min(W, a0 + 32);
      p.rect(a0, a0 + 1, 0, 21, t(shade(wood, -0.35)));
      p.rect(a0 + 2, a1 - 2, 11, 19, t(shade(wood, 0.1)));
      p.rect(a0 + 2, a1 - 2, 18, 19, t(shade(wood, 0.28)));
      p.rect(a0 + 2, a1 - 2, 2, 10, t(shade(wood, 0.04)));
      p.rect(a0 + 2, a1 - 2, 9, 10, t(shade(wood, 0.24)));
      p.rect(a0 + 2, a1 - 2, 10, 11, t(shade(wood, -0.4)));
      p.rect(a0 + 12, a0 + 20, 8, 9, t('#1f232b'));
      p.rect(a0 + 12, a0 + 20, 16, 17, t('#1f232b'));
    }
  });
  const plinth = at(0.06, len - 0.06, 0.16, 0.8, 0, 3, '#2b2f3a', '#1f232b', '#14161d', { noOutline: true });
  const mid = len / 2;
  const slab = withDetail(at(0, len, 0.06, 0.9, 24, 3, '#f3efe6', '#d6d0c2', '#a9a291'), (ctx, ox, oy) => {
    if (!decorate) return;
    const sink = (X: number, Y: number) => (alongX ? X >= mid - 0.32 && X < mid + 0.32 && Y > 0.3 && Y < 0.66 : Y >= mid - 0.32 && Y < mid + 0.32 && X > 0.3 && X < 0.66);
    paintTop(ctx, ox, oy, 0, 0.06, fw, 0.9, CT, (X, Y) => (sink(X, Y) ? ((alongX ? Y < 0.38 : X < 0.38) ? '#6f7a8c' : '#9aa4b4') : null));
  });
  const boxes: Box[] = [plinth, carcass, slab];
  if (decorate) {
    const px = (l: number, s: number): [number, number] => (alongX ? [l, s] : [s, l]);
    const small = (l: number, s: number, w: number, z: number, h: number, top: string, left: string, right: string): Box => {
      const [x, y] = px(l, s);
      return { x, y, z, w, d: w, h, top, left, right };
    };
    boxes.push(
      small(mid - 0.04, 0.2, 0.08, CT, 14, '#c8ced8', '#aeb4c0', '#7d8594'), // tap
      small(0.3, 0.4, 0.14, CT, 5, '#fff3a0', '#e0bb7c', '#a8803f'), // bowl
      small(0.38, 0.5, 0.09, CT + 5, 3, '#ff9a3a', '#e07a2a', '#b05a1a'),
      small(len - 0.4, 0.4, 0.1, CT, 6, '#ffffff', '#e8e8e8', '#b8bcc6'), // mug
      small(len - 0.26, 0.62, 0.1, CT, 6, '#e0714f', '#c25b3a', '#9a4528'),
    );
  }
  return { boxes, z1: CT + 12, shadow: { alpha: 0.28 } };
}

const DESK_H = 24;
const faceOf = (f: Furniture): 'n' | 'w' => (f.dir % 2 === 0 ? 'w' : 'n');
const tone = (side: 'n' | 'w', c: string) => (side === 'w' ? shade(c, -0.13) : c);
/**
 * One-tile appliances (fridge, cooler, coffee, printer, rack) show their front on the +x face for dir 0 and the +y
 * face for dir 1; dir 2/3 turn the front away from the camera, so the visible face is the rear.
 */
const isBack = (f: Furniture) => ((f.dir % 4) + 4) % 4 >= 2;
/** Plain rear panel with vent slits, painted on the visible face of a box instead of its front. */
const rearPanel = (side: 'n' | 'w', color: string) => (ctx: Ctx, ox: number, oy: number, b: Box) => {
  const p = boxPlane(ctx, ox, oy, b, side);
  const W = Math.round((side === 'n' ? b.w : b.d) * 32);
  p.rect(0, W, 0, b.h, tone(side, color));
  p.rect(0, W, 0, 1, tone(side, shade(color, -0.3)));
  p.rectFn(3, W - 3, 4, b.h - 3, (a, z) => (z % 4 === 0 && a % 6 < 4 ? tone(side, shade(color, -0.22)) : null));
};

/** Paints a pattern on a horizontal rectangle (tile units) at height z. */
function paintTop(ctx: Ctx, ox: number, oy: number, x0: number, y0: number, x1: number, y1: number, z: number, fn: (X: number, Y: number, px: number, py: number) => string | null) {
  const cs = [project(ox, oy, x0, y0, z), project(ox, oy, x1, y0, z), project(ox, oy, x1, y1, z), project(ox, oy, x0, y1, z)];
  const minX = Math.min(...cs.map((c) => c[0])) - 1;
  const maxX = Math.max(...cs.map((c) => c[0])) + 1;
  const minY = Math.min(...cs.map((c) => c[1])) - 1;
  const maxY = Math.max(...cs.map((c) => c[1])) + 1;
  let last = '';
  for (let py = minY; py <= maxY; py++) {
    for (let px = minX; px <= maxX; px++) {
      const dx = px + 0.5 - ox;
      const dy = py + 0.5 - oy + z;
      const X = (dx / 32 + dy / 16) / 2;
      const Y = (dy / 16 - dx / 32) / 2;
      if (X < x0 || X >= x1 || Y < y0 || Y >= y1) continue;
      const c = fn(X, Y, px, py);
      if (!c) continue;
      if (c !== last) {
        ctx.fillStyle = c;
        last = c;
      }
      ctx.fillRect(px, py, 1, 1);
    }
  }
}

function withDetail(b: Box, fn: (ctx: Ctx, ox: number, oy: number, b: Box) => void): Box {
  b.detail = (ctx, ox, oy) => fn(ctx, ox, oy, b);
  return b;
}

/** Wall hanging painter: plane at the north (`n`) or west (`w`) wall of the footprint. */
const onWall = (f: Furniture, fn: (p: Plane, side: 'n' | 'w') => void): Painter => (ctx, ox, oy) => {
  const side: 'n' | 'w' = f.dir % 2 === 0 ? 'n' : 'w';
  fn(new Plane(ctx, side, ox, oy), side);
};

/** Soft drop shadow of a wall hanging on the wall surface (falls to the right and down). */
function wallShadow(p: Plane, a0: number, a1: number, z0: number, z1: number) {
  p.rect(a0 + 2, a1 + 2, z0 - 2, z1 - 2, 'rgba(25,20,45,0.22)');
}

/** Office swivel chair and theatre seat share one drawing: only the colours and the back height change. */
function chairParts(f: Furniture, seat: string, back: string, tall = 0): Parts {
  const boxes: Box[] = [
    { x: 0.1, y: 0.46, z: 0, w: 0.8, d: 0.08, h: 2, top: METAL, noOutline: true },
    { x: 0.46, y: 0.1, z: 0, w: 0.08, d: 0.8, h: 2, top: METAL, noOutline: true },
    { x: 0.08, y: 0.4, z: 0, w: 0.1, d: 0.2, h: 2, top: '#14161d', noOutline: true },
    { x: 0.82, y: 0.4, z: 0, w: 0.1, d: 0.2, h: 2, top: '#14161d', noOutline: true },
    { x: 0.4, y: 0.08, z: 0, w: 0.2, d: 0.1, h: 2, top: '#14161d', noOutline: true },
    { x: 0.4, y: 0.82, z: 0, w: 0.2, d: 0.1, h: 2, top: '#14161d', noOutline: true },
    { x: 0.44, y: 0.44, z: 2, w: 0.12, d: 0.12, h: 6, top: '#5a606c', left: '#8f94a0', right: '#4a505c' },
    { x: 0.14, y: 0.14, z: 8, w: 0.72, d: 0.72, h: 4, top: shade(seat, 0.1), left: seat, right: shade(seat, -0.25) },
  ];
  const rest: Box[] = [];
  const fac = ((f.dir % 4) + 4) % 4;
  const T = 0.12;
  const cushion = (b: Box): Box => ({ ...b, top: shade(back, 0.14), left: shade(back, 0.08), right: shade(back, -0.1) });
  let backBox: Box;
  let pad: Box;
  if (fac === 0) {
    backBox = { x: 0.12, y: 0.14, z: 12, w: T, d: 0.72, h: 16 + tall, top: back };
    pad = cushion({ x: 0.24, y: 0.2, z: 14, w: 0.05, d: 0.6, h: 11 + tall, top: back });
  } else if (fac === 1) {
    backBox = { x: 0.14, y: 0.12, z: 12, w: 0.72, d: T, h: 16 + tall, top: back };
    pad = cushion({ x: 0.2, y: 0.24, z: 14, w: 0.6, d: 0.05, h: 11 + tall, top: back });
  } else if (fac === 2) {
    backBox = { x: 0.76, y: 0.14, z: 12, w: T, d: 0.72, h: 16 + tall, top: back };
    pad = cushion({ x: 0.71, y: 0.2, z: 14, w: 0.05, d: 0.6, h: 11 + tall, top: back });
  } else {
    backBox = { x: 0.14, y: 0.76, z: 12, w: 0.72, d: T, h: 16 + tall, top: back };
    pad = cushion({ x: 0.2, y: 0.71, z: 14, w: 0.6, d: 0.05, h: 11 + tall, top: back });
  }
  if (fac <= 1) boxes.push(backBox, pad);
  else rest.push(backBox, pad);
  return { boxes, front: rest, z1: 28 + tall, shadow: { alpha: 0.26 } };
}

/** Modern auditorium seat: teal upholstery, walnut armrests, gold headrest stripe. */
function theaterSeat(f: Furniture): Parts {
  const seat = '#2aa3a1';
  const back = '#1f7f88';
  const wood = '#a87040';
  const fac = ((f.dir % 4) + 4) % 4;
  const boxes: Box[] = [
    { x: 0.28, y: 0.28, z: 0, w: 0.44, d: 0.44, h: 2, top: '#14161d', left: '#2b2f3a', right: '#0f1117', noOutline: true },
    { x: 0.43, y: 0.43, z: 2, w: 0.14, d: 0.14, h: 7, top: '#59606e', left: '#8f94a0', right: '#3a3f4c' },
    { x: 0.12, y: 0.12, z: 9, w: 0.76, d: 0.76, h: 5, top: shade(seat, 0.14), left: seat, right: shade(seat, -0.26) },
  ];
  // armrests on both sides of the sitter
  const alongY = fac % 2 === 1;
  for (const s of [0.07, 0.83]) {
    if (alongY) boxes.push({ x: s, y: 0.16, z: 14, w: 0.1, d: 0.62, h: 3, top: shade(wood, 0.2), left: wood, right: shade(wood, -0.3) });
    else boxes.push({ x: 0.16, y: s, z: 14, w: 0.62, d: 0.1, h: 3, top: shade(wood, 0.2), left: wood, right: shade(wood, -0.3) });
  }
  const rest: Box[] = [];
  const T = 0.12;
  const H = 28;
  const gold = { top: '#f0c050', left: '#d9a53c', right: '#a67a28', noOutline: true };
  const shell = { top: back, left: shade(back, -0.06), right: shade(back, -0.3) };
  const pad = { top: shade(seat, 0.16), left: shade(seat, 0.06), right: shade(seat, -0.14) };
  const zt = 12 + H - 4;
  let parts: Box[];
  if (fac === 0) {
    parts = [
      { x: 0.1, y: 0.14, z: 12, w: T, d: 0.72, h: H, ...shell },
      { x: 0.22, y: 0.2, z: 14, w: 0.05, d: 0.6, h: H - 6, ...pad },
      { x: 0.1, y: 0.18, z: zt, w: T, d: 0.64, h: 3, ...gold },
    ];
  } else if (fac === 1) {
    parts = [
      { x: 0.14, y: 0.1, z: 12, w: 0.72, d: T, h: H, ...shell },
      { x: 0.2, y: 0.22, z: 14, w: 0.6, d: 0.05, h: H - 6, ...pad },
      { x: 0.18, y: 0.1, z: zt, w: 0.64, d: T, h: 3, ...gold },
    ];
  } else if (fac === 2) {
    parts = [
      { x: 0.78, y: 0.14, z: 12, w: T, d: 0.72, h: H, ...shell },
      { x: 0.73, y: 0.2, z: 14, w: 0.05, d: 0.6, h: H - 6, ...pad },
      { x: 0.78, y: 0.18, z: zt, w: T, d: 0.64, h: 3, ...gold },
    ];
  } else {
    parts = [
      { x: 0.14, y: 0.78, z: 12, w: 0.72, d: T, h: H, ...shell },
      { x: 0.2, y: 0.73, z: 14, w: 0.6, d: 0.05, h: H - 6, ...pad },
      { x: 0.18, y: 0.78, z: zt, w: 0.64, d: T, h: 3, ...gold },
    ];
  }
  (fac <= 1 ? boxes : rest).push(...parts);
  return { boxes, front: rest, z1: 42, shadow: { alpha: 0.26 } };
}

/** Modern geometric rug in two palettes: warm sand with terracotta, or cool grey with teal and mustard. */
const rugVariant = (f: Furniture): string => (f.dir % 2 === 1 ? 'L' : (f.x + f.y) % 2 === 0 ? 'a' : 'b');

const modernRug = (fw: number, fd: number, f: Furniture): Parts => {
  const warm = rugVariant(f) === 'a';
  const pal = warm
    ? { base: '#e8dfca', alt: '#ddd2b9', edge: '#c8704c', band: '#37495f', accent: '#c8704c', accent2: '#e8b24a', shadow: 'rgba(40,30,25,0.3)' }
    : { base: '#d3dadf', alt: '#c4ced5', edge: '#2e4a5e', band: '#e0a63a', accent: '#2a9a98', accent2: '#e0714f', shadow: 'rgba(25,30,45,0.3)' };
  return {
    boxes: [],
    z1: 0,
    shadow: null,
    flat: (ctx, ox, oy) => {
      const M = 0.04;
      const inside = (px: number, py: number) => {
        const dx = px + 0.5 - ox;
        const dy = py + 0.5 - oy;
        const X = (dx / 32 + dy / 16) / 2;
        const Y = (dy / 16 - dx / 32) / 2;
        return X >= M && Y >= M && X < fw - M && Y < fd - M;
      };
      paintTop(ctx, ox, oy, M, M, fw - M, fd - M, 0, (X, Y, px, py) => {
        const m = Math.min(X - M, Y - M, fw - M - X, fd - M - Y);
        const n = hash2(px, py, 21);
        if (m < 0.07) return n < 0.12 ? shade(pal.edge, -0.12) : pal.edge;
        if (m < 0.1) return pal.base;
        if (m < 0.14) return pal.band;
        const cx = fw / 2;
        const cy = fd / 2;
        const dm = Math.abs(X - cx) / (fw * 0.2) + Math.abs(Y - cy) / (fd * 0.3);
        if (dm < 0.38) return pal.accent2;
        if (dm < 0.62) return pal.accent;
        if (dm < 0.72) return pal.base;
        if (dm < 0.8) return pal.band;
        const stripe = Math.floor((X + Y) * 4) % 2 === 0;
        if (n < 0.05) return shade(pal.base, -0.06);
        return stripe ? pal.base : pal.alt;
      });
      const c1 = project(ox, oy, M, fd - M, 0);
      const c2 = project(ox, oy, fw - M, fd - M, 0);
      const c3 = project(ox, oy, fw - M, M, 0);
      ctx.fillStyle = pal.shadow;
      for (let x = c1[0]; x < c3[0]; x++) {
        const y0 = x < c2[0] ? c1[1] : c3[1];
        for (let y = y0 - 3; y < c2[1] + 3; y++) if (inside(x, y) && !inside(x, y + 1)) ctx.fillRect(x, y + 1, 1, 1);
      }
    },
  };
};

/** Auditorium aisle runner (rug rotated 1): dark navy with chevrons pointing at the stage and lit edges. */
const legacyRug = (fw: number, fd: number): Parts => ({
  boxes: [],
  z1: 0,
  shadow: null,
  flat: (ctx, ox, oy) => {
    const M = 0.04;
    const inside = (px: number, py: number) => {
      const dx = px + 0.5 - ox;
      const dy = py + 0.5 - oy;
      const X = (dx / 32 + dy / 16) / 2;
      const Y = (dy / 16 - dx / 32) / 2;
      return X >= M && Y >= M && X < fw - M && Y < fd - M;
    };
    paintTop(ctx, ox, oy, M, M, fw - M, fd - M, 0, (X, Y, px, py) => {
      const m = Math.min(X - M, fw - M - X);
      const n = hash2(px, py, 21);
      if (m < 0.05) return '#7fe0ff';
      if (m < 0.11) return '#161a33';
      if (m < 0.15) return '#3b4d8a';
      const cx = fw / 2;
      const chev = (Y * 2.4 + Math.abs(X - cx) * 1.5) % 1;
      if (chev < 0.1) return '#6f8fe0';
      if (chev < 0.24) return '#3e5399';
      if (n < 0.07) return '#2a3262';
      return '#232a52';
    });
    const c1 = project(ox, oy, M, fd - M, 0);
    const c2 = project(ox, oy, fw - M, fd - M, 0);
    const c3 = project(ox, oy, fw - M, M, 0);
    ctx.fillStyle = 'rgba(10,8,25,0.4)';
    for (let x = c1[0]; x < c3[0]; x++) {
      const y0 = x < c2[0] ? c1[1] : c3[1];
      for (let y = y0 - 3; y < c2[1] + 3; y++) if (inside(x, y) && !inside(x, y + 1)) ctx.fillRect(x, y + 1, 1, 1);
    }
  },
});

const BUILDERS: Record<FurniKind, Builder> = {
  desk: (fw, fd) => {
    // Modern bench desk: white laminate top on an oak edge, black frame legs, slate modesty panel.
    const TH = 3;
    const top: Box = withDetail(
      { x: 0, y: 0.04, z: DESK_H - TH, w: fw, d: fd - 0.08, h: TH, top: '#f1eee6', left: '#d0a56c', right: '#a67d48' },
      (ctx, ox, oy, b) => {
        paintTop(ctx, ox, oy, b.x + 0.02, b.y + 0.04, b.x + b.w - 0.02, b.y + b.d - 0.04, b.z + b.h, (X, Y, px, py) => {
          if (hash2(px, py, 1) < 0.035) return '#e2ddd2';
          if (Math.abs(((X * 2) % 1) - 0.5) > 0.495 && hash2(px, py, 2) < 0.5) return '#e6e1d6';
          return null;
        });
      },
    );
    const legs: Box[] = [];
    for (const x of [0.06, fw - 0.14]) {
      legs.push({ x, y: 0.12, z: 0, w: 0.08, d: 0.08, h: DESK_H - TH, top: '#4a505c', left: '#2f343e', right: '#1f232b', noOutline: true });
      legs.push({ x, y: fd - 0.2, z: 0, w: 0.08, d: 0.08, h: DESK_H - TH, top: '#4a505c', left: '#2f343e', right: '#1f232b', noOutline: true });
    }
    const rails: Box[] = [
      { x: 0.1, y: 0.44, z: 0, w: 0.04, d: 0.12, h: 2, top: '#2f343e', noOutline: true },
      { x: fw - 0.14, y: 0.44, z: 0, w: 0.04, d: 0.12, h: 2, top: '#2f343e', noOutline: true },
    ];
    const modesty: Box = { x: 0.3, y: 0.46, z: 7, w: fw - 0.6, d: 0.06, h: DESK_H - TH - 7, top: '#566074', left: '#46506a', right: '#363d52', flat: true };
    const items: Box[] = [
      // a mug and a tiny succulent between the two monitors
      { x: fw / 2 - 0.04, y: 0.54, z: DESK_H, w: 0.08, d: 0.08, h: 5, top: '#ffffff', left: '#e8e8e8', right: '#b8bcc6' },
      { x: fw / 2 - 0.05, y: 0.12, z: DESK_H, w: 0.1, d: 0.1, h: 5, top: '#58b878', left: '#d08652', right: '#9a5830' },
    ];
    return { z1: DESK_H, boxes: [...legs, ...rails, modesty, top, ...items] };
  },

  chair: (_fw, _fd, f) => {
    const [seat, back] = CHAIR_PAL[chairVariant(f)];
    return chairParts(f, seat, back, 2);
  },
  auditorium_seat: (_fw, _fd, f) => theaterSeat(f),

  computer: (_fw, _fd, f, on) => {
    // dir 3: the user sits on the north side, so the camera sees the back of the monitor.
    const back = ((f.dir % 4) + 4) % 4 === 3;
    const dual = pcDual(f);
    const MH = dual ? 14 : 16;
    const slot = dual ? [0.02, 0.52] : [0.12];
    const MW = dual ? 0.46 : 0.76;
    const my = back ? 0.58 : 0.34;
    const monitors: Box[] = slot.map((mx) =>
      withDetail(
        { x: mx, y: my, z: DESK_H + 5, w: MW, d: 0.06, h: MH, top: '#4a5062', left: '#262a36', right: '#1a1d26', flat: true },
        (ctx, ox, oy, b) => {
          const p = boxPlane(ctx, ox, oy, b, 'n');
          const W = Math.round(b.w * 32);
          if (back) {
            // rear shell with vents and a logo
            p.rect(0, W, MH - 1, MH, '#5b6275');
            p.rectFn(2, W - 2, 2, MH - 2, (a, z) => (z % 3 === 0 && a % 2 === 0 ? '#2b2f3a' : null));
            p.rect(W / 2 - 2, W / 2 + 2, MH / 2 - 1, MH / 2 + 2, '#8f94a0');
            p.rect(W / 2 - 1, W / 2 + 1, MH / 2, MH / 2 + 1, '#cfd3dc');
            return;
          }
          p.rect(0, W, MH - 1, MH, '#5b6275');
          p.rect(1, W - 1, 1, MH - 1, '#12151d');
          if (!on) {
            // standby: dim lock screen with a clock block
            p.rectFn(2, W - 2, 2, MH - 2, (a, z) => (z > MH * 0.6 ? '#21304a' : z > MH * 0.3 ? '#1a2640' : '#141c30'));
            p.rect(W / 2 - 4, W / 2 + 4, MH / 2, MH / 2 + 2, '#3d5a8c');
            p.px(W - 4, 1, '#58e08a');
            return;
          }
          p.rectFn(2, W - 2, 2, MH - 2, (a, z) => (z < 3 ? '#12293f' : z > MH - 4 ? '#2a7ab5' : '#1f5f94'));
          p.rect(3, W - 3, 3, MH - 3, '#eef4fa');
          p.rect(3, W - 3, MH - 4, MH - 3, '#3b82c4');
          for (let i = 0; i < Math.max(2, (MH - 8) / 2); i++) {
            const len = 4 + Math.floor(hash2(i, 5, 2) * Math.max(2, W - 14));
            p.rect(5, Math.min(W - 5, 5 + len), MH - 6 - i * 2, MH - 5 - i * 2, i === 0 ? '#c0504a' : '#7d8fa6');
          }
          p.rect(W - 6, W - 4, 4, MH - 6, '#58b858');
        },
      ),
    );
    const standBoxes: Box[] = slot.flatMap((mx) => [
      { x: mx + MW / 2 - 0.14, y: my - 0.04, z: DESK_H, w: 0.28, d: 0.14, h: 1, top: '#9aa0ac', noOutline: true },
      { x: mx + MW / 2 - 0.04, y: my, z: DESK_H + 1, w: 0.08, d: 0.05, h: 4, top: '#8f94a0', left: '#6b717e', right: '#4a505c', noOutline: true },
    ]);
    const ky = back ? 0.12 : 0.62;
    const kb = withDetail({ x: 0.2, y: ky, z: DESK_H, w: 0.54, d: 0.2, h: 1, top: '#e8eaee', left: '#b9bec9', right: '#8f94a0', flat: true }, (ctx, ox, oy, b) => {
      paintTop(ctx, ox, oy, b.x + 0.02, b.y + 0.03, b.x + b.w - 0.02, b.y + b.d - 0.03, b.z + b.h, (X, Y) => {
        const gx = Math.floor((X - b.x) * 32);
        const gy = Math.floor((Y - b.y) * 32);
        return gx % 3 === 2 || gy % 3 === 2 ? '#b0b6c2' : '#f4f6f9';
      });
    });
    return {
      z0: DESK_H,
      z1: DESK_H + 5 + MH + 2,
      shadow: null,
      boxes: [...standBoxes, ...monitors, kb, { x: 0.82, y: ky + 0.02, z: DESK_H, w: 0.08, d: 0.12, h: 2, top: '#dfe2e8', left: '#b9bec9', right: '#8f94a0' }],
    };
  },

  sofa: (fw, fd, f) => lounger(fw, fd, f, '#c08552'),
  armchair: (fw, fd, f) => lounger(fw, fd, f, '#d9a441'),

  pouf: (_fw, _fd, f) => {
    const c = POUF_COLORS[seatVariant(f)];
    return {
      z1: 12,
      shadow: { alpha: 0.26 },
      boxes: [
        { x: 0.22, y: 0.22, z: 0, w: 0.56, d: 0.56, h: 3, top: shade(c, -0.3), left: shade(c, -0.22), right: shade(c, -0.42), noOutline: true },
        { x: 0.16, y: 0.16, z: 3, w: 0.68, d: 0.68, h: 8, top: shade(c, 0.14), left: c, right: shade(c, -0.26) },
        { x: 0.3, y: 0.3, z: 11, w: 0.4, d: 0.4, h: 1, top: shade(c, 0.24), left: shade(c, 0.1), right: shade(c, -0.1), noOutline: true },
        { x: 0.47, y: 0.47, z: 12, w: 0.06, d: 0.06, h: 1, top: shade(c, -0.3), noOutline: true },
      ],
    };
  },

  stool: (_fw, _fd, f) => {
    const c = POUF_COLORS[(seatVariant(f) + 1) % 3];
    return {
      z1: 14,
      shadow: { alpha: 0.22 },
      boxes: [
        { x: 0.3, y: 0.3, z: 0, w: 0.4, d: 0.4, h: 1, top: '#2b2f3a', noOutline: true },
        { x: 0.46, y: 0.46, z: 1, w: 0.08, d: 0.08, h: 8, top: '#8f94a0', left: '#aeb4c0', right: '#59606e', noOutline: true },
        { x: 0.34, y: 0.34, z: 5, w: 0.32, d: 0.32, h: 1, top: '#59606e', noOutline: true },
        { x: 0.22, y: 0.22, z: 9, w: 0.56, d: 0.56, h: 4, top: shade(c, 0.14), left: c, right: shade(c, -0.26) },
      ],
    };
  },

  high_table: (fw, fd) => {
    const TH = 3;
    const H = 30;
    return {
      z1: H,
      boxes: [
        { x: 0.3, y: 0.38, z: 0, w: fw - 0.6, d: 0.1, h: 2, top: '#2b2f3a', noOutline: true },
        { x: fw / 2 - 0.05, y: 0.45, z: 2, w: 0.1, d: 0.1, h: H - TH - 2, top: '#9aa0ac', left: '#b8bdc8', right: '#59606e', noOutline: true },
        withDetail({ x: 0.04, y: 0.12, z: H - TH, w: fw - 0.08, d: fd - 0.24, h: TH, top: '#f1eee6', left: '#d0a56c', right: '#a67d48' }, (ctx, ox, oy, b) => {
          paintTop(ctx, ox, oy, b.x + 0.03, b.y + 0.04, b.x + b.w - 0.03, b.y + b.d - 0.04, b.z + b.h, (_X, _Y, px, py) => (hash2(px, py, 4) < 0.04 ? '#e2ddd2' : null));
        }),
        { x: 0.34, y: 0.36, z: H, w: 0.1, d: 0.1, h: 5, top: '#ffffff', left: '#e8e8e8', right: '#b8bcc6' },
        { x: fw - 0.6, y: 0.4, z: H, w: 0.1, d: 0.1, h: 5, top: '#f6d7a8', left: '#e5bd86', right: '#b88a54' },
      ],
    };
  },

  counter: (fw, fd, f) => cabinet(fw, fd, true, undefined, isBack(f)),
  coffee: (fw, fd, f, on) => {
    const side = faceOf(f);
    const cab = cabinet(fw, fd, false, side, isBack(f));
    const body = withDetail({ x: 0.16, y: 0.22, z: CT, w: 0.68, d: 0.56, h: 24, top: '#6a7186', left: '#454b5c', right: '#2f3342' }, isBack(f) ? rearPanel(side, '#454b5c') : (ctx, ox, oy, b) => {
      const p = boxPlane(ctx, ox, oy, b, side);
      const W = Math.round((side === 'n' ? b.w : b.d) * 32);
      const t = (c: string) => tone(side, c);
      p.rect(3, W - 3, 4, 12, t('#14161d'));
      p.rect(3, W - 3, 11, 12, t('#2b2f3a'));
      p.rect(W / 2 - 3, W / 2 + 3, 4, 9, t('#f4f1ea'));
      p.rect(W / 2 - 3, W / 2 - 2, 4, 9, t('#ffffff'));
      p.rect(W / 2 - 2, W / 2 + 2, 8, 9, on ? t('#7a4a2a') : t('#d9d4c6'));
      p.rect(4, W - 4, 15, 20, t('#0f1219'));
      p.rect(5, W - 5, 16, 19, on ? t('#58e08a') : t('#2b3a33'));
      p.px(6, 13, '#ffd95a');
      p.px(W - 7, 13, '#e04848');
      p.rect(0, W, 22, 24, t('#e04848'));
    });
    return {
      z1: CT + 26,
      shadow: cab.shadow,
      boxes: [...cab.boxes, body, { x: 0.24, y: 0.3, z: CT + 24, w: 0.52, d: 0.4, h: 2, top: '#3a3f4c', left: '#2b2f3a', right: '#1a1c24' }],
      post: (ctx, ox, oy) => {
        if (!on) return;
        const [cx, cy] = project(ox, oy, 0.5 + (side === 'w' ? 0.3 : 0), 0.5 + (side === 'n' ? 0.3 : 0), CT + 10);
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        for (const [dx, dy] of [[0, 0], [1, -2], [-1, -4], [0, -6]]) ctx.fillRect(cx + dx, cy + dy, 1, 2);
      },
    };
  },

  fridge: (_fw, _fd, f) => {
    const side = faceOf(f);
    const body = withDetail({ x: 0.1, y: 0.12, z: 0, w: 0.8, d: 0.76, h: 62, top: '#eceff4', left: '#cfd5df', right: '#9ea6b4' }, isBack(f) ? rearPanel(side, '#cfd5df') : (ctx, ox, oy, b) => {
      const p = boxPlane(ctx, ox, oy, b, side);
      const W = Math.round((side === 'n' ? b.w : b.d) * 32);
      const t = (c: string) => tone(side, c);
      p.rect(0, W, 1, 3, t('#59606e'));
      p.rect(0, W, 38, 39, t('#8f94a0'));
      p.rect(0, W, 39, 40, t('#eef1f5'));
      p.rect(0, W, 3, 38, t('#dfe4ec'));
      p.rect(0, W, 40, 61, t('#dfe4ec'));
      p.rect(0, 1, 3, 61, t('#f7f9fc'));
      p.rect(W - 5, W - 3, 20, 33, t('#59606e'));
      p.rect(W - 5, W - 4, 20, 33, t('#9aa0ac'));
      p.rect(W - 5, W - 3, 42, 54, t('#59606e'));
      p.rect(W - 5, W - 4, 42, 54, t('#9aa0ac'));
      p.rect(5, 11, 46, 52, '#ffe27a');
      p.rect(6, 12, 28, 33, '#e8644a');
      p.rect(13, 18, 24, 28, '#3b82c4');
    });
    return { z1: 63, boxes: [body] };
  },

  tv: (_fw, _fd, f) => ({
    boxes: [],
    z0: 40,
    z1: 82,
    shadow: null,
    post: onWall(f, (p, side) => {
      const dk = side === 'w' ? -0.1 : 0;
      const S = (c: string) => shade(c, dk);
      const A0 = 5;
      const A1 = 59;
      const Z0 = 44;
      const Z1 = 76;
      wallShadow(p, A0, A1, Z0, Z1);
      p.rect(A0, A1, Z0, Z1, S('#0d0f15'));
      p.rect(A0, A1, Z1 - 1, Z1, S('#3a3f4c'));
      p.rect(A0, A0 + 1, Z0, Z1, S('#2b2f3a'));
      p.rectFn(A0 + 2, A1 - 2, Z0 + 2, Z1 - 2, (a, z) => {
        const u = (a - A0 - 2) / (A1 - A0 - 4);
        const v = (z - Z0 - 2) / (Z1 - Z0 - 4);
        // evening skyline over a gradient sky
        if ((u - 0.72) ** 2 + ((v - 0.62) * 1.6) ** 2 < 0.012) return S('#ffe9a0');
        const sky = v > 0.7 ? '#ff9a6a' : v > 0.5 ? '#f2748a' : v > 0.3 ? '#8a4fa0' : '#3b2f6a';
        const h = 0.22 + 0.16 * hash2(Math.floor(u * 9), 2, 5);
        if (v < h) return S(hash2(a, z, 3) < 0.07 ? '#ffd95a' : '#1d1a3a');
        return S(sky);
      });
      p.rect(A0 + 2, A0 + 8, Z0 + 2, Z0 + 3, 'rgba(255,255,255,0.35)');
      p.px(A1 - 3, Z0 + 1, '#58e08a');
    }),
  }),

  clock: (_fw, _fd, f) => ({
    boxes: [],
    z0: 50,
    z1: 84,
    shadow: null,
    post: onWall(f, (p, side) => {
      const dk = side === 'w' ? -0.1 : 0;
      const S = (c: string) => shade(c, dk);
      const cx = 16;
      const cz = 68;
      wallShadow(p, cx - 11, cx + 11, cz - 11, cz + 11);
      for (let a = cx - 11; a <= cx + 11; a++) {
        for (let z = cz - 11; z <= cz + 11; z++) {
          const d = Math.hypot(a - cx, z - cz);
          if (d > 11) continue;
          let c = '#f7f4ec';
          if (d > 10) c = '#1f232b';
          else if (d > 8.5) c = '#3a3f4c';
          else if (Math.abs(a - cx) < 1 && d > 7 && z > cz) c = '#2b2f3a';
          else if (Math.abs(z - cz) < 1 && d > 7) c = '#2b2f3a';
          else if (a - cx + z - cz < -4 && d < 8) c = '#fffefa';
          p.px(a, z, S(c));
        }
      }
      p.line(cx, cz, cx - 4, cz + 4, S('#1f232b'));
      p.line(cx, cz, cx + 6, cz + 1, S('#1f232b'));
      p.px(cx, cz, S('#e04848'));
    }),
  }),

  reception_desk: (fw, fd) => {
    const alongX = fw >= fd;
    const L = alongX ? fw : fd;
    const side: 'n' | 'w' = alongX ? 'n' : 'w';
    const mk = (l0: number, l1: number, s0: number, s1: number, z: number, h: number, top: string, left: string, right: string): Box =>
      alongX ? { x: l0, y: s0, z, w: l1 - l0, d: s1 - s0, h, top, left, right } : { x: s0, y: l0, z, w: s1 - s0, d: l1 - l0, h, top, left, right };
    const front = withDetail(mk(0.02, L - 0.02, 0.1, 0.9, 0, 26, '#e9e6df', '#2a9a98', '#1d7473'), (ctx, ox, oy, b) => {
      const p = boxPlane(ctx, ox, oy, b, side);
      const W = Math.round((alongX ? b.w : b.d) * 32);
      const t = (c: string) => tone(side, c);
      p.rect(2, W - 2, 2, 5, t('#1b5f5e'));
      p.rect(2, W - 2, 21, 23, t('#7fd6cf'));
      // wall-mounted mark: a gold "W" on a dark plate in the middle of the front panel
      const cx = W >> 1;
      p.rect(cx - 12, cx + 12, 7, 19, t('#16241f'));
      const glyph = ['X.......X', 'X...X...X', 'X..X.X..X', '.X.X.X.X.', '..X...X..'];
      glyph.forEach((row, r) => {
        for (let c = 0; c < row.length; c++) if (row[c] === 'X') p.rect(cx - 9 + c * 2, cx - 7 + c * 2, 16 - r * 2, 18 - r * 2, t('#f2cf5c'));
      });
    });
    const top = mk(0, L, 0.04, 0.96, 26, 3, '#f7f5ef', '#ffffff', '#c9ccd3');
    const ledge = mk(0.04, L - 0.04, 0.1, 0.36, 29, 5, '#e1ddd2', '#cfcabd', '#a8a396');
    // monitor, keyboard and a call bell on the worker's side
    const m0 = L * 0.5 - 0.3;
    const screenBox = mk(m0, m0 + 0.6, 0.14, 0.22, 34, 12, '#cdd1d9', '#14161d', '#2b2f3a');
    const bell = mk(L - 0.4, L - 0.28, 0.52, 0.64, 29, 3, '#f2cf5c', '#e0bb7c', '#a8803f');
    return { z1: 48, boxes: [front, top, ledge], after: [screenBox, bell], shadow: { alpha: 0.26 } };
  },

  logo: (_fw, _fd, f) => ({
    boxes: [],
    z0: 40,
    z1: 84,
    shadow: null,
    post: onWall(f, (p, side) => {
      const dk = side === 'w' ? -0.1 : 0;
      const S = (c: string) => shade(c, dk);
      const A0 = 4;
      const A1 = 60;
      const Z0 = 46;
      const Z1 = 78;
      wallShadow(p, A0, A1, Z0, Z1);
      p.rect(A0, A1, Z0, Z1, S('#12202b'));
      p.rect(A0, A1, Z1 - 1, Z1, S('#2a9a98'));
      p.rect(A0, A1, Z0, Z0 + 1, S('#0b141b'));
      // pixel "W" mark in gold, followed by a two-line wordmark
      const glyph = ['X.......X', 'X...X...X', 'X..X.X..X', '.X.X.X.X.', '..X...X..'];
      glyph.forEach((row, r) => {
        for (let c = 0; c < row.length; c++) if (row[c] === 'X') p.rect(A0 + 6 + c * 2, A0 + 8 + c * 2, Z1 - 7 - r * 3, Z1 - 4 - r * 3, S('#f2cf5c'));
      });
      p.rect(A0 + 28, A1 - 6, Z1 - 12, Z1 - 9, S('#f4f1ea'));
      p.rect(A0 + 28, A1 - 14, Z1 - 17, Z1 - 15, S('#7fd6cf'));
      p.rect(A0 + 28, A1 - 20, Z1 - 21, Z1 - 20, S('#59606e'));
    }),
  }),

  glass_divider: (fw, fd) => {
    const alongX = fw >= fd;
    const len = alongX ? fw : fd;
    const glassB = alongX ? { x: 0, y: 0.45, z: 5, w: fw, d: 0.1 } : { x: 0.45, y: 0, z: 5, w: 0.1, d: fd };
    const plane = (ctx: Ctx, ox: number, oy: number) => boxPlane(ctx, ox, oy, glassB, alongX ? 'n' : 'w');
    const mk = (l0: number, l1: number, z: number, h: number, top: string, left: string, right: string): Box =>
      alongX ? { x: l0, y: 0.42, z, w: l1 - l0, d: 0.16, h, top, left, right, noOutline: true } : { x: 0.42, y: l0, z, w: 0.16, d: l1 - l0, h, top, left, right, noOutline: true };
    const metal = (l0: number, l1: number, z: number, h: number) => mk(l0, l1, z, h, '#cfd3dc', '#aeb4c0', '#7d8594');
    return {
      z1: 46,
      shadow: { alpha: 0.12 },
      boxes: [metal(0.05, len - 0.05, 0, 5)],
      post: (ctx, ox, oy) => {
        const p = plane(ctx, ox, oy);
        const L = Math.round(len * 32);
        p.rectFn(3, L - 3, 5, 44, (a, z) => {
          const g = (a + z) % 24;
          if (g < 2) return 'rgba(255,255,255,0.34)';
          if (g === 5 || g === 6) return 'rgba(255,255,255,0.14)';
          return z > 30 ? 'rgba(160,215,235,0.30)' : 'rgba(130,195,225,0.26)';
        });
        // frosted band
        p.rect(3, L - 3, 18, 26, 'rgba(255,255,255,0.22)');
      },
      after: [metal(0.05, len - 0.05, 44, 2), metal(0.03, 0.1, 5, 41), metal(len - 0.1, len - 0.03, 5, 41)],
    };
  },

  plant: () => ({
    z1: 62,
    boxes: [
      { x: 0.26, y: 0.26, z: 0, w: 0.48, d: 0.48, h: 12, top: '#b0663a', left: '#c27646', right: '#8e4f2c' },
      { x: 0.2, y: 0.2, z: 12, w: 0.6, d: 0.6, h: 3, top: '#3a281c', left: '#d08652', right: '#9a5830' },
    ],
    post: (ctx, ox, oy) => {
      const [cx, cy] = project(ox, oy, 0.5, 0.5, 15);
      const leaves: ReadonlyArray<readonly [number, number, number, number]> = [
        [-1, 40, 6, 5],
        [-10, 33, 8, 5],
        [9, 34, 8, 5],
        [0, 28, 8, 6],
        [-13, 23, 7, 5],
        [12, 24, 7, 5],
        [-4, 17, 10, 5],
        [8, 14, 7, 4],
        [-10, 11, 6, 4],
      ];
      ctx.fillStyle = '#2f6b3a';
      ctx.fillRect(cx - 1, cy - 20, 2, 20);
      for (const [dx, dy] of leaves) {
        const n = Math.max(Math.abs(dx), 1);
        for (let i = 0; i < n; i += 2) ctx.fillRect(cx + Math.round((dx * i) / n), cy - Math.round((dy * i) / n), 1, 1);
      }
      for (const [dx, dy, rx, ry] of leaves) blob(ctx, cx + dx, cy - dy, rx, ry, LEAF, '#1d4a2c');
      ctx.fillStyle = '#d6ffc7';
      for (const [dx, dy] of [
        [-3, 42],
        [-12, 35],
        [6, 36],
        [-3, 30],
      ])
        ctx.fillRect(cx + dx, cy - dy, 2, 1);
    },
  }),

  bookshelf: (fw, fd, f) => {
    // Runs along the wall it leans on: along x against the north wall (front on the +y face) or along y against
    // the west wall (front on the +x face). Rotation 2/3 turns the front away (room divider): the rear shows.
    const alongX = fw >= fd;
    const L = alongX ? fw : fd;
    const rear = ((f.dir % 4) + 4) % 4 >= 2;
    const side: 'n' | 'w' = alongX ? 'n' : 'w';
    const H = 52;
    // l = position along the wall, s = distance from the wall (0 = the wall, grows toward the front)
    const mk = (l0: number, l1: number, s0: number, s1: number, z: number, h: number, top: string, left: string, right: string, flat?: boolean): Box => {
      const a0 = rear ? 1 - s1 : s0;
      const a1 = rear ? 1 - s0 : s1;
      return alongX ? { x: l0, y: a0, w: l1 - l0, d: a1 - a0, z, h, top, left, right, flat } : { x: a0, y: l0, w: a1 - a0, d: l1 - l0, z, h, top, left, right, flat };
    };
    const boxes: Box[] = [
      mk(0.02, L - 0.02, 0.1, 0.17, 0, H, '#4a2f18', '#5c3a1e', '#3e2713', true),
      mk(0.02, 0.12, 0.1, 0.7, 0, H, '#a56e3b', '#a56e3b', '#7a4d27'),
    ];
    for (const z of [4, 18, 35]) boxes.push(mk(0.02, L - 0.02, 0.1, 0.7, z, 3, '#b57c46', '#9a6636', '#7a4d27'));
    boxes.push(mk(0, L, 0.08, 0.72, 0, 4, '#5c3a1e', '#6b4423', '#4a2f18'));
    boxes.push(mk(0, L, 0.08, 0.72, H - 3, 3, '#c48a50', '#a56e3b', '#7a4d27'));
    const right = mk(L - 0.12, L - 0.02, 0.1, 0.7, 0, H - 3, '#a56e3b', '#9a6636', '#6b4423');
    const covers = ['#d95d4a', '#e8b73a', '#4a8fd9', '#58b858', '#a55ad9', '#f4f1ea', '#e07a3a', '#3fb3b3'];
    const wpx = Math.round(L * 32);
    return {
      z1: H + 1,
      boxes,
      post: (ctx, ox, oy) => {
        if (rear) {
          // vertical planks of the back panel
          const p = boxPlane(ctx, ox, oy, alongX ? { x: 0, y: 0.9, z: 0, w: L, d: 0 } : { x: 0.9, y: 0, z: 0, w: 0, d: L }, side);
          p.rectFn(2, wpx - 2, 4, H - 3, (a, z) => (a % 8 === 0 ? tone(side, '#3e2713') : (a + z * 3) % 11 === 0 ? tone(side, '#6b4423') : tone(side, '#5c3a1e')));
          return;
        }
        const plane = boxPlane(ctx, ox, oy, alongX ? { x: 0, y: 0.58, z: 0, w: L, d: 0 } : { x: 0.58, y: 0, z: 0, w: 0, d: L }, side);
        const rows: ReadonlyArray<readonly [number, number]> = [
          [0, 7],
          [1, 21],
          [2, 38],
        ];
        for (const [rowIdx, z0] of rows) {
          const zMax = rowIdx === 2 ? 49 : z0 + 14;
          plane.rect(5, wpx - 5, z0, zMax - 2, tone(side, '#33200f'));
          let a = 6;
          let n = 0;
          while (a < wpx - 8) {
            const w = 3 + Math.floor(hash2(n, rowIdx, 7) * 3);
            const h = 8 + Math.floor(hash2(n, rowIdx, 8) * 5);
            const c = tone(side, covers[Math.floor(hash2(n, rowIdx, 9) * covers.length)]);
            if (hash2(n, rowIdx, 10) < 0.1) {
              a += 3;
              n++;
              continue;
            }
            if (a + w > wpx - 6) break;
            plane.rect(a, a + w, z0, z0 + h, c);
            plane.rect(a, a + 1, z0, z0 + h, shade(c, 0.28));
            plane.rect(a + w - 1, a + w, z0, z0 + h, shade(c, -0.3));
            plane.rect(a + 1, a + w - 1, z0 + h - 1, z0 + h, shade(c, 0.12));
            const band = z0 + 3 + Math.floor(hash2(n, rowIdx, 11) * (h - 6));
            plane.rect(a, a + w, band, band + 1, hash2(n, rowIdx, 12) < 0.5 ? tone(side, '#f4f1ea') : shade(c, -0.28));
            a += w;
            n++;
          }
        }
        // a small pot on the top shelf
        plane.rect(wpx - 14, wpx - 7, 38, 43, tone(side, '#b0663a'));
        plane.rect(wpx - 14, wpx - 13, 38, 43, tone(side, '#d08652'));
        blob(ctx, plane.sx(wpx - 11), plane.sy(wpx - 11, 47), 3, 3, LEAF);
      },
      after: [right],
    };
  },

  coffee_table: (fw, fd) => {
    // Low modern table: pale oak top on black hairpin legs, a lower shelf, a book stack, a mug and a small succulent.
    const H = 12;
    const TH = 2;
    const along = fw >= fd;
    const L = along ? fw : fd;
    const mk = (l0: number, l1: number, s0: number, s1: number, z: number, h: number, top: string, left: string, right: string, extra: Partial<Box> = {}): Box =>
      along ? { x: l0, y: s0, w: l1 - l0, d: s1 - s0, z, h, top, left, right, ...extra } : { x: s0, y: l0, w: s1 - s0, d: l1 - l0, z, h, top, left, right, ...extra };
    const boxes: Box[] = [];
    for (const l of [0.14, L - 0.22]) for (const s of [0.2, 0.72]) boxes.push(mk(l, l + 0.07, s, s + 0.07, 0, H - TH, '#3a3f4c', '#59606e', '#1f232b', { noOutline: true }));
    boxes.push(mk(0.14, L - 0.14, 0.24, 0.76, 3, 1, '#a2683f', '#8a5733', '#6b4423', { noOutline: true }));
    boxes.push(
      withDetail(mk(0.04, L - 0.04, 0.12, 0.88, H - TH, TH, '#ecdfc6', '#d0a56c', '#a67d48'), (ctx, ox, oy, b) => {
        paintTop(ctx, ox, oy, b.x + 0.03, b.y + 0.03, b.x + b.w - 0.03, b.y + b.d - 0.03, b.z + b.h, (_X, _Y, px, py) => (hash2(px, py, 14) < 0.05 ? '#dccdb0' : null));
      }),
    );
    boxes.push(mk(0.28, 0.5, 0.3, 0.52, H, 2, '#d9473a', '#b13a30', '#8a2c25'));
    boxes.push(mk(0.3, 0.48, 0.32, 0.5, H + 2, 2, '#f4f1ea', '#cfc9b8', '#a8a396'));
    boxes.push(mk(L - 0.5, L - 0.38, 0.56, 0.68, H, 5, '#ffffff', '#e8e8e8', '#b8bcc6'));
    boxes.push(mk(L * 0.5 - 0.06, L * 0.5 + 0.1, 0.4, 0.56, H, 4, '#b0663a', '#c27646', '#8e4f2c'));
    return {
      z1: H + 12,
      shadow: { alpha: 0.2 },
      boxes,
      post: (ctx, ox, oy) => {
        const [x, y] = along ? [L * 0.5 + 0.02, 0.48] : [0.48, L * 0.5 + 0.02];
        const [cx, cy] = project(ox, oy, x, y, H + 5);
        blob(ctx, cx, cy - 2, 4, 3, LEAF, '#1d4a2c');
      },
    };
  },

  table: (fw, fd) => {
    const topBox = withDetail({ x: 0.06, y: 0.06, z: 20, w: fw - 0.12, d: fd - 0.12, h: 5, top: '#e4be8a', left: '#b98a52', right: '#946a3a' }, (ctx, ox, oy, b) => {
      paintTop(ctx, ox, oy, b.x + 0.05, b.y + 0.06, b.x + b.w - 0.05, b.y + b.d - 0.06, b.z + b.h, (X, Y, px, py) => {
        const g = hash2(Math.floor(X * 9), Math.floor(Y * 38), 4);
        if (g < 0.2) return '#d4aa72';
        if (g > 0.94) return '#f2d3a4';
        if (hash2(px, py, 6) < 0.025) return '#f2d3a4';
        return null;
      });
    });
    const legs: Box[] = [];
    for (const [x, y] of [
      [0.22, 0.22],
      [fw - 0.38, 0.22],
      [0.22, fd - 0.38],
      [fw - 0.38, fd - 0.38],
    ] as const) {
      legs.push({ x, y, z: 0, w: 0.16, d: 0.16, h: 20, top: '#8f94a0', left: '#a9aebb', right: '#59606e' });
    }
    legs.push({ x: 0.3, y: fd / 2 - 0.04, z: 6, w: fw - 0.6, d: 0.08, h: 2, top: '#59606e', noOutline: true });
    const cx = fw / 2;
    const cy = fd / 2;
    return {
      z1: 34,
      boxes: [
        ...legs,
        topBox,
        { x: 0.4, y: 0.4, z: 25, w: 0.34, d: 0.26, h: 1, top: '#f4f1ea', noOutline: true },
        { x: 0.46, y: 0.44, z: 26, w: 0.3, d: 0.2, h: 1, top: '#fffefa', noOutline: true },
        { x: fw - 0.8, y: fd - 0.7, z: 25, w: 0.12, d: 0.12, h: 5, top: '#ffffff', left: '#e8e8e8', right: '#c0c4cc' },
        { x: fw - 0.98, y: fd - 0.62, z: 25, w: 0.12, d: 0.12, h: 5, top: '#f6d7a8', left: '#e5bd86', right: '#b88a54' },
        // laptop
        { x: cx - 0.2, y: cy + 0.05, z: 25, w: 0.36, d: 0.26, h: 1, top: '#59606e', left: '#444a56', right: '#2f343e' },
        { x: cx - 0.2, y: cy + 0.03, z: 26, w: 0.36, d: 0.03, h: 10, top: '#59606e', left: '#6fe0ff', right: '#2f343e', flat: true },
        // vase
        { x: cx + 0.46, y: cy - 0.32, z: 25, w: 0.14, d: 0.14, h: 8, top: '#58b858', left: '#6fa0d8', right: '#4a78a8' },
      ],
      post: (ctx, ox, oy) => {
        const [vx, vy] = project(ox, oy, cx + 0.53, cy - 0.25, 33);
        blob(ctx, vx, vy - 2, 4, 3, LEAF);
        ctx.fillStyle = '#ff8fa0';
        ctx.fillRect(vx - 2, vy - 4, 1, 1);
        ctx.fillRect(vx + 1, vy - 3, 1, 1);
      },
    };
  },

  rug: (fw, fd, f) => (f.dir % 2 === 0 ? modernRug(fw, fd, f) : legacyRug(fw, fd)),

  cooler: (_fw, _fd, f) => {
    const side = faceOf(f);
    const base = withDetail({ x: 0.28, y: 0.28, z: 0, w: 0.44, d: 0.44, h: 26, top: '#eef1f5', left: '#d6dce5', right: '#a9b1be' }, isBack(f) ? rearPanel(side, '#d6dce5') : (ctx, ox, oy, b) => {
      const p = boxPlane(ctx, ox, oy, b, side);
      const W = Math.round(0.44 * 32);
      const t = (c: string) => tone(side, c);
      p.rect(3, W - 3, 12, 19, t('#59606e'));
      p.rect(3, W - 3, 18, 19, t('#8f94a0'));
      p.rect(4, 7, 14, 18, t('#3a8fd8'));
      p.rect(4, 5, 14, 18, t('#8fd0ff'));
      p.rect(W - 7, W - 4, 14, 18, t('#e04848'));
      p.rect(W - 7, W - 6, 14, 18, t('#ff9a8a'));
      p.rect(3, W - 3, 6, 10, t('#59606e'));
      for (let a = 4; a < W - 4; a += 2) p.px(a, 7, t('#2b2f3a'));
      p.rect(3, W - 3, 10, 11, t('#9aa0ac'));
      p.rect(3, W - 3, 2, 3, t('#aeb4c0'));
    });
    const jug = withDetail({ x: 0.31, y: 0.31, z: 26, w: 0.38, d: 0.38, h: 20, top: '#d8f1fc', left: '#9ad6f5', right: '#5faede', flat: true }, (ctx, ox, oy, b) => {
      const p = boxPlane(ctx, ox, oy, b, 'n');
      const q = boxPlane(ctx, ox, oy, b, 'w');
      const W = Math.round(0.38 * 32);
      p.rect(2, 4, 3, 17, '#d8f1fc');
      p.rect(5, 6, 6, 14, '#c3e8f9');
      p.px(W / 2, 10, '#ffffff');
      p.px(W / 2 + 3, 6, '#ffffff');
      p.px(W / 2 - 3, 13, '#ffffff');
      p.rect(0, W, 16, 17, '#e8f8ff');
      q.rect(2, 3, 3, 15, '#7fc4ea');
    });
    return {
      z1: 52,
      boxes: [base, jug, { x: 0.38, y: 0.38, z: 46, w: 0.24, d: 0.24, h: 3, top: '#eef1f5', left: '#d6dce5', right: '#a9b1be' }],
    };
  },

  bin: () => {
    const body = withDetail({ x: 0.3, y: 0.3, z: 0, w: 0.4, d: 0.4, h: 13, top: '#8a92a2', left: '#a1a9b8', right: '#6d7686' }, (ctx, ox, oy, b) => {
      for (const s of ['n', 'w'] as const) {
        const p = boxPlane(ctx, ox, oy, b, s);
        const W = Math.round(0.4 * 32);
        for (let a = 3; a < W - 2; a += 4) p.rect(a, a + 1, 2, 11, s === 'n' ? '#8791a3' : '#5d6676');
        p.rect(0, W, 5, 8, s === 'n' ? '#3fae6a' : '#2c7d4b');
        p.rect(0, W, 7, 8, s === 'n' ? '#7fe0a0' : '#4cae74');
      }
    });
    return {
      z1: 17,
      boxes: [body, { x: 0.27, y: 0.27, z: 13, w: 0.46, d: 0.46, h: 2, top: '#2a2e3a', left: '#c3c9d6', right: '#8791a3' }],
      post: (ctx, ox, oy) => {
        const [cx, cy] = project(ox, oy, 0.5, 0.5, 15);
        ctx.fillStyle = '#f4f1ea';
        ctx.fillRect(cx - 2, cy - 2, 3, 2);
        ctx.fillRect(cx + 1, cy - 1, 2, 2);
        ctx.fillStyle = '#c8c4ba';
        ctx.fillRect(cx - 1, cy, 2, 1);
      },
    };
  },

  printer: (_fw, _fd, f) => {
    const side = faceOf(f);
    const fx = side === 'w';
    const cab = withDetail({ x: 0.14, y: 0.18, z: 0, w: 0.72, d: 0.64, h: 15, top: '#4d5362', left: '#454b5c', right: '#2f3342' }, isBack(f) ? rearPanel(side, '#454b5c') : (ctx, ox, oy, b) => {
      const p = boxPlane(ctx, ox, oy, b, side);
      const W = Math.round((fx ? b.d : b.w) * 32);
      const t = (c: string) => tone(side, c);
      p.rect(3, W / 2 - 1, 2, 13, t('#59606e'));
      p.rect(W / 2 + 1, W - 3, 2, 13, t('#59606e'));
      p.rect(3, W / 2 - 1, 12, 13, t('#7d8594'));
      p.rect(W / 2 + 1, W - 3, 12, 13, t('#7d8594'));
      p.rect(W / 2 - 5, W / 2 - 3, 6, 9, t('#c0c6d0'));
      p.rect(W / 2 + 3, W / 2 + 5, 6, 9, t('#c0c6d0'));
    });
    const mach = withDetail({ x: 0.1, y: 0.14, z: 15, w: 0.8, d: 0.72, h: 14, top: '#eef0f4', left: '#d7dbe3', right: '#aeb4c0' }, isBack(f) ? rearPanel(side, '#d7dbe3') : (ctx, ox, oy, b) => {
      const p = boxPlane(ctx, ox, oy, b, side);
      const W = Math.round((fx ? b.d : b.w) * 32);
      const t = (c: string) => tone(side, c);
      p.rect(4, W - 4, 3, 8, t('#8f94a0'));
      p.rect(5, W - 5, 4, 7, t('#2b2f3a'));
      p.rect(6, W - 8, 4, 5, t('#ffffff'));
      p.rect(W - 12, W - 4, 9, 12, t('#3a4152'));
      p.rect(W - 11, W - 8, 10, 11, t('#6fe0ff'));
      p.px(W - 7, 10, t('#58e08a'));
      p.px(W - 6, 10, t('#e04848'));
      p.rect(4, 12, 10, 12, t('#aeb4c0'));
      p.px(5, 10, t('#e04848'));
    });
    const lid: Box = withDetail({ x: 0.1, y: 0.14, z: 29, w: 0.8, d: 0.72, h: 2, top: '#f6f8fb', left: '#e0e4ea', right: '#b6bcc8' }, (ctx, ox, oy, b) => {
      paintTop(ctx, ox, oy, b.x + 0.1, b.y + 0.1, b.x + b.w - 0.1, b.y + b.d - 0.1, b.z + b.h, (X) => (((X - b.x) * 32) % 6 < 1 ? '#e4e8ee' : null));
    });
    const tray: Box = fx
      ? { x: 0.9, y: 0.3, z: 17, w: 0.14, d: 0.4, h: 1, top: '#ffffff', noOutline: true }
      : { x: 0.3, y: 0.88, z: 17, w: 0.4, d: 0.14, h: 1, top: '#ffffff', noOutline: true };
    return { z1: 31, boxes: isBack(f) ? [cab, mach, lid] : [cab, mach, lid, tray] };
  },

  lamp: () => ({
    z1: 58,
    shadow: { alpha: 0.2 },
    flat: (ctx, ox, oy) => {
      const [cx, cy] = project(ox, oy, 0.5, 0.5, 0);
      softEllipse(ctx, cx, cy, 31, 15, '#ffd988', 0.3);
    },
    boxes: [
      { x: 0.34, y: 0.34, z: 0, w: 0.32, d: 0.32, h: 3, top: '#3c4150', left: '#59606e', right: '#2b2f3a' },
      { x: 0.47, y: 0.47, z: 3, w: 0.06, d: 0.06, h: 40, top: '#8f94a0', left: '#aeb4c0', right: '#59606e', noOutline: true },
      { x: 0.27, y: 0.27, z: 42, w: 0.46, d: 0.46, h: 14, top: '#fff6d2', left: '#ffe9a8', right: '#e8c476', flat: true },
    ],
    post: (ctx, ox, oy) => {
      const [cx, cy] = project(ox, oy, 0.5, 0.5, 49);
      softEllipse(ctx, cx, cy, 18, 12, '#fff0b8', 0.12);
    },
  }),

  frame: (_fw, _fd, f) => {
    const variant = (f.x * 7 + f.y * 3) % 3;
    return {
      boxes: [],
      z0: 50,
      z1: 78,
      shadow: null,
      post: onWall(f, (p, side) => {
        const A0 = 2;
        const A1 = 30;
        const Z0 = 52;
        const Z1 = 76;
        const dk = side === 'w' ? -0.1 : 0;
        const fr = shade('#6b4426', dk);
        const S = (c: string) => shade(c, dk);
        wallShadow(p, A0, A1, Z0, Z1);
        p.rect(A0, A1, Z0, Z1, shade(fr, -0.45));
        p.rect(A0 + 1, A1 - 1, Z0 + 1, Z1 - 1, fr);
        p.rect(A0 + 1, A1 - 1, Z1 - 2, Z1 - 1, shade(fr, 0.3));
        p.rect(A0 + 1, A0 + 2, Z0 + 1, Z1 - 1, shade(fr, 0.2));
        p.rect(A1 - 2, A1 - 1, Z0 + 1, Z1 - 1, shade(fr, -0.2));
        p.rect(A0 + 3, A1 - 3, Z0 + 3, Z1 - 3, S('#f4f1ea'));
        p.rect(A0 + 3, A0 + 4, Z0 + 3, Z1 - 3, S('#cfc9b8'));
        p.rect(A0 + 3, A1 - 3, Z1 - 4, Z1 - 3, S('#cfc9b8'));
        const a0 = A0 + 5;
        const a1 = A1 - 5;
        const z0 = Z0 + 5;
        const z1 = Z1 - 5;
        p.rectFn(a0, a1, z0, z1, (a, z) => {
          const u = (a - a0) / (a1 - a0);
          const v = (z - z0) / (z1 - z0);
          if (variant === 0) {
            if ((u - 0.7) ** 2 + (v - 0.72) ** 2 < 0.018) return S('#ffe27a');
            const h1 = 0.32 + Math.sin(u * 5) * 0.08;
            const h2 = 0.2 + Math.sin(u * 4 + 2) * 0.07;
            if (v < h2) return S('#2f7a4a');
            if (v < h1) return S('#58b858');
            return v > 0.55 ? S('#bfe6f6') : S('#9fd4f2');
          }
          if (variant === 1) {
            if (Math.abs(u - 0.3) + Math.abs(v - 0.6) < 0.28) return S('#e8644a');
            if ((u - 0.68) ** 2 + (v - 0.4) ** 2 < 0.05) return S('#3b6bb3');
            if (v < 0.2) return S('#e8b73a');
            return S('#f1e6cf');
          }
          if (v < 0.22 + 0.25 * hash2(Math.floor(u * 6), 3, 5)) return hash2(a, z, 2) < 0.18 ? S('#ffe27a') : S('#2b3a5c');
          if (hash2(a, z, 3) < 0.05) return S('#ffffff');
          return v > 0.5 ? S('#3b4d7a') : S('#27365c');
        });
      }),
    };
  },

  whiteboard: (_fw, _fd, f) => ({
    boxes: [],
    z0: 44,
    z1: 80,
    shadow: null,
    post: onWall(f, (p, side) => {
      const dk = side === 'w' ? -0.1 : 0;
      const S = (c: string) => shade(c, dk);
      const A0 = 3;
      const A1 = 61;
      const Z0 = 47;
      const Z1 = 79;
      wallShadow(p, A0, A1, Z0, Z1);
      p.rect(A0, A1, Z0, Z1, S('#6b717e'));
      p.rect(A0 + 1, A1 - 1, Z0 + 1, Z1 - 1, S('#c9ced8'));
      p.rect(A0 + 1, A1 - 1, Z1 - 2, Z1 - 1, S('#eef0f4'));
      p.rect(A0 + 3, A1 - 3, Z0 + 5, Z1 - 3, S('#f6f8fb'));
      p.rect(A0 + 3, A0 + 4, Z0 + 5, Z1 - 3, S('#d9dee6'));
      p.rect(A0 + 3, A1 - 3, Z1 - 4, Z1 - 3, S('#d9dee6'));
      // pen tray with markers
      p.rect(A0 + 4, A1 - 4, Z0 + 1, Z0 + 3, S('#9aa0ac'));
      p.rect(A0 + 4, A1 - 4, Z0 + 2, Z0 + 3, S('#6b717e'));
      p.rect(A0 + 9, A0 + 14, Z0 + 3, Z0 + 4, S('#3b6bb3'));
      p.rect(A0 + 16, A0 + 20, Z0 + 3, Z0 + 4, S('#e04848'));
      p.rect(A0 + 22, A0 + 26, Z0 + 3, Z0 + 4, S('#2f2f2f'));
      // diagram scribbles
      const blue = S('#3b6bb3');
      const red = S('#d9473a');
      const green = S('#2f9d55');
      const box = (a0: number, a1: number, z0: number, z1: number, c: string) => {
        p.rect(a0, a1, z0, z0 + 1, c);
        p.rect(a0, a1, z1 - 1, z1, c);
        p.rect(a0, a0 + 1, z0, z1, c);
        p.rect(a1 - 1, a1, z0, z1, c);
      };
      p.rect(A0 + 7, A0 + 25, Z1 - 9, Z1 - 8, blue);
      p.rect(A0 + 7, A0 + 14, Z1 - 12, Z1 - 11, blue);
      box(A0 + 8, A0 + 21, Z0 + 10, Z0 + 19, blue);
      box(A0 + 29, A0 + 42, Z0 + 10, Z0 + 19, green);
      p.rect(A0 + 21, A0 + 29, Z0 + 14, Z0 + 15, red);
      p.line(A0 + 27, Z0 + 16, A0 + 29, Z0 + 14, red);
      p.line(A0 + 27, Z0 + 12, A0 + 29, Z0 + 14, red);
      for (let i = 0; i < 4; i++) p.rect(A0 + 31, A0 + 38 + (i % 2) * 2, Z0 + 12 + (i % 3) * 2, Z0 + 13 + (i % 3) * 2, green);
      p.line(A0 + 46, Z0 + 20, A0 + 52, Z0 + 14, red);
      p.line(A0 + 46, Z0 + 14, A0 + 52, Z0 + 20, red);
      // sticky notes
      p.rect(A0 + 45, A0 + 51, Z1 - 12, Z1 - 6, S('#ffe27a'));
      p.rect(A0 + 45, A0 + 51, Z1 - 12, Z1 - 11, S('#e8c24a'));
      p.rect(A0 + 33, A0 + 39, Z1 - 11, Z1 - 5, S('#ff9fb4'));
      p.rect(A0 + 33, A0 + 39, Z1 - 11, Z1 - 10, S('#e07a94'));
    }),
  }),

  basket: () => {
    const weave = (ctx: Ctx, ox: number, oy: number, b: Box) => {
      for (const s of ['n', 'w'] as const) {
        const p = boxPlane(ctx, ox, oy, b, s);
        const W = Math.round(b.w * 32);
        p.rectFn(0, W, 1, b.h, (a, z) => (((a >> 1) + (z >> 1)) & 1 ? (s === 'n' ? '#a98046' : '#7c5a2c') : null));
      }
    };
    return {
      z1: 40,
      boxes: [
        withDetail({ x: 0.26, y: 0.26, z: 0, w: 0.48, d: 0.48, h: 13, top: '#d9b274', left: '#c9a063', right: '#936e3a', flat: true }, weave),
        { x: 0.23, y: 0.23, z: 13, w: 0.54, d: 0.54, h: 2, top: '#3a281c', left: '#e0bb7c', right: '#a8803f' },
      ],
      post: (ctx, ox, oy) => {
        const [cx, cy] = project(ox, oy, 0.5, 0.5, 15);
        for (const [dx, dy, rx, ry] of [
          [-6, 8, 5, 4],
          [6, 9, 5, 4],
          [0, 13, 5, 4],
          [-3, 5, 6, 3],
          [4, 5, 6, 3],
        ] as const)
          blob(ctx, cx + dx, cy - dy, rx, ry, LEAF, '#1d4a2c');
        ctx.fillStyle = '#ff8fa0';
        ctx.fillRect(cx - 1, cy - 16, 2, 2);
        ctx.fillRect(cx + 5, cy - 11, 2, 2);
        ctx.fillStyle = '#fff3a0';
        ctx.fillRect(cx - 8, cy - 11, 2, 2);
      },
    };
  },

  stage: (fw, fd) => ({
    boxes: [],
    z1: 0,
    shadow: null,
    flat: (ctx, ox, oy) => {
      const M = 0.02;
      // thickness of the platform on its two front edges
      const P = (x: number, y: number, z = 0) => project(ox, oy, x, y, z);
      const lipL: Pt[] = [P(M, fd - M), P(fw - M, fd - M), P(fw - M, fd - M, -6), P(M, fd - M, -6)];
      const lipR: Pt[] = [P(fw - M, M), P(fw - M, fd - M), P(fw - M, fd - M, -6), P(fw - M, M, -6)];
      fillPoly(ctx, lipL, '#2a2540');
      fillPoly(ctx, lipR, '#1a1730');
      for (const [a, b] of [
        [P(M, fd - M), P(fw - M, fd - M)],
        [P(fw - M, M), P(fw - M, fd - M)],
      ] as const) {
        const n = Math.max(Math.abs(b[0] - a[0]), 1);
        for (let i = 0; i <= n; i++) {
          const x = Math.round(a[0] + ((b[0] - a[0]) * i) / n);
          const y = Math.round(a[1] + ((b[1] - a[1]) * i) / n);
          ctx.fillStyle = '#0c0a18';
          ctx.fillRect(x, y + 6, 1, 1);
          // LED strip under the lip, with a soft glow
          ctx.fillStyle = '#9af0ff';
          ctx.fillRect(x, y + 2, 1, 1);
          ctx.fillStyle = '#4fc6f0';
          ctx.fillRect(x, y + 3, 1, 1);
          ctx.fillStyle = 'rgba(79,198,240,0.28)';
          ctx.fillRect(x, y + 4, 1, 1);
        }
      }
      const planks = ['#4a4264', '#453d5e', '#514970', '#3f3858'];
      const spots: ReadonlyArray<readonly [number, string]> = [
        [0.2, '#ffe2a0'],
        [0.5, '#bfe6ff'],
        [0.8, '#ffc0e6'],
      ];
      paintTop(ctx, ox, oy, M, M, fw - M, fd - M, 0, (X, Y, px, py) => {
        const m = Math.min(X - M, Y - M, fw - M - X, fd - M - Y);
        const row = Math.floor(Y * 4);
        const off = hash2(row, 0, 7) * 3;
        const k = Math.floor((X + off) / 1.5);
        const tone = planks[Math.floor(hash2(row, k, 9) * planks.length)];
        if (m < 0.05) return '#1f1a33';
        if (m < 0.1) return '#2c2646';
        // white safety tape along the front edge
        if (fd - M - Y < 0.2 && fd - M - Y > 0.15) return '#e6f4ff';
        let c = tone;
        const fy = Y * 4 - row;
        if (fy < 0.09) c = shade(c, -0.2);
        else if (fy < 0.2) c = shade(c, 0.04);
        if (hash2(px, py, 3) < 0.05) c = shade(c, 0.06);
        // three coloured spot pools
        for (const [sx, col] of spots) {
          const e = ((X - fw * sx) / (fw * 0.13)) ** 2 + ((Y - fd * 0.5) / (fd * 0.36)) ** 2;
          if (e < 1) c = mix(c, col, 0.42 * (1 - e) * (1 - e * 0.4) + (e < 0.12 ? 0.1 : 0));
        }
        return c;
      });
    },
  }),

  podium: () => {
    const wood = '#7a4a28';
    const body = withDetail({ x: 0.22, y: 0.3, z: 0, w: 0.56, d: 0.44, h: 30, top: shade(wood, 0.2), left: wood, right: shade(wood, -0.3) }, (ctx, ox, oy, b) => {
      const p = boxPlane(ctx, ox, oy, b, 'n');
      const q = boxPlane(ctx, ox, oy, b, 'w');
      const W = Math.round(b.w * 32);
      const D = Math.round(b.d * 32);
      // framed front panel with the WorkVerse mark
      p.rect(3, W - 3, 5, 25, shade(wood, -0.28));
      p.rect(4, W - 4, 6, 24, shade(wood, 0.06));
      p.rect(4, W - 4, 23, 24, shade(wood, 0.28));
      p.rect(W / 2 - 4, W / 2 + 4, 11, 19, '#ffe27a');
      p.rect(W / 2 - 3, W / 2 + 3, 12, 18, '#3d82d6');
      p.rect(W / 2 - 1, W / 2 + 1, 13, 17, '#ffffff');
      q.rect(3, D - 3, 5, 25, shade(wood, -0.4));
      q.rect(4, D - 4, 6, 24, shade(wood, -0.22));
    });
    const slab: Box = { x: 0.16, y: 0.24, z: 30, w: 0.68, d: 0.56, h: 3, top: '#a56e3b', left: '#8d5a2d', right: '#6b4423' };
    const laptop: Box = { x: 0.34, y: 0.38, z: 33, w: 0.3, d: 0.22, h: 1, top: '#59606e', left: '#444a56', right: '#2f343e' };
    return {
      z1: 70,
      boxes: [body, slab, laptop],
      post: (ctx, ox, oy) => {
        // gooseneck microphone
        const [cx, cy] = project(ox, oy, 0.5, 0.5, 34);
        ctx.fillStyle = '#14161d';
        for (let i = 0; i < 18; i++) ctx.fillRect(cx - Math.round(Math.sin(i / 7) * 3), cy - i, 1, 1);
        ctx.fillRect(cx - 7, cy - 19, 5, 3);
        ctx.fillStyle = '#9aa0ac';
        ctx.fillRect(cx - 7, cy - 19, 4, 2);
        ctx.fillStyle = '#e04848';
        ctx.fillRect(cx - 4, cy - 18, 1, 1);
      },
    };
  },

  screen: (_fw, _fd, f) => ({
    boxes: [],
    z0: 8,
    z1: 98,
    shadow: null,
    post: onWall(f, (p, side) => {
      const dk = side === 'w' ? -0.1 : 0;
      const S = (c: string) => shade(c, dk);
      // 16:9 display of 144 x 81 px at a = 8..152, z = 12..93; the scene paints the slide over it
      wallShadow(p, 3, 157, 8, 97);
      p.rect(3, 157, 8, 97, S('#14161d'));
      p.rect(4, 156, 9, 96, S('#2b2f3a'));
      p.rect(4, 156, 95, 96, S('#59606e'));
      p.rect(4, 5, 9, 96, S('#454b5c'));
      p.rect(6, 154, 10, 94, S('#0b0d12'));
      p.rect(8, 152, 12, 93, S('#1b1830'));
      // mounting brackets and the roller case on top
      p.rect(30, 34, 96, 100, S('#8f94a0'));
      p.rect(126, 130, 96, 100, S('#8f94a0'));
      p.rect(3, 157, 98, 101, S('#d7dbe3'));
      p.rect(3, 157, 100, 101, S('#f6f8fb'));
      p.rect(3, 157, 98, 99, S('#8f94a0'));
    }),
  }),

  router: (_fw, _fd, f) => ({
    boxes: [],
    z0: 50,
    z1: 90,
    shadow: null,
    post: onWall(f, (p, side) => {
      const dk = side === 'w' ? -0.1 : 0;
      const S = (c: string) => shade(c, dk);
      wallShadow(p, 4, 28, 50, 64);
      // antennas first, so the body overlaps their feet
      for (const [a0, a1, top] of [[9, 5, 87], [23, 27, 87], [16, 16, 83]] as const) {
        p.line(a0, 63, a1, top, S('#14161d'));
        p.line(a0 + 1, 63, a1 + 1, top, S('#3a3f4c'));
        p.rect(a1 - 1, a1 + 3, top, top + 3, S('#0b0d12'));
        p.px(a1, top + 1, S('#59606e'));
      }
      // wall bracket and the network cable that leaves the bottom
      p.rect(8, 11, 47, 52, S('#8f94a0'));
      p.rect(21, 24, 47, 52, S('#8f94a0'));
      p.rect(15, 17, 36, 53, S('#f2c53a'));
      p.rect(16, 17, 36, 53, S('#c89a1a'));
      // glossy white body with a dark face plate
      p.rect(4, 28, 52, 64, S('#0b0d12'));
      p.rect(5, 27, 53, 63, S('#f1f3f7'));
      p.rect(5, 27, 62, 63, S('#ffffff'));
      p.rect(5, 6, 53, 63, S('#ffffff'));
      p.rect(26, 27, 53, 63, S('#c0c6d0'));
      p.rect(5, 27, 53, 54, S('#b6bcc8'));
      p.rect(7, 25, 56, 61, S('#1b1e28'));
      p.rect(7, 25, 60, 61, S('#2b2f3a'));
      // status LEDs
      const leds = ['#58e08a', '#58e08a', '#4aa8ff', '#ffb347', '#f4f1ea'];
      leds.forEach((c, i) => {
        const a = 9 + i * 3;
        p.rect(a - 1, a + 2, 57, 60, `${c}33`);
        p.rect(a, a + 1, 58, 59, c);
      });
      // wifi mark
      p.px(23, 57, S('#9aa0ac'));
      p.px(22, 58, S('#9aa0ac'));
      p.px(24, 58, S('#9aa0ac'));
    }),
  }),

  rack: (_fw, _fd, f) => {
    const side = faceOf(f);
    const body = withDetail({ x: 0.08, y: 0.1, z: 0, w: 0.84, d: 0.8, h: 66, top: '#2b2f3a', left: '#20242e', right: '#14161d' }, isBack(f) ? rearPanel(side, '#2b2f3a') : (ctx, ox, oy, b) => {
      const p = boxPlane(ctx, ox, oy, b, side);
      const W = Math.round((side === 'n' ? b.w : b.d) * 32);
      const t = (c: string) => tone(side, c);
      // open front: dark cavity between two rails
      p.rect(0, W, 0, 3, t('#0b0d12'));
      p.rect(2, W - 2, 4, 62, t('#0b0d12'));
      p.rect(2, 3, 4, 62, t('#59606e'));
      p.rect(W - 3, W - 2, 4, 62, t('#3a3f4c'));
      p.rect(0, W, 62, 66, t('#323744'));
      for (let a = 3; a < W - 3; a += 3) p.rect(a, a + 1, 63, 65, t('#14161d'));
      const ports = (z0: number, z1: number, step: number, col: string) => {
        for (let a = 5; a + 1 < W - 4; a += step) p.rect(a, a + 1, z0, z1, t(col));
      };
      // patch panel
      p.rect(4, W - 4, 52, 58, t('#3a4152'));
      p.rect(4, W - 4, 57, 58, t('#59606e'));
      ports(53, 56, 2, '#0b0d12');
      // patch cables looping down to the switch
      const cables = ['#3b82c4', '#f2c53a', '#58e08a', '#e0714f', '#f4f1ea', '#a55ad9', '#3b82c4', '#f2c53a', '#58e08a'];
      for (let i = 0; i < 9; i++) {
        const a = 5 + i * 2;
        if (a + 1 >= W - 4) break;
        const len = 4 + Math.floor(hash2(i, 3, 5) * 5);
        p.rect(a, a + 1, 52 - len, 52, t(cables[i]));
        p.rect(a, a + 1, 44, 46, t(shade(cables[i], -0.25)));
      }
      // switches with port rows and blinking-style LEDs
      const sw = (z0: number, z1: number, seed: number) => {
        p.rect(4, W - 4, z0, z1, t('#2f3544'));
        p.rect(4, W - 4, z1 - 1, z1, t('#4a5062'));
        ports(z0 + 1, z0 + 3, 2, '#0b0d12');
        for (let a = 5; a + 1 < W - 4; a += 2) {
          const r = hash2(a, seed, 8);
          p.px(a, z1 - 2, r < 0.6 ? '#58e08a' : r < 0.85 ? '#ffb347' : '#3a4152');
        }
      };
      sw(38, 44, 1);
      sw(31, 36, 2);
      // cable brush panel
      p.rect(4, W - 4, 28, 30, t('#14161d'));
      p.rect(5, W - 5, 29, 30, t('#2b2f3a'));
      // NAS with four drive bays
      p.rect(4, W - 4, 16, 27, t('#262a35'));
      const bay = Math.floor((W - 12) / 4);
      for (let i = 0; i < 4; i++) {
        const a = 6 + i * bay;
        p.rect(a, a + bay - 1, 18, 25, t('#3a4152'));
        p.rect(a, a + bay - 1, 24, 25, t('#59606e'));
        p.px(a + 1, 19, i === 2 ? '#ffb347' : '#4aa8ff');
      }
      // UPS
      p.rect(4, W - 4, 4, 15, t('#363c4b'));
      p.rect(4, W - 4, 14, 15, t('#59606e'));
      p.rect(6, 15, 7, 12, t('#0b0d12'));
      p.rect(7, 14, 8, 11, t('#58e08a'));
      p.rect(8, 11, 9, 10, t('#1f9a55'));
      p.rect(W - 9, W - 7, 7, 9, t('#e04848'));
      p.rect(W - 9, W - 7, 10, 12, t('#ffb347'));
      p.rect(17, W - 11, 8, 11, t('#2b2f3a'));
    });
    return {
      z1: 68,
      shadow: { alpha: 0.3 },
      boxes: [body],
    };
  },

  cable_tray: (_fw, _fd, f) => ({
    boxes: [],
    z0: 60,
    z1: 94,
    shadow: null,
    post: onWall(f, (p, side) => {
      const dk = side === 'w' ? -0.1 : 0;
      const S = (c: string) => shade(c, dk);
      // horizontal wire-mesh tray near the ceiling
      p.rect(2, 64, 86, 87, 'rgba(25,20,45,0.25)');
      p.rect(0, 64, 87, 92, S('#6b717e'));
      p.rect(0, 64, 91, 92, S('#d7dbe3'));
      p.rect(0, 64, 87, 88, S('#3a3f4c'));
      p.rectFn(0, 64, 88, 91, (a) => (a % 3 === 0 ? S('#2b2f3a') : S('#aeb4c0')));
      // cables lying in the tray
      p.rect(0, 40, 92, 94, S('#3b82c4'));
      p.rect(6, 52, 92, 93, S('#f2c53a'));
      p.rect(12, 46, 93, 94, S('#e0714f'));
      // brackets
      for (const a of [8, 56]) p.rect(a, a + 2, 80, 87, S('#8f94a0'));
      // vertical drop to the rack
      p.rect(43, 53, 66, 88, 'rgba(25,20,45,0.22)');
      p.rect(42, 52, 66, 88, S('#aeb4c0'));
      p.rect(42, 43, 66, 88, S('#e8ebf0'));
      p.rect(51, 52, 66, 88, S('#6b717e'));
      p.rect(44, 51, 67, 87, S('#14161d'));
      p.rect(45, 46, 67, 87, S('#3b82c4'));
      p.rect(47, 48, 67, 87, S('#f2c53a'));
      p.rect(49, 50, 67, 87, S('#58e08a'));
      p.rect(41, 53, 64, 67, S('#8f94a0'));
    }),
  }),

  divider: (fw) => {
    const fabric = '#5f7fa6';
    const panel = withDetail({ x: 0.05, y: 0.42, z: 4, w: fw - 0.1, d: 0.1, h: 36, top: shade(fabric, 0.15), left: fabric, right: shade(fabric, -0.28), flat: true }, (ctx, ox, oy, b) => {
      const p = boxPlane(ctx, ox, oy, b, 'n');
      const W = Math.round(b.w * 32);
      p.rectFn(1, W - 1, 1, b.h - 1, (a, z) => ((a + z) % 4 === 0 ? shade(fabric, 0.08) : (a * 3 + z) % 7 === 0 ? shade(fabric, -0.08) : null));
      const note = (a: number, z: number, c: string, w = 6, h = 6) => {
        p.rect(a, a + w, z, z + h, c);
        p.rect(a, a + w, z, z + 1, shade(c, -0.2));
        p.px(a + (w >> 1), z + h - 1, '#e04848');
      };
      note(8, 20, '#ffe27a');
      note(17, 14, '#ff9fb4');
      note(W - 22, 22, '#9fe0a8');
      p.rect(W - 14, W - 4, 12, 26, '#f6f8fb');
      p.rect(W - 14, W - 4, 23, 26, '#d9473a');
      for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) p.px(W - 13 + c * 2 + 1, 14 + r * 2, '#8f94a0');
    });
    const rail: Box = { x: 0.03, y: 0.4, z: 40, w: fw - 0.06, d: 0.14, h: 2, top: '#d7dbe3', left: '#b9bec9', right: '#8f94a0' };
    const feet: Box[] = [
      { x: 0.2, y: 0.32, z: 0, w: 0.12, d: 0.3, h: 4, top: '#8f94a0', left: '#a9aebb', right: '#59606e' },
      { x: fw - 0.32, y: 0.32, z: 0, w: 0.12, d: 0.3, h: 4, top: '#8f94a0', left: '#a9aebb', right: '#59606e' },
    ];
    return { z1: 42, boxes: [...feet, panel, rail] };
  },
};

const cache = new Map<string, FurniSprite>();
const MAX_Z = 96;
const PAD = 6;

export function renderFurniture(f: Furniture, on = false): FurniSprite {
  const dir = ((f.dir % 4) + 4) % 4;
  const variant =
    f.kind === 'frame'
      ? `:${(f.x * 7 + f.y * 3) % 3}`
      : f.kind === 'chair'
        ? `:${chairVariant(f)}`
        : f.kind === 'pouf' || f.kind === 'stool'
        ? `:${seatVariant(f)}`
        : f.kind === 'computer'
          ? `:${pcDual(f) ? 'd' : 's'}`
          : f.kind === 'rug'
            ? `:${rugVariant(f)}`
            : '';
  const key = `fu:${f.kind}:${dir}:${on ? 1 : 0}${variant}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const { w: fw, d: fd } = footprint(f);
  const build = BUILDERS[f.kind] as Builder | undefined;
  // Tipo sem desenho registrado: bloco provisório, para uma peça faltando nunca derrubar a sala inteira.
  const parts: Parts = build
    ? build(fw, fd, f, on)
    : { z1: 20, boxes: [{ x: 0.1, y: 0.1, z: 0, w: fw - 0.2, d: fd - 0.2, h: 20, top: '#c75bd6' }] };
  const width = (fw + fd) * 32 + PAD * 2;
  const height = (fw + fd) * 16 + MAX_Z + PAD * 2;
  const ax = fd * 32 + PAD;
  const ay = MAX_Z + PAD;

  const main = createCanvas(width, height);
  const ctx = main.ctx;
  parts.flat?.(ctx, ax, ay);
  if (parts.shadow !== null) {
    const len = parts.shadow?.len ?? 0.12;
    const alpha = parts.shadow?.alpha ?? 0.3;
    const q = (x0: number, y0: number, x1: number, y1: number): Pt[] => [project(ax, ay, x0, y0), project(ax, ay, x1, y0), project(ax, ay, x1, y1), project(ax, ay, x0, y1)];
    fillPoly(ctx, q(0.04 + len, 0.0, fw - 0.02 + len, fd - 0.16), `rgba(22,16,44,${alpha * 0.5})`);
    fillPoly(ctx, q(0.1 + len * 0.5, 0.06, fw - 0.08 + len * 0.5, fd - 0.08), `rgba(22,16,44,${alpha * 0.9})`);
  }
  drawBoxes(ctx, ax, ay, parts.boxes);
  parts.post?.(ctx, ax, ay);
  if (parts.after) drawBoxes(ctx, ax, ay, parts.after);

  let front: FurniSprite['front'];
  if (parts.front && parts.front.length > 0) {
    const fc = createCanvas(width, height);
    drawBoxes(fc.ctx, ax, ay, parts.front);
    front = { canvas: fc.canvas, key: `${key}:front` };
  }
  const sprite: FurniSprite = { canvas: main.canvas, key, ax, ay, front, z0: parts.z0 ?? 0, z1: parts.z1 };
  cache.set(key, sprite);
  return sprite;
}
