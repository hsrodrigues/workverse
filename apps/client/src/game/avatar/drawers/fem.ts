import { mix, shade } from '../../pixel';
import { AUX, MAIN, SIDE, levelY, surfLine, torsoHull, torsoPoint, tuckedBelt, type Ctx2, type P2, type Resolved } from '../engine';
import { tonesOf, type Tones } from '../recolor';
import { registerDrawer } from '../registry';
import { legKit, pelvis } from './bottoms2';

/**
 * Feminine tops, one-piece dresses and a few skirts/trousers/pinafore.
 *
 * - `fem.top`   : bodice kit (straps, strapless, off-shoulder, halter, crop...), the shape comes from \`params.variant\`.
 * - `fem.dress` : bodice + skirt + bare legs. The catalog marks dresses with \`covers: ['bottom']\`, so the compositor does not
 *                 draw the saved bottom while a dress is worn.
 * - `fem.bottom`: round/denim skirts, pinafore, high-waist shorts, skinny and wide-leg trousers.
 * Skin that a garment leaves bare (shoulders, belly, neck) is painted by the garment itself, in the wearer's skin tones.
 */

const WHITE = '#f4f1ea';
type Deco = (x: number, y: number, tone: 0 | 1 | 2) => string | undefined;
const pick = (t: Tones, tone: 0 | 1 | 2) => (tone === 2 ? t.sh : tone === 0 ? t.lt : t.base);

function done(c: Ctx2) {
  MAIN.clear();
  AUX.clear();
  c.clip = null;
}

/** A horizontal line around the torso (visible side only) with an optional wave, e.g. a frill. */
function ring(c: Ctx2, yo: number, hex: (n: number) => string, amp = 0, grow = 0.4, steps = 48) {
  for (let n = 0; n < steps; n++) {
    const psi = (n / steps) * Math.PI * 2;
    const p = torsoPoint(c, psi, yo + (amp > 0 && n % 2 === 0 ? amp : 0), grow);
    if (p[2] > 0.3) c.px(p[0], p[1], hex(n));
  }
}

// ---- patterns ------------------------------------------------------------------------------------------------------------

function floral(it: Resolved): Deco {
  const petal = tonesOf('#f7b6c8');
  const petal2 = tonesOf('#fff0b8');
  const leaf = tonesOf('#5fae6a');
  return (x, y, tone) => {
    const row = Math.floor(y / 9);
    const fx = (x + (row % 2 ? 5 : 0)) % 9;
    const fy = y % 9;
    if ((fx === 4 && fy === 4)) return pick(petal2, tone);
    if ((fx === 4 && (fy === 3 || fy === 5)) || (fy === 4 && (fx === 3 || fx === 5))) return pick(petal, tone);
    if (fx === 6 && fy === 6) return pick(leaf, tone);
    void it;
    return undefined;
  };
}

function sparkle(it: Resolved): Deco {
  const col = it.t;
  return (x, y, tone) => {
    if ((x * 7 + y * 13) % 41 === 0) return '#fff3c8';
    if ((x + y) % 11 === 0 && tone !== 2) return col.lt;
    return undefined;
  };
}

const knitRib = (col: Tones): Deco => (_x, y, tone) => (y % 4 === 0 ? (tone === 2 ? col.sh : col.lt) : undefined);

// ---- bodice ------------------------------------------------------------------------------------------------------------------

interface TopV {
  hem: number;
  top: number;
  /** Paint bare skin from this height up to the neck first (garments that leave the belly or shoulders bare). */
  skinFrom?: number;
  neck?: { shape: 'scoop' | 'square' | 'v'; a: number; d: number };
  straps?: 'thin' | 'wide' | 'halter';
  deco?: (it: Resolved) => Deco | undefined;
  detail?: (c: Ctx2, it: Resolved) => void;
}

