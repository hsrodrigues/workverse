import { mix } from '../../pixel';
import { AUX2, FH, FW, HEAD_RY, HEAD_RZ, MAIN, SIDE, bobBack, curlDeco, cutEars, drawHair, faceRegion, fringe, hairBackPart, hairCap, headCenter, longHairBack, v3, type Ctx2, type P2, type Resolved } from '../engine';
import { registerDrawer } from '../registry';

/**
 * More hairstyles (mostly feminine, but every item is open to everybody). They compose the shared hair primitives of the
 * engine (cap, fringe, long/bob back masses) with extra masses: braids, pigtails, buns, bows and side locks. The color
 * comes from the hair palette, so every style accepts natural and fantasy colors.
 */

const asShape = (it: Resolved, id: string): Resolved => ({ ...it, item: { ...it.item, id } });
const seedOf = (it: Resolved) => [...(it.ref.color ?? '')].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) | 0, 5) & 0xff;

/** Chain of capsules through character-space points (a braid, a tail, a lock). */
function strand(c: Ctx2, it: Resolved, pts: ReadonlyArray<readonly [number, number, number]>, radii: number[], deco?: (x: number, y: number, tone: 0 | 1 | 2) => string | undefined) {
  const q = pts.map((p) => c.Pv(v3(p[0], p[1], p[2])));
  MAIN.clear();
  for (let i = 0; i + 1 < q.length; i++) MAIN.capsule(q[i][0], q[i][1], q[i + 1][0], q[i + 1][1], radii[i], radii[i + 1]);
  c.paint(MAIN, it.t, { lw: 3, sw: 4, deco });
  MAIN.clear();
  c.clip = null;
  return q;
}

const tie = (c: Ctx2, x: number, y: number, hex = '#d24a35') => {
  c.px(x - 1, y, hex);
  c.px(x, y, hex);
  c.px(x + 1, y, hex);
  c.px(x, y + 1, mix(hex, '#000000', 0.35));
};

/** Wave pattern for long hair: diagonal light/dark rows that suggest soft waves. */
const waveDeco = (c: Ctx2) => (x: number, y: number, tone: 0 | 1 | 2) => {
  const k = (y + Math.floor(x / 3) * 2) % 7;
  if (k === 0) return tone === 2 ? c.hair.ol : c.hair.sh;
  if (k === 3 && tone !== 2) return c.hair.lt;
  return undefined;
};

// ---- long, straight, with bangs ---------------------------------------------------------------------------------------

registerDrawer('hair.long_bangs', (c, it, e) => {
  const [cx, cy] = headCenter(c);
  e.part(-7 * c.cs, () => hairBackPart(c, asShape(it, 'hair.long')));
  e.part(20.2, () => drawHair(c, cx, cy, asShape(it, 'hair.bob')));
});

// ---- long, wavy ---------------------------------------------------------------------------------------------------------

registerDrawer('hair.wavy', (c, it, e) => {
  const [cx, cy] = headCenter(c);
  e.part(-7 * c.cs, () => longHairBack(c, cx, cy, waveDeco(c)));
  e.part(20.2, () => drawHair(c, cx, cy, asShape(it, 'hair.long')));
});

// ---- big coily volume -----------------------------------------------------------------------------------------------------

registerDrawer('hair.volume', (c, it, e) => {
  const [cx, cy] = headCenter(c);
  const sn = c.sn;
  const seed = seedOf(it);
  e.part(-7 * c.cs, () => {
    MAIN.clear();
    MAIN.ellipse(cx, cy + 4, 17.4, 15.6);
    for (let n = 0; n < 14; n++) {
      const a = (n / 14) * Math.PI * 2;
      MAIN.ellipse(cx + Math.cos(a) * 16.4, cy + 4 + Math.sin(a) * 14.6, 3.2, 3.2);
    }
    c.paint(MAIN, it.t, { lw: 3, sw: 4, deco: curlDeco(c, seed + 9) });
    MAIN.clear();
    c.clip = null;
  });
  e.part(20.2, () => {
    MAIN.clear();
    MAIN.ellipse(cx + 0.5 * sn, cy - 4.6, 18, 17);
    for (let n = 0; n < 16; n++) {
      const a = (n / 16) * Math.PI * 2;
      MAIN.ellipse(cx + 0.5 * sn + Math.cos(a) * 16.6, cy - 4.6 + Math.sin(a) * 15.6, 3.2, 3.2);
    }
    if (!c.back) {
      AUX2.clear();
      faceRegion(c, AUX2, cx, cy, -7.8);
      MAIN.sub(AUX2);
      AUX2.clear();
      for (let y = Math.floor(cy + 6); y < FH; y++) for (let x = 0; x < FW; x++) MAIN.a[y * FW + x] = 0;
      cutEars(c, MAIN, cx, cy);
    } else {
      for (let y = Math.floor(cy + 13); y < FH; y++) for (let x = 0; x < FW; x++) MAIN.a[y * FW + x] = 0;
    }
    c.paint(MAIN, it.t, { lw: 3, sw: 4, deco: curlDeco(c, seed) });
    MAIN.clear();
    c.clip = null;
  });
});

