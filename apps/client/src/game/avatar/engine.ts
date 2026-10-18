import type { AvatarV2, ItemDef, ItemRef, ItemSlot, Pose } from '@workverse/shared';
import { hash2, mix, shade } from '../pixel';
import { tonesOf, type Tones } from './recolor';

/**
 * Procedural avatar, drawn entirely by code (no assets).
 *
 * The body is a tiny 3D skeleton (hips, knees, shoulders, elbows...) that is
 * rotated to one of four camera yaws and projected orthographically with a
 * slight downward pitch, so every view and every pose (idle, walk, sit, wave)
 * comes from the same description. Each body part is rasterised into a 1-bit
 * mask and painted with three tones (light from the upper left) plus a
 * "selective outline": the contour takes a dark shade of the part's own colour.
 *
 * 1 sprite pixel = 1 world pixel, the same density as the furniture.
 */
export const FW = 64;
export const FH = 128;
/** Feet anchor inside a frame (standing: the point between the soles). */
export const ANCHOR_X = 32;
export const ANCHOR_Y = 100;
/**
 * Pixels the scene lifts the sprite when the avatar sits. The sitting frame is
 * drawn with the seat surface at the anchor, so use the seat height here.
 */
export const SIT_LIFT = 11;

export type View = 'front' | 'front34' | 'back' | 'back34';
export const VIEWS: readonly View[] = ['front', 'front34', 'back', 'back34'];

export const FRAME_IDLE = 0; // 0..1 (breathing)
export const FRAME_WALK = 2; // 2..7
export const FRAME_SIT = 8; // 8..9 (breathing)
export const FRAME_WAVE = 10; // 10..12 (play 0,1,2,1)
export const FRAME_TYPE = 13; // 13..14 (sitting, typing at a keyboard; alternate hands)
export const FRAME_DRINK = 15; // 15..16 (standing, holding a cup: 15 raising, 16 cup at the mouth)
export const FRAME_COUNT = 17;
export const FRAMES_IDLE = { start: FRAME_IDLE, count: 2 } as const;
export const FRAMES_WALK = { start: FRAME_WALK, count: 6 } as const;
export const FRAMES_SIT = { start: FRAME_SIT, count: 2 } as const;
export const FRAMES_WAVE = { start: FRAME_WAVE, count: 3 } as const;
export const FRAMES_TYPE = { start: FRAME_TYPE, count: 2 } as const;
export const FRAMES_DRINK = { start: FRAME_DRINK, count: 2 } as const;

// ---------------------------------------------------------------------------
// Pixel buffer, masks and painting

const PIX = FW * FH;
/** Distance metric exponent: 2 is round, higher is boxier (chunky pixel-art shapes). */
const SQ = 3;
const packMemo = new Map<string, number>();
/** #rrggbb to a little-endian ABGR integer. */
export const C = (hex: string): number => {
  let v = packMemo.get(hex);
  if (v === undefined) {
    const n = parseInt(hex.slice(1), 16);
    v = (0xff000000 | ((n & 255) << 16) | (n & 0xff00) | ((n >> 16) & 255)) >>> 0;
    packMemo.set(hex, v);
  }
  return v;
};

export class Mask {
  readonly a = new Uint8Array(PIX);
  x0 = FW;
  y0 = FH;
  x1 = -1;
  y1 = -1;
  clear() {
    for (let y = this.y0; y <= this.y1; y++) this.a.fill(0, y * FW + this.x0, y * FW + this.x1 + 1);
    this.x0 = FW;
    this.y0 = FH;
    this.x1 = -1;
    this.y1 = -1;
  }
  set(x: number, y: number) {
    if (x < 0 || y < 0 || x >= FW || y >= FH) return;
    this.a[y * FW + x] = 1;
    if (x < this.x0) this.x0 = x;
    if (x > this.x1) this.x1 = x;
    if (y < this.y0) this.y0 = y;
    if (y > this.y1) this.y1 = y;
  }
  has(x: number, y: number) {
    return x >= 0 && y >= 0 && x < FW && y < FH && this.a[y * FW + x] === 1;
  }
  capsule(ax: number, ay: number, bx: number, by: number, r0: number, r1 = r0) {
    const r = Math.max(r0, r1) + 1;
    const xa = Math.max(0, Math.floor(Math.min(ax, bx) - r));
    const xb = Math.min(FW - 1, Math.ceil(Math.max(ax, bx) + r));
    const ya = Math.max(0, Math.floor(Math.min(ay, by) - r));
    const yb = Math.min(FH - 1, Math.ceil(Math.max(ay, by) + r));
    const vx = bx - ax;
    const vy = by - ay;
    const l2 = vx * vx + vy * vy;
    for (let y = ya; y <= yb; y++) {
      for (let x = xa; x <= xb; x++) {
        const px = x + 0.5;
        const py = y + 0.5;
        let t = l2 > 0 ? ((px - ax) * vx + (py - ay) * vy) / l2 : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const rr = r0 + (r1 - r0) * t;
        const dx = px - (ax + vx * t);
        const dy = py - (ay + vy * t);
        if (Math.abs(dx) ** SQ + Math.abs(dy) ** SQ <= rr ** SQ) this.set(x, y);
      }
    }
  }
  ellipse(cx: number, cy: number, rx: number, ry: number) {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const dx = (x + 0.5 - cx) / rx;
        const dy = (y + 0.5 - cy) / ry;
        if (Math.abs(dx) ** SQ + Math.abs(dy) ** SQ <= 1) this.set(x, y);
      }
    }
  }
  /** Even-odd scanline polygon. */
  poly(pts: ReadonlyArray<readonly [number, number]>) {
    let lo = Infinity;
    let hi = -Infinity;
    for (const p of pts) {
      lo = Math.min(lo, p[1]);
      hi = Math.max(hi, p[1]);
    }
    for (let y = Math.max(0, Math.floor(lo)); y <= Math.min(FH - 1, Math.ceil(hi)); y++) {
      const yc = y + 0.5;
      const xs: number[] = [];
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        const q = pts[(i + 1) % pts.length];
        if ((p[1] <= yc && q[1] > yc) || (q[1] <= yc && p[1] > yc)) xs.push(p[0] + ((yc - p[1]) * (q[0] - p[0])) / (q[1] - p[1]));
      }
      xs.sort((u, v) => u - v);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        for (let x = Math.ceil(xs[k] - 0.5); x < Math.ceil(xs[k + 1] - 0.5); x++) this.set(x, y);
      }
    }
  }
  hull(pts: ReadonlyArray<readonly [number, number]>) {
    const p = [...pts].sort((u, v) => u[0] - v[0] || u[1] - v[1]);
    const cross = (o: readonly [number, number], a: readonly [number, number], b: readonly [number, number]) =>
      (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lower: (readonly [number, number])[] = [];
    for (const q of p) {
      while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
      lower.push(q);
    }
    const upper: (readonly [number, number])[] = [];
    for (let i = p.length - 1; i >= 0; i--) {
      const q = p[i];
      while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
      upper.push(q);
    }
    lower.pop();
    upper.pop();
    this.poly([...lower, ...upper]);
  }
  /** Removes the pixels set in `o`. */
  sub(o: Mask) {
    for (let y = o.y0; y <= o.y1; y++) {
      for (let x = o.x0; x <= o.x1; x++) if (o.a[y * FW + x]) this.a[y * FW + x] = 0;
    }
  }
  /** Keeps only the pixels set in `o`. */
  and(o: Mask) {
    for (let y = this.y0; y <= this.y1; y++) {
      for (let x = this.x0; x <= this.x1; x++) if (this.a[y * FW + x] && !o.a[y * FW + x]) this.a[y * FW + x] = 0;
    }
  }
}

export interface PaintOpts {
  /** Steps toward the light that stay light (default 2 = one lit pixel). */
  lw?: number;
  /** Steps away from the light that turn dark (default 3 = two shaded pixels). */
  sw?: number;
  outline?: boolean;
  /** Per-pixel override. tone: 0 light, 1 base, 2 shadow. Returns a hex colour or undefined. */
  deco?: (x: number, y: number, tone: 0 | 1 | 2) => string | undefined;
}

export const MAIN = new Mask();
export const AUX = new Mask();
export const AUX2 = new Mask();
const CLIP = new Mask();

// ---------------------------------------------------------------------------
// Vector helpers (character space: x = screen right when facing the camera, y up, z forward)

