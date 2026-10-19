import { mix } from '../../pixel';
import { HEAD_RX, MAIN, SIDE, facePoint, headCenter, torsoPoint, type Ctx2 } from '../engine';
import { tonesOf } from '../recolor';
import { getDrawer, registerDrawer } from '../registry';

/** Itens de avatar dos eventos (Halloween, Carnaval, Ano Novo, Pascoa, Natal). Cores fixas; sao desenhados como os chapeus. */

registerDrawer('ev.witch_hat', (c, _it, e) =>
  e.part(20.6, () => {
    const [cx, cy] = headCenter(c);
    const col = tonesOf('#4a2a78');
    const by = cy - 9.4;
    MAIN.clear();
    MAIN.ellipse(cx, by, 17, 4.6);
    c.paint(MAIN, tonesOf('#3a2060'), { lw: 2, sw: 3 });
    MAIN.clear();
    MAIN.poly([[cx - 8.4, by], [cx + 4, cy - 31], [cx + 8.4, by]]);
    MAIN.capsule(cx + 3, cy - 30, cx + 10, cy - 27, 2.6, 1.8);
    c.paint(MAIN, col, { lw: 2, sw: 3 });
    // faixa e fivela
    for (let x = Math.round(cx - 8); x <= Math.round(cx + 8); x++) {
      c.px(x, by - 2, '#ff8a1f');
      c.px(x, by - 1, '#d06a10');
    }
    c.px(cx + 1, by - 2, '#ffe27a');
    c.px(cx + 2, by - 2, '#ffe27a');
    c.px(cx + 1, by - 1, '#ffe27a');
    c.px(cx + 2, by - 1, '#ffe27a');
    MAIN.clear();
    c.clip = null;
  }),
);

registerDrawer('ev.pumpkin_hat', (c, _it, e) =>
  e.part(20.6, () => {
    const [cx, cy] = headCenter(c);
    MAIN.clear();
    MAIN.ellipse(cx, cy - 13, 12.4, 8.4);
    c.paint(MAIN, tonesOf('#f28a1c'), { lw: 2, sw: 3, deco: (x, _y, tone) => (Math.abs(x - cx) % 6 < 1 ? (tone === 0 ? '#ffb347' : '#b4540e') : undefined) });
    MAIN.clear();
    MAIN.capsule(cx, cy - 22, cx + 2, cy - 19, 1.6, 1.4);
    c.paint(MAIN, tonesOf('#3f7a2a'), { lw: 1, sw: 1 });
    if (!c.back) {
      const g = '#ffe27a';
      c.px(cx - 5, cy - 15, g); c.px(cx - 4, cy - 15, g); c.px(cx - 4, cy - 16, g);
      c.px(cx + 4, cy - 15, g); c.px(cx + 5, cy - 15, g); c.px(cx + 4, cy - 16, g);
      for (let x = -4; x <= 4; x++) c.px(cx + x, cy - 11 + (Math.abs(x) % 2), g);
    }
    MAIN.clear();
    c.clip = null;
  }),
);

registerDrawer('ev.bunny_ears', (c, _it, e) =>
  e.part(20.6, () => {
    const [cx, cy] = headCenter(c);
    for (const sg of SIDE) {
      MAIN.clear();
      MAIN.capsule(cx + sg * 5.4, cy - 14, cx + sg * 8, cy - 29, 2.8, 2.4);
      c.paint(MAIN, tonesOf('#f4f1ea'), { lw: 2, sw: 3 });
      MAIN.clear();
      MAIN.capsule(cx + sg * 5.6, cy - 16, cx + sg * 7.8, cy - 27, 1.2, 1);
      c.paint(MAIN, tonesOf('#ffb8d8'), { lw: 1, sw: 1 });
    }
    // fita
    for (let x = Math.round(cx - 8); x <= Math.round(cx + 8); x++) c.px(x, cy - 12 - (Math.abs(x - cx) > 6 ? 0 : 1), '#ff9ccf');
    MAIN.clear();
    c.clip = null;
  }),
);

registerDrawer('ev.antlers', (c, _it, e) =>
  e.part(20.6, () => {
    const [cx, cy] = headCenter(c);
    const t = tonesOf('#8a5a2c');
    for (const sg of SIDE) {
      MAIN.clear();
      MAIN.capsule(cx + sg * 6, cy - 12, cx + sg * 9, cy - 25, 1.4, 1.2);
      MAIN.capsule(cx + sg * 8, cy - 19, cx + sg * 13, cy - 22, 1.1, 1);
      MAIN.capsule(cx + sg * 9, cy - 25, cx + sg * 5, cy - 29, 1.1, 1);
      c.paint(MAIN, t, { lw: 1, sw: 2 });
    }
    // fita vermelha com guizo
    for (let x = Math.round(cx - 7); x <= Math.round(cx + 7); x++) c.px(x, cy - 11, '#d03a3a');
    c.px(cx, cy - 10, '#ffd95a');
    MAIN.clear();
    c.clip = null;
  }),
);

