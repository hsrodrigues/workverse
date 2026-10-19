import { mix, shade } from '../../pixel';
import {
  HEAD_RX,
  HEAD_RY,
  MAIN,
  SIDE,
  armDepth,
  headCenter,
  torsoPoint,
  v3,
  vAdd,
  vNorm,
  vSub,
  type Ctx2,
  type P2,
  type Rig,
  type Resolved,
  type V3,
} from '../engine';
import { tonesOf, type Tones } from '../recolor';
import { registerDrawer, renderExtras } from '../registry';

/**
 * Special items: held devices (notebook, tablet, mug), the corporate badge and festive hats.
 * Held items are only asked for in the poses the catalog marks as supported (see `ItemDef.poses`): the notebook and the
 * tablet are drawn standing and sitting, the mug also while walking; none of them while waving (hidden, never broken).
 */

const quadPts = (c: Ctx2, pts: readonly V3[]): P2[] =>
  pts.map((p) => {
    const q = c.Pv(p);
    return [q[0], q[1]] as P2;
  });

function slab(c: Ctx2, pts: readonly V3[], t: Tones, o: { lw?: number; sw?: number } = {}) {
  MAIN.clear();
  MAIN.hull(quadPts(c, pts));
  c.paint(MAIN, t, { lw: o.lw ?? 1, sw: o.sw ?? 2 });
}

// ---- notebook ----------------------------------------------------------------------------------------------------

const NOTE_W = 6.4; // half width of the notebook

registerDrawer('sp.notebook', {
  hold: (pose) =>
    pose === 'sit'
      ? { side: 1, target: (rig: Rig) => v3(3.4, rig.hipY + 7.4, rig.bz + 11) }
      : { side: 1, target: (rig: Rig) => v3(8.6, rig.hipY + 6.4, rig.bz + 8.4) },
  draw: (c, it, e) => {
    const { rig } = c;
    const t = it.t;
    if (c.pose === 'sit') {
      // open on the lap: we see the back of the lid, its logo, and the front edge of the base
      e.part(c.back ? -1 : 120, () => {
        const y0 = rig.hipY + 5.8;
        const hz = rig.bz + 14.4;
        slab(c, [v3(-NOTE_W, y0 - 1.6, hz + 1.8), v3(NOTE_W, y0 - 1.6, hz + 1.8), v3(NOTE_W, y0, hz), v3(-NOTE_W, y0, hz)], tonesOf(shade(it.hex, -0.18)));
        slab(c, [v3(-NOTE_W, y0, hz), v3(NOTE_W, y0, hz), v3(NOTE_W, y0 + 9.6, hz - 2.2), v3(-NOTE_W, y0 + 9.6, hz - 2.2)], t, { lw: 2, sw: 3 });
        const lg = c.Pv(v3(0, y0 + 5, hz - 1));
        c.px(lg[0], lg[1], '#f4f1ea');
        c.px(lg[0] - 1, lg[1], mix(t.lt, '#ffffff', 0.5));
        c.px(lg[0], lg[1] - 1, mix(t.lt, '#ffffff', 0.5));
        c.px(lg[0] + 1, lg[1], t.sh);
        c.px(lg[0], lg[1] + 1, t.sh);
        MAIN.clear();
        c.clip = null;
      });
      return;
    }
    // standing: closed, held flat against the belly
    e.part(c.back ? -1 : 0.2, () => {
      const cxm = 2.6;
      const y0 = rig.hipY + 4.6;
      const z = rig.bz + 7.6;
      slab(c, [v3(cxm - NOTE_W, y0, z), v3(cxm + NOTE_W, y0, z), v3(cxm + NOTE_W, y0 + 8.6, z + 0.4), v3(cxm - NOTE_W, y0 + 8.6, z + 0.4)], t, { lw: 2, sw: 3 });
      const lg = c.Pv(v3(cxm, y0 + 4.6, z + 0.6));
      c.px(lg[0], lg[1], '#f4f1ea');
      c.px(lg[0] - 1, lg[1], mix(t.lt, '#ffffff', 0.5));
      c.px(lg[0] + 1, lg[1] - 1, t.sh);
      MAIN.clear();
      c.clip = null;
    });
  },
});