function cutNeck(c: Ctx2, it: Resolved, mask: typeof MAIN, n: NonNullable<TopV['neck']>) {
  const base = c.back ? Math.PI : 0;
  const a = c.back ? 0.62 : n.a;
  const d = c.back ? 1.2 : n.d;
  const pts: P2[] = [];
  for (let k = 0; k <= 12; k++) {
    const t = -1 + k / 6;
    const shape = c.back ? 'scoop' : n.shape;
    const f = shape === 'v' ? 1 - Math.abs(t) : shape === 'square' ? (Math.abs(t) < 0.86 ? 1 : 0.15) : 1 - t * t;
    const p = torsoPoint(c, base + t * a, 22.4 - d * f, 0.4);
    pts.push([p[0], p[1]]);
  }
  const t1 = torsoPoint(c, base + a, 28, 0.4);
  const t0 = torsoPoint(c, base - a, 28, 0.4);
  AUX.clear();
  AUX.poly([...pts, [t1[0], t1[1]], [t0[0], t0[1]]]);
  AUX.and(mask);
  c.paint(AUX, c.skin, { lw: 1, sw: 1, outline: false, deco: (_x, _y, tone) => (tone === 2 ? mix(c.skin.base, c.skin.sh, 0.5) : c.skin.base) });
  const edge = it.t.sh;
  for (let k = 0; k + 1 < pts.length; k++) c.line(pts[k][0], pts[k][1], pts[k + 1][0], pts[k + 1][1], edge);
  AUX.clear();
}

function bodice(c: Ctx2, it: Resolved, v: TopV) {
  const col = it.t;
  if (v.skinFrom !== undefined) {
    MAIN.clear();
    torsoHull(c, MAIN, v.skinFrom, 22.4, 0.2, 0.2);
    c.paint(MAIN, c.skin, { lw: 2, sw: 4 });
  }
  MAIN.clear();
  torsoHull(c, MAIN, v.hem, v.top, 0.3, 0.3);
  c.paint(MAIN, col, { lw: 2, sw: 4, deco: v.deco?.(it) });
  surfLine(c, -1.45, v.hem + 0.8, 1.45, v.hem + 0.8, col.sh, 0.3);
  if (v.neck && v.top >= 22) cutNeck(c, it, MAIN, v.neck);
  if (v.straps) {
    const wide = v.straps === 'wide';
    for (const sg of SIDE) {
      for (const base of [0, Math.PI]) {
        const s = base === 0 ? sg : -sg;
        const topPsi = v.straps === 'halter' ? 0.1 : 0.34;
        for (let k = 0; k < (wide ? 3 : 2); k++) {
          const hex = k === 0 ? col.lt : k === 1 ? col.base : col.sh;
          surfLine(c, base + s * (0.5 + k * 0.05), v.top - 0.4, base + s * (topPsi + k * 0.05), 23.8, hex, 0.5);
        }
      }
    }
  }
  v.detail?.(c, it);
  done(c);
}