function visor(c: Ctx2, frame: string, lens: string, glitter: string, feathers: boolean) {
  const [cx, cy] = headCenter(c);
  const pts = SIDE.map((sg) => facePoint(c, cx, cy, sg * 0.5, -1.6)).filter((p) => p.vis > 0.1);
  if (pts.length === 0) return;
  const xa = Math.round(Math.min(...pts.map((p) => p.x)) - 5);
  const xb = Math.round(Math.max(...pts.map((p) => p.x)) + 5);
  const y0 = Math.round(pts[0]!.y - 4);
  for (let y = 0; y < 7; y++) for (let x = xa; x <= xb; x++) {
    const edge = y === 0 || y === 6 || x === xa || x === xb;
    if ((y === 0 || y === 6) && (x === xa || x === xb)) continue;
    const eye = !edge && y >= 2 && y <= 4 && Math.abs(x - (xa + xb) / 2) >= 2 && Math.abs(x - (xa + xb) / 2) <= (xb - xa) / 2 - 2;
    c.px(x, y0 + y, eye ? '#1a1424' : edge ? mix(frame, '#000000', 0.35) : (x + y) % 5 === 0 ? glitter : lens);
  }
  c.px(xa + 2, y0 + 1, '#ffffff');
  if (feathers) {
    for (let k = 0; k < 4; k++) {
      c.line(xb, y0 + 1, xb + 3 + k, y0 - 3 - k + (k % 2), k % 2 ? '#e83c8a' : '#1fbf6a');
      c.line(xa, y0 + 1, xa - 3 - k, y0 - 3 - k + (k % 2), k % 2 ? '#ffcf1f' : '#3a8fd0');
    }
  }
}

registerDrawer('ev.carnival_mask', (c, _it, e) => e.part(20.5, () => visor(c, '#7a5af0', '#e83c8a', '#ffcf1f', true)));
registerDrawer('ev.ny_glasses', (c, _it, e) =>
  e.part(20.5, () => {
    visor(c, '#c9a227', '#2a2f4a', '#f4d35e', false);
    const [cx, cy] = headCenter(c);
    const p = facePoint(c, cx, cy, 0, -1.6);
    if (p.vis > 0.1) {
      c.px(p.x, p.y - 7, '#f4d35e');
      c.px(p.x - 1, p.y - 6, '#f4d35e');
      c.px(p.x + 1, p.y - 6, '#f4d35e');
    }
  }),
);

// ---- Dia do Profissional de TI -----------------------------------------------------------------------------------------

registerDrawer('ev.hacker_shades', (c, _it, e) =>
  e.part(20.5, () => {
    visor(c, '#0b1020', '#0d3b52', '#27d9ff', false);
    // neon edge on the lenses
    const [cx, cy] = headCenter(c);
    for (const sg of SIDE) {
      const p = facePoint(c, cx, cy, sg * 0.5, -1.6);
      if (p.vis > 0.1) c.px(p.x, p.y - 4, '#39ff88');
    }
  }),
);

// the bridge headset is the RGB headset in a fixed cyan
registerDrawer('ev.bridge_headset', (c, it, e) => getDrawer('sp.gamer_headset')?.draw(c, { ...it, hex: '#27d9ff' }, e));

registerDrawer('ti.headset', (c, it, e) => getDrawer('sp.gamer_headset')?.draw(c, { ...it, hex: '#39ff88' }, e));

registerDrawer('ev.alien_antennae', (c, _it, e) =>
  e.part(20.6, () => {
    const [cx, cy] = headCenter(c);
    // headband
    for (let x = Math.round(cx - 9); x <= Math.round(cx + 9); x++) c.px(x, cy - 12 - (Math.abs(x - cx) > 7 ? 0 : 1), '#1b4fcf');
    for (const sg of SIDE) {
      MAIN.clear();
      MAIN.capsule(cx + sg * 5, cy - 13, cx + sg * 8, cy - 26, 1.1, 0.9);
      c.paint(MAIN, tonesOf('#39ff88'), { lw: 1, sw: 1 });
      MAIN.clear();
      MAIN.ellipse(cx + sg * 8, cy - 28, 3.2, 3.2);
      c.paint(MAIN, tonesOf('#7dffb0'), { lw: 1, sw: 2 });
      c.px(cx + sg * 8 - 1, cy - 29, '#ffffff');
    }
    MAIN.clear();
    c.clip = null;
  }),
);

// round metal communicator pinned on the chest (original shape): ring, cyan core and two tiny side lights
registerDrawer('ev.comm_badge', (c, _it, e) =>
  e.part(0.1, () => {
    if (c.back) return;
    const p = torsoPoint(c, 0.3, 12.6, 0.9);
    if (p[2] < 0.2) return;
    const x = Math.round(p[0]);
    const y = Math.round(p[1]);
    const ring = ['..###..', '.#####.', '#######', '#######', '#######', '.#####.', '..###..'];
    ring.forEach((row, r) => {
      for (let k = 0; k < 7; k++) if (row[k] === '#') c.px(x - 3 + k, y - 3 + r, r < 2 ? '#e8ecf4' : r > 4 ? '#7a8396' : '#b8c0d0');
    });
    for (const [dx, dy] of [[-1, -1], [0, -1], [1, -1], [-1, 0], [0, 0], [1, 0], [0, 1]] as const) c.px(x + dx, y + dy, dy < 0 ? '#9af0ff' : '#27d9ff');
    c.px(x, y, '#ffffff');
    c.px(x - 3, y + 4, '#39ff88');
    c.px(x + 3, y + 4, '#ff5fb0');
  }),
);

void HEAD_RX;