// ---- tablet -------------------------------------------------------------------------------------------------------

registerDrawer('sp.tablet', {
  hold: () => ({ side: 1, target: (rig: Rig) => v3(8.4, rig.hipY + 9.4, rig.bz + 8.6) }),
  draw: (c, it, e) =>
    e.part(c.back ? -1 : c.pose === 'sit' ? 99.5 : 0.2, () => {
      const { rig } = c;
      const t = it.t;
      const cxm = 4.6;
      const y0 = rig.hipY + 7.2;
      const z = rig.bz + 8.2;
      slab(c, [v3(cxm - 4.4, y0, z), v3(cxm + 4.4, y0, z), v3(cxm + 4.4, y0 + 12.2, z + 0.5), v3(cxm - 4.4, y0 + 12.2, z + 0.5)], t, { lw: 2, sw: 3 });
      // back plate: camera dot, logo and a lighter edge
      const cam = c.Pv(v3(cxm - 2.8, y0 + 11, z + 0.8));
      c.px(cam[0], cam[1], '#1d1a24');
      c.px(cam[0] + 1, cam[1], mix(t.lt, '#ffffff', 0.4));
      const lg = c.Pv(v3(cxm, y0 + 6, z + 0.7));
      c.px(lg[0], lg[1], mix(t.lt, '#ffffff', 0.6));
      c.px(lg[0], lg[1] + 1, mix(t.lt, '#ffffff', 0.3));
      MAIN.clear();
      c.clip = null;
    }),
});

// ---- coffee mug ---------------------------------------------------------------------------------------------------

const GOLD = tonesOf('#e3b03a');

registerDrawer('sp.mug', {
  hold: () => ({ side: 1, target: (rig: Rig) => v3(6.2, rig.hipY + 14.2, rig.bz + 9) }),
  draw: (c, it, e) =>
    e.part(armDepth(c, 1) + 0.02, () => {
      const { rig } = c;
      const gold = it.item.params?.gold === true;
      const t = gold ? GOLD : it.t;
      const wr = rig.wrist[1];
      const dir = vNorm(vSub(wr, rig.elbow[1]));
      const tip = c.Pv(vAdd(wr, [dir[0] * 3.4, dir[1] * 3.4, dir[2] * 3.4]));
      const hx = Math.round(tip[0]);
      const hy = Math.round(tip[1]);
      const x0 = hx - 3;
      const y0 = hy - 7;
      MAIN.clear();
      for (let y = 0; y < 7; y++) for (let x = 0; x < 6; x++) MAIN.set(x0 + x, y0 + y);
      c.paint(MAIN, t, { lw: 1, sw: 2 });
      // coffee surface, rim highlight and a small logo band
      for (let x = 1; x <= 4; x++) c.px(x0 + x, y0 + 1, '#5a3420');
      c.px(x0 + 1, y0, t.lt);
      c.px(x0 + 4, y0 + 1, '#3c2214');
      for (let x = 1; x <= 4; x++) c.px(x0 + x, y0 + 4, gold ? '#b57a1e' : t.sh);
      c.px(x0 + 1, y0 + 2, mix(t.lt, '#ffffff', 0.5));
      // handle on the outer side (screen right when facing the camera)
      const hxp = x0 + 6;
      c.px(hxp, y0 + 2, t.ol);
      c.px(hxp + 1, y0 + 3, t.ol);
      c.px(hxp, y0 + 4, t.ol);
      c.px(hxp, y0 + 3, t.base);
      // steam
      const steam = '#e9eaf0';
      c.px(x0 + 2, y0 - 2, steam);
      c.px(x0 + 3, y0 - 3, mix(steam, '#9aa0b4', 0.4));
      c.px(x0 + 2, y0 - 4, mix(steam, '#9aa0b4', 0.6));
      MAIN.clear();
      c.clip = null;
    }),
});

