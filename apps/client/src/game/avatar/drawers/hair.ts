import { MAIN, AUX2, FH, FW, cutEars, curlDeco, drawHair, faceRegion, hairBackPart, hairCap, headCenter, type Ctx2, type Resolved } from '../engine';
import { registerDrawer } from '../registry';

/** The same item with another shape of the shared implementation (`styleOf` reads the id). */
const asShape = (it: Resolved, id: string): Resolved => ({ ...it, item: { ...it.item, id } });

registerDrawer('hair.none', () => {});

// ---- styles from the first version (shape selected by item id) ---------------------------------

const classic = (key: string, flatUnderHat = false) =>
  registerDrawer(key, (c, it, e) => {
    const [cx, cy] = headCenter(c);
    // Volume on top (spikes, bun, pompadour) flattens to a short cut under a hat so nothing pokes through.
    const shape = flatUnderHat && c.hatted ? asShape(it, 'hair.short') : it;
    e.part(-7 * c.cs, () => hairBackPart(c, shape));
    e.part(20.2, () => drawHair(c, cx, cy, shape));
  });
for (const key of ['hair.short', 'hair.long', 'hair.ponytail', 'hair.bob', 'hair.afro']) classic(key);
for (const key of ['hair.spiky', 'hair.bun', 'hair.pompadour']) classic(key, true);

// ---- buzz cut -----------------------------------------------------------------------------------

registerDrawer('hair.buzz', (c, it, e) => {
  const [cx, cy] = headCenter(c);
  e.part(20.2, () => {
    MAIN.clear();
    hairCap(c, MAIN, cx, cy, { grow: 0.7, topGrow: 0.7, lowY: 3.4, hairline: -9.8 });
    cutEars(c, MAIN, cx, cy);
    const t = it.t;
    c.paint(MAIN, t, { lw: 3, sw: 4, deco: (x, y, tone) => ((x + y) % 2 === 0 && tone !== 0 ? t.sh : undefined) });
    MAIN.clear();
    c.clip = null;
  });
});

// ---- medium: straight fringe like the bob, with a longer mass that reaches the shoulders --------------

function mediumBack(c: Ctx2, it: Resolved) {
  const { rig } = c;
  const top = rig.head;
  const pts: [number, number][] = [];
  const rows: [number, number, number][] = [
    [top[1] + 3, 13.6, -2],
    [top[1] - 8, 14.4, -4],
    [rig.hipY + 20, 13.4, -5],
    [rig.hipY + 14, 12.4, -4.6],
  ];
  for (const [yy, hw, zz] of rows) {
    for (let n = 0; n < 12; n++) {
      const psi = (n / 12) * Math.PI * 2;
      const p = c.P(Math.sin(psi) * hw, yy, rig.bz + zz + Math.cos(psi) * 6);
      pts.push([p[0], p[1]]);
    }
  }
  MAIN.clear();
  MAIN.hull(pts);
  if (!c.back) {
    const [cx, cy] = headCenter(c);
    AUX2.clear();
    faceRegion(c, AUX2, cx, cy, -7.4);
    MAIN.sub(AUX2);
    AUX2.clear();
  }
  c.paint(MAIN, it.t, { lw: 3, sw: 4 });
  // soft flipped tips
  const lowest = MAIN.y1;
  for (const [x0, x1] of [[MAIN.x0 + 1, MAIN.x0 + 3], [MAIN.x1 - 3, MAIN.x1 - 1]]) {
    for (let x = x0; x <= x1; x++) c.px(x, lowest, it.t.sh);
  }
  MAIN.clear();
  c.clip = null;
}

registerDrawer('hair.medium', (c, it, e) => {
  const [cx, cy] = headCenter(c);
  const front = asShape(it, 'hair.bob');
  e.part(-7 * c.cs, () => mediumBack(c, it));
  e.part(20.2, () => drawHair(c, cx, cy, front));
});

// ---- curly: a smaller, rounder cloud of curls than the afro ---------------------------------------------

registerDrawer('hair.curly', (c, it, e) => {
  const [cx, cy] = headCenter(c);
  const sn = c.sn;
  const seedBase = [...(it.ref.color ?? '')].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) | 0, 3) & 0xff;
  // curls hanging behind the head and down to the shoulders
  e.part(-7 * c.cs, () => {
    MAIN.clear();
    MAIN.ellipse(cx, cy + 3, 15.2, 13.4);
    for (let n = 0; n < 12; n++) {
      const a = (n / 12) * Math.PI * 2;
      MAIN.ellipse(cx + Math.cos(a) * 14, cy + 3 + Math.sin(a) * 12.4, 2.8, 2.8);
    }
    c.paint(MAIN, it.t, { lw: 3, sw: 4, deco: curlDeco(c, seedBase + 5) });
    MAIN.clear();
    c.clip = null;
  });
  e.part(20.2, () => {
    MAIN.clear();
    MAIN.ellipse(cx + 0.5 * sn, cy - 3.6, 15.6, 15);
    for (let n = 0; n < 14; n++) {
      const a = (n / 14) * Math.PI * 2;
      MAIN.ellipse(cx + 0.5 * sn + Math.cos(a) * 14, cy - 3.6 + Math.sin(a) * 13.4, 2.9, 2.9);
    }
    if (!c.back) {
      AUX2.clear();
      faceRegion(c, AUX2, cx, cy, -7.4);
      MAIN.sub(AUX2);
      AUX2.clear();
      for (let y = Math.floor(cy + 7); y < FH; y++) for (let x = 0; x < FW; x++) MAIN.a[y * FW + x] = 0;
      cutEars(c, MAIN, cx, cy);
    } else {
      for (let y = Math.floor(cy + 12); y < FH; y++) for (let x = 0; x < FW; x++) MAIN.a[y * FW + x] = 0;
    }
    c.paint(MAIN, it.t, { lw: 3, sw: 4, deco: curlDeco(c, seedBase) });
    MAIN.clear();
    c.clip = null;
  });
});