const TOPS: Record<string, TopV & { sleeve?: number; cuff?: 'plain' | 'rib' }> = {
  crop: { hem: 9.4, top: 22.4, skinFrom: 5.6, neck: { shape: 'scoop', a: 0.62, d: 3.4 }, sleeve: 0.55 },
  cami: { hem: -2.4, top: 19.8, skinFrom: -2.4, straps: 'thin' },
  ruffle: {
    hem: -2.4,
    top: 22.4,
    neck: { shape: 'square', a: 0.7, d: 3.2 },
    sleeve: 0.5,
    detail: (c, it) => {
      const col = it.t;
      ring(c, 18.9, (n) => (n % 2 ? col.lt : col.base), 0, 0.5);
      ring(c, 18.0, (n) => (n % 2 ? col.sh : col.base), 0.8, 0.5);
      ring(c, -1.8, (n) => (n % 2 ? col.lt : col.sh), 1.0, 0.45);
    },
  },
  bowblouse: {
    hem: -1.6,
    top: 22.4,
    neck: { shape: 'scoop', a: 0.46, d: 2.0 },
    sleeve: 1,
    detail: (c, it) => {
      if (c.back) return;
      // pussy-bow: knot and two soft tails
      const col = it.t;
      const lt = tonesOf(shade(col.base, 0.1));
      for (const sg of SIDE) {
        const a = torsoPoint(c, sg * 0.34, 21.2, 0.9);
        const b = torsoPoint(c, sg * 0.5, 14.8, 0.9);
        const m = torsoPoint(c, sg * 0.16, 19.4, 0.9);
        AUX.clear();
        AUX.poly([[a[0], a[1]], [b[0], b[1]], [m[0] + sg, m[1] + 3], [m[0], m[1]]]);
        c.paint(AUX, lt, { lw: 1, sw: 2 });
        AUX.clear();
      }
      const k = torsoPoint(c, 0, 20.6, 1.1);
      if (k[2] > 0.3) {
        c.px(k[0] - 1, k[1], col.lt);
        c.px(k[0], k[1], col.base);
        c.px(k[0] + 1, k[1], col.sh);
        c.px(k[0], k[1] + 1, col.sh);
      }
    },
  },
  body: {
    hem: 1.2,
    top: 22.4,
    neck: { shape: 'scoop', a: 0.62, d: 4.8 },
    sleeve: 1,
    detail: (c, it) => {
      // snug fit: a lighter line down each side and snaps at the bottom
      for (const sg of SIDE) surfLine(c, sg * 1.3, 18, sg * 1.2, 2.4, it.t.lt, 0.35);
      if (!c.back) for (const dx of [-1, 1]) c.px(torsoPoint(c, 0, 1.8, 0.4)[0] + dx, torsoPoint(c, 0, 1.8, 0.4)[1], '#d6d0c2');
    },
  },
  offshoulder: {
    hem: -2.4,
    top: 18.0,
    skinFrom: -2.4,
    sleeve: 0.5,
    detail: (c, it) => {
      const col = it.t;
      ring(c, 18.0, (n) => (n % 2 ? col.lt : col.base), 0, 0.5);
      ring(c, 17.0, (n) => (n % 2 ? col.sh : col.base), 0.8, 0.5);
      ring(c, 15.9, (n) => col.sh, 0, 0.5);
    },
  },
  tube: {
    hem: -1.4,
    top: 16.8,
    skinFrom: -1.4,
    detail: (c, it) => {
      ring(c, 16.8, () => it.t.lt, 0, 0.5);
      ring(c, 15.9, () => it.t.sh, 0, 0.5);
    },
  },
  shortknit: { hem: 7.4, top: 22.4, skinFrom: 5.6, neck: { shape: 'scoop', a: 0.6, d: 2.6 }, sleeve: 1, cuff: 'rib', deco: (it) => knitRib(it.t) },
  babytee: {
    hem: 0.4,
    top: 22.4,
    neck: { shape: 'scoop', a: 0.6, d: 4.0 },
    sleeve: 0.55,
    detail: (c, it) => {
      // a tiny star print on the chest
      if (c.back) return;
      const p = torsoPoint(c, -0.4, 12.4, 0.5);
      if (p[2] > 0.4) for (const [dx, dy] of [[0, -1], [-1, 0], [0, 0], [1, 0], [0, 1]] as const) c.px(p[0] + dx, p[1] + dy, dx === 0 && dy === 0 ? WHITE : '#fff3b8');
      void it;
    },
  },
  sport: {
    hem: 10.4,
    top: 19.4,
    skinFrom: 5.6,
    straps: 'wide',
    detail: (c, it) => {
      ring(c, 11.4, () => '#f4f1ea', 0, 0.45);
      ring(c, 10.6, () => it.t.sh, 0, 0.45);
    },
  },
  halter: {
    hem: -1.8,
    top: 18.6,
    skinFrom: -1.8,
    straps: 'halter',
    detail: (c, it) => {
      ring(c, 18.6, () => it.t.lt, 0, 0.5);
    },
  },
};

registerDrawer('fem.top', {
  draw: (c, it, e) => e.part(0, () => bodice(c, it, TOPS[String(it.item.params?.variant)] ?? TOPS.cami)),
  sleeve: (it) => {
    const v = TOPS[String(it.item.params?.variant)];
    const len = v?.sleeve ?? 0;
    return len > 0 ? { len, cuff: v?.cuff ?? 'plain', ...(v?.deco ? { deco: v.deco(it) } : {}) } : null;
  },
});

// ---- skirts ------------------------------------------------------------------------------------------------------------------

interface SkirtO {
  hem: number;
  hemSit: number;
  rx: number;
  rz: number;
  folds: 'many' | 'soft' | 'few' | 'none';
  deco?: (it: Resolved) => Deco | undefined;
  detail?: (c: Ctx2, it: Resolved, ringPts: { top: [number, number, number]; bot: [number, number, number] }[]) => void;
}

