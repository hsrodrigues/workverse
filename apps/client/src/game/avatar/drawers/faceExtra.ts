import { hash2, mix } from '../../pixel';
import { FACE_YAW, HEAD_RX, MAIN, SIDE, facePoint, headCenter, type Ctx2, type Resolved } from '../engine';
import { registerDrawer } from '../registry';
import { tonesOf } from '../recolor';
import { D_BROWS, D_EYES, D_FACIAL, D_MOUTH, onFace } from './face';

/**
 * More faces: eyes, brows, mouths and facial hair. Same rules as the first eyes/mouth: tiny flat marks, clipped to the
 * head, positioned with `facePoint` so they follow the head when it turns (front and three-quarter views only).
 */

const INK = '#241821';
const LIP = '#8a2f3a';
const MOUTH_IN = '#5a1624';
const TEETH = '#f6f3ec';

interface EyeSpot {
  sg: -1 | 1;
  /** Screen position of the eye center. */
  x: number;
  y: number;
  /** Eye width in pixels (3 facing the camera, 2 when turned). */
  w: number;
  /** Left pixel column. */
  x0: number;
}

function eyeSpots(c: Ctx2, cx: number, cy: number, wide: number, narrow: number): EyeSpot[] {
  const out: EyeSpot[] = [];
  for (const sg of SIDE) {
    const p = facePoint(c, cx, cy, sg * 0.4, -1.8);
    if (p.vis < 0.15) continue;
    const w = p.vis > 0.62 ? wide : narrow;
    out.push({ sg, x: p.x, y: p.y, w, x0: Math.round(p.x - w / 2) });
  }
  return out;
}

/** Pixel at column k of an eye; `k` 0 is the outer corner. */
const col = (e: EyeSpot, k: number) => (e.sg < 0 ? e.x0 + k : e.x0 + e.w - 1 - k);

// ---- eyes ------------------------------------------------------------------------------------------------------

registerDrawer('eyes.round', (c, it, e) =>
  e.part(D_EYES, () =>
    onFace(c, (cx, cy) => {
      for (const s of eyeSpots(c, cx, cy, 3, 2)) {
        const y0 = Math.round(s.y - 2);
        for (let k = 0; k < s.w; k++) {
          c.px(s.x0 + k, y0, INK);
          c.px(s.x0 + k, y0 + 1, it.hex);
          c.px(s.x0 + k, y0 + 2, it.hex);
          c.px(s.x0 + k, y0 + 3, it.t.sh);
        }
        c.px(col(s, s.w - 1), y0 + 1, TEETH); // glint on the inner side
      }
    }),
  ),
);

registerDrawer('eyes.narrow', (c, it, e) =>
  e.part(D_EYES, () =>
    onFace(c, (cx, cy) => {
      for (const s of eyeSpots(c, cx, cy, 3, 2)) {
        const y0 = Math.round(s.y);
        for (let k = 0; k < s.w; k++) c.px(s.x0 + k, y0, it.hex);
        c.px(col(s, 0), y0 - 1, it.hex); // outer corner lifts: almond shape
        c.px(col(s, s.w - 1), y0 + 1, it.t.sh);
      }
    }),
  ),
);

registerDrawer('eyes.happy', (c, it, e) =>
  e.part(D_EYES, () =>
    onFace(c, (cx, cy) => {
      for (const s of eyeSpots(c, cx, cy, 3, 2)) {
        const y0 = Math.round(s.y - 1);
        if (s.w === 3) {
          c.px(s.x0, y0 + 1, it.hex);
          c.px(s.x0 + 1, y0, it.hex);
          c.px(s.x0 + 2, y0 + 1, it.hex);
        } else {
          c.px(col(s, 0), y0 + 1, it.hex);
          c.px(col(s, 1), y0, it.hex);
        }
      }
    }),
  ),
);

registerDrawer('eyes.lashes', (c, it, e) =>
  e.part(D_EYES, () =>
    onFace(c, (cx, cy) => {
      for (const s of eyeSpots(c, cx, cy, 2, 2)) {
        const y0 = Math.round(s.y - 2);
        const outer = col(s, 0) + s.sg; // one pixel past the outer corner
        for (let k = 0; k < s.w; k++) c.px(s.x0 + k, y0, INK);
        c.px(outer, y0, INK);
        c.px(outer, y0 - 1, INK);
        for (let k = 0; k < s.w; k++) {
          c.px(s.x0 + k, y0 + 1, it.hex);
          c.px(s.x0 + k, y0 + 2, it.hex);
          c.px(s.x0 + k, y0 + 3, it.t.sh);
        }
        c.px(col(s, s.w - 1), y0 + 1, TEETH);
      }
    }),
  ),
);

// ---- brows -----------------------------------------------------------------------------------------------------

