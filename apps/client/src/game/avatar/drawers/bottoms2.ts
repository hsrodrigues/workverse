import { mix, shade } from '../../pixel';
import { AUX, MAIN, add3, limbPt, surfLine, topDeco, torsoHull, torsoPoint, tuckedBelt, type Ctx2, type P2, type Resolved } from '../engine';
import { tonesOf, type Tones } from '../recolor';
import { registerDrawer } from '../registry';

/**
 * More bottoms: leggings, joggers/track pants, denim and cargo bermudas, and three skirt lengths.
 * The leg garments follow the same skeleton as `drawLegPart` (thigh + shin capsules from the rig), so walking and
 * sitting are free; the pelvis and the waistband sit on the torso hull like the existing trousers.
 */

const WHITE = '#f4f1ea';

interface LegOpts {
  /** Radii: thigh top/bottom, shin top/bottom. */
  r: [number, number, number, number];
  /** Where the garment ends along hip->knee (0..1) when shorter than the knee, otherwise it continues down the shin. */
  thighEnd?: number;
  /** Bare skin under shorts. */
  bare?: boolean;
  deco?: (x: number, y: number, tone: 0 | 1 | 2) => string | undefined;
  detail?: (g: { hip: P2; knee: P2; ank: P2; side: -1 | 1; col: Tones }) => void;
}

export function legKit(c: Ctx2, i: 0 | 1, it: Resolved, o: LegOpts) {
  const { rig } = c;
  const hp = c.Pv(rig.hip[i]);
  const kn = c.Pv(rig.knee[i]);
  const an = c.Pv(add3(rig.ankle[i], 0, 1.2, 0));
  const hipS: P2 = [hp[0], hp[1]];
  const knS: P2 = [kn[0], kn[1]];
  const anS: P2 = [an[0], an[1]];
  const col = it.t;
  if (o.bare) {
    MAIN.clear();
    MAIN.capsule(hipS[0], hipS[1], knS[0], knS[1], 4.4, 3.9);
    MAIN.capsule(knS[0], knS[1], anS[0], anS[1], 3.6, 2.9);
    c.paint(MAIN, c.skin, { lw: 2, sw: 3 });
    MAIN.clear();
    c.px(knS[0] - 1, knS[1], c.skin.lt);
  }
  MAIN.clear();
  if (o.thighEnd !== undefined) {
    const end = limbPt(hipS, knS, o.thighEnd, 0, 0);
    MAIN.capsule(hipS[0], hipS[1], end[0], end[1], o.r[0], o.r[1]);
  } else {
    MAIN.capsule(hipS[0], hipS[1], knS[0], knS[1], o.r[0], o.r[1]);
    MAIN.capsule(knS[0], knS[1], anS[0], anS[1], o.r[2], o.r[3]);
  }
  c.paint(MAIN, col, { lw: 2, sw: 3, deco: o.deco });
  o.detail?.({ hip: hipS, knee: knS, ank: anS, side: i === 0 ? -1 : 1, col });
  MAIN.clear();
  c.clip = null;
}

export function pelvis(c: Ctx2, it: Resolved, deco?: LegOpts['deco']) {
  MAIN.clear();
  torsoHull(c, MAIN, -5.2, 5.5, 0.35, 0.35);
  c.paint(MAIN, it.t, { lw: 2, sw: 3, deco });
  MAIN.clear();
  c.clip = null;
}

/** Elastic waistband (two lines across the belly), optionally with a drawstring. */
function elastic(c: Ctx2, col: Tones, cord: boolean) {
  surfLine(c, -1.4, 4.2, 1.4, 4.2, col.sh, 0.45);
  surfLine(c, -1.4, 3.2, 1.4, 3.2, col.lt, 0.45);
  surfLine(c, -1.4, 2.4, 1.4, 2.4, col.sh, 0.45);
  if (cord) {
    for (const sg of [-1, 1] as const) {
      const p = torsoPoint(c, sg * 0.14, 3.6, 0.55);
      if (p[2] > 0.3) {
        c.px(p[0], p[1], WHITE);
        c.px(p[0] + sg, p[1] + 1, '#cfc9bd');
        c.px(p[0] + sg, p[1] + 2, WHITE);
      }
    }
  }
}

// ---- leggings, joggers, track pants -------------------------------------------------------------------------------------