function skirtShape(c: Ctx2, it: Resolved, o: SkirtO) {
  const { rig } = c;
  const sit = rig.sit;
  const col = it.t;
  const hemY = rig.hipY + (sit ? o.hemSit : o.hem);
  const waistY = rig.hipY + 4;
  const rx = sit ? o.rx * 0.92 : o.rx;
  const rz = sit ? Math.min(o.rz * 1.24, 9.2) : o.rz;
  const hemZ = sit ? rig.bz + 7.2 : rig.bz;
  const N = 16;
  const rp: { top: [number, number, number]; bot: [number, number, number] }[] = [];
  const pts: P2[] = [];
  for (let n = 0; n < N; n++) {
    const psi = (n / N) * Math.PI * 2;
    const top = c.P(Math.sin(psi) * 8.3, waistY, rig.bz + Math.cos(psi) * 5.4);
    const bot = c.P(Math.sin(psi) * rx, hemY, hemZ + Math.cos(psi) * rz);
    rp.push({ top, bot });
    pts.push([top[0], top[1]], [bot[0], bot[1]]);
  }
  MAIN.clear();
  MAIN.hull(pts);
  c.paint(MAIN, col, { lw: 2, sw: 3, deco: o.deco?.(it) });
  for (let n = 0; n < N; n++) {
    const r = rp[n];
    if (r.bot[2] < 0.5 || o.folds === 'none') continue;
    if (o.folds === 'few' && n % 4 !== 1) continue;
    if (o.folds === 'soft' && n % 2 === 1) continue;
    c.line(r.top[0], r.top[1] + (o.folds === 'soft' ? 2 : 1), r.bot[0], r.bot[1] - 1, n % 2 === 0 ? col.sh : col.lt);
  }
  const hemPts = rp.filter((r) => r.bot[2] > 0).map((r) => r.bot);
  for (let k = 0; k + 1 < hemPts.length; k++) c.line(hemPts[k][0], hemPts[k][1] - 1, hemPts[k + 1][0], hemPts[k + 1][1] - 1, col.sh);
  o.detail?.(c, it, rp);
  done(c);
}

const bareLegs = (c: Ctx2, it: Resolved, i: 0 | 1) => legKit(c, i, { ...it, t: c.skin } as Resolved, { r: [4.4, 3.9, 3.6, 2.9] });

// ---- dresses --------------------------------------------------------------------------------------------------------------------

interface DressV {
  top: TopV & { sleeve?: number; cuff?: 'plain' | 'rib' };
  skirt: SkirtO;
}

const waistBelt = (hex: string | null) => (c: Ctx2, it: Resolved) => {
  const col = it.t;
  surfLine(c, -1.45, 3.2, 1.45, 3.2, hex ?? col.sh, 0.45);
  surfLine(c, -1.45, 4.1, 1.45, 4.1, hex ? mix(hex, WHITE, 0.3) : col.lt, 0.45);
};