// ---- long braids ------------------------------------------------------------------------------------------------------------

registerDrawer('hair.braids', (c, it, e) => {
  const [cx, cy] = headCenter(c);
  const h = c.rig.head;
  e.part(20.2, () => drawHair(c, cx, cy, asShape(it, 'hair.long')));
  e.part(0.25, () => {
    for (const sg of SIDE) {
      const x = sg * 12.6;
      const pts: [number, number, number][] = [
        [x, h[1] - 6, h[2] + 0.5],
        [x * 1.0, h[1] - 13, h[2] + 1.5],
        [x * 0.98, h[1] - 20, h[2] + 2.4],
        [x * 0.96, h[1] - 27, h[2] + 2.6],
      ];
      const q = strand(c, it, pts, [3.2, 3.0, 2.8, 2.2], (px, py, tone) => ((px + py) % 4 === 0 ? (tone === 2 ? it.t.ol : it.t.sh) : (px - py) % 4 === 0 && tone !== 2 ? it.t.lt : undefined));
      tie(c, q[3][0], q[3][1] + 3);
    }
  });
  e.part(-7 * c.cs, () => hairBackPart(c, asShape(it, 'hair.long')));
});

// ---- pigtails -----------------------------------------------------------------------------------------------------------------

registerDrawer('hair.pigtails', (c, it, e) => {
  const [cx, cy] = headCenter(c);
  const h = c.rig.head;
  e.part(20.2, () => drawHair(c, cx, cy, asShape(it, 'hair.long')));
  e.part(19.4, () => {
    for (const sg of SIDE) {
      const x = sg * 14.4;
      const q = strand(
        c,
        it,
        [
          [x - sg * 2, h[1] + 2, h[2] - 0.5],
          [x + sg * 1.6, h[1] - 4, h[2] - 0.2],
          [x + sg * 2.6, h[1] - 12, h[2] + 0.4],
          [x + sg * 2.2, h[1] - 18, h[2] + 0.8],
        ],
        [3.2, 4.4, 4.2, 2.2],
      );
      tie(c, q[0][0] + sg, q[0][1] - 3, '#e0568a');
    }
  });
});

// ---- high ponytail --------------------------------------------------------------------------------------------------------------

registerDrawer('hair.high_pony', (c, it, e) => {
  const [cx, cy] = headCenter(c);
  const h = c.rig.head;
  e.part(20.2, () => drawHair(c, cx, cy, asShape(it, c.hatted ? 'hair.short' : 'hair.bob')));
  e.part(c.back ? 20.3 : -7, () => {
    const q = strand(
      c,
      it,
      [
        [0, h[1] + HEAD_RY - 3, h[2] - 5],
        [0, h[1] + HEAD_RY + 1, h[2] - 10],
        [0, h[1] + HEAD_RY - 6, h[2] - 15],
        [0, h[1] + HEAD_RY - 17, h[2] - 14],
        [0.6, h[1] + HEAD_RY - 24, h[2] - 12],
      ],
      [3, 4.6, 4.4, 3.6, 1.8],
    );
    tie(c, q[0][0], q[0][1] + 1);
  });
});

// ---- messy high bun ---------------------------------------------------------------------------------------------------------------

registerDrawer('hair.messy_bun', (c, it, e) => {
  const [cx, cy] = headCenter(c);
  const h = c.rig.head;
  e.part(20.2, () => {
    drawHair(c, cx, cy, asShape(it, 'hair.bun'));
    // loose strands around the bun
    const bp = c.P(0, h[1] + HEAD_RY + 3.2, h[2] - 3.5);
    MAIN.clear();
    MAIN.ellipse(bp[0] - 5.4, bp[1] + 1, 2.6, 2.2);
    MAIN.ellipse(bp[0] + 5.6, bp[1] - 1, 2.4, 2.4);
    MAIN.ellipse(bp[0] + 1, bp[1] - 6, 2.6, 2.2);
    c.paint(MAIN, it.t, { lw: 2, sw: 3 });
    MAIN.clear();
    c.clip = null;
    c.px(bp[0] - 7, bp[1] + 5, it.t.sh);
    c.px(bp[0] - 8, bp[1] + 6, it.t.sh);
    c.px(bp[0] + 7, bp[1] + 3, it.t.sh);
    tie(c, bp[0], bp[1] + 4, '#e0568a');
  });
});

// ---- low bun --------------------------------------------------------------------------------------------------------------------------