registerDrawer('bottom.leggings', {
  draw(c, it, e) {
    const sit = c.rig.sit;
    e.leg('garment', (i) =>
      legKit(c, i, it, {
        r: [4.0, 3.6, 3.4, 3.0],
        detail: ({ hip, knee, ank, side, col }) => {
          // sheen along the outer thigh and shin; a flat seam inside
          const a = limbPt(hip, knee, 0.16, side * 0.6, 4.0);
          const b = limbPt(hip, knee, 0.9, side * 0.55, 3.6);
          c.line(a[0], a[1], b[0], b[1], col.lt);
          const d = limbPt(knee, ank, 0.18, side * 0.55, 3.2);
          const f = limbPt(knee, ank, 0.84, side * 0.5, 3.0);
          c.line(d[0], d[1], f[0], f[1], col.lt);
          const k0 = limbPt(hip, knee, 1.02, -0.6, 3.6);
          const k1 = limbPt(hip, knee, 1.02, 0.6, 3.6);
          c.line(k0[0], k0[1], k1[0], k1[1], col.sh);
          // ankle edge
          const c0 = limbPt(knee, ank, 0.94, -0.9, 3.0);
          const c1 = limbPt(knee, ank, 0.94, 0.9, 3.0);
          c.line(c0[0], c0[1], c1[0], c1[1], col.sh);
        },
      }),
    );
    e.part(sit ? 36 : -40, () => pelvis(c, it));
    e.part(sit ? 37 : -39, () => {
      // wide sports waistband with a light edge
      surfLine(c, -1.4, 5.0, 1.4, 5.0, it.t.lt, 0.45);
      surfLine(c, -1.4, 4.0, 1.4, 4.0, it.t.sh, 0.45);
      surfLine(c, -1.4, 3.0, 1.4, 3.0, it.t.sh, 0.45);
    });
  },
});

registerDrawer('bottom.joggers', {
  draw(c, it, e) {
    const sit = c.rig.sit;
    const track = it.item.params?.variant === 'track';
    const stripe = tonesOf(WHITE);
    e.leg('garment', (i) =>
      legKit(c, i, it, {
        r: track ? [4.5, 4.1, 3.9, 3.6] : [4.6, 4.3, 4.2, 3.5],
        detail: ({ hip, knee, ank, side, col }) => {
          if (track) {
            // two white stripes down the outer seam
            for (const o of [0.45, 0.72]) {
              const a = limbPt(hip, knee, 0.1, side * o, 4.5);
              const b = limbPt(hip, knee, 1.0, side * o, 4.1);
              const d = limbPt(knee, ank, 0.1, side * o, 3.9);
              const f = limbPt(knee, ank, 0.96, side * o, 3.6);
              c.line(a[0], a[1], b[0], b[1], stripe.base);
              c.line(b[0], b[1], d[0], d[1], stripe.base);
              c.line(d[0], d[1], f[0], f[1], stripe.base);
            }
            const c0 = limbPt(knee, ank, 0.92, -0.95, 3.6);
            const c1 = limbPt(knee, ank, 0.92, 0.95, 3.6);
            c.line(c0[0], c0[1], c1[0], c1[1], col.sh);
          } else {
            // gathered ankle: a rib cuff with the cloth ballooning above it
            const s0 = limbPt(hip, knee, 0.12, side * 0.78, 4.5);
            const s1 = limbPt(hip, knee, 0.96, side * 0.7, 4.3);
            c.line(s0[0], s0[1], s1[0], s1[1], col.lt);
            for (const [t, hex] of [[0.78, col.sh], [0.9, col.lt], [0.97, col.sh]] as const) {
              const c0 = limbPt(knee, ank, t, -0.95, 3.4);
              const c1 = limbPt(knee, ank, t, 0.95, 3.4);
              c.line(c0[0], c0[1], c1[0], c1[1], hex);
            }
            const f0 = limbPt(knee, ank, 0.55, -0.6, 4.0);
            const f1 = limbPt(knee, ank, 0.7, 0.2, 4.0);
            c.line(f0[0], f0[1], f1[0], f1[1], col.sh);
          }
          const k0 = limbPt(hip, knee, 1.02, -0.7, 4.0);
          const k1 = limbPt(hip, knee, 1.02, 0.5, 4.0);
          c.line(k0[0], k0[1], k1[0], k1[1], col.sh);
        },
      }),
    );
    e.part(sit ? 36 : -40, () => pelvis(c, it));
    e.part(sit ? 37 : -39, () => elastic(c, it.t, !track));
  },
});