export type V3 = readonly [number, number, number];
export const v3 = (x: number, y: number, z: number): V3 => [x, y, z];
export const vAdd = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const vSub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const vMul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const vDot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const vLen = (a: V3) => Math.hypot(a[0], a[1], a[2]);
export const vNorm = (a: V3): V3 => {
  const l = vLen(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const vLerp = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** Two-bone IK: returns the joint (elbow/knee) and the reachable end point. */
function ik(root: V3, target: V3, l1: number, l2: number, pole: V3): { joint: V3; end: V3 } {
  let d = vSub(target, root);
  let D = vLen(d);
  const maxD = (l1 + l2) * 0.999;
  const minD = Math.abs(l1 - l2) + 0.5;
  D = Math.min(maxD, Math.max(minD, D));
  d = vMul(vNorm(d), D);
  const dir = vNorm(d);
  const a = (l1 * l1 - l2 * l2 + D * D) / (2 * D);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  const p = vSub(pole, vMul(dir, vDot(pole, dir)));
  const joint = vAdd(vAdd(root, vMul(dir, a)), vMul(vNorm(p), h));
  return { joint, end: vAdd(root, d) };
}

// ---------------------------------------------------------------------------
// Pose (skeleton)

export interface Rig {
  sit: boolean;
  wave: number; // -1 none, else 0..2
  hipY: number;
  bz: number;
  breath: number;
  hip: [V3, V3];
  knee: [V3, V3];
  ankle: [V3, V3];
  pitch: [number, number];
  toeYaw: [number, number];
  shoulder: [V3, V3];
  elbow: [V3, V3];
  wrist: [V3, V3];
  head: V3;
  waveSide: 0 | 1;
}

const L_THIGH = 11.5;
const L_SHIN = 11.5;
const L_UPPER = 9.8;
const L_FORE = 9.4;
export const SIDE = [-1, 1] as const;
const HIP_X = 4.8;
const STAND_HIP = 28;
const ANKLE_Y = 5;

export function makeRig(frame: number, view: View, hold: HoldSpec | null = null): Rig {
  const typing = frame >= FRAME_TYPE && frame < FRAME_DRINK ? frame - FRAME_TYPE : -1;
  const drink = frame >= FRAME_DRINK ? frame - FRAME_DRINK : -1;
  const sit = (frame >= FRAME_SIT && frame < FRAME_WAVE) || typing >= 0;
  const walkI = frame >= FRAME_WALK && frame < FRAME_SIT ? frame - FRAME_WALK : -1;
  const wave = frame >= FRAME_WAVE && frame < FRAME_TYPE ? frame - FRAME_WAVE : -1;
  const breath = frame === 1 ? 1 : frame === FRAME_SIT + 1 ? 1 : 0;
  const hipY = sit ? 4.8 : STAND_HIP;
  const bz = sit ? -3.5 : 0;
  const rig: Rig = {
    sit,
    wave,
    hipY,
    bz,
    breath,
    hip: [v3(-HIP_X, hipY - 1, bz), v3(HIP_X, hipY - 1, bz)],
    knee: [v3(0, 0, 0), v3(0, 0, 0)],
    ankle: [v3(0, 0, 0), v3(0, 0, 0)],
    pitch: [0, 0],
    toeYaw: [0, 0],
    shoulder: [v3(-11.4, hipY + 16.3 - breath * 0.8, bz), v3(11.4, hipY + 16.3 - breath * 0.8, bz)],
    elbow: [v3(0, 0, 0), v3(0, 0, 0)],
    wrist: [v3(0, 0, 0), v3(0, 0, 0)],
    head: v3(0, hipY + 37.6 - breath, bz),
    waveSide: view === 'front' ? 1 : 0,
  };

  // typing: head a little lower and forward, looking at the screen
  if (typing >= 0) rig.head = v3(0, hipY + 35.8, bz + 2.4);

  // legs ------------------------------------------------------------------
  const ankleT: [V3, V3] = [v3(0, 0, 0), v3(0, 0, 0)];
  let armZ: [number, number] = [0.6, 0.6];
  let armLift: [number, number] = [0, 0];
  if (walkI >= 0) {
    const stride = 7;
    const lift = 5.2;
    for (const i of [0, 1] as const) {
      const q = (((walkI + 0.5) / 6 + (i === 1 ? 0.5 : 0)) % 1 + 1) % 1;
      let z: number;
      let y = 0;
      let pitch = 0;
      if (q < 0.5) {
        z = stride * (1 - 4 * q);
        pitch = q > 0.3 ? -((q - 0.3) / 0.2) * 0.55 : 0;
      } else {
        const u = (q - 0.5) * 2;
        z = -stride + 2 * stride * u;
        y = lift * Math.sin(Math.PI * u);
        pitch = u < 0.5 ? -0.5 * (1 - u * 2) : 0.4 * ((u - 0.5) * 2) ** 2;
      }
      ankleT[i] = v3(SIDE[i] * HIP_X, ANKLE_Y + y, z);
      rig.pitch[i] = pitch;
      armZ[1 - i] = -z * 0.82 + 0.4;
      armLift[1 - i] = Math.max(0, z) * 0.18;
    }
    const q0 = ((walkI + 0.5) / 6) % 1;
    rig.hipY = STAND_HIP - 0.4 - 0.9 * (0.5 + 0.5 * Math.cos(4 * Math.PI * q0 + Math.PI)) * 0.0 + 0.9 * -Math.cos(4 * Math.PI * q0) * 0.5;
    rig.hip = [v3(-HIP_X, rig.hipY - 1, 0), v3(HIP_X, rig.hipY - 1, 0)];
    rig.shoulder = [v3(-11.4, rig.hipY + 16.3, 0), v3(11.4, rig.hipY + 16.3, 0)];
    rig.head = v3(0, rig.hipY + 37.6, 0);
  } else if (!sit) {
    for (const i of [0, 1] as const) ankleT[i] = v3(SIDE[i] * HIP_X, ANKLE_Y, 0.5);
  }

  if (sit) {
    for (const i of [0, 1] as const) {
      const hp = rig.hip[i];
      const kn = v3(SIDE[i] * (HIP_X + 0.5), hp[1] + 1.0, hp[2] + 14.6);
      rig.knee[i] = kn;
      rig.ankle[i] = v3(kn[0], kn[1] - 11.4, kn[2] + 2.4);
      rig.pitch[i] = 0.12;
      rig.toeYaw[i] = 0;
    }
  } else {
    for (const i of [0, 1] as const) {
      const r = ik(rig.hip[i], ankleT[i], L_THIGH, L_SHIN, v3(0, 0.25, 1));
      rig.knee[i] = r.joint;
      rig.ankle[i] = r.end;
    }
  }

  // arms ------------------------------------------------------------------
  for (const i of [0, 1] as const) {
    const sh = rig.shoulder[i];
    const sg = SIDE[i];
    let target: V3 = v3(sg * 13.2, rig.hipY - 2.6 + armLift[i], bz + armZ[i]);
    let pole: V3 = v3(sg * 0.35, -0.25, -1);
    if (walkI >= 0) target = v3(sg * 12.6, STAND_HIP - 3.0 + armLift[i] * 0.7, armZ[i]);
    if (sit) {
      target = v3(sg * 6.6, rig.hip[i][1] + 5.6, bz + 8.4);
      pole = v3(sg * 0.6, -0.3, -1);
    }
    if (typing >= 0) {
      // hands on the keyboard (desk top is ~13px above the seat), one key press per frame, alternating
      target = v3(sg * 5.4, hipY + 8.6 + (typing === i ? -0.9 : 0.5), bz + 15.6 + (typing === i ? 0.6 : -0.3));
      pole = v3(sg * 0.9, -0.55, -0.25);
    }
    if (hold && i === hold.side) {
      target = hold.target(rig);
      if (hold.pole) pole = hold.pole;
      if (drink >= 0) {
        // cup half way up (frame 0) or at the mouth (frame 1)
        target = drink === 0 ? v3(5.4, rig.hipY + 17.5, bz + 11.5) : v3(3.4, rig.hipY + 24.5, bz + 12);
        pole = v3(0.9, -0.7, -0.3);
      }
    }
    if (wave >= 0 && i === rig.waveSide) {
      const wob = [-3.2, 0.4, 3.6][wave];
      target = v3(sg * (15.6 + wob), STAND_HIP + 33, 2.5);
      pole = v3(sg * 1, -0.8, -0.1);
    }
    const r = ik(sh, target, L_UPPER, L_FORE, pole);
    rig.elbow[i] = r.joint;
    rig.wrist[i] = r.end;
  }
  return rig;
}

// ---------------------------------------------------------------------------
// Renderer

const YAW: Record<View, number> = { front: 0, front34: Math.PI / 4, back: Math.PI, back34: (Math.PI * 3) / 4 };
export const PITCH = 0.5;

export type P2 = [number, number];

export const FACE_YAW = 0.72;
export const HEAD_RX = 14.2;
export const HEAD_RY = 14.8;
export const HEAD_RZ = 12.8;

/** An equipped item with its resolved main color ramp. */
export interface Resolved {
  item: ItemDef;
  ref: ItemRef;
  hex: string;
  t: Tones;
}

export interface Look {
  skinHex: string;
  list: Resolved[];
  get(slot: ItemSlot): Resolved | undefined;
}

/** What the sleeves of the outermost sleeved garment look like. */
export interface SleeveSpec {
  it: Resolved;
  len: number;
  cuff: 'plain' | 'shirt' | 'rib';
}

/** Makes one arm hold an object (only used in poses where the item has art). */
export interface HoldSpec {
  side: 0 | 1;
  target: (rig: Rig) => V3;
  pole?: V3;
}

/** Legacy style numbers of the drawers that share one implementation (variants are handled by the item id). */
const STYLE_OF: Readonly<Record<string, number>> = {
  'bottom.pants': 0, 'bottom.jeans': 0, 'bottom.cargo': 4, 'bottom.dress': 3, 'bottom.shorts': 1, 'bottom.skirt': 2, 'bottom.pencil': 2,
  'shoes.sneakers': 0, 'shoes.runner': 0, 'shoes.hightop': 3, 'shoes.dress': 1, 'shoes.loafer': 1, 'shoes.boots': 2,
  'top.tee': 0, 'top.tank': 0, 'top.striped': 0, 'top.wv': 0, 'top.shirt': 1, 'top.hoodie': 2, 'outer.blazer': 3, 'top.polo': 4, 'top.sweater': 5,
  'hair.short': 0, 'hair.long': 1, 'hair.spiky': 2, 'hair.bun': 3, 'hair.bald': 4, 'hair.afro': 5, 'hair.ponytail': 6, 'hair.bob': 7, 'hair.pompadour': 8,
  'acc.glasses': 1, 'acc.glasses_round': 1, 'acc.headset': 2, 'acc.cap': 3, 'acc.sunglasses': 4, 'acc.beanie': 5, 'acc.headphones': 6,
};
export const styleOf = (it: Resolved): number => STYLE_OF[it.item.id] ?? 0;

export interface Ctx2 {
  buf: Uint32Array;
  look: Look;
  pose: Pose;
  sleeve: SleeveSpec | null;
  /** A hat/cap/beanie is worn: hair styles with volume on top flatten under it. */
  hatted: boolean;
  /** Head silhouette of the frame, filled by the head part (face features clip to it). */
  headClip: Mask;
  view: View;
  rig: Rig;
  th: number;
  cs: number;
  sn: number;
  back: boolean;
  face: boolean;
  skin: Tones;
  skinHex: string;
  hair: Tones;
  /** screen position + depth of a character-space point */
  P(x: number, y: number, z: number): [number, number, number];
  Pv(p: V3): [number, number, number];
  paint(m: Mask, t: Tones, o?: PaintOpts): void;
  px(x: number, y: number, hex: string): void;
  line(x0: number, y0: number, x1: number, y1: number, hex: string): void;
  clip: Mask | null;
}

export function createCtx(look: Look, view: View, rig: Rig, pose: Pose): Ctx2 {
  const th = YAW[view];
  const cs = Math.cos(th);
  const sn = Math.sin(th);
  const buf = new Uint32Array(PIX);
  const skinHex = look.skinHex;
  const ctx: Ctx2 = {
    buf,
    look,
    pose,
    sleeve: null,
    hatted: false,
    headClip: new Mask(),
    view,
    rig,
    th,
    cs,
    sn,
    back: view === 'back' || view === 'back34',
    face: cs > 0.1,
    skin: tonesOf(skinHex, true),
    skinHex,
    hair: look.get('hair')?.t ?? tonesOf('#4a2c17'),
    P(x, y, z) {
      const d = z * cs - x * sn;
      return [ANCHOR_X + x * cs + z * sn, ANCHOR_Y - y + d * PITCH, d];
    },
    Pv(p) {
      return ctx.P(p[0], p[1], p[2]);
    },
    clip: null,
    paint(m, t, o = {}) {
      const lw = o.lw ?? 2;
      const sw = o.sw ?? 3;
      const a = m.a;
      const ol = C(t.ol);
      const olLt = C(t.olLt);
      const cl = C(t.lt);
      const cb = C(t.base);
      const cd = C(t.sh);
      const outline = o.outline !== false;
      for (let y = m.y0; y <= m.y1; y++) {
        for (let x = m.x0; x <= m.x1; x++) {
          const i = y * FW + x;
          if (!a[i]) continue;
          const L = x > 0 && a[i - 1] === 1;
          const R = x < FW - 1 && a[i + 1] === 1;
          const U = y > 0 && a[i - FW] === 1;
          const D = y < FH - 1 && a[i + FW] === 1;
          if (outline && (!L || !R || !U || !D)) {
            buf[i] = !R || !D ? ol : olLt;
            continue;
          }
          let tone: 0 | 1 | 2 = 1;
          let k = 1;
          while (k <= sw && x + k < FW && y + k < FH && a[(y + k) * FW + x + k]) k++;
          if (k <= sw) tone = 2;
          else {
            k = 1;
            while (k <= lw && x - k >= 0 && y - k >= 0 && a[(y - k) * FW + x - k]) k++;
            if (k <= lw) tone = 0;
          }
          if (o.deco) {
            const over = o.deco(x, y, tone);
            if (over) {
              buf[i] = C(over);
              continue;
            }
          }
          buf[i] = tone === 0 ? cl : tone === 1 ? cb : cd;
        }
      }
      ctx.clip = m;
    },
    px(x, y, hex) {
      x = Math.floor(x);
      y = Math.floor(y);
      if (x < 0 || y < 0 || x >= FW || y >= FH) return;
      if (ctx.clip && !ctx.clip.has(x, y)) return;
      buf[y * FW + x] = C(hex);
    },
    line(x0, y0, x1, y1, hex) {
      x0 = Math.round(x0);
      y0 = Math.round(y0);
      x1 = Math.round(x1);
      y1 = Math.round(y1);
      const dx = Math.abs(x1 - x0);
      const dy = -Math.abs(y1 - y0);
      const sx = x0 < x1 ? 1 : -1;
      const sy = y0 < y1 ? 1 : -1;
      let err = dx + dy;
      for (let n = 0; n < 200; n++) {
        ctx.px(x0, y0, hex);
        if (x0 === x1 && y0 === y1) break;
        const e2 = 2 * err;
        if (e2 >= dy) {
          err += dy;
          x0 += sx;
        }
        if (e2 <= dx) {
          err += dx;
          y0 += sy;
        }
      }
    },
  };
  return ctx;
}

/** Point on a limb: t along the segment, o across (in radii, screen perpendicular). */
export function limbPt(a: [number, number], b: [number, number], t: number, o: number, r: number): [number, number] {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l = Math.hypot(dx, dy) || 1;
  return [a[0] + dx * t + (-dy / l) * o * r, a[1] + dy * t + (dx / l) * o * r];
}

// ---- torso geometry -------------------------------------------------------

/** [y offset above the hip joint, half width, half depth] */
const TORSO_KEYS: ReadonlyArray<readonly [number, number, number]> = [
  [-4.6, 9.2, 5.8],
  [-1, 9.6, 6],
  [4, 9.2, 5.8],
  [12, 9.8, 6],
  [16.6, 10.4, 5.6],
  [20.2, 8.2, 4.8],
  [22.6, 5.4, 3.8],
];

function torsoRadii(yo: number): [number, number] {
  const K = TORSO_KEYS;
  if (yo <= K[0][0]) return [K[0][1], K[0][2]];
  for (let i = 1; i < K.length; i++) {
    if (yo <= K[i][0]) {
      const t = (yo - K[i - 1][0]) / (K[i][0] - K[i - 1][0]);
      return [K[i - 1][1] + (K[i][1] - K[i - 1][1]) * t, K[i - 1][2] + (K[i][2] - K[i - 1][2]) * t];
    }
  }
  return [K[K.length - 1][1], K[K.length - 1][2]];
}

/** y above the floor of a torso level, with the breathing sag applied to the upper body. */
export function levelY(c: Ctx2, yo: number) {
  const k = Math.min(1, Math.max(0, (yo - 4) / 16));
  return c.rig.hipY + yo - c.rig.breath * 0.9 * k;
}

export function torsoPoint(c: Ctx2, psi: number, yo: number, grow = 0): [number, number, number] {
  const [a, b] = torsoRadii(yo);
  return c.P((a + grow) * Math.sin(psi), levelY(c, yo), c.rig.bz + (b + grow) * Math.cos(psi));
}

export function torsoHull(c: Ctx2, m: Mask, y0: number, y1: number, grow = 0, lowGrow = grow) {
  const pts: P2[] = [];
  const levels: number[] = [y0];
  for (const k of TORSO_KEYS) if (k[0] > y0 && k[0] < y1) levels.push(k[0]);
  levels.push(y1);
  for (const yo of levels) {
    const g = yo <= y0 + 0.01 ? lowGrow : grow;
    for (let n = 0; n < 12; n++) {
      const p = torsoPoint(c, (n / 12) * Math.PI * 2, yo, g);
      pts.push([p[0], p[1]]);
    }
  }
  m.hull(pts);
}

/** Draws a line that follows the torso surface; only the camera-facing part is visible. */
export function surfLine(c: Ctx2, psi0: number, y0: number, psi1: number, y1: number, hex: string, grow = 0.2) {
  const n = 14;
  let last: [number, number] | null = null;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const p = torsoPoint(c, psi0 + (psi1 - psi0) * t, y0 + (y1 - y0) * t, grow);
    if (p[2] > 0.3) {
      const cur: [number, number] = [p[0], p[1]];
      if (last) c.line(last[0], last[1], cur[0], cur[1], hex);
      else c.px(cur[0], cur[1], hex);
      last = cur;
    } else last = null;
  }
}

export function surfVisible(c: Ctx2, psi: number, yo: number) {
  return torsoPoint(c, psi, yo)[2] > 0.3;
}

// ---- legs -----------------------------------------------------------------

export function drawLegPart(c: Ctx2, i: 0 | 1, bt: Resolved) {
  const { rig } = c;
  const hp = c.Pv(rig.hip[i]);
  const kn = c.Pv(rig.knee[i]);
  const an = c.Pv(add3(rig.ankle[i], 0, 1.2, 0));
  const style = styleOf(bt);
  const bare = style === 1 || style === 2;
  const rT0 = 4.4;
  const rT1 = 4.0;
  const rS0 = 3.8;
  const rS1 = style === 4 ? 3.9 : 3.5;
  const hipS: P2 = [hp[0], hp[1]];
  const knS: P2 = [kn[0], kn[1]];
  const anS: P2 = [an[0], an[1]];

  // bare skin of the whole leg
  if (bare) {
    MAIN.clear();
    MAIN.capsule(hipS[0], hipS[1], knS[0], knS[1], 4.4, 3.9);
    MAIN.capsule(knS[0], knS[1], anS[0], anS[1], 3.6, 2.9);
    c.paint(MAIN, c.skin, { lw: 2, sw: 3 });
    MAIN.clear();
    // knee cap hint
    c.px(knS[0] - 1, knS[1] - 0, c.skin.lt);
  }

  const col = style === 3 ? tonesOf(shade(bt.hex, -0.04)) : bt.t;
  if (style !== 2) {
    MAIN.clear();
    if (style === 1) {
      const end = limbPt(hipS, knS, 0.9, 0, 0);
      MAIN.capsule(hipS[0], hipS[1], end[0], end[1], rT0 + 0.2, rT1 + 0.8);
    } else {
      MAIN.capsule(hipS[0], hipS[1], knS[0], knS[1], rT0, rT1);
      MAIN.capsule(knS[0], knS[1], anS[0], anS[1], rS0, rS1);
    }
    c.paint(MAIN, col, { lw: 2, sw: 3 });
    // decorations clipped to the leg
    const sideO = i === 0 ? -1 : 1;
    if (style === 0 || style === 3 || style === 4) {
      // outer seam
      const s0 = limbPt(hipS, knS, 0.12, sideO * 0.78, rT0);
      const s1 = limbPt(hipS, knS, 0.96, sideO * 0.7, rT1);
      c.line(s0[0], s0[1], s1[0], s1[1], bt.item.id === 'bottom.jeans' ? mix(col.base, '#e0b060', 0.7) : col.lt);
      // knee creases
      const k0 = limbPt(hipS, knS, 1.02, -0.7, rT1);
      const k1 = limbPt(hipS, knS, 1.02, 0.5, rT1);
      c.line(k0[0], k0[1], k1[0], k1[1], col.sh);
      // cuff
      const c0 = limbPt(knS, anS, 0.8, -0.95, rS1);
      const c1 = limbPt(knS, anS, 0.8, 0.95, rS1);
      c.line(c0[0], c0[1], c1[0], c1[1], style === 3 || bt.item.id === 'bottom.jeans' ? col.lt : col.sh);
      if (style === 3) {
        // pressed crease down the front
        const f0 = limbPt(hipS, knS, 0.15, 0.05, rT0);
        const f1 = limbPt(knS, anS, 0.85, 0.05, rS1);
        c.line(f0[0], f0[1], knS[0], knS[1], col.lt);
        c.line(knS[0], knS[1], f1[0], f1[1], col.lt);
      }
      if (style === 4) {
        // cargo pocket on the thigh
        const p0 = limbPt(hipS, knS, 0.38, -0.55, rT0);
        const p1 = limbPt(hipS, knS, 0.38, 0.75, rT0);
        const p2 = limbPt(hipS, knS, 0.74, -0.55, rT0);
        const p3 = limbPt(hipS, knS, 0.74, 0.75, rT0);
        c.line(p0[0], p0[1], p1[0], p1[1], col.sh);
        c.line(p0[0], p0[1], p2[0], p2[1], col.sh);
        c.line(p1[0], p1[1], p3[0], p3[1], col.sh);
        c.line(p2[0], p2[1], p3[0], p3[1], col.sh);
        c.px(p0[0] + 1, p0[1] + 1, col.lt);
        c.px(p1[0] - 1, p1[1] + 1, col.lt);
      }
    }
    if (style === 1) {
      const e0 = limbPt(hipS, knS, 0.84, -1, rT0);
      const e1 = limbPt(hipS, knS, 0.84, 1, rT0);
      c.line(e0[0], e0[1], e1[0], e1[1], col.sh);
      const s0 = limbPt(hipS, knS, 0.12, sideO * 0.78, rT0);
      const s1 = limbPt(hipS, knS, 0.8, sideO * 0.7, rT0);
      c.line(s0[0], s0[1], s1[0], s1[1], col.lt);
    }
    MAIN.clear();
    c.clip = null;
  }

}

export function add3(v: V3, x: number, y: number, z: number): V3 {
  return [v[0] + x, v[1] + y, v[2] + z];
}

export function drawShoe(c: Ctx2, i: 0 | 1, st: Resolved) {
  const { rig } = c;
  const an = rig.ankle[i];
  const pitch = rig.pitch[i];
  const yaw = rig.toeYaw[i] * SIDE[i];
  const style = styleOf(st);
  const rot = (dz: number, dy: number): V3 => {
    const z = dz * Math.cos(pitch) - dy * Math.sin(pitch);
    const y = dy * Math.cos(pitch) + dz * Math.sin(pitch);
    return v3(an[0] + z * Math.sin(yaw), an[1] + y, an[2] + z * Math.cos(yaw));
  };
  const heel = c.Pv(rot(-2.4, -2.6));
  const toe = c.Pv(rot(5.4, -2.8));
  const ankleTop = c.Pv(rot(-0.6, 1.8));
  const sole = style === 1 ? '#171520' : style === 2 ? '#241a18' : '#f2efe8';
  const upper = style === 1 ? tonesOf(shade(st.hex, -0.12)) : st.t;
  const soleT = tonesOf(sole);

  // sole
  MAIN.clear();
  MAIN.capsule(heel[0], heel[1] + 1.5, toe[0], toe[1] + 1.5, 3.6, 3.6);
  c.paint(MAIN, soleT, { lw: 1, sw: 2 });
  // upper
  MAIN.clear();
  const rr = 3.6;
  MAIN.capsule(heel[0], heel[1] - 0.2, toe[0], toe[1] - 0.2, rr, rr);
  if (style === 2 || style === 3) {
    const high = c.Pv(rot(-0.8, style === 2 ? 8.5 : 5.5));
    MAIN.capsule(ankleTop[0], ankleTop[1], high[0], high[1], style === 2 ? 4.0 : 3.5, style === 2 ? 4.2 : 3.6);
  } else {
    MAIN.capsule(heel[0], heel[1] - 0.2, ankleTop[0], ankleTop[1], 3.4, 3.2);
  }
  c.paint(MAIN, upper, { lw: 2, sw: 3 });
  const lt = upper.lt;
  const dk = upper.sh;
  const tipDir: P2 = [toe[0] - heel[0], toe[1] - heel[1]];
  const tl = Math.hypot(tipDir[0], tipDir[1]) || 1;
  const along = (t: number, o: number): P2 => {
    const px = heel[0] + tipDir[0] * t;
    const py = heel[1] + tipDir[1] * t;
    return [px + (-tipDir[1] / tl) * o, py + (tipDir[0] / tl) * o];
  };
  if (c.rig.sit || true) {
    // toe cap / laces / gloss depending on the style
    if (style === 0 || style === 3) {
      const cap = tonesOf('#f6f3ec');
      const a = along(0.86, -2.6);
      const b = along(0.86, 2.6);
      c.line(a[0], a[1], b[0], b[1], cap.base);
      const a2 = along(0.97, -2.2);
      const b2 = along(0.97, 2.2);
      c.line(a2[0], a2[1], b2[0], b2[1], cap.base);
      for (const t of [0.2, 0.36, 0.52]) {
        const p = along(t, -0.3);
        c.px(p[0], p[1] - 1, '#f6f3ec');
        c.px(p[0] + 1, p[1] - 1, '#cfc9bd');
      }
      if (style === 3) {
        const hi = c.Pv(rot(-0.8, 4.5));
        c.px(hi[0], hi[1], '#f6f3ec');
        c.px(hi[0] - 1, hi[1], '#f6f3ec');
        c.px(hi[0] + 1, hi[1], '#f6f3ec');
        c.px(hi[0], hi[1] + 1, '#e04848');
      }
    } else if (style === 1) {
      const p = along(0.55, -1.2);
      c.px(p[0], p[1] - 1, '#9d9aa8');
      c.px(p[0] + 1, p[1] - 1, '#c9c6d4');
      const q = along(0.8, 0.4);
      c.px(q[0], q[1] - 1, '#a6a3b2');
      const a = along(0.18, -1);
      c.line(a[0], a[1] - 2, a[0] + 2, a[1] - 2, dk);
    } else {
      // boot: cuff line and highlight
      const hi = c.Pv(rot(-0.8, 8.2));
      c.line(hi[0] - 3, hi[1], hi[0] + 3, hi[1], lt);
      c.line(hi[0] - 3, hi[1] + 1, hi[0] + 3, hi[1] + 1, dk);
      const t = c.Pv(rot(4.6, -1.2));
      c.line(t[0] - 2, t[1] - 1, t[0] + 2, t[1] - 1, lt);
    }
  }
  if (st.item.id === 'shoes.runner') {
    // contrast swoosh along the side and a coloured heel tab
    const sw = tonesOf('#f6f3ec');
    for (const t of [0.3, 0.42, 0.54, 0.66]) {
      const p = along(t, 0.5 - t * 1.2);
      c.px(p[0], p[1] - 1, sw.base);
      c.px(p[0] + 1, p[1] - 1, sw.sh);
    }
    c.px(heel[0], heel[1] - 2, lt);
  }
  if (st.item.id === 'shoes.loafer') {
    // penny-loafer strap with a coin
    const p = along(0.55, -0.4);
    c.line(p[0] - 2, p[1] - 1, p[0] + 2, p[1] - 1, dk);
    c.px(p[0], p[1] - 1, '#d9c36a');
  }
  c.clip = null;
  MAIN.clear();
}

// ---- torso and arms -----------------------------------------------------

export function pelvisPart(c: Ctx2, bt: Resolved) {
  const style = styleOf(bt);
  const col = style === 3 ? tonesOf(shade(bt.hex, -0.04)) : bt.t;
  MAIN.clear();
  torsoHull(c, MAIN, -5.2, 5.5, 0.35, 0.35);
  c.paint(MAIN, style === 2 ? bt.t : col, { lw: 2, sw: 3 });
  MAIN.clear();
  c.clip = null;
}

export function skirtPart(c: Ctx2, bt: Resolved) {
  const { rig } = c;
  const col = bt.t;
  MAIN.clear();
  const pts: P2[] = [];
  const sit = rig.sit;
  const pencil = bt.item.id === 'bottom.pencil';
  const hemY = sit ? rig.hipY + 0.6 : rig.hipY - (pencil ? 9.5 : 12.5);
  const waistY = rig.hipY + 4;
  const hemRx = sit ? (pencil ? 9.8 : 11.2) : pencil ? 9.4 : 12.4;
  const hemRz = sit ? (pencil ? 7.6 : 8.6) : pencil ? 5.8 : 7.4;
  const hemZ = sit ? rig.bz + 7.2 : rig.bz;
  const ringPts: { top: [number, number, number]; bot: [number, number, number] }[] = [];
  for (let n = 0; n < 16; n++) {
    const psi = (n / 16) * Math.PI * 2;
    const top = c.P(Math.sin(psi) * 8.3, waistY, rig.bz + Math.cos(psi) * 5.4);
    const bot = c.P(Math.sin(psi) * hemRx, hemY, hemZ + Math.cos(psi) * hemRz);
    ringPts.push({ top, bot });
    pts.push([top[0], top[1]], [bot[0], bot[1]]);
  }
  MAIN.hull(pts);
  c.paint(MAIN, col, { lw: 2, sw: 3 });
  // pleats: vertical folds only on the camera-facing half
  for (let n = 0; n < 16; n++) {
    const r = ringPts[n];
    if (r.bot[2] < 0.5) continue;
    if (pencil && n !== 0 && n !== 1 && n !== 15) continue; // a pencil skirt has one back/front seam, not pleats
    const dark = n % 2 === 0;
    c.line(r.top[0], r.top[1] + 1, r.bot[0], r.bot[1] - 1, dark ? col.sh : col.lt);
  }
  // hem line
  const hemPts = ringPts.filter((r) => r.bot[2] > 0).map((r) => r.bot);
  for (let k = 0; k + 1 < hemPts.length; k++) c.line(hemPts[k][0], hemPts[k][1] - 1, hemPts[k + 1][0], hemPts[k + 1][1] - 1, col.sh);
  MAIN.clear();
  c.clip = null;
}

export function tuckedBelt(c: Ctx2) {
  // belt for trousers, drawn on the pelvis hull top
  const belt = '#2a2230';
  const buckle = '#d9c36a';
  for (let k = -5; k <= 5; k++) {
    const psi = (k / 5) * 1.35;
    const p = torsoPoint(c, psi, 2.2, 0.35);
    if (p[2] <= 0.2) continue;
    const q = torsoPoint(c, psi, 3.9, 0.35);
    c.line(p[0], p[1], q[0], q[1], belt);
  }
  const b = torsoPoint(c, 0, 3, 0.4);
  if (b[2] > 0.5) {
    c.px(b[0], b[1] - 1, buckle);
    c.px(b[0] - 1, b[1], buckle);
    c.px(b[0], b[1], '#8a7a3a');
    c.px(b[0] + 1, b[1], buckle);
    c.px(b[0], b[1] + 1, buckle);
  }
}

interface TopSpec {
  sleeve: number; // 0 sleeveless, 0.5 short, 1 long
  hemY: number;
}
export const specOf = (it: Resolved): TopSpec => (it.item.id === 'top.tank' ? { sleeve: 0, hemY: -2.4 } : TOP_SPECS[styleOf(it)] ?? TOP_SPECS[0]);
const TOP_SPECS: TopSpec[] = [
  { sleeve: 0.55, hemY: -2.4 }, // camiseta
  { sleeve: 1, hemY: 0.4 }, // social
  { sleeve: 1, hemY: -3.4 }, // moletom
  { sleeve: 1, hemY: -3.2 }, // blazer
  { sleeve: 0.5, hemY: -2.2 }, // polo
  { sleeve: 1, hemY: -3.0 }, // suéter
];

export function torsoPart(c: Ctx2, it: Resolved) {
  const style = styleOf(it);
  const spec = specOf(it);
  const col = it.t;
  MAIN.clear();
  torsoHull(c, MAIN, spec.hemY, 22.4, 0.3, 0.3);
  c.paint(MAIN, col, {
    lw: 2,
    sw: 4,
    deco:
      style === 5
        ? (x, y, tone) => (y % 4 === 0 ? (tone === 2 ? col.sh : col.lt) : undefined)
        : it.item.id === 'top.striped'
          ? (x, y, tone) => {
              const w = tonesOf('#f4f1ea');
              return Math.floor(y / 2) % 2 === 0 ? (tone === 2 ? w.sh : tone === 0 ? w.lt : w.base) : undefined;
            }
          : undefined,
  });

  // fold lines
  const fold = mix(col.sh, col.base, 0.35);
  // hem
  const hemTone = style === 2 || style === 5 ? col.sh : col.sh;
  surfLine(c, -1.45, spec.hemY + 0.8, 1.45, spec.hemY + 0.8, hemTone, 0.3);
  if (style === 2 || style === 5) {
    surfLine(c, -1.45, spec.hemY + 2.0, 1.45, spec.hemY + 2.0, mix(col.sh, col.base, 0.5), 0.3);
    surfLine(c, -1.45, spec.hemY + 3.0, 1.45, spec.hemY + 3.0, col.sh, 0.3);
  }
  // shoulder seam
  for (const sg of SIDE) {
    const a = torsoPoint(c, sg * 1.3, 17.6, 0.2);
    const b = torsoPoint(c, sg * 1.0, 13.6, 0.2);
    if (a[2] > 0.3) c.line(a[0], a[1], b[0], b[1], col.sh);
  }

  neckline(c, it);
  if (it.item.id === 'top.wv' && !c.back) {
    // chest logo: a small gold "W" on the wearer's left (screen right in the front view)
    const p = torsoPoint(c, 0.5, 14.2, 0.4);
    if (p[2] > 0.4) {
      const g = '#ffe27a';
      for (const [dx, dy] of [[0, 0], [2, 0], [4, 0], [0, 1], [2, 1], [4, 1], [1, 2], [3, 2]] as const) c.px(p[0] - 2 + dx, p[1] - 1 + dy, g);
    }
  }
  MAIN.clear();
  c.clip = null;
}

/** Neck opening and per-style collar/front details. */
function neckline(c: Ctx2, it: Resolved) {
  const style = styleOf(it);
  const col = it.t;
  const skin = c.skin;
  const front = !c.back;
  const white = tonesOf('#f4f1ea');
  const accent = '#b3361f';
  // opening
  const openPts: P2[] = [];
  const wide = it.item.id === 'top.tank';
  const dip = wide ? 6.4 : style === 1 || style === 4 ? 2.6 : style === 3 ? 4.5 : style === 5 ? 3.0 : 3.4;
  const widthA = wide ? 7.6 : style === 3 ? 3.7 : 4.3;
  for (let n = 0; n <= 10; n++) {
    const psi = -Math.PI * 0.5 + (n / 10) * Math.PI;
    const p = c.P(
      widthA * Math.sin(psi) * 1.0,
      levelY(c, 22.5 - (front ? dip * Math.cos(psi) * (style === 3 ? 1 : 1) : 0.8 * Math.cos(psi))),
      c.rig.bz + 3.4 * Math.cos(psi) * (front ? 1 : -1) * (front ? 1 : 1),
    );
    openPts.push([p[0], p[1]]);
  }
  const top = c.P(0, levelY(c, 26), c.rig.bz);
  const a = c.P(-widthA, levelY(c, 26), c.rig.bz);
  const b = c.P(widthA, levelY(c, 26), c.rig.bz);
  AUX.clear();
  const poly: P2[] = [...openPts.map((p) => [p[0], p[1]] as P2)];
  poly.push([b[0], b[1] - 4], [top[0], top[1] - 4], [a[0], a[1] - 4]);
  AUX.poly(poly);
  if (style !== 2) {
    AUX.and(MAINcopyGuard(MAIN));
    paintNeckHole(c, AUX, skin);
  }
  AUX.clear();

  // style specific
  if (style === 0) {
    // crew-neck ribbing
    for (let n = 0; n <= 10; n++) {
      const psi = -Math.PI * 0.5 + (n / 10) * Math.PI;
      const p = c.P(
        (widthA + 0.6) * Math.sin(psi),
        levelY(c, 22.5 - (front ? (dip - 0.9) * Math.cos(psi) : 0.2 * Math.cos(psi))),
        c.rig.bz + (3.8 * Math.cos(psi)),
      );
      if (p[2] > -0.5 || !front) c.px(p[0], p[1] + 1, col.sh);
    }
  } else if (style === 1 || style === 4) {
    // collar flaps + placket + buttons
    const flap = style === 1 ? white : tonesOf(shade(col.base, 0.08));
    if (front) {
      AUX.clear();
      const l = [
        c.P(-4.6, levelY(c, 23.5), c.rig.bz + 2.5),
        c.P(-0.4, levelY(c, 18.6), c.rig.bz + 5.6),
        c.P(-0.2, levelY(c, 22.3), c.rig.bz + 4.4),
        c.P(-4.0, levelY(c, 24.6), c.rig.bz + 1),
      ];
      const r = [
        c.P(4.6, levelY(c, 23.5), c.rig.bz + 2.5),
        c.P(0.4, levelY(c, 18.6), c.rig.bz + 5.6),
        c.P(0.2, levelY(c, 22.3), c.rig.bz + 4.4),
        c.P(4.0, levelY(c, 24.6), c.rig.bz + 1),
      ];
      for (const poly2 of [l, r]) {
        AUX.clear();
        AUX.poly(poly2.map((p) => [p[0], p[1]] as P2));
        c.paint(AUX, flap, { lw: 1, sw: 2 });
      }
      AUX.clear();
      // placket
      surfLine(c, 0, 18.5, 0, 0.6, col.sh, 0.4);
      for (const yy of style === 1 ? [16.2, 12.4, 8.6, 4.8] : [17.5, 14]) {
        const p = torsoPoint(c, 0, yy, 0.4);
        if (p[2] > 0.3) {
          c.px(p[0], p[1], style === 1 ? '#ece7da' : '#e9e4d6');
          c.px(p[0] + 1, p[1], col.sh);
        }
      }
      if (style === 1) {
        // pocket
        const p0 = torsoPoint(c, -0.62, 11.4, 0.3);
        const p1 = torsoPoint(c, -0.2, 11.4, 0.3);
        const p2 = torsoPoint(c, -0.62, 7.4, 0.3);
        const p3 = torsoPoint(c, -0.2, 7.4, 0.3);
        if (p0[2] > 0) {
          c.line(p0[0], p0[1], p1[0], p1[1], col.sh);
          c.line(p0[0], p0[1], p2[0], p2[1], col.sh);
          c.line(p1[0], p1[1], p3[0], p3[1], col.sh);
          c.line(p2[0], p2[1], p3[0], p3[1], col.sh);
        }
      }
    } else {
      // back collar band
      surfLine(c, Math.PI - 0.9, 22.2, Math.PI + 0.9, 22.2, (style === 1 ? white : col).lt, 0.3);
      surfLine(c, Math.PI - 0.9, 21.2, Math.PI + 0.9, 21.2, (style === 1 ? white : col).base, 0.3);
    }
  } else if (style === 2) {
    // hood rim around the neck + drawstrings + kangaroo pocket
    if (front) {
      for (let n = 0; n <= 12; n++) {
        const psi = -Math.PI * 0.5 + (n / 12) * Math.PI;
        const p = c.P(5.6 * Math.sin(psi), levelY(c, 21.5 - 3.5 * Math.cos(psi)), c.rig.bz + 4.6 * Math.cos(psi));
        c.px(p[0], p[1], col.sh);
        c.px(p[0], p[1] - 1, col.lt);
      }
      for (const sg of SIDE) {
        surfLine(c, sg * 0.2, 17.5, sg * 0.2, 9.2, '#f1ede2', 0.5);
        const tip = torsoPoint(c, sg * 0.2, 8.4, 0.5);
        if (tip[2] > 0) c.px(tip[0], tip[1], '#d8d2c2');
      }
      // pocket
      const q = [torsoPoint(c, -0.95, 7.2, 0.4), torsoPoint(c, 0.95, 7.2, 0.4), torsoPoint(c, 0.95, -0.4, 0.4), torsoPoint(c, -0.95, -0.4, 0.4)];
      surfLine(c, -0.95, 7.2, 0.95, 7.2, col.sh, 0.4);
      surfLine(c, -0.95, 7.2, -0.95, 0.4, col.sh, 0.4);
      surfLine(c, 0.95, 7.2, 0.95, 0.4, col.sh, 0.4);
      surfLine(c, -0.9, 6.2, 0.9, 6.2, col.lt, 0.4);
      void q;
    } else {
      surfLine(c, Math.PI - 1.0, 20.5, Math.PI + 1.0, 20.5, col.sh, 0.3);
    }
  } else if (style === 3) {
    // blazer: lapels over a shirt with a tie
    if (front) {
      AUX.clear();
      AUX.poly(
        [
          c.P(-3.4, levelY(c, 23), c.rig.bz + 3),
          c.P(3.4, levelY(c, 23), c.rig.bz + 3),
          c.P(1.2, levelY(c, 6.4), c.rig.bz + 5.9),
          c.P(-1.2, levelY(c, 6.4), c.rig.bz + 5.9),
        ].map((p) => [p[0], p[1]] as P2),
      );
      AUX.and(MAINcopyGuard(MAIN));
      c.paint(AUX, white, { lw: 1, sw: 1, outline: false });
      c.clip = AUX;
      // tie
      const t0 = c.P(0, levelY(c, 20.5), c.rig.bz + 5.2);
      const t1 = c.P(0, levelY(c, 9), c.rig.bz + 5.9);
      c.line(t0[0] - 1, t0[1], t1[0] - 1, t1[1] + 1, '#d24a35');
      c.line(t0[0], t0[1], t1[0], t1[1] + 1, accent);
      c.line(t0[0] + 1, t0[1] + 1, t1[0] + 1, t1[1], '#8a2616');
      c.px(t0[0], t0[1], '#8a2616');
      c.px(t0[0] - 1, t0[1], '#8a2616');
      c.clip = null;
      AUX.clear();
      // lapels
      for (const sg of SIDE) {
        AUX.clear();
        AUX.poly(
          [
            c.P(sg * 4.8, levelY(c, 22.6), c.rig.bz + 1.8),
            c.P(sg * 3.4, levelY(c, 22.6), c.rig.bz + 3),
            c.P(sg * 1.2, levelY(c, 6.4), c.rig.bz + 5.9),
            c.P(sg * 4.8, levelY(c, 10.5), c.rig.bz + 5.4),
            c.P(sg * 6.3, levelY(c, 17), c.rig.bz + 4.3),
          ].map((p) => [p[0], p[1]] as P2),
        );
        AUX.and(MAINcopyGuard(MAIN));
        c.paint(AUX, tonesOf(shade(col.base, 0.06)), { lw: 1, sw: 2 });
        AUX.clear();
      }
      // buttons and pocket flap
      const bt = torsoPoint(c, 0.0, 5.6, 0.5);
      if (bt[2] > 0) {
        c.px(bt[0], bt[1], '#1f1c26');
        c.px(bt[0] - 1, bt[1], col.sh);
      }
      surfLine(c, 0.45, 5.0, 1.0, 5.4, col.sh, 0.4);
      const hk = torsoPoint(c, -0.95, 12.6, 0.4);
      if (hk[2] > 0) {
        c.px(hk[0], hk[1], '#f4f1ea');
        c.px(hk[0] + 1, hk[1], '#cfc9bd');
        c.px(hk[0] + 2, hk[1] - 1, '#e04848');
      }
    } else {
      surfLine(c, Math.PI, 20, Math.PI, -2.4, col.sh, 0.4);
      surfLine(c, Math.PI - 0.5, 2, Math.PI - 0.45, -2.6, col.sh, 0.4);
    }
  } else if (style === 5) {
    // chunky knit collar
    if (front) {
      for (let n = 0; n <= 10; n++) {
        const psi = -Math.PI * 0.5 + (n / 10) * Math.PI;
        const p = c.P(5.2 * Math.sin(psi), levelY(c, 22.2 - 3.0 * Math.cos(psi)), c.rig.bz + 4.2 * Math.cos(psi));
        c.px(p[0], p[1] - 1, col.lt);
        c.px(p[0], p[1], col.base);
        c.px(p[0], p[1] + 1, col.sh);
      }
    }
  }
}

/** Keeps `m` only; used to clip neck-hole shapes to the torso. */
function MAINcopyGuard(m: Mask) {
  return m;
}

function paintNeckHole(c: Ctx2, m: Mask, skin: Tones) {
  // darker skin in the opening (the neck sits in shade under the chin)
  const hex = mix(skin.sh, skin.base, 0.3);
  for (let y = m.y0; y <= m.y1; y++) {
    for (let x = m.x0; x <= m.x1; x++) {
      if (m.a[y * FW + x]) c.buf[y * FW + x] = C(hex);
    }
  }
}

export function armPart(c: Ctx2, i: 0 | 1) {
  const { rig } = c;
  const sl = c.sleeve;
  const spec = { sleeve: sl?.len ?? 0 };
  const sh = c.Pv(rig.shoulder[i]);
  const el = c.Pv(rig.elbow[i]);
  const wr = c.Pv(rig.wrist[i]);
  const col = sl?.it.t ?? c.hair;
  const shS: P2 = [sh[0], sh[1]];
  const elS: P2 = [el[0], el[1]];
  const wrS: P2 = [wr[0], wr[1]];
  // hand direction: continue the forearm
  const fd = vNorm(vSub(rig.wrist[i], rig.elbow[i]));
  const tip = c.Pv(vAdd(rig.wrist[i], vMul(fd, 6.2)));
  const tipS: P2 = [tip[0], tip[1]];
  const rU0 = 3.6;
  const rU1 = 3.3;
  const rF1 = 2.8;

  // skin: whole arm + hand
  MAIN.clear();
  MAIN.capsule(shS[0], shS[1], elS[0], elS[1], rU0, rU1);
  MAIN.capsule(elS[0], elS[1], wrS[0], wrS[1], rU1, rF1);
  c.paint(MAIN, c.skin, { lw: 2, sw: 3 });
  MAIN.clear();

  // sleeve
  if (sl) {
  const upperEnd = Math.min(1, spec.sleeve * 1.0 + (spec.sleeve < 1 ? 0.05 : 0));
  AUX.clear();
  AUX.capsule(shS[0], shS[1], ...(lerp2(shS, elS, Math.min(1, upperEnd)) as P2), rU0 + 0.5, spec.sleeve >= 1 ? rU1 + 0.5 : rU0 + 0.1);
  if (spec.sleeve >= 1) {
    const fe = lerp2(elS, wrS, 0.86);
    AUX.capsule(elS[0], elS[1], fe[0], fe[1], rU1 + 0.5, rF1 + 0.5);
  }
  c.paint(AUX, col, { lw: 2, sw: 3 });
  // sleeve hem / cuff
  if (spec.sleeve < 1) {
    const e = lerp2(shS, elS, upperEnd);
    const hemTone = col.sh;
    const p0 = limbPt(shS, elS, upperEnd, -1.0, rU0);
    const p1 = limbPt(shS, elS, upperEnd, 1.0, rU0);
    c.line(p0[0], p0[1], p1[0], p1[1], hemTone);
    void e;
  } else {
    const p0 = limbPt(elS, wrS, 0.84, -1.0, rF1 + 0.4);
    const p1 = limbPt(elS, wrS, 0.84, 1.0, rF1 + 0.4);
    const p2 = limbPt(elS, wrS, 0.74, -1.0, rF1 + 0.5);
    const p3 = limbPt(elS, wrS, 0.74, 1.0, rF1 + 0.5);
    const cuff = sl.cuff === 'shirt' ? '#f4f1ea' : col.lt;
    c.line(p0[0], p0[1], p1[0], p1[1], sl.cuff === 'shirt' ? '#cfc9bd' : col.sh);
    c.line(p2[0], p2[1], p3[0], p3[1], cuff);
    if (sl.cuff === 'rib') {
      const p4 = limbPt(elS, wrS, 0.64, -1.0, rF1 + 0.5);
      const p5 = limbPt(elS, wrS, 0.64, 1.0, rF1 + 0.5);
      c.line(p4[0], p4[1], p5[0], p5[1], col.sh);
    }
  }
  // elbow wrinkle and sleeve fold
  {
    const p0 = limbPt(shS, elS, 0.9, -0.5, rU1);
    const p1 = limbPt(shS, elS, 0.98, 0.5, rU1);
    if (spec.sleeve >= 1) c.line(p0[0], p0[1], p1[0], p1[1], col.sh);
  }
  }
  AUX.clear();
  c.clip = null;

  // hand: a small skin block at the end of the forearm
  MAIN.clear();
  const hc2 = lerp2(wrS, tipS, 0.6);
  MAIN.capsule(wrS[0], wrS[1], hc2[0], hc2[1], 2.6, 2.6);
  c.paint(MAIN, c.skin, { lw: 2, sw: 2 });
  MAIN.clear();
  c.clip = null;
}

export function lerp2(a: P2, b: P2, t: number): P2 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

// ---- head -----------------------------------------------------------------

export function headCenter(c: Ctx2): P2 {
  const p = c.Pv(c.rig.head);
  return [p[0], p[1]];
}

export function headMask(m: Mask, cx: number, cy: number, grow = 0) {
  const rx = HEAD_RX + grow;
  const ry = HEAD_RY + grow;
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
    const dy = (y + 0.5 - cy) / ry;
    if (Math.abs(dy) > 1) continue;
    const n = 3.0;
    let w = rx * Math.pow(1 - Math.pow(Math.abs(dy), n), 1 / n);
    if (dy > 0) w *= 1 - 0.14 * Math.pow(dy, 2.2);
    for (let x = Math.floor(cx - w - 1); x <= Math.ceil(cx + w); x++) {
      if (Math.abs(x + 0.5 - cx) <= w) m.set(x, y);
    }
  }
}