registerDrawer('hair.low_bun', (c, it, e) => {
  const [cx, cy] = headCenter(c);
  const h = c.rig.head;
  e.part(20.2, () => drawHair(c, cx, cy, asShape(it, 'hair.long')));
  e.part(c.back ? 20.3 : -7, () => {
    const bp = c.P(0, h[1] - 6, h[2] - HEAD_RZ - 2);
    MAIN.clear();
    MAIN.ellipse(bp[0], bp[1], 6.2, 5.8);
    c.paint(MAIN, it.t, { lw: 3, sw: 4, deco: curlDeco(c, seedOf(it)) });
    MAIN.clear();
    c.clip = null;
    c.line(bp[0] - 5, bp[1] + 3, bp[0] + 5, bp[1] + 3, it.t.sh);
    c.px(bp[0] - 2, bp[1] - 3, mix(it.t.lt, '#ffffff', 0.3));
    c.px(bp[0] - 1, bp[1] - 3, mix(it.t.lt, '#ffffff', 0.3));
  });
});

// ---- asymmetric bob -----------------------------------------------------------------------------------------------------------------

registerDrawer('hair.bob_asym', (c, it, e) => {
  const [cx, cy] = headCenter(c);
  const h = c.rig.head;
  e.part(-7 * c.cs, () => bobBack(c, cx, cy, () => undefined));
  e.part(20.2, () => {
    drawHair(c, cx, cy, asShape(it, 'hair.bob'));
    // the screen-left side falls longer, past the jaw
    const a = c.Pv(v3(-12.8, h[1] - 3, h[2] + 1));
    const b = c.Pv(v3(-12.4, h[1] - 14, h[2] + 2));
    MAIN.clear();
    MAIN.capsule(a[0], a[1], b[0], b[1], 3.8, 3);
    c.paint(MAIN, it.t, { lw: 3, sw: 4 });
    MAIN.clear();
    c.clip = null;
  });
});

// ---- pixie ----------------------------------------------------------------------------------------------------------------------------------

registerDrawer('hair.pixie', (c, it, e) => {
  const [cx, cy] = headCenter(c);
  e.part(20.2, () => {
    const t = it.t;
    MAIN.clear();
    hairCap(c, MAIN, cx, cy, { grow: 1.0, topGrow: 1.8, lowY: 4.4, hairline: -8.6 });
    cutEars(c, MAIN, cx, cy);
    if (!c.back) fringe(c, MAIN, cx, cy, 8);
    // wispy tufts over the forehead and nape
    const tufts: P2[] = [[cx + 7, cy - 6], [cx + 10, cy - 4]];
    if (!c.back) for (const [x, y] of tufts) MAIN.ellipse(x, y, 2.6, 2.4);
    c.paint(MAIN, t, { lw: 3, sw: 4, deco: (x, y, tone) => ((x * 2 + y) % 6 === 0 && tone !== 0 ? t.sh : undefined) });
    MAIN.clear();
    c.clip = null;
  });
});

// ---- half-up with a bow --------------------------------------------------------------------------------------------------------------------

registerDrawer('hair.half_up', (c, it, e) => {
  const [cx, cy] = headCenter(c);
  const h = c.rig.head;
  e.part(-7 * c.cs, () => hairBackPart(c, asShape(it, 'hair.long')));
  e.part(20.2, () => drawHair(c, cx, cy, asShape(it, 'hair.long')));
  e.part(20.4, () => {
    const p = c.P(0, h[1] + HEAD_RY - 1.6, h[2] - 2.6);
    const bow = '#d24a35';
    for (const sg of SIDE) {
      MAIN.clear();
      MAIN.ellipse(p[0] + sg * 4.2, p[1], 3.8, 2.8);
      c.paint(MAIN, { lt: mix(bow, '#ffffff', 0.3), base: bow, sh: mix(bow, '#000000', 0.3), ol: mix(bow, '#000000', 0.6), olLt: mix(bow, '#000000', 0.4) }, { lw: 1, sw: 2 });
    }
    MAIN.clear();
    c.clip = null;
    c.px(p[0], p[1], mix(bow, '#000000', 0.4));
    c.px(p[0] - 1, p[1], bow);
    c.px(p[0], p[1] + 1, mix(bow, '#000000', 0.4));
  });
});

// ---- quiff with side locks -----------------------------------------------------------------------------------------------------------------

registerDrawer('hair.sidelocks', (c, it, e) => {
  const [cx, cy] = headCenter(c);
  const h = c.rig.head;
  e.part(20.2, () => {
    drawHair(c, cx, cy, asShape(it, c.hatted ? 'hair.short' : 'hair.pompadour'));
    for (const sg of SIDE) {
      const a = c.Pv(v3(sg * 12.8, h[1] - 1, h[2] + 3));
      const b = c.Pv(v3(sg * 12.4, h[1] - 12, h[2] + 4.5));
      if (!c.back && Math.abs(c.sn) < 0.2) {
        MAIN.clear();
        MAIN.capsule(a[0], a[1], b[0], b[1], 2.4, 1.8);
        c.paint(MAIN, it.t, { lw: 2, sw: 3 });
        MAIN.clear();
        c.clip = null;
      }
    }
  });
});