// ---- glass of water (water cooler; not a wardrobe item, see ../held.ts) ------------------------------------------------

registerDrawer('sp.cup', {
  hold: () => ({ side: 1, target: (rig: Rig) => v3(6.2, rig.hipY + 14.2, rig.bz + 9) }),
  draw: (c, it, e) =>
    e.part(armDepth(c, 1) + 0.02, () => {
      const { rig } = c;
      const wr = rig.wrist[1];
      const dir = vNorm(vSub(wr, rig.elbow[1]));
      const tip = c.Pv(vAdd(wr, [dir[0] * 3.4, dir[1] * 3.4, dir[2] * 3.4]));
      const hx = Math.round(tip[0]);
      const hy = Math.round(tip[1]);
      const x0 = hx - 3;
      const y0 = hy - 7;
      // tapered plastic cup: 6px wide at the rim, 4px at the base
      MAIN.clear();
      for (let y = 0; y < 7; y++) {
        const inset = y >= 5 ? 1 : 0;
        for (let x = inset; x < 6 - inset; x++) MAIN.set(x0 + x, y0 + y);
      }
      c.paint(MAIN, it.t, { lw: 1, sw: 2 });
      // water level (blue), surface line and a highlight on the glass
      for (let y = 2; y < 7; y++) {
        const inset = y >= 5 ? 1 : 0;
        for (let x = 1 + inset; x < 5 - inset; x++) c.px(x0 + x, y0 + y, y === 2 ? '#a9dcf7' : y >= 5 ? '#4d9bd6' : '#6bb6e8');
      }
      c.px(x0 + 1, y0 + 3, '#ffffff');
      c.px(x0 + 1, y0 + 4, '#d9f1ff');
      c.px(x0, y0, '#ffffff');
      MAIN.clear();
      c.clip = null;
    }),
});

// ---- snack bag, soda can and lunch box (vending machines and microwave; not wardrobe items, see ../held.ts) ------------

/** Common anchor of the small things held in the right hand: top-left corner of a box of `w` x `h` around the fist. */
function handBox(c: Ctx2, w: number, h: number): [number, number] {
  const { rig } = c;
  const wr = rig.wrist[1];
  const dir = vNorm(vSub(wr, rig.elbow[1]));
  const tip = c.Pv(vAdd(wr, [dir[0] * 3.4, dir[1] * 3.4, dir[2] * 3.4]));
  return [Math.round(tip[0]) - Math.floor(w / 2), Math.round(tip[1]) - h];
}

registerDrawer('sp.snack', {
  hold: () => ({ side: 1, target: (rig: Rig) => v3(6.2, rig.hipY + 14.2, rig.bz + 9) }),
  draw: (c, it, e) =>
    e.part(armDepth(c, 1) + 0.02, () => {
      const [x0, y0] = handBox(c, 6, 8);
      // crimped bag: 6px wide, 8px tall, slightly pinched at both ends
      MAIN.clear();
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 6; x++) MAIN.set(x0 + x, y0 + y);
      }
      c.paint(MAIN, it.t, { lw: 1, sw: 2 });
      // crimps (zig-zag) at the top and bottom
      for (let x = 0; x < 6; x++) {
        c.px(x0 + x, y0, x % 2 ? '#f4c542' : '#d98e1f');
        c.px(x0 + x, y0 + 7, x % 2 ? '#d98e1f' : '#f4c542');
      }
      // yellow label with a red chip drawn on it and a light edge
      for (let y = 2; y <= 5; y++) for (let x = 1; x <= 4; x++) c.px(x0 + x, y0 + y, y === 2 ? '#ffe27a' : '#ffd24a');
      c.px(x0 + 2, y0 + 3, '#c4301f');
      c.px(x0 + 3, y0 + 3, '#e8593a');
      c.px(x0 + 2, y0 + 4, '#a82616');
      c.px(x0 + 1, y0 + 1, mix(it.t.lt, '#ffffff', 0.55));
      c.px(x0 + 5, y0 + 5, it.t.sh);
      MAIN.clear();
      c.clip = null;
    }),
});