export function neckPart(c: Ctx2) {
  const { rig } = c;
  const a = c.P(0, levelY(c, 20), rig.bz);
  const b = c.P(0, levelY(c, 29), rig.bz);
  MAIN.clear();
  MAIN.capsule(a[0], a[1], b[0], b[1], 3.6, 3.4);
  c.paint(MAIN, tonesOf(mix(c.skin.sh, c.skin.base, 0.2), true), { lw: 1, sw: 1 });
  MAIN.clear();
  c.clip = null;
}

/** Angle on the head sphere to screen: returns [screenX, depth] for a lateral angle and height. */
export function facePoint(c: Ctx2, cx: number, cy: number, alpha: number, dy: number): { x: number; y: number; vis: number } {
  const g = alpha + c.th * FACE_YAW;
  const beta = Math.asin(Math.max(-0.99, Math.min(0.99, dy / HEAD_RY)));
  return { x: cx + HEAD_RX * Math.sin(g) * Math.cos(beta), y: cy - dy, vis: Math.cos(g) * Math.cos(beta) };
}

/** Very simple face: two dark dot eyes, a tiny mouth and (when facing front) soft cheeks. */
function drawBlush(c: Ctx2, cx: number, cy: number) {
  // cheeks: one flat pink block each (part of the base face, under the eyes/brows/mouth items)
  const blush = mix(c.skin.base, '#f0707e', 0.45);
  for (const sg of SIDE) {
    const p = facePoint(c, cx, cy, sg * 0.7, -5.2);
    if (p.vis > 0.3) {
      c.px(p.x - 1, p.y, blush);
      c.px(p.x, p.y, blush);
    }
  }
}