/** Brow shapes: dy per pixel from the outer corner to the inner end (negative is up), and thickness. */
const BROWS: Record<string, { dy: number[]; thick: boolean }> = {
  'brows.soft': { dy: [0, 0, 0, 0], thick: false },
  'brows.thick': { dy: [0, 0, 0, 0], thick: true },
  'brows.arched': { dy: [1, 0, 0, 1], thick: false },
  'brows.stern': { dy: [-1, 0, 1, 1], thick: true },
};

for (const [key, shape] of Object.entries(BROWS)) {
  registerDrawer(key, (c, it, e) =>
    e.part(D_BROWS, () =>
      onFace(c, (cx, cy) => {
        for (const s of eyeSpots(c, cx, cy, 4, 3)) {
          const y0 = Math.round(s.y - 5);
          const x0 = Math.round(s.x - s.w / 2);
          for (let k = 0; k < s.w; k++) {
            // k = 0 is the outer end: mirror for the left eye so the shape is symmetric
            const px = s.sg < 0 ? x0 + k : x0 + s.w - 1 - k;
            const dy = shape.dy[Math.min(shape.dy.length - 1, Math.round((k / Math.max(1, s.w - 1)) * (shape.dy.length - 1)))];
            c.px(px, y0 + dy, it.hex);
            if (shape.thick) c.px(px, y0 + dy + 1, it.hex);
          }
        }
      }),
    ),
  );
}

// ---- mouths ----------------------------------------------------------------------------------------------------

interface MouthSpot {
  x0: number;
  y: number;
  w: number;
}

function mouthSpot(c: Ctx2, cx: number, cy: number, base = 4): MouthSpot {
  const m = facePoint(c, cx, cy, 0, -8.2);
  const w = Math.max(2, Math.round(base * Math.cos(c.th * FACE_YAW)));
  return { x0: Math.round(m.x - w / 2), y: Math.round(m.y), w };
}

registerDrawer('mouth.neutral', (c, _it, e) =>
  e.part(D_MOUTH, () =>
    onFace(c, (cx, cy) => {
      const m = mouthSpot(c, cx, cy, 3.4);
      for (let k = 0; k < m.w; k++) c.px(m.x0 + k, m.y, LIP);
    }),
  ),
);

registerDrawer('mouth.grin', (c, _it, e) =>
  e.part(D_MOUTH, () =>
    onFace(c, (cx, cy) => {
      const m = mouthSpot(c, cx, cy, 6);
      const w = Math.max(3, m.w);
      const x0 = m.x0 - (w > m.w ? 1 : 0);
      for (let k = 0; k < w; k++) c.px(x0 + k, m.y, LIP);
      for (let k = 1; k < w - 1; k++) c.px(x0 + k, m.y + 1, TEETH);
      c.px(x0, m.y - 1, LIP);
      c.px(x0 + w - 1, m.y - 1, LIP);
      for (let k = 1; k < w - 1; k++) c.px(x0 + k, m.y + 2, LIP);
    }),
  ),
);

registerDrawer('mouth.laugh', (c, _it, e) =>
  e.part(D_MOUTH, () =>
    onFace(c, (cx, cy) => {
      const m = mouthSpot(c, cx, cy, 5.4);
      const w = Math.max(3, m.w);
      const x0 = m.x0 - (w > m.w ? 1 : 0);
      for (let k = 0; k < w; k++) c.px(x0 + k, m.y, LIP);
      for (let k = 1; k < w - 1; k++) {
        c.px(x0 + k, m.y + 1, TEETH);
        c.px(x0 + k, m.y + 2, MOUTH_IN);
      }
      c.px(x0, m.y + 1, LIP);
      c.px(x0 + w - 1, m.y + 1, LIP);
      c.px(x0 + (w >> 1), m.y + 2, '#d8606c'); // tongue
      for (let k = 1; k < w - 1; k++) c.px(x0 + k, m.y + 3, LIP);
      c.px(x0, m.y - 1, LIP);
      c.px(x0 + w - 1, m.y - 1, LIP);
    }),
  ),
);

registerDrawer('mouth.smirk', (c, _it, e) =>
  e.part(D_MOUTH, () =>
    onFace(c, (cx, cy) => {
      const m = mouthSpot(c, cx, cy, 4.6);
      const w = Math.max(3, m.w);
      for (let k = 0; k < w; k++) c.px(m.x0 + k, m.y, LIP);
      c.px(m.x0 + w, m.y - 1, LIP); // right corner lifts
      c.px(m.x0 + w + 1, m.y - 2, LIP);
    }),
  ),
);

registerDrawer('mouth.surprised', (c, _it, e) =>
  e.part(D_MOUTH, () =>
    onFace(c, (cx, cy) => {
      const m = mouthSpot(c, cx, cy, 3);
      const w = Math.max(2, Math.min(3, m.w));
      const x0 = m.x0;
      for (let k = 0; k < w; k++) {
        c.px(x0 + k, m.y, LIP);
        c.px(x0 + k, m.y + 3, LIP);
      }
      for (let r = 1; r <= 2; r++) {
        for (let k = 0; k < w; k++) c.px(x0 + k, m.y + r, k === 0 || k === w - 1 ? LIP : MOUTH_IN);
      }
      if (w === 2) {
        c.px(x0, m.y + 1, MOUTH_IN);
        c.px(x0 + 1, m.y + 1, MOUTH_IN);
      }
    }),
  ),
);