// ---- bermudas ------------------------------------------------------------------------------------------------------------

registerDrawer('bottom.shorts_kit', {
  draw(c, it, e) {
    const sit = c.rig.sit;
    const cargo = it.item.params?.variant === 'cargo';
    e.leg('garment', (i) =>
      legKit(c, i, it, {
        bare: true,
        thighEnd: cargo ? 0.97 : 0.9,
        r: cargo ? [4.9, 4.7, 0, 0] : [4.6, 4.5, 0, 0],
        detail: ({ hip, knee, side, col }) => {
          const s0 = limbPt(hip, knee, 0.12, side * 0.78, 4.6);
          const s1 = limbPt(hip, knee, 0.8, side * 0.7, 4.6);
          if (cargo) {
            const p0 = limbPt(hip, knee, 0.34, -0.5, 4.7);
            const p1 = limbPt(hip, knee, 0.34, 0.8, 4.7);
            const p2 = limbPt(hip, knee, 0.78, -0.5, 4.7);
            const p3 = limbPt(hip, knee, 0.78, 0.8, 4.7);
            c.line(p0[0], p0[1], p1[0], p1[1], col.sh);
            c.line(p0[0], p0[1], p2[0], p2[1], col.sh);
            c.line(p1[0], p1[1], p3[0], p3[1], col.sh);
            c.line(p2[0], p2[1], p3[0], p3[1], col.sh);
            c.px(p0[0] + 1, p0[1] + 1, col.lt);
            c.px(p1[0] - 1, p1[1] + 1, col.lt);
            const hm = limbPt(hip, knee, 0.9, 0, 0);
            void hm;
            const e0 = limbPt(hip, knee, 0.92, -1, 4.7);
            const e1 = limbPt(hip, knee, 0.92, 1, 4.7);
            c.line(e0[0], e0[1], e1[0], e1[1], col.sh);
          } else {
            // turned-up hem: a lighter band with a stitch line, and the outer seam
            const stitch = mix(col.lt, '#e8b86a', 0.5);
            for (const [t, hex] of [[0.74, col.lt], [0.8, col.base], [0.86, stitch], [0.9, col.sh]] as const) {
              const e0 = limbPt(hip, knee, t, -1, 4.6);
              const e1 = limbPt(hip, knee, t, 1, 4.6);
              c.line(e0[0], e0[1], e1[0], e1[1], hex);
            }
            c.line(s0[0], s0[1], s1[0], s1[1], stitch);
          }
          if (cargo) c.line(s0[0], s0[1], s1[0], s1[1], col.lt);
        },
      }),
    );
    e.part(sit ? 36 : -40, () => pelvis(c, it));
    e.part(sit ? 37 : -39, () => {
      if (cargo) tuckedBelt(c);
      else {
        tuckedBelt(c);
      }
    });
  },
});

// ---- skirts ---------------------------------------------------------------------------------------------------------------