registerDrawer('sp.can', {
  hold: () => ({ side: 1, target: (rig: Rig) => v3(6.2, rig.hipY + 14.2, rig.bz + 9) }),
  draw: (c, it, e) =>
    e.part(armDepth(c, 1) + 0.02, () => {
      const [x0, y0] = handBox(c, 4, 7);
      // can: 4px wide, 7px tall, aluminium lid and base
      MAIN.clear();
      for (let y = 0; y < 7; y++) for (let x = 0; x < 4; x++) MAIN.set(x0 + x, y0 + y);
      c.paint(MAIN, it.t, { lw: 1, sw: 2 });
      for (let x = 0; x < 4; x++) {
        c.px(x0 + x, y0, '#d9dde6');
        c.px(x0 + x, y0 + 6, '#9aa0ac');
      }
      c.px(x0 + 1, y0, '#ffffff');
      // white wave stripe across the body and a highlight on the left side
      c.px(x0, y0 + 3, '#ffffff');
      c.px(x0 + 1, y0 + 4, '#ffffff');
      c.px(x0 + 2, y0 + 3, '#ffffff');
      c.px(x0 + 3, y0 + 4, '#ffffff');
      c.px(x0, y0 + 2, mix(it.t.lt, '#ffffff', 0.5));
      c.px(x0, y0 + 1, mix(it.t.lt, '#ffffff', 0.35));
      c.px(x0 + 3, y0 + 2, it.t.sh);
      MAIN.clear();
      c.clip = null;
    }),
});

registerDrawer('sp.lunchbox', {
  hold: () => ({ side: 1, target: (rig: Rig) => v3(6.2, rig.hipY + 14.2, rig.bz + 9) }),
  draw: (c, it, e) =>
    e.part(armDepth(c, 1) + 0.02, () => {
      const [x0, y0] = handBox(c, 8, 6);
      // rectangular container with a clear lid: food visible, steam on top
      MAIN.clear();
      for (let y = 0; y < 6; y++) for (let x = 0; x < 8; x++) MAIN.set(x0 + x, y0 + y);
      c.paint(MAIN, it.t, { lw: 1, sw: 2 });
      for (let x = 0; x < 8; x++) c.px(x0 + x, y0, '#f4f1ea');
      for (let x = 1; x < 7; x++) {
        c.px(x0 + x, y0 + 1, x % 2 ? '#e8892a' : '#f2b64a');
        c.px(x0 + x, y0 + 2, x % 3 === 0 ? '#58b45f' : '#f7e3a4');
      }
      c.px(x0 + 2, y0 + 2, '#58b45f');
      c.px(x0 + 5, y0 + 1, '#d44a2a');
      c.px(x0 + 1, y0, '#ffffff');
      for (let x = 0; x < 8; x++) c.px(x0 + x, y0 + 3, '#2f7fbf');
      for (let x = 1; x < 7; x++) c.px(x0 + x, y0 + 4, '#3b8fd0');
      c.px(x0 + 1, y0 + 4, '#7fc4ea');
      // steam
      const steam = '#e9eaf0';
      c.px(x0 + 2, y0 - 2, steam);
      c.px(x0 + 3, y0 - 3, mix(steam, '#9aa0b4', 0.4));
      c.px(x0 + 5, y0 - 2, mix(steam, '#9aa0b4', 0.3));
      c.px(x0 + 5, y0 - 4, mix(steam, '#9aa0b4', 0.6));
      MAIN.clear();
      c.clip = null;
    }),
});

// ---- badge on a lanyard --------------------------------------------------------------------------------------------