export function earMask(c: Ctx2, m: Mask, cx: number, cy: number, sg: number, grow = 0) {
  const g = sg * 1.5708 + c.th;
  const vis = Math.cos(g);
  const ex = cx + (HEAD_RX + 0.4) * Math.sin(g);
  const w = Math.max(1.1, 2.6 * Math.abs(vis) + 1.0);
  m.ellipse(ex, cy + 1.4, w + grow, 3.4 + grow);
  return { x: ex, vis, w };
}

export function headPart(c: Ctx2) {
  const [cx, cy] = headCenter(c);
  const skin = c.skin;

  // ears
  for (const sg of SIDE) {
    const g = sg * 1.5708 + c.th;
    if (Math.cos(g) < -0.55) continue;
    MAIN.clear();
    const e = earMask(c, MAIN, cx, cy, sg);
    if (e.vis < -0.2) {
      MAIN.clear();
      continue;
    }
    c.paint(MAIN, skin, { lw: 1, sw: 2 });
    const inner = mix(skin.base, skin.sh, 0.7);
    c.px(e.x, cy + 1.2, inner);
    c.px(e.x, cy + 2.2, inner);
    MAIN.clear();
    c.clip = null;
  }

  // head
  MAIN.clear();
  headMask(MAIN, cx, cy);
  c.paint(MAIN, skin, {
    lw: 3,
    sw: 4,
    deco: (x, y, tone) => {
      // soft jaw and cheek shading
      if (tone === 2 && y > cy + 9) return mix(skin.sh, skin.ol, 0.15);
      return undefined;
    },
  });
  c.headClip.clear();
  for (let y = MAIN.y0; y <= MAIN.y1; y++) for (let x = MAIN.x0; x <= MAIN.x1; x++) if (MAIN.a[y * FW + x]) c.headClip.set(x, y);
  if (c.face) drawBlush(c, cx, cy);
  MAIN.clear();
  c.clip = null;
}