function skirt(c: Ctx2, it: Resolved) {
  const { rig } = c;
  const v = it.item.params?.variant;
  const sit = rig.sit;
  const mini = v === 'mini';
  const midi = v === 'midi';
  const pleated = v === 'pleated';
  const col = it.t;
  const hemY = sit ? rig.hipY + (mini ? 2.4 : 0.6) : rig.hipY - (mini ? 6.4 : pleated ? 8.6 : 19);
  const waistY = rig.hipY + 4;
  const hemRx = sit ? (mini ? 10.2 : midi ? 11.8 : 10.6) : mini ? 11.2 : midi ? 12.2 : 10.6;
  const hemRz = sit ? (mini ? 7.8 : midi ? 9 : 8) : mini ? 6.6 : midi ? 7.6 : 6.4;
  const hemZ = sit ? rig.bz + (midi ? 6.4 : 7.2) : rig.bz;
  const ringPts: { top: [number, number, number]; bot: [number, number, number] }[] = [];
  const pts: P2[] = [];
  const N = 16;
  for (let n = 0; n < N; n++) {
    const psi = (n / N) * Math.PI * 2;
    const top = c.P(Math.sin(psi) * 8.3, waistY, rig.bz + Math.cos(psi) * 5.4);
    const bot = c.P(Math.sin(psi) * hemRx, hemY, hemZ + Math.cos(psi) * hemRz);
    ringPts.push({ top, bot });
    pts.push([top[0], top[1]], [bot[0], bot[1]]);
  }
  MAIN.clear();
  MAIN.hull(pts);
  const deco = pleated ? topDeco({ ...it, item: { ...it.item, params: { pattern: 'plaid' } } }) : undefined;
  c.paint(MAIN, col, { lw: 2, sw: 3, deco });
  for (let n = 0; n < N; n++) {
    const r = ringPts[n];
    if (r.bot[2] < 0.5) continue;
    const dark = n % 2 === 0;
    if (mini && n % 2 === 1) continue;
    if (midi) {
      // soft long folds
      if (n % 2 === 0) c.line(r.top[0], r.top[1] + 2, r.bot[0], r.bot[1] - 1, dark ? col.sh : col.lt);
      continue;
    }
    c.line(r.top[0], r.top[1] + 1, r.bot[0], r.bot[1] - 1, dark ? col.sh : col.lt);
  }
  const hemPts = ringPts.filter((r) => r.bot[2] > 0).map((r) => r.bot);
  for (let k = 0; k + 1 < hemPts.length; k++) c.line(hemPts[k][0], hemPts[k][1] - 1, hemPts[k + 1][0], hemPts[k + 1][1] - 1, col.sh);
  if (midi) {
    for (let k = 0; k + 1 < hemPts.length; k++) c.line(hemPts[k][0], hemPts[k][1] - 3, hemPts[k + 1][0], hemPts[k + 1][1] - 3, mix(col.sh, col.base, 0.5));
  }
  MAIN.clear();
  c.clip = null;
  void AUX;
  void shade;
}

registerDrawer('bottom.skirt_kit', {
  draw(c, it, e) {
    const sit = c.rig.sit;
    e.leg('garment', (i) => legKit(c, i, { ...it, t: c.skin } as Resolved, { r: [4.4, 3.9, 3.6, 2.9], bare: false }));
    e.part(sit ? 36 : -40, () => pelvis(c, it));
    e.part(sit ? 44 : -30, () => skirt(c, it));
  },
});

// ---- staff trousers -----------------------------------------------------------------------------------------------------

const STAFF_GOLD = '#d9b24a';

registerDrawer('staff.trousers', {
  draw(c, it, e) {
    const sit = c.rig.sit;
    e.leg('garment', (i) =>
      legKit(c, i, it, {
        r: [4.4, 4.0, 3.8, 3.5],
        detail: ({ hip, knee, ank, side, col }) => {
          // double gold stripe down the outer seam, pressed crease, gold cuff line
          for (const o of [0.62, 0.86]) {
            const a = limbPt(hip, knee, 0.08, side * o, 4.4);
            const b = limbPt(hip, knee, 1.0, side * o, 4.0);
            const d = limbPt(knee, ank, 0.06, side * o, 3.8);
            const f = limbPt(knee, ank, 0.9, side * o, 3.5);
            c.line(a[0], a[1], b[0], b[1], o < 0.7 ? STAFF_GOLD : '#a87a1a');
            c.line(b[0], b[1], d[0], d[1], o < 0.7 ? STAFF_GOLD : '#a87a1a');
            c.line(d[0], d[1], f[0], f[1], o < 0.7 ? STAFF_GOLD : '#a87a1a');
          }
          const f0 = limbPt(hip, knee, 0.15, 0.05, 4.4);
          const f1 = limbPt(knee, ank, 0.85, 0.05, 3.5);
          c.line(f0[0], f0[1], knee[0], knee[1], col.lt);
          c.line(knee[0], knee[1], f1[0], f1[1], col.lt);
          const c0 = limbPt(knee, ank, 0.82, -0.95, 3.5);
          const c1 = limbPt(knee, ank, 0.82, 0.95, 3.5);
          c.line(c0[0], c0[1], c1[0], c1[1], STAFF_GOLD);
        },
      }),
    );
    e.part(sit ? 36 : -40, () => pelvis(c, it));
    e.part(sit ? 37 : -39, () => {
      tuckedBelt(c);
      surfLine(c, -1.4, 5.2, 1.4, 5.2, STAFF_GOLD, 0.45);
    });
  },
});