registerDrawer('sp.badge', (c, it, e) => {
  const staff = it.item.params?.staff === true;
  const tiCard = it.item.params?.ti === true;
  const strap = staff ? tonesOf('#d9a62e') : it.t;
  e.part(0.1, () => {
    if (c.back) {
      // only the lanyard around the neck shows from behind
      const a = torsoPoint(c, Math.PI - 0.55, 22.6, 0.5);
      const b = torsoPoint(c, Math.PI + 0.55, 22.6, 0.5);
      c.line(a[0], a[1], b[0], b[1], strap.base);
      c.line(a[0], a[1] + 1, b[0], b[1] + 1, strap.sh);
      return;
    }
    const card = torsoPoint(c, 0.0, 10.6, 0.9);
    const w = tiCard ? Math.max(6, Math.round(9 * c.cs)) : Math.max(4, Math.round(7 * c.cs));
    const x0 = Math.round(card[0] - w / 2);
    const y0 = Math.round(card[1] - 4);
    // lanyard
    for (const sg of SIDE) {
      const n = torsoPoint(c, sg * 0.66, 22.2, 0.7);
      if (n[2] < 0) continue;
      c.line(n[0], n[1], x0 + w / 2, y0, strap.base);
      c.line(n[0] + 1, n[1], x0 + w / 2 + 1, y0, strap.sh);
    }
    c.px(x0 + w / 2 - 1, y0 - 1, '#c9ccd4');
    c.px(x0 + w / 2, y0 - 1, '#8a8f9a');
    // card: ink border, white body, color header, photo and text lines
    // the stripe takes the color of the person's sector (set by the scene); the staff badge keeps its gold
    const head = staff ? '#e0b030' : (renderExtras.stripe ?? it.hex);
    if (tiCard) {
      // IT badge: dark navy card with a neon cyan frame, circuit chip in the header, mini portrait and the letters TI
      const H = 11;
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < w; x++) {
          const edge = y === 0 || y === H - 1 || x === 0 || x === w - 1;
          const corner = (y === 0 || y === H - 1) && (x === 0 || x === w - 1);
          if (corner) continue;
          c.px(x0 + x, y0 + y, edge ? '#27d9ff' : y < 3 ? head : '#0e1a33');
        }
      }
      const mid2 = x0 + (w >> 1);
      // chip: a tiny square with legs
      for (const [dx, dy] of [[-1, 1], [0, 1], [1, 1], [-1, 2], [1, 2]] as const) c.px(mid2 + dx, y0 + dy, '#0b2a44');
      c.px(mid2, y0 + 2, '#7aeaff');
      // portrait
      const pw2 = w >= 8 ? 3 : 2;
      const px2 = mid2 - (pw2 >> 1);
      for (let i = 0; i < pw2; i++) {
        c.px(px2 + i, y0 + 3, c.hair.base);
        c.px(px2 + i, y0 + 4, c.skinHex);
        c.px(px2 + i, y0 + 5, c.skinHex);
      }
      c.px(px2, y0 + 4, '#2a2230');
      if (pw2 === 3) c.px(px2 + 2, y0 + 4, '#2a2230');
      // T and I, three pixels each
      const tx = mid2 - 3;
      for (const dx of [0, 1, 2]) c.px(tx + dx, y0 + 7, '#7aeaff');
      c.px(tx + 1, y0 + 8, '#27d9ff');
      c.px(tx + 1, y0 + 9, '#27d9ff');
      for (const dx of [0, 1, 2]) c.px(tx + 4 + dx, y0 + 7, '#7aeaff');
      c.px(tx + 5, y0 + 8, '#27d9ff');
      for (const dx of [0, 1, 2]) c.px(tx + 4 + dx, y0 + 9, '#27d9ff');
      return;
    }
    for (let y = 0; y < 9; y++) {
      for (let x = 0; x < w; x++) {
        const edge = y === 0 || y === 8 || x === 0 || x === w - 1;
        const corner = (y === 0 || y === 8) && (x === 0 || x === w - 1);
        if (corner) continue;
        c.px(x0 + x, y0 + y, edge ? '#2a2230' : y < 3 ? head : staff ? '#fff1b8' : '#f4f1ea');
      }
    }
    c.px(x0 + 1, y0 + 1, mix(head, '#ffffff', 0.4));
    const mid = x0 + (w >> 1);
    // mini portrait (3x3) with the wearer's own hair and skin; narrower in the 3/4 views
    const pw = w >= 6 ? 3 : 2;
    const px0 = mid - (pw >> 1);
    for (let i = 0; i < pw; i++) {
      c.px(px0 + i, y0 + 3, c.hair.base);
      c.px(px0 + i, y0 + 4, c.skinHex);
      c.px(px0 + i, y0 + 5, c.skinHex);
    }
    c.px(px0, y0 + 4, '#2a2230');
    if (pw === 3) c.px(px0 + 2, y0 + 4, '#2a2230');
    for (let x = 1; x < w - 1; x++) c.px(x0 + x, y0 + 7, '#9a93a2');
    if (staff) {
      c.px(mid, y0 + 1, '#ffffff');
      c.px(mid - 1, y0 + 2, '#fff1b8');
      c.px(mid, y0 + 2, '#ffffff');
    }
  });
});