const seedOf = (it: Resolved) => ([...(it.ref.color ?? '')].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) | 0, 7) & 0xffff) % 997;

// ---- hair ---------------------------------------------------------------

function hairTones(c: Ctx2) {
  return c.hair;
}

export function strandDeco(c: Ctx2, wx: number, wy: number, seed: number) {
  void wx;
  void wy;
  void seed;
  void c;
  return (_x: number, _y: number, _tone: 0 | 1 | 2): string | undefined => undefined;
}

/** Face (skin) region of the head, in screen space, used to cut the hairline. */
export function faceRegion(c: Ctx2, m: Mask, cx: number, cy: number, top = -7.8) {
  const sn = c.sn;
  const fx = cx + 5.2 * sn;
  const rx = 11.2 - 1.4 * Math.abs(sn);
  const ry = 12.4;
  const cyF = cy + top + ry;
  m.ellipse(fx, cyF, rx, ry);
}

export function hairCap(c: Ctx2, m: Mask, cx: number, cy: number, o: { grow?: number; topGrow?: number; lowY?: number; cutFace?: boolean; hairline?: number } = {}) {
  const grow = o.grow ?? 1.3;
  const topGrow = o.topGrow ?? 2.4;
  const lowY = o.lowY ?? 5.5;
  // expanded head
  AUX.clear();
  headMask(AUX, cx, cy - 0.4, grow);
  // add crown volume
  AUX.ellipse(cx, cy - 4.2, HEAD_RX + grow, HEAD_RY - 1 + topGrow);
  // limit to above the sideburn line (front) or the nape (back)
  if (c.back) {
    for (let y = Math.floor(cy + lowY + 5); y < FH; y++) for (let x = 0; x < FW; x++) AUX.a[y * FW + x] = 0;
  } else {
    for (let y = Math.floor(cy + lowY); y < FH; y++) for (let x = 0; x < FW; x++) AUX.a[y * FW + x] = 0;
  }
  for (let y = AUX.y0; y <= AUX.y1; y++) for (let x = AUX.x0; x <= AUX.x1; x++) if (AUX.a[y * FW + x]) m.set(x, y);
  AUX.clear();
  if (!c.back && o.cutFace !== false) {
    AUX2.clear();
    faceRegion(c, AUX2, cx, cy, o.hairline ?? -7.6);
    m.sub(AUX2);
    AUX2.clear();
  }
}