// ---- facial hair -------------------------------------------------------------------------------------------------

/** Hairy region of the lower face: jaw and sideburns, with the mouth left clear. */
function beardMask(c: Ctx2, cx: number, cy: number, mouth: MouthSpot, top: number): void {
  const fx = cx + HEAD_RX * Math.sin(c.th * FACE_YAW);
  const clip = c.headClip;
  MAIN.clear();
  for (let y = Math.floor(cy + top - 3); y <= clip.y1; y++) {
    for (let x = clip.x0; x <= clip.x1; x++) {
      if (!clip.has(x, y)) continue;
      const dx = Math.abs(x + 0.5 - fx) / HEAD_RX;
      // upper edge: sideburns start higher than the chin area
      const edge = cy + top + 3.2 * (1 - Math.min(1, dx * 1.25)) * 1.0;
      if (y + 0.5 < edge - (dx > 0.62 ? 3.4 : 0)) continue;
      MAIN.set(x, y);
    }
  }
  // keep the mouth visible
  for (let y = mouth.y - 1; y <= mouth.y + 2; y++) {
    for (let x = mouth.x0 - 2; x < mouth.x0 + mouth.w + 2; x++) MAIN.a[y * 64 + x] = 0;
  }
}

function paintBeard(c: Ctx2, it: Resolved, cx: number, cy: number, mouth: MouthSpot, top: number, stubble: boolean) {
  const m = tonesOf(it.hex);
  beardMask(c, cx, cy, mouth, top);
  if (stubble) {
    const skin = c.skin.base;
    const dot = mix(skin, it.hex, 0.62);
    const dot2 = mix(skin, it.hex, 0.35);
    for (let y = MAIN.y0; y <= MAIN.y1; y++) {
      for (let x = MAIN.x0; x <= MAIN.x1; x++) {
        if (!MAIN.a[y * 64 + x]) continue;
        const h = hash2(x, y, 11);
        if (h < 0.34) c.px(x, y, dot);
        else if (h < 0.5) c.px(x, y, dot2);
      }
    }
  } else {
    c.paint(MAIN, m, { lw: 2, sw: 3, outline: false });
  }
  MAIN.clear();
  c.clip = c.headClip;
}

function mustache(c: Ctx2, it: Resolved, cx: number, cy: number, m: MouthSpot, wide: number) {
  const t = tonesOf(it.hex);
  const half = Math.max(2, Math.round(wide * Math.cos(c.th * FACE_YAW)));
  const mid = m.x0 + m.w / 2;
  const x0 = Math.round(mid - half);
  const x1 = Math.round(mid + half) - 1;
  const y = m.y - 2;
  for (let x = x0; x <= x1; x++) {
    c.px(x, y, t.base);
    c.px(x, y - 1, x === x0 || x === x1 ? t.sh : t.base);
  }
  c.px(x0, y + 1, t.sh); // ends droop
  c.px(x1, y + 1, t.sh);
  c.px(Math.round(mid) - 1, y - 1, t.lt);
  void cx;
  void cy;
}

registerDrawer('facial.stubble', (c, it, e) =>
  e.part(D_FACIAL, () =>
    onFace(c, (cx, cy) => {
      paintBeard(c, it, cx, cy, mouthSpot(c, cx, cy), 5.4, true);
    }),
  ),
);

registerDrawer('facial.beard', (c, it, e) =>
  e.part(D_FACIAL, () =>
    onFace(c, (cx, cy) => {
      const m = mouthSpot(c, cx, cy);
      paintBeard(c, it, cx, cy, m, 4.4, false);
      mustache(c, it, cx, cy, m, 4);
    }),
  ),
);

registerDrawer('facial.mustache', (c, it, e) =>
  e.part(D_FACIAL, () =>
    onFace(c, (cx, cy) => {
      mustache(c, it, cx, cy, mouthSpot(c, cx, cy), 4);
    }),
  ),
);

registerDrawer('facial.goatee', (c, it, e) =>
  e.part(D_FACIAL, () =>
    onFace(c, (cx, cy) => {
      const m = mouthSpot(c, cx, cy);
      const t = tonesOf(it.hex);
      mustache(c, it, cx, cy, m, 3);
      const mid = Math.round(m.x0 + m.w / 2);
      const w = Math.max(2, Math.round(4 * Math.cos(c.th * FACE_YAW)));
      for (let r = 0; r < 3; r++) {
        const rw = Math.max(1, w - (r === 2 ? 1 : 0));
        for (let k = 0; k < rw; k++) c.px(mid - (rw >> 1) + k, m.y + 3 + r, r === 2 ? t.sh : t.base);
      }
      c.px(mid - 1, m.y + 3, t.lt);
    }),
  ),
);

void headCenter;