// ---- festive hats -------------------------------------------------------------------------------------------------

registerDrawer('sp.party_hat', (c, it, e) =>
  e.part(20.6, () => {
    const [cx, cy] = headCenter(c);
    const col = it.t;
    const bx = cx + 1;
    const by = cy - 12.4;
    const apexX = cx + 2.6;
    const apexY = cy - 33;
    MAIN.clear();
    MAIN.ellipse(bx, by, 7.4, 2.8);
    MAIN.poly([
      [bx - 7.4, by],
      [apexX, apexY],
      [bx + 7.4, by],
    ]);
    const stripe = tonesOf(it.hex === '#f2d03a' ? '#ffffff' : '#ffe27a');
    c.paint(MAIN, col, {
      lw: 2,
      sw: 3,
      deco: (x, y, tone) => (Math.floor((x + y * 0.9) / 3) % 3 === 0 ? (tone === 2 ? stripe.sh : tone === 0 ? stripe.lt : stripe.base) : undefined),
    });
    // pompom
    MAIN.clear();
    MAIN.ellipse(apexX, apexY - 1, 3.2, 3.2);
    c.paint(MAIN, tonesOf('#ffe27a'), { lw: 1, sw: 2 });
    MAIN.clear();
    c.clip = null;
  }),
);

registerDrawer('sp.santa_hat', (c, it, e) =>
  e.part(20.6, () => {
    const [cx, cy] = headCenter(c);
    const col = it.t.base === it.hex ? tonesOf('#d03a3a') : it.t;
    const white = tonesOf('#f4f1ea');
    const by = cy - 8.6;
    MAIN.clear();
    MAIN.ellipse(cx, cy - 12.6, 13.2, 8.4);
    for (let y = Math.floor(cy - 12.6); y <= by; y++) for (let x = Math.round(cx - 13); x <= Math.round(cx + 13); x++) MAIN.set(x, y);
    MAIN.capsule(cx + 1, cy - 19, cx + 10, cy - 11, 5, 3.4);
    c.paint(MAIN, col, { lw: 3, sw: 4 });
    // fur band and pompom
    MAIN.clear();
    MAIN.ellipse(cx, by, 14.4, 3.6);
    c.paint(MAIN, white, { lw: 2, sw: 3 });
    MAIN.clear();
    MAIN.ellipse(cx + 11, cy - 10, 3.6, 3.6);
    c.paint(MAIN, white, { lw: 2, sw: 2 });
    MAIN.clear();
    c.clip = null;
  }),
);

void HEAD_RX;
void HEAD_RY;
export type { Resolved };