export function cutEars(c: Ctx2, m: Mask, cx: number, cy: number) {
  for (const sg of SIDE) {
    const g = sg * 1.5708 + c.th;
    if (Math.cos(g) < -0.2) continue;
    AUX2.clear();
    earMask(c, AUX2, cx, cy, sg, 0.8);
    m.sub(AUX2);
    AUX2.clear();
  }
}

export function drawHair(c: Ctx2, cx: number, cy: number, it: Resolved) {
  const style = styleOf(it);
  if (style === 4) return;
  const t = it.t;
  const sn = c.sn;
  const seed = seedOf(it) * 13 + style;
  const wx = cx - 2 + 3 * sn;
  const wy = cy - HEAD_RY + 4;
  const deco = strandDeco(c, wx, wy, seed);
  // glossy highlight band on the crown
  const shineDeco = (x: number, y: number, tone: 0 | 1 | 2): string | undefined => {
    const dx = x - (cx - 2.5);
    const dy = y - (cy - 3);
    const r = Math.hypot(dx, dy);
    const ang = Math.atan2(dy, dx);
    if (ang < -1.15 && ang > -2.55 && r > 10.3 && r < 12.8 && !c.back) return t.lt;
    if (c.back && ang < -1.1 && ang > -2.7 && r > 9 && r < 11.5) return t.lt;
    return deco(x, y, tone);
  };

  MAIN.clear();
  const short = style === 0 || style === 2 || style === 3 || style === 8 || style === 6;

  if (style === 5) {
    // black power: big round volume
    AUX2.clear();
    MAIN.ellipse(cx + 0.5 * sn, cy - 3.6, 17.2, 16.4);
    for (let n = 0; n < 16; n++) {
      const a = (n / 16) * Math.PI * 2;
      MAIN.ellipse(cx + 0.5 * sn + Math.cos(a) * 15.4, cy - 3.6 + Math.sin(a) * 14.6, 3.1, 3.1);
    }
    if (!c.back) {
      faceRegion(c, AUX2, cx, cy, -7.2);
      MAIN.sub(AUX2);
      AUX2.clear();
      // the rest of the head below the hair stays skin: cut the lower part
      for (let y = Math.floor(cy + 6); y < FH; y++) for (let x = 0; x < FW; x++) MAIN.a[y * FW + x] = 0;
      cutEars(c, MAIN, cx, cy);
    } else {
      for (let y = Math.floor(cy + 12); y < FH; y++) for (let x = 0; x < FW; x++) MAIN.a[y * FW + x] = 0;
    }
    c.paint(MAIN, t, { lw: 3, sw: 4, deco: curlDeco(c, seed) });
    MAIN.clear();
    c.clip = null;
    return;
  }

  hairCap(c, MAIN, cx, cy, {
    grow: style === 7 ? 1.8 : 1.3,
    topGrow: style === 8 ? 2.2 : 2.6,
    lowY: style === 7 ? 6 : 5.2,
  });
  if (short || style === 1) cutEars(c, MAIN, cx, cy);

  // front fringe (bangs) per style
  if (!c.back) fringe(c, MAIN, cx, cy, style);

  if (style === 2) {
    // spikes are part of the same mask so the contour is continuous
    const spikes: [number, number, number][] = [
      [-9.5, -9, 9],
      [-4.5, -12, 12],
      [1.5, -13, 14],
      [7, -11, 12],
      [11, -7, 8],
    ];
    for (const [ox, oy, h] of spikes) {
      const x = cx + ox * Math.cos(c.th * 0.3) + sn * 1.5;
      const baseY = cy + oy;
      MAIN.poly([
        [x - 3.6, baseY + 4],
        [x + 3.6, baseY + 4],
        [x + (ox > 0 ? 1.2 : -0.6), baseY - h * 0.5 - 2],
      ]);
    }
  }
  if (style === 3) {
    // bun on the crown, slightly behind
    const bp = c.P(0, c.rig.head[1] + HEAD_RY + 3.2, c.rig.head[2] - 3.5);
    MAIN.ellipse(bp[0], bp[1], 5.8, 5.6);
  }
  if (style === 8) {
    // pompadour: raised, swept volume
    const q = cx + 2.6 * sn;
    MAIN.ellipse(q + 1.5, cy - HEAD_RY - 0.8, 10.8, 5.4);
    MAIN.ellipse(q + 6, cy - HEAD_RY - 2.2, 7, 4.2);
  }
  c.paint(MAIN, t, { lw: 3, sw: 4, deco: shineDeco });
  if (style === 3) {
    const bp = c.P(0, c.rig.head[1] + HEAD_RY + 3.2, c.rig.head[2] - 3.5);
    c.px(bp[0] - 2, bp[1] - 2, mix(t.lt, '#ffffff', 0.3));
    c.px(bp[0] - 1, bp[1] - 3, mix(t.lt, '#ffffff', 0.3));
    c.line(bp[0] - 5, bp[1] + 4, bp[0] + 5, bp[1] + 4, t.sh);
  }
  if (style === 6) ponytail(c, cx, cy, deco, 'front');
  MAIN.clear();
  c.clip = null;
}