const DRESSES: Record<string, DressV> = {
  short: {
    top: { hem: 2.6, top: 19.8, skinFrom: 2.6, straps: 'thin', detail: waistBelt(null) },
    skirt: { hem: -8.8, hemSit: 1.8, rx: 11.8, rz: 7.0, folds: 'soft' },
  },
  midi: {
    top: {
      hem: 2.6,
      top: 22.4,
      neck: { shape: 'v', a: 0.6, d: 6.4 },
      sleeve: 0.5,
      detail: (c, it) => {
        waistBelt('#d9b24a')(c, it);
        const k = torsoPoint(c, 0, 3.6, 0.9);
        if (k[2] > 0.3) {
          c.px(k[0] - 1, k[1], '#d9b24a');
          c.px(k[0], k[1], '#f2cf63');
          c.px(k[0] + 1, k[1], '#d9b24a');
        }
      },
    },
    skirt: { hem: -19, hemSit: -0.8, rx: 12.6, rz: 7.6, folds: 'soft' },
  },
  long: {
    top: { hem: 2.6, top: 19.4, skinFrom: 2.6, straps: 'wide', detail: waistBelt(null) },
    skirt: { hem: -25.5, hemSit: -4, rx: 13.4, rz: 8.0, folds: 'soft' },
  },
  floral: {
    top: { hem: 2.6, top: 22.4, neck: { shape: 'scoop', a: 0.62, d: 4.2 }, deco: floral, detail: waistBelt('#5fae6a') },
    skirt: { hem: -18, hemSit: -0.6, rx: 12.4, rz: 7.6, folds: 'soft', deco: floral },
  },
  party: {
    top: {
      hem: 2.6,
      top: 17.2,
      skinFrom: 2.6,
      deco: sparkle,
      detail: (c, it) => {
        // sweetheart edge: lit rim with a small notch in the middle
        ring(c, 17.2, () => it.t.lt, 0, 0.5);
        ring(c, 16.3, () => it.t.sh, 0, 0.5);
        const k = torsoPoint(c, 0, 17.4, 0.6);
        if (k[2] > 0.3) {
          c.px(k[0], k[1] + 1, it.t.sh);
          c.px(k[0], k[1] + 2, it.t.sh);
        }
        waistBelt('#f2cf63')(c, it);
      },
    },
    skirt: { hem: -13.6, hemSit: 0.4, rx: 13.4, rz: 8.0, folds: 'many', deco: sparkle },
  },
  formal: {
    top: {
      hem: 2.6,
      top: 22.4,
      neck: { shape: 'v', a: 0.5, d: 3.8 },
      sleeve: 0.55,
      detail: (c, it) => {
        waistBelt('#2a2230')(c, it);
        if (c.back) return;
        // shirt-dress: collar flaps and a button placket
        const col = it.t;
        for (const sg of SIDE) {
          const a = torsoPoint(c, sg * 0.5, 23.8, 0.9);
          const b = torsoPoint(c, sg * 0.1, 18.6, 1.0);
          const m = torsoPoint(c, sg * 0.14, 22.0, 1.0);
          AUX.clear();
          AUX.poly([[a[0], a[1]], [b[0], b[1]], [m[0], m[1]]]);
          c.paint(AUX, tonesOf(shade(col.base, 0.16)), { lw: 1, sw: 1 });
          AUX.clear();
        }
        surfLine(c, 0, 18, 0, 4, col.sh, 0.6);
        for (const yy of [15.4, 11.8, 8.2, 5.2]) {
          const q = torsoPoint(c, 0, yy, 0.7);
          if (q[2] > 0.3) c.px(q[0], q[1], '#ece7da');
        }
      },
    },
    skirt: { hem: -14.2, hemSit: 0.4, rx: 11.4, rz: 7.0, folds: 'few' },
  },
  sheath: {
    top: { hem: 2.6, top: 22.4, neck: { shape: 'scoop', a: 0.6, d: 3.6 }, detail: (c, it) => {
      for (const sg of SIDE) surfLine(c, sg * 1.25, 17, sg * 1.2, 4, it.t.lt, 0.35);
    } },
    skirt: { hem: -13.8, hemSit: 0.8, rx: 9.2, rz: 6.0, folds: 'none' },
  },
  strap: {
    top: {
      hem: 8.0,
      top: 19.4,
      skinFrom: 8.0,
      straps: 'wide',
      detail: (c, it) => {
        // empire waist under the bust with a ribbon and a bow
        ring(c, 8.4, () => mix(it.t.base, WHITE, 0.55), 0, 0.5);
        ring(c, 7.6, () => mix(it.t.sh, WHITE, 0.3), 0, 0.5);
        const k = torsoPoint(c, 0.28, 8.2, 0.9);
        if (k[2] > 0.3) {
          for (const dx of [-2, -1, 1, 2]) c.px(k[0] + dx, k[1] + (Math.abs(dx) === 2 ? 1 : 0), '#fff');
          c.px(k[0], k[1], '#d8d2c2');
        }
      },
    },
    skirt: { hem: -17, hemSit: -0.6, rx: 12.6, rz: 7.6, folds: 'soft' },
  },
};

registerDrawer('fem.dress', {
  draw(c, it, e) {
    const v = DRESSES[String(it.item.params?.variant)] ?? DRESSES.short;
    const sit = c.rig.sit;
    e.leg('garment', (i) => bareLegs(c, it, i));
    e.part(sit ? 36 : -40, () => pelvis(c, it, v.skirt.deco?.(it)));
    e.part(sit ? 44 : -30, () => skirtShape(c, it, v.skirt));
    // the bodice paints the whole torso (bare shoulders included), so it goes with the other tops at depth 0
    e.part(0, () => bodice(c, it, v.top));
  },
  sleeve: (it) => {
    const v = DRESSES[String(it.item.params?.variant)];
    const len = v?.top.sleeve ?? 0;
    return len > 0 ? { len, cuff: 'plain', ...(v?.top.deco ? { deco: v.top.deco(it) } : {}) } : null;
  },
});

// ---- bottoms ------------------------------------------------------------------------------------------------------------------

const SKIRTS: Record<string, SkirtO> = {
  circle: { hem: -14.5, hemSit: 0.6, rx: 13.8, rz: 8.2, folds: 'soft' },
  denim: {
    hem: -8.0,
    hemSit: 2.2,
    rx: 10.8,
    rz: 6.8,
    folds: 'none',
    detail: (c, it, rp) => {
      // front button row, topstitching and a frayed light hem
      const stitch = mix(it.t.lt, '#e8b86a', 0.5);
      const f = rp[0];
      if (f.bot[2] > 0.5) {
        for (let k = 0; k < 4; k++) {
          const t = (k + 0.5) / 4;
          c.px(f.top[0] + (f.bot[0] - f.top[0]) * t, f.top[1] + (f.bot[1] - f.top[1]) * t, '#d9c36a');
        }
        c.line(f.top[0] + 1, f.top[1] + 1, f.bot[0] + 1, f.bot[1] - 1, stitch);
      }
      const hemPts = rp.filter((r) => r.bot[2] > 0).map((r) => r.bot);
      for (let k = 0; k + 1 < hemPts.length; k++) c.line(hemPts[k][0], hemPts[k][1] - 2, hemPts[k + 1][0], hemPts[k + 1][1] - 2, stitch);
    },
  },
  pinafore: { hem: -9.6, hemSit: 1.6, rx: 11.6, rz: 7.2, folds: 'soft' },
};

function pinaforeBib(c: Ctx2, it: Resolved) {
  const col = it.t;
  MAIN.clear();
  torsoHull(c, MAIN, 3.4, 16.2, 0.55, 0.55);
  if (c.back) {
    // from behind only the crossed straps show
    done(c);
    for (const sg of SIDE) {
      for (let k = 0; k < 2; k++) surfLine(c, Math.PI - sg * (0.5 - k * 0.05), 4.6, Math.PI + sg * (0.55 + k * 0.05), 22.4, k === 0 ? col.base : col.sh, 0.6);
    }
    return;
  }
  c.paint(MAIN, col, { lw: 2, sw: 4 });
  surfLine(c, -1.45, 4.4, 1.45, 4.4, col.sh, 0.6);
  for (const sg of SIDE) {
    for (let k = 0; k < 3; k++) surfLine(c, sg * (0.52 + k * 0.05), 15.8, sg * (0.42 + k * 0.05), 23.4, k === 0 ? col.lt : k === 1 ? col.base : col.sh, 0.6);
    const b = torsoPoint(c, sg * 0.5, 15.8, 0.9);
    if (b[2] > 0.3) {
      c.px(b[0], b[1], '#d9c36a');
      c.px(b[0] + 1, b[1], '#8a7a3a');
    }
  }
  // bib pocket with a stitched edge
  const a = torsoPoint(c, -0.26, 11.4, 0.8);
  const b2 = torsoPoint(c, 0.26, 11.4, 0.8);
  const d = torsoPoint(c, -0.26, 6.6, 0.8);
  const f = torsoPoint(c, 0.26, 6.6, 0.8);
  if (a[2] > 0.3) {
    c.line(a[0], a[1], b2[0], b2[1], col.lt);
    c.line(a[0], a[1], d[0], d[1], col.sh);
    c.line(b2[0], b2[1], f[0], f[1], col.sh);
    c.line(d[0], d[1], f[0], f[1], col.sh);
  }
  done(c);
}