/** Hair masses that hang behind the head/torso: drawn as their own depth-sorted part. */
export function hairBackPart(c: Ctx2, it: Resolved) {
  const style = styleOf(it);
  if (style !== 1 && style !== 6 && style !== 7) return;
  const [cx, cy] = headCenter(c);
  const seed = seedOf(it) * 13 + style;
  const deco = strandDeco(c, cx - 2 + 3 * c.sn, cy - HEAD_RY + 4, seed);
  if (style === 1) longHairBack(c, cx, cy, deco);
  else if (style === 6) ponytail(c, cx, cy, deco, 'behind');
  else bobBack(c, cx, cy, deco);
}

export function curlDeco(c: Ctx2, seed: number) {
  const t = c.hair;
  return (x: number, y: number, tone: 0 | 1 | 2): string | undefined => {
    // chunky 3px curls: a light dot and a dark dot per cell
    const cx3 = Math.floor(x / 3);
    const cy3 = Math.floor(y / 3);
    if (hash2(cx3, cy3, seed) < 0.3 && x % 3 === 1 && y % 3 === 1) return tone === 2 ? t.ol : tone === 0 ? t.lt : t.sh;
    return undefined;
  };
}

export function fringe(c: Ctx2, m: Mask, cx: number, cy: number, style: number) {
  const sn = c.sn;
  const s = 4.4 * sn;
  const x = (v: number) => cx + v + s * 0.8;
  const y = (v: number) => cy + v;
  const pts: P2[] = [];
  if (style === 0) {
    pts.push([x(-17), y(-3)], [x(-17), y(-18)], [x(18), y(-18)], [x(18), y(-4.4)], [x(9), y(-6)], [x(5.5), y(-3.2)], [x(2), y(-6.6)], [x(-2.4), y(-3.6)], [x(-6), y(-6)], [x(-9.4), y(-1.6)]);
  } else if (style === 1) {
    // centre part
    pts.push([x(-17), y(-1)], [x(-17), y(-18)], [x(18), y(-18)], [x(18), y(-1)], [x(10), y(-4)], [x(5), y(-6.4)], [x(0.6), y(-8)], [x(-1), y(-6.4)], [x(-6), y(-4.2)], [x(-10), y(-1)]);
  } else if (style === 2) {
    pts.push([x(-17), y(-6)], [x(-17), y(-18)], [x(18), y(-18)], [x(18), y(-6)], [x(8), y(-8.4)], [x(0), y(-7)], [x(-6), y(-8.4)]);
  } else if (style === 3) {
    pts.push([x(-17), y(-5)], [x(-17), y(-18)], [x(18), y(-18)], [x(18), y(-5)], [x(8), y(-7.6)], [x(2), y(-6.2)], [x(-5), y(-8)]);
  } else if (style === 6) {
    pts.push([x(-17), y(-3)], [x(-17), y(-18)], [x(18), y(-18)], [x(18), y(-3)], [x(8), y(-6.6)], [x(3), y(-4.6)], [x(-3), y(-7)], [x(-8), y(-3.4)]);
  } else if (style === 7) {
    // straight fringe
    pts.push([x(-17), y(-0.5)], [x(-17), y(-18)], [x(18), y(-18)], [x(18), y(-0.5)], [x(9), y(-3.6)], [x(4), y(-3.2)], [x(-1), y(-3.8)], [x(-6), y(-3.2)], [x(-10), y(-3.6)]);
  } else if (style === 8) {
    pts.push([x(-17), y(-7)], [x(-17), y(-18)], [x(18), y(-18)], [x(18), y(-6)], [x(7), y(-9.6)], [x(0), y(-9)], [x(-6), y(-8)]);
  } else return;
  AUX.clear();
  AUX.poly(pts);
  // only inside the head silhouette (bangs must not float outside)
  AUX2.clear();
  headMask(AUX2, cx, cy - 0.4, 1.8);
  AUX2.ellipse(cx, cy - 4.2, HEAD_RX + 1.8, HEAD_RY + 1.6);
  AUX.and(AUX2);
  AUX2.clear();
  for (let yy = AUX.y0; yy <= AUX.y1; yy++) for (let xx = AUX.x0; xx <= AUX.x1; xx++) if (AUX.a[yy * FW + xx]) m.set(xx, yy);
  AUX.clear();
}

export function longHairBack(c: Ctx2, cx: number, cy: number, deco: (x: number, y: number, t: 0 | 1 | 2) => string | undefined) {
  const t = c.hair;
  const { rig } = c;
  const top = rig.head;
  const dep = (z: number) => z * c.cs;
  void dep;
  const pts: P2[] = [];
  const endY = rig.hipY + 6.5 - rig.breath * 0.6;
  const rows: [number, number, number][] = [
    [top[1] + 3, 12.6, -2],
    [top[1] - 8, 13.4, -5],
    [rig.hipY + 20, 12.4, -6.2],
    [endY + 8, 11.6, -6.4],
    [endY, 10.8, -5.8],
  ];
  for (const [yy, hw, zz] of rows) {
    for (let n = 0; n < 12; n++) {
      const psi = (n / 12) * Math.PI * 2;
      const p = c.P(Math.sin(psi) * hw, yy, rig.bz + zz + Math.cos(psi) * 5.2);
      pts.push([p[0], p[1]]);
    }
  }
  MAIN.clear();
  MAIN.hull(pts);
  if (!c.back) {
    // front views: only the parts outside the head/torso matter, but keep the whole mass behind
  }
  c.paint(MAIN, t, { lw: 3, sw: 4, deco });
  // wavy tips
  MAIN.clear();
  c.clip = null;
}

export function bobBack(c: Ctx2, cx: number, cy: number, deco: (x: number, y: number, t: 0 | 1 | 2) => string | undefined) {
  const t = c.hair;
  MAIN.clear();
  const pts: P2[] = [];
  const rig = c.rig;
  const yb = rig.head[1] - 11.2;
  for (const [yy, hw] of [
    [rig.head[1] + 3, 13.6],
    [rig.head[1] - 5, 14.4],
    [yb, 12.8],
  ] as [number, number][]) {
    for (let n = 0; n < 14; n++) {
      const psi = (n / 14) * Math.PI * 2;
      const p = c.P(Math.sin(psi) * hw, yy, rig.bz - 1.4 + Math.cos(psi) * 11.6);
      pts.push([p[0], p[1]]);
    }
  }
  MAIN.hull(pts);
  if (!c.back) {
    AUX2.clear();
    faceRegion(c, AUX2, cx, cy, -7.4);
    MAIN.sub(AUX2);
    AUX2.clear();
  }
  c.paint(MAIN, t, { lw: 3, sw: 4, deco });
  MAIN.clear();
  c.clip = null;
}

export function ponytail(c: Ctx2, cx: number, cy: number, deco: (x: number, y: number, t: 0 | 1 | 2) => string | undefined, pass: 'behind' | 'front') {
  const t = c.hair;
  const { rig } = c;
  const h = rig.head;
  const pts: V3[] = [
    v3(0, h[1] + 4, h[2] - HEAD_RZ - 0.5),
    v3(2, h[1] - 3, h[2] - HEAD_RZ - 4.5),
    v3(4.4, h[1] - 12, h[2] - HEAD_RZ - 4.2),
    v3(5.6, h[1] - 21, h[2] - HEAD_RZ - 2.4),
  ];
  const rads = [3.2, 4.6, 4.2, 2.4];
  const q = pts.map((p) => c.Pv(p));
  if (pass === 'behind') {
    // visible beside the head in front views, in front of the back in back views
    MAIN.clear();
    for (let i = 0; i + 1 < q.length; i++) MAIN.capsule(q[i][0], q[i][1], q[i + 1][0], q[i + 1][1], rads[i], rads[i + 1]);
    c.paint(MAIN, t, { lw: 3, sw: 4, deco });
    MAIN.clear();
    c.clip = null;
  } else {
    // hair tie
    const a = q[0];
    c.px(a[0] - 2, a[1] + 1, '#d24a35');
    c.px(a[0] - 1, a[1] + 1, '#d24a35');
    c.px(a[0], a[1] + 1, '#d24a35');
    c.px(a[0] + 1, a[1] + 1, '#8a2616');
  }
  void cx;
  void cy;
}

// ---- accessories ----------------------------------------------------------