registerDrawer('fem.bottom', {
  draw(c, it, e) {
    const v = String(it.item.params?.variant);
    const sit = c.rig.sit;
    const col = it.t;
    if (v === 'circle' || v === 'denim' || v === 'pinafore') {
      e.leg('garment', (i) => bareLegs(c, it, i));
      e.part(sit ? 36 : -40, () => pelvis(c, it));
      e.part(sit ? 44 : -30, () => skirtShape(c, it, SKIRTS[v]));
      if (v === 'pinafore') e.part(0.03, () => pinaforeBib(c, it));
      return;
    }
    if (v === 'shorts_hw') {
      e.leg('garment', (i) =>
        legKit(c, i, it, {
          bare: true,
          thighEnd: 0.6,
          r: [4.7, 4.5, 0, 0],
          detail: ({ hip, knee, side }) => {
            const stitch = mix(col.lt, '#e8b86a', 0.5);
            const a = { x: hip[0] + (knee[0] - hip[0]) * 0.52, y: hip[1] + (knee[1] - hip[1]) * 0.52 };
            c.line(a.x - 4, a.y, a.x + 4, a.y, stitch);
            c.px(a.x + side * 4, a.y + 1, col.sh);
          },
        }),
      );
      e.part(sit ? 36 : -40, () => {
        MAIN.clear();
        torsoHull(c, MAIN, -5.2, 8.6, 0.4, 0.35);
        c.paint(MAIN, col, { lw: 2, sw: 3 });
        done(c);
      });
      e.part(sit ? 37 : -39, () => {
        surfLine(c, -1.4, 8.0, 1.4, 8.0, col.lt, 0.5);
        surfLine(c, -1.4, 7.0, 1.4, 7.0, col.sh, 0.5);
        const b = torsoPoint(c, 0, 7.4, 0.6);
        if (b[2] > 0.3) {
          c.px(b[0], b[1], '#d9c36a');
          c.px(b[0] + 1, b[1], '#8a7a3a');
        }
        surfLine(c, 0, 7, 0, 1.4, col.sh, 0.5);
      });
      return;
    }
    const wide = v === 'wide';
    e.leg('garment', (i) =>
      legKit(c, i, it, {
        r: wide ? [4.8, 5.3, 6.0, 6.6] : [3.9, 3.5, 3.3, 2.8],
        detail: ({ hip, knee, ank, side }) => {
          const seam = mix(col.lt, '#e8b86a', 0.4);
          const s0 = { x: hip[0], y: hip[1] };
          void s0;
          const lerp = (a: P2, b: P2, t: number, o: number, r: number): P2 => {
            const dx = b[0] - a[0];
            const dy = b[1] - a[1];
            const l = Math.hypot(dx, dy) || 1;
            return [a[0] + dx * t + (-dy / l) * o * r, a[1] + dy * t + (dx / l) * o * r];
          };
          const a = lerp(hip, knee, 0.12, side * 0.7, 4);
          const b = lerp(hip, knee, 0.98, side * 0.65, 4);
          c.line(a[0], a[1], b[0], b[1], wide ? col.lt : seam);
          if (wide) {
            // pressed crease and a deep hem
            const f0 = lerp(hip, knee, 0.15, 0.05, 4.8);
            const f1 = lerp(knee, ank, 0.85, 0.05, 6);
            c.line(f0[0], f0[1], knee[0], knee[1], col.lt);
            c.line(knee[0], knee[1], f1[0], f1[1], col.lt);
            const h0 = lerp(knee, ank, 0.92, -1, 6.6);
            const h1 = lerp(knee, ank, 0.92, 1, 6.6);
            c.line(h0[0], h0[1], h1[0], h1[1], col.sh);
          } else {
            const k0 = lerp(hip, knee, 1.02, -0.6, 3.5);
            const k1 = lerp(hip, knee, 1.02, 0.6, 3.5);
            c.line(k0[0], k0[1], k1[0], k1[1], col.sh);
            const c0 = lerp(knee, ank, 0.9, -0.9, 2.8);
            const c1 = lerp(knee, ank, 0.9, 0.9, 2.8);
            c.line(c0[0], c0[1], c1[0], c1[1], col.sh);
          }
        },
      }),
    );
    e.part(sit ? 36 : -40, () => pelvis(c, it));
    e.part(sit ? 37 : -39, () => tuckedBelt(c));
  },
});

void levelY;