export function capEdge(c: Ctx2, cx: number, by: number, rr: number, x: number) {
  const u = (x + 0.5 - cx) / rr;
  return by + PITCH * HEAD_RZ * Math.sqrt(Math.max(0, 1 - u * u)) * 1.1;
}

export function drawAccessory(c: Ctx2, cx: number, cy: number, it: Resolved) {
  const acc = styleOf(it);
  if (acc === 0) return;
  const { rig } = c;
  const ink = '#1d1a24';
  const hc = rig.head;

  if (acc === 1 || acc === 4) {
    if (!c.face) {
      // temple arms seen from behind
      for (const sg of SIDE) {
        const p = facePoint(c, cx, cy, sg * 1.25, -1.2);
        if (p.vis > -0.1) c.px(p.x, p.y, ink);
      }
      return;
    }
    const sun = acc === 4;
    const round = it.item.id === 'acc.glasses_round';
    const frame = it.hex;
    const lensCol = sun ? '#1c2030' : '#cfe9ff';
    const pts: { x: number; y: number; w: number }[] = [];
    for (const sg of SIDE) {
      const p = facePoint(c, cx, cy, sg * 0.4, -1.6);
      if (p.vis < 0.12) continue;
      const w = Math.max(3, Math.round(8.2 * p.vis));
      pts.push({ x: p.x, y: p.y, w });
    }
    for (const p of pts) {
      const x0 = Math.round(p.x - p.w / 2);
      const y0 = Math.round(p.y - 4);
      const h = sun ? 7 : round ? 9 : 8;
      for (let yy = 0; yy < h; yy++) {
        for (let xx = 0; xx < p.w; xx++) {
          const edge = yy === 0 || yy === h - 1 || xx === 0 || xx === p.w - 1;
          const corner = (yy === 0 || yy === h - 1) && (xx === 0 || xx === p.w - 1);
          if (corner && p.w > 4) continue;
          // "Óculos redondos": lens cut into an octagon (before, it drew exactly like the regular glasses).
          if (round && Math.min(xx, p.w - 1 - xx) + Math.min(yy, h - 1 - yy) < 2) continue;
          if (edge) c.px(x0 + xx, y0 + yy, frame);
          else {
            let col = lensCol;
            if (sun) col = yy < 3 ? '#2a3350' : '#171a28';
            else col = yy > h - 3 ? '#b4d6f0' : lensCol;
            c.px(x0 + xx, y0 + yy, col);
          }
        }
      }
      // glint
      c.px(x0 + 1, y0 + 1, '#ffffff');
      if (p.w > 5) c.px(x0 + 2, y0 + 1, sun ? '#8aa0d8' : '#ffffff');
      if (sun) c.px(x0 + 1, y0 + 2, '#8aa0d8');
    }
    if (pts.length === 2) {
      const a = pts[0];
      const b = pts[1];
      const left = a.x < b.x ? a : b;
      const right = a.x < b.x ? b : a;
      const xa = Math.round(left.x + left.w / 2);
      const xb = Math.round(right.x - right.w / 2);
      for (let x = xa; x < xb; x++) c.px(x, Math.round(left.y - 2), frame);
    }
    // temple arms toward the ears
    for (const sg of SIDE) {
      const p = facePoint(c, cx, cy, sg * 1.2, -1.2);
      const q = facePoint(c, cx, cy, sg * 0.75, -1.6);
      if (p.vis > 0.02 && q.vis > 0.02) c.line(q.x, q.y - 3, p.x, p.y - 3, frame);
    }
    return;
  }

  if (acc === 2 || acc === 6) {
    // headset / headphones: band over the crown + ear cups
    const headset = acc === 2;
    const band = headset ? '#2b2f3a' : '#3a3f4e';
    const cup = tonesOf(it.hex);
    const rx = HEAD_RX + 1.6;
    const ry = HEAD_RY + 2.4;
    // band as an arc over the head in the lateral plane (x-y)
    const arc: [number, number, number][] = [];
    for (let n = 0; n <= 18; n++) {
      const a = Math.PI - (n / 18) * Math.PI;
      arc.push(c.P(Math.cos(a) * rx, hc[1] - 1 + Math.sin(a) * ry * 0.98, hc[2] - 0.5));
    }
    MAIN.clear();
    for (let i = 0; i + 1 < arc.length; i++) MAIN.capsule(arc[i][0], arc[i][1], arc[i + 1][0], arc[i + 1][1], 1.5, 1.5);
    c.paint(MAIN, tonesOf(band), { lw: 1, sw: 2 });
    MAIN.clear();
    c.clip = null;
    c.px(arc[9][0] - 3, arc[9][1] + 1, '#6a7186');
    c.px(arc[9][0] - 2, arc[9][1] + 1, '#6a7186');
    for (const sg of SIDE) {
      const cupP = c.P(sg * (HEAD_RX + 1.7), hc[1] - 1, hc[2] + 0.5);
      if (cupP[2] < -2.2) continue;
      MAIN.clear();
      const near = cupP[2] > 0;
      const w = near || Math.abs(c.sn) < 0.1 ? 3.6 : 2.8;
      MAIN.ellipse(cupP[0], cupP[1], headset ? w : w + 0.6, headset ? 5.2 : 5.8);
      c.paint(MAIN, cup, { lw: 2, sw: 3 });
      c.px(cupP[0], cupP[1] - 2, cup.lt);
      c.px(cupP[0] + 1, cupP[1] + 1, mix(cup.base, cup.sh, 0.5));
      MAIN.clear();
      c.clip = null;
      if (headset && c.face && sg === (c.sn > 0.3 ? -1 : -1) && cupP[2] > 0) {
        // microphone boom to the mouth
        const m = facePoint(c, cx, cy, -0.72, -8.2);
        c.line(cupP[0], cupP[1] + 4, cupP[0] + 1, cupP[1] + 8, band);
        c.line(cupP[0] + 1, cupP[1] + 8, m.x + 1, m.y - 1, band);
        c.px(m.x + 1, m.y - 1, '#1c1f27');
        c.px(m.x + 2, m.y - 1, '#1c1f27');
        c.px(m.x + 1, m.y, '#4a5062');
      }
    }
    return;
  }

  if (acc === 3 || acc === 5) {
    const beanie = acc === 5;
    const col = tonesOf(it.hex);
    const by = cy + (beanie ? -8.6 : -10.4);
    const rr = HEAD_RX + (beanie ? 2.5 : 1.8);
    MAIN.clear();
    // dome: everything above the band edge
    for (let x = Math.floor(cx - rr - 1); x <= Math.ceil(cx + rr + 1); x++) {
      const edge = capEdge(c, cx, by, rr, x);
      const u = (x + 0.5 - cx) / rr;
      if (Math.abs(u) > 1) continue;
      const topY = cy - 4.4 - (HEAD_RY + 2.6) * Math.sqrt(1 - u * u) - (beanie ? 1.2 : 0);
      for (let y = Math.floor(topY); y <= Math.floor(edge); y++) MAIN.set(x, y);
    }
    c.paint(MAIN, col, {
      lw: 3,
      sw: 4,
      deco: beanie
        ? (x, y, tone) => {
            if (x % 3 === 0 && tone !== 0) return col.sh;
            return undefined;
          }
        : undefined,
    });
    // seams
    if (!beanie) {
      const top = c.P(0, hc[1] + HEAD_RY + 2.4, hc[2]);
      for (let k = 0; k < 5; k++) c.px(top[0] - 1 + Math.sign(c.sn) * 0, top[1] + k * 2 - 1, col.sh);
      c.px(top[0] + 1, top[1] + 1, col.sh);
      c.px(top[0] - 4, top[1] + 3, col.lt);
      c.px(top[0] - 3, top[1] + 2, col.lt);
      c.px(top[0], top[1] - 1, shade(col.base, -0.35));
      c.px(top[0], top[1], shade(col.base, -0.35));
    } else {
      // cuff and pompom
      for (let x = Math.floor(cx - rr - 1); x <= Math.ceil(cx + rr + 1); x++) {
        const edge = capEdge(c, cx, by, rr, x);
        const u = (x + 0.5 - cx) / rr;
        if (Math.abs(u) > 1) continue;
        for (let k = 0; k < 3; k++) {
          c.px(x, Math.floor(edge) - k, k === 0 ? col.sh : k === 1 ? mix(col.base, col.lt, 0.5) : col.lt);
        }
        if (x % 2 === 0) c.px(x, Math.floor(edge) - 1, col.sh);
      }
      const top = c.P(0, hc[1] + HEAD_RY + 4.2, hc[2]);
      MAIN.clear();
      MAIN.ellipse(top[0], top[1], 3.8, 3.8);
      c.paint(MAIN, tonesOf('#f1ede2'), { lw: 2, sw: 2 });
    }
    MAIN.clear();
    c.clip = null;
    if (!beanie) {
      // visor and band
      if (c.face) {
        const brim: P2[] = [];
        const under: P2[] = [];
        for (let n = 0; n <= 10; n++) {
          const a = -1.15 + (n / 10) * 2.3 + c.th * 0;
          const g = a + c.th;
          const inn = c.P(0, 0, 0);
          void inn;
          const p0 = c.P(Math.sin(a) * (HEAD_RX + 1.2), hc[1] + 10, hc[2] + Math.cos(a) * (HEAD_RZ + 1.0));
          const p1 = c.P(Math.sin(a) * (HEAD_RX + 2.4), hc[1] + 9.4, hc[2] + Math.cos(a) * (HEAD_RZ + 5.6));
          void g;
          brim.push([p1[0], p1[1]]);
          under.push([p0[0], p0[1]]);
        }
        MAIN.clear();
        MAIN.poly([...under, ...brim.slice().reverse()]);
        const visor = tonesOf(shade(col.base, -0.18));
        c.paint(MAIN, visor, { lw: 2, sw: 2 });
        // brim highlight edge
        for (let k = 0; k + 1 < brim.length; k++) c.line(brim[k][0], brim[k][1] - 1, brim[k + 1][0], brim[k + 1][1] - 1, shade(col.base, 0.1));
        MAIN.clear();
        c.clip = null;
        const lg = c.P(0, hc[1] + 5, hc[2] + HEAD_RZ + 1.2);
        if (lg[2] > 1) {
          c.px(lg[0] - 1, lg[1], '#f4f1ea');
          c.px(lg[0], lg[1], '#f4f1ea');
          c.px(lg[0] - 1, lg[1] - 1, '#f4f1ea');
          c.px(lg[0], lg[1] - 1, '#cfc9bd');
        }
      } else {
        // strap opening at the back
        const s = c.P(0, hc[1] - 2.6, hc[2] - HEAD_RZ - 1.2);
        for (let k = -3; k <= 3; k++) c.px(s[0] + k, s[1], k % 2 === 0 ? col.sh : shade(col.base, -0.4));
        c.px(s[0] - 3, s[1] + 1, col.sh);
        c.px(s[0] + 3, s[1] + 1, col.sh);
      }
    }
    void ink;
    return;
  }
}


/** Depth of an arm part (the compositor and the items that attach to an arm use the same value). */
export function armDepth(c: Ctx2, i: 0 | 1): number {
  const { rig } = c;
  const dep = (p: V3) => p[2] * c.cs - p[0] * c.sn;
  return (rig.sit ? 100 : 0.3) + (dep(rig.shoulder[i]) + dep(rig.elbow[i]) + dep(rig.wrist[i])) / 3;
}
