import type { Furniture, FurniKind } from '@workverse/shared';
import { Plane, boxPlane, hash2, project, shade, softEllipse, type Box, type Ctx } from './pixel';
import { wallText } from './eventArt';
import type { Builder, Parts } from './furniture';

/**
 * Pieces of the IT room (Sala da TI): server rack, command desk, videowall, architecture board and hardware bench.
 * All pixel art is original and drawn by code. `on` is used as the blink phase (the scene flips it every few hundred ms)
 * for the pieces with LEDs and live screens (see WorldScene `blinkers`).
 */

const tone = (side: 'n' | 'w', c: string) => (side === 'w' ? shade(c, -0.13) : c);
const isBack = (f: Furniture) => ((f.dir % 4) + 4) % 4 >= 2;

function withDetail(b: Box, fn: (ctx: Ctx, ox: number, oy: number, b: Box) => void): Box {
  b.detail = (ctx, ox, oy) => fn(ctx, ox, oy, b);
  return b;
}

/** Paints a pattern on a horizontal rectangle (tile units) at height z. */
function paintTop(ctx: Ctx, ox: number, oy: number, x0: number, y0: number, x1: number, y1: number, z: number, fn: (X: number, Y: number, px: number, py: number) => string | null) {
  const cs = [project(ox, oy, x0, y0, z), project(ox, oy, x1, y0, z), project(ox, oy, x1, y1, z), project(ox, oy, x0, y1, z)];
  const minX = Math.min(...cs.map((c) => c[0])) - 1;
  const maxX = Math.max(...cs.map((c) => c[0])) + 1;
  const minY = Math.min(...cs.map((c) => c[1])) - 1;
  const maxY = Math.max(...cs.map((c) => c[1])) + 1;
  for (let py = minY; py <= maxY; py++) {
    for (let px = minX; px <= maxX; px++) {
      const dx = px + 0.5 - ox;
      const dy = py + 0.5 - oy + z;
      const X = (dx / 32 + dy / 16) / 2;
      const Y = (dy / 16 - dx / 32) / 2;
      if (X < x0 || X >= x1 || Y < y0 || Y >= y1) continue;
      const c = fn(X, Y, px, py);
      if (!c) continue;
      ctx.fillStyle = c;
      ctx.fillRect(px, py, 1, 1);
    }
  }
}

const onWall = (f: Furniture, fn: (p: Plane, side: 'n' | 'w') => void) => (ctx: Ctx, ox: number, oy: number) => {
  const side: 'n' | 'w' = f.dir % 2 === 0 ? 'n' : 'w';
  fn(new Plane(ctx, side, ox, oy), side);
};

const wallShadow = (p: Plane, a0: number, a1: number, z0: number, z1: number) => p.rect(a0 + 2, a1 + 2, z0 - 2, z1 - 2, 'rgba(25,20,45,0.22)');

const CYAN = '#35d8ff';
const CYAN_DK = '#1a8fb5';
const GREEN = '#58e08a';
const AMBER = '#ffb347';
const MAGENTA = '#ff5fb0';

/** Live-looking content of one screen (a0..a1 x z0..z1 of the plane `p`); `idx` picks the kind, `ph` is the blink phase. */
function screenArt(p: Plane, a0: number, a1: number, z0: number, z1: number, idx: number, ph: number, S: (c: string) => string) {
  const w = a1 - a0;
  const h = z1 - z0;
  p.rect(a0, a1, z0, z1, S('#07101e'));
  const kind = idx % 6;
  if (kind === 0) {
    // line chart with a faint grid
    for (let a = a0 + 3; a < a1 - 1; a += 6) p.rect(a, a + 1, z0 + 1, z1 - 1, S('#10233a'));
    for (let z = z0 + 3; z < z1 - 1; z += 6) p.rect(a0 + 1, a1 - 1, z, z + 1, S('#10233a'));
    let prev = z0 + 3;
    for (let a = a0 + 2; a < a1 - 2; a++) {
      const v = z0 + 3 + Math.round((h - 8) * (0.5 + 0.35 * Math.sin((a - a0 + ph * 5) * 0.22) + 0.15 * Math.sin((a - a0) * 0.7 + ph)));
      p.rect(a, a + 1, Math.min(prev, v), Math.max(prev, v) + 1, S(CYAN));
      p.px(a, v - 1, S('#9af0ff'));
      prev = v;
    }
  } else if (kind === 1) {
    // network map: nodes and links, a few of them blinking
    const nodes: Array<[number, number]> = [[0.15, 0.7], [0.4, 0.3], [0.65, 0.65], [0.85, 0.25], [0.5, 0.85]];
    const pt = (n: [number, number]): [number, number] => [a0 + 2 + Math.round(n[0] * (w - 5)), z0 + 2 + Math.round(n[1] * (h - 5))];
    const links: Array<[number, number]> = [[0, 1], [1, 2], [2, 3], [1, 3], [2, 4], [0, 4]];
    for (const [i, j] of links) {
      const A = pt(nodes[i]!);
      const B = pt(nodes[j]!);
      p.line(A[0], A[1], B[0], B[1], S(CYAN_DK));
    }
    nodes.forEach((n, i) => {
      const [a, z] = pt(n);
      const hot = (i + ph) % 3 === 0;
      p.rect(a - 1, a + 2, z - 1, z + 2, S(hot ? MAGENTA : GREEN));
      p.px(a, z, S('#ffffff'));
    });
  } else if (kind === 2) {
    // bars
    const n = Math.max(3, Math.floor((w - 3) / 4));
    for (let i = 0; i < n; i++) {
      const bh = 2 + Math.floor(hash2(i, idx, 3 + ph) * (h - 5));
      const a = a0 + 2 + i * 4;
      p.rect(a, a + 3, z0 + 2, z0 + 2 + bh, S(bh > h * 0.7 ? AMBER : GREEN));
      p.rect(a, a + 1, z0 + 2, z0 + 2 + bh, S(shade(bh > h * 0.7 ? AMBER : GREEN, 0.3)));
    }
  } else if (kind === 3) {
    // terminal
    for (let r = 0; r < Math.floor((h - 3) / 4); r++) {
      const len = 3 + Math.floor(hash2(r, idx, 5) * (w - 12));
      const a = a0 + 2 + (r % 3 === 1 ? 3 : 0);
      p.rect(a, Math.min(a1 - 2, a + len), z1 - 4 - r * 4, z1 - 3 - r * 4, S(r % 4 === 0 ? CYAN : GREEN));
    }
    if (ph === 0) p.rect(a0 + 2, a0 + 5, z0 + 2, z0 + 4, S('#e9fff1'));
  } else if (kind === 4) {
    // heat grid
    for (let r = 0; r < Math.floor((h - 2) / 4); r++) {
      for (let c = 0; c < Math.floor((w - 2) / 4); c++) {
        const v = hash2(c, r, 9 + ph * 3 + idx);
        p.rect(a0 + 2 + c * 4, a0 + 5 + c * 4, z0 + 2 + r * 4, z0 + 5 + r * 4, S(v < 0.6 ? '#1f8f5a' : v < 0.85 ? '#d6b02a' : '#d94b4b'));
      }
    }
  } else {
    // gauge ring with a big reading
    const cx = a0 + Math.floor(w / 2);
    const cz = z0 + Math.floor(h / 2) + 1;
    const R = Math.min(w, h) / 2 - 3;
    for (let a = -Math.ceil(R); a <= Math.ceil(R); a++) {
      for (let z = -Math.ceil(R); z <= Math.ceil(R); z++) {
        const d = Math.hypot(a, z);
        if (d > R || d < R - 2.2) continue;
        const ang = Math.atan2(z, a);
        p.px(cx + a, cz + z, S(ang > -2.2 + ph * 0.3 && ang < 1.7 ? CYAN : '#14304a'));
      }
    }
    wallText(p, cx - 3, cz - 2, ph ? '99' : '97', S('#e9fcff'), 1);
  }
  // glass sheen
  p.rect(a0, a0 + 1, z0, z1, 'rgba(255,255,255,0.07)');
  p.rect(a0, a1, z1 - 1, z1, 'rgba(255,255,255,0.08)');
}

/** One monitor on the desk: rear shell when its back faces the camera. */
function monitor(l0: number, l1: number, s0: number, s1: number, alongX: boolean, side: 'n' | 'w', idx: number, ph: number, back: boolean): Box {
  const z = 26;
  const h = 15;
  const base = alongX ? { x: l0, y: s0, w: l1 - l0, d: s1 - s0 } : { x: s0, y: l0, w: s1 - s0, d: l1 - l0 };
  return withDetail({ ...base, z, h, top: '#2b3350', left: '#141a2c', right: '#0c101c', flat: true }, (ctx, ox, oy, b) => {
    const p = boxPlane(ctx, ox, oy, b, side);
    const W = Math.round((alongX ? b.w : b.d) * 32);
    const S = (c: string) => tone(side, c);
    if (back) {
      p.rect(0, W, 0, h, S('#1a2036'));
      p.rect(0, W, h - 1, h, S('#3a4468'));
      p.rectFn(2, W - 2, 2, h - 2, (a, zz) => (zz % 3 === 0 && a % 2 === 0 ? S('#0b0e18') : null));
      p.rect(W / 2 - 1, W / 2 + 1, h / 2, h / 2 + 1, S(CYAN));
      return;
    }
    p.rect(0, W, 0, h, S('#0b0e18'));
    p.rect(0, W, h - 1, h, S('#3a4468'));
    screenArt(p, 1, W - 1, 1, h - 1, idx, ph, S);
  });
}

export const TECH_BUILDERS: Record<Extract<FurniKind, 'server_rack' | 'command_desk' | 'videowall' | 'arch_board' | 'hardware_bench'>, Builder> = {
  server_rack: (_fw, _fd, f, on): Parts => {
    const side: 'n' | 'w' = f.dir % 2 === 0 ? 'w' : 'n';
    const ph = on ? 1 : 0;
    const H = 78;
    const body = withDetail({ x: 0.08, y: 0.1, z: 0, w: 0.84, d: 0.8, h: H, top: '#1d2336', left: '#151a2a', right: '#0d101b' }, (ctx, ox, oy, b) => {
      const p = boxPlane(ctx, ox, oy, b, side);
      const W = Math.round((side === 'n' ? b.w : b.d) * 32);
      const t = (c: string) => tone(side, c);
      if (isBack(f)) {
        p.rect(0, W, 0, H, t('#171c2c'));
        p.rectFn(3, W - 3, 4, H - 4, (a, z) => (z % 4 === 0 && a % 5 < 3 ? t('#0b0e18') : null));
        p.rect(0, W, H - 2, H, t('#2a3350'));
        return;
      }
      p.rect(0, W, 0, H, t('#10141f'));
      p.rect(0, 2, 0, H, t('#2c3552'));
      p.rect(W - 2, W, 0, H, t('#0b0e18'));
      // cyan accent line on the cap and a base plinth
      p.rect(0, W, H - 3, H, t('#1a2036'));
      p.rect(2, W - 2, H - 3, H - 2, t(CYAN));
      p.rect(0, W, 0, 3, t('#0b0e18'));
      // 9 server units, each with vents, a drive bay and blinking LEDs
      for (let u = 0; u < 9; u++) {
        const z0 = 4 + u * 8;
        const sel = hash2(u, f.x * 3 + f.y, 4);
        p.rect(2, W - 2, z0, z0 + 7, t(sel < 0.3 ? '#2b3350' : '#222a44'));
        p.rect(2, W - 2, z0 + 6, z0 + 7, t('#3a4468'));
        p.rect(2, W - 2, z0, z0 + 1, t('#0b0e18'));
        p.rectFn(4, 13, z0 + 2, z0 + 5, (a, z) => (a % 2 === 0 || z === z0 + 3 ? t('#0f1322') : null));
        if (sel > 0.55) p.rect(14, 19, z0 + 2, z0 + 5, t('#161b2e'));
        for (let k = 0; k < 3; k++) {
          const a = W - 10 + k * 3;
          const r = hash2(u * 3 + k, f.x + f.y * 7, 6 + ph * 5);
          p.px(a, z0 + 4, r < 0.55 ? GREEN : r < 0.78 ? AMBER : r < 0.9 ? CYAN : '#2a3350');
          p.px(a, z0 + 3, r < 0.55 ? 'rgba(88,224,138,0.35)' : 'rgba(53,216,255,0.2)');
        }
      }
      // glass door reflection
      for (let z = 8; z < H - 6; z += 1) {
        const a = Math.round(((z - 8) / (H - 14)) * (W - 8)) + 3;
        p.px(a, z, 'rgba(255,255,255,0.10)');
        p.px(a + 1, z, 'rgba(255,255,255,0.06)');
      }
    });
    return { z1: H + 2, shadow: { alpha: 0.32 }, boxes: [body] };
  },

  command_desk: (fw, fd, f, on): Parts => {
    const ph = on ? 1 : 0;
    const alongX = fw >= fd;
    const L = alongX ? fw : fd;
    const side: 'n' | 'w' = alongX ? 'n' : 'w';
    const fr = ((f.dir % 4) + 4) % 4;
    // front faces +y/+x for dir 0/1 (screens toward the camera); dir 2/3 turn the rear toward it
    const facing = fr < 2;
    const mk = (l0: number, l1: number, s0: number, s1: number, z: number, h: number, top: string, left?: string, right?: string, extra: Partial<Box> = {}): Box =>
      alongX ? { x: l0, y: s0, w: l1 - l0, d: s1 - s0, z, h, top, left, right, ...extra } : { x: s0, y: l0, w: s1 - s0, d: l1 - l0, z, h, top, left, right, ...extra };
    const base = withDetail(mk(0.02, L - 0.02, 0.08, 0.92, 0, 21, '#232b45', '#1a2138', '#10152a'), (ctx, ox, oy, b) => {
      const p = boxPlane(ctx, ox, oy, b, side);
      const W = Math.round((alongX ? b.w : b.d) * 32);
      const t = (c: string) => tone(side, c);
      p.rect(0, W, 0, 21, t('#1a2138'));
      p.rect(0, W, 0, 2, t('#0b0e18'));
      p.rect(0, W, 3, 4, t(CYAN));
      p.rect(0, W, 4, 5, 'rgba(53,216,255,0.30)');
      for (let a = 32; a < W; a += 32) p.rect(a, a + 1, 6, 20, t('#0b0e18'));
      for (let a = 4; a < W - 4; a += 32) {
        p.rect(a + 6, a + 20, 9, 16, t('#10152a'));
        p.rect(a + 6, a + 20, 15, 16, t('#2f3a60'));
        p.px(a + 8, 11, hash2(a, f.x + f.y, 2) < 0.5 ? GREEN : AMBER);
      }
    });
    // glossy dark top with a lit edge on the sitter's side and touch-pad marks
    const top = withDetail(mk(0, L, 0.04, 0.96, 21, 3, '#0f1626', '#34426b', '#1c2644'), (ctx, ox, oy, b) => {
      const sitter = facing ? 0.9 : 0.1;
      paintTop(ctx, ox, oy, b.x + 0.02, b.y + 0.02, b.x + b.w - 0.02, b.y + b.d - 0.02, b.z + b.h, (X, Y, px, py) => {
        const s = alongX ? Y - b.y : X - b.x;
        const l = alongX ? X - b.x : Y - b.y;
        if (Math.abs(s - (facing ? 0.9 : 0.1)) < 0.03) return CYAN;
        if (Math.abs(s - sitter) < 0.06) return '#1f2c4d';
        if (Math.abs(l - Math.round(l)) < 0.02) return '#1a2442';
        return hash2(px, py, 4) < 0.03 ? '#1c2748' : null;
      });
    });
    const boxes: Box[] = [base, top];
    // one monitor per tile at the far side of the desk, facing the sitter; the keyboard lies on the sitter's side
    const ms: [number, number] = facing ? [0.1, 0.17] : [0.83, 0.9];
    const after: Box[] = [];
    for (let i = 0; i < L; i++) {
      const idx = Math.floor(hash2(f.x + i, f.y, 12) * 6);
      boxes.push(mk(i + 0.4, i + 0.6, ms[0] - 0.02, ms[1] + 0.02, 24, 2, '#1c2238', '#2a3350', '#10152a', { noOutline: true }));
      boxes.push(monitor(i + 0.07, i + 0.93, ms[0], ms[1], alongX, side, idx + (i % 2) * 2, ph, !facing));
      const ks = facing ? 0.56 : 0.2;
      boxes.push(mk(i + 0.22, i + 0.7, ks, ks + 0.2, 24, 1, '#3a4468', '#262e4a', '#171d34', { noOutline: true }));
      boxes.push(mk(i + 0.74, i + 0.82, ks + 0.04, ks + 0.12, 24, 1, '#58e08a', '#2f9f60', '#1f6f40', { noOutline: true }));
    }
    // a mug and a small status lamp on the first tile
    after.push(mk(L - 0.3, L - 0.18, facing ? 0.5 : 0.3, facing ? 0.62 : 0.42, 24, 5, '#ffffff', '#e8e8e8', '#b8bcc6'));
    return {
      z1: 44,
      shadow: { alpha: 0.28 },
      flat: (ctx, ox, oy) => {
        const [cx, cy] = project(ox, oy, alongX ? L / 2 : 0.5, alongX ? 0.5 : L / 2, 0);
        softEllipse(ctx, cx, cy, alongX ? 22 * L : 30, alongX ? 18 : 15 * L, CYAN, 0.1);
      },
      boxes,
      after,
    };
  },

  videowall: (_fw, _fd, f, on): Parts => {
    const ph = on ? 1 : 0;
    return {
      boxes: [],
      z0: 12,
      z1: 88,
      shadow: null,
      post: onWall(f, (p, side) => {
        const S = (c: string) => shade(c, side === 'w' ? -0.1 : 0);
        const A1 = 160;
        wallShadow(p, 2, A1, 12, 87);
        // frame with a cyan under-glow line
        p.rect(2, A1, 14, 87, S('#05070d'));
        p.rect(3, A1 - 1, 15, 86, S('#161c30'));
        p.rect(3, A1 - 1, 85, 86, S('#3a4468'));
        p.rect(2, A1, 12, 14, S(CYAN));
        p.rect(2, A1, 11, 12, 'rgba(53,216,255,0.35)');
        const cols = [5, 57, 109];
        const rows: Array<[number, number]> = [[50, 84], [17, 48]];
        let idx = 0;
        for (const [z0, z1] of rows) {
          for (const a0 of cols) {
            p.rect(a0 - 1, a0 + 50, z0 - 1, z1 + 1, S('#0b0e18'));
            screenArt(p, a0, a0 + 49, z0, z1, idx, ph, S);
            idx++;
          }
        }
      }),
    };
  },

  arch_board: (_fw, _fd, f): Parts => ({
    boxes: [],
    z0: 40,
    z1: 86,
    shadow: null,
    post: onWall(f, (p, side) => {
      const S = (c: string) => shade(c, side === 'w' ? -0.1 : 0);
      const A0 = 3;
      const A1 = 93;
      const Z0 = 42;
      const Z1 = 84;
      wallShadow(p, A0, A1, Z0, Z1);
      p.rect(A0, A1, Z0, Z1, S('#6b717e'));
      p.rect(A0 + 1, A1 - 1, Z0 + 1, Z1 - 1, S('#c9ced8'));
      p.rect(A0 + 3, A1 - 3, Z0 + 5, Z1 - 3, S('#f6f8fb'));
      p.rect(A0 + 3, A1 - 3, Z1 - 4, Z1 - 3, S('#dde2ea'));
      // marker tray
      p.rect(A0 + 4, A1 - 4, Z0 + 1, Z0 + 3, S('#9aa0ac'));
      p.rect(A0 + 10, A0 + 15, Z0 + 3, Z0 + 4, S('#3b6bb3'));
      p.rect(A0 + 18, A0 + 22, Z0 + 3, Z0 + 4, S('#2f9d55'));
      p.rect(A0 + 26, A0 + 30, Z0 + 3, Z0 + 4, S('#d9473a'));
      const blue = S('#2f62b8');
      const green = S('#2a8f4f');
      const red = S('#d03a3a');
      const ink = S('#2b2f3a');
      const box = (a0: number, a1: number, z0: number, z1: number, c: string) => {
        p.rect(a0, a1, z0, z0 + 1, c);
        p.rect(a0, a1, z1 - 1, z1, c);
        p.rect(a0, a0 + 1, z0, z1, c);
        p.rect(a1 - 1, a1, z0, z1, c);
      };
      const arrow = (a0: number, a1: number, z: number, c: string) => {
        p.rect(a0, a1, z, z + 1, c);
        p.line(a1 - 2, z + 2, a1, z, c);
        p.line(a1 - 2, z - 2, a1, z, c);
      };
      // title and three tiers: clients -> API -> database, plus a cache and a queue
      wallText(p, A0 + 6, Z1 - 12, 'ARQUITETURA', ink, 1);
      p.rect(A0 + 6, A0 + 50, Z1 - 14, Z1 - 13, blue);
      box(A0 + 6, A0 + 22, Z0 + 20, Z0 + 31, blue);
      wallText(p, A0 + 8, Z0 + 23, 'WEB', blue, 1);
      arrow(A0 + 22, A0 + 32, Z0 + 25, ink);
      box(A0 + 32, A0 + 50, Z0 + 20, Z0 + 31, green);
      wallText(p, A0 + 35, Z0 + 23, 'API', green, 1);
      arrow(A0 + 50, A0 + 60, Z0 + 25, ink);
      // database drum
      p.rect(A0 + 60, A0 + 76, Z0 + 14, Z0 + 31, red);
      p.rect(A0 + 61, A0 + 75, Z0 + 15, Z0 + 30, S('#fdf2f2'));
      p.rect(A0 + 60, A0 + 76, Z0 + 28, Z0 + 29, red);
      p.rect(A0 + 60, A0 + 76, Z0 + 21, Z0 + 22, red);
      wallText(p, A0 + 63, Z0 + 16, 'DB', red, 1);
      // lower row: cache and queue hanging from the API
      p.rect(A0 + 40, A0 + 41, Z0 + 12, Z0 + 20, ink);
      box(A0 + 30, A0 + 52, Z0 + 6, Z0 + 14, blue);
      wallText(p, A0 + 33, Z0 + 8, 'CACHE', blue, 1);
      // cloud and a sticky note
      for (const [da, dz, r] of [[0, 0, 4], [5, 2, 5], [11, 0, 4]] as const) {
        for (let a = -r; a <= r; a++) for (let z = -r; z <= r; z++) if (a * a + z * z <= r * r) p.px(A0 + 68 + da + a, Z1 - 12 + dz + z, S('#bfe0ff'));
      }
      p.rect(A0 + 10, A0 + 26, Z0 + 6, Z0 + 7, ink);
      p.rect(A0 + 74, A0 + 84, Z0 + 5, Z0 + 14, S('#ffe27a'));
      p.rect(A0 + 74, A0 + 84, Z0 + 13, Z0 + 14, S('#e8c24a'));
      wallText(p, A0 + 75, Z0 + 7, 'OK', S('#7a5a1a'), 1);
    }),
  }),

  hardware_bench: (fw, fd, f): Parts => {
    const alongX = fw >= fd;
    const L = alongX ? fw : fd;
    const side: 'n' | 'w' = alongX ? 'n' : 'w';
    const back = isBack(f);
    const mk = (l0: number, l1: number, s0: number, s1: number, z: number, h: number, top: string, left?: string, right?: string, extra: Partial<Box> = {}): Box =>
      alongX ? { x: l0, y: s0, w: l1 - l0, d: s1 - s0, z, h, top, left, right, ...extra } : { x: s0, y: l0, w: s1 - s0, d: l1 - l0, z, h, top, left, right, ...extra };
    const BT = 25;
    const cab = withDetail(mk(0.02, L - 0.02, 0.1, 0.9, 0, BT, '#6b7488', '#55607a', '#3a4258'), (ctx, ox, oy, b) => {
      const p = boxPlane(ctx, ox, oy, b, side);
      const W = Math.round((alongX ? b.w : b.d) * 32);
      const t = (c: string) => tone(side, c);
      p.rect(0, W, 0, BT, t('#55607a'));
      p.rect(0, W, 0, 2, t('#2b3248'));
      if (back) {
        for (let a = 0; a < W; a += 32) p.rect(a, a + 1, 0, BT, t('#2b3248'));
        return;
      }
      // three drawers per tile with handles and colour tabs
      for (let a = 0; a < W; a += 32) {
        p.rect(a, a + 1, 0, BT, t('#2b3248'));
        for (const [z0, z1] of [[3, 11], [12, 20]] as const) {
          p.rect(a + 2, a + 30, z0, z1, t('#66718b'));
          p.rect(a + 2, a + 30, z1 - 1, z1, t('#8791aa'));
          p.rect(a + 11, a + 21, z0 + 3, z0 + 4, t('#1a1f30'));
          p.rect(a + 3, a + 6, z0 + 2, z0 + 4, t(['#35d8ff', '#ffb347', '#58e08a', '#ff5fb0'][(a / 32 + z0) % 4]!));
        }
      }
    });
    const top = withDetail(mk(0, L, 0.04, 0.96, BT, 3, '#2d6a4f', '#1f4d39', '#163a2b'), (ctx, ox, oy, b) => {
      paintTop(ctx, ox, oy, b.x + 0.02, b.y + 0.02, b.x + b.w - 0.02, b.y + b.d - 0.02, b.z + b.h, (X, Y, px, py) => {
        const l = alongX ? X - b.x : Y - b.y;
        return Math.abs(l * 4 - Math.round(l * 4)) < 0.06 ? '#3a8a68' : hash2(px, py, 8) < 0.04 ? '#24583f' : null;
      });
    });
    const z0 = BT + 3;
    const boxes: Box[] = [cab, top];
    // oscilloscope on the left, soldering station with a hot iron, an open motherboard, RAM sticks and a magnifier lamp
    const scope = withDetail(mk(0.12, 0.72, 0.4, 0.8, z0, 13, '#c9ccd6', '#9aa0b0', '#5f6578'), (ctx, ox, oy, b) => {
      const p = boxPlane(ctx, ox, oy, b, side);
      const W = Math.round((alongX ? b.w : b.d) * 32);
      if (back) return;
      const t = (c: string) => tone(side, c);
      p.rect(1, W - 1, 1, 12, t('#2b3248'));
      p.rect(2, W - 9, 3, 11, t('#06140c'));
      for (let a = 3; a < W - 10; a++) p.px(a, 7 + Math.round(Math.sin(a * 0.9) * 2.5), '#58ffa0');
      p.px(W - 5, 9, '#ffb347');
      p.px(W - 5, 6, '#35d8ff');
      p.px(W - 5, 3, '#ff5fb0');
    });
    boxes.push(scope);
    boxes.push(mk(1.02, 1.3, 0.4, 0.7, z0, 5, '#2b3248', '#1a1f30', '#10142a'));
    boxes.push(mk(1.12, 1.2, 0.5, 0.58, z0 + 5, 2, '#ff6a3a', '#d0481e', '#8a2a10', { noOutline: true }));
    // motherboard with a CPU and heat sink
    boxes.push(withDetail(mk(1.5, 2.05, 0.3, 0.8, z0, 1, '#1d7a4f', '#145a3a', '#0e4029', { noOutline: true }), (ctx, ox, oy, b) => {
      paintTop(ctx, ox, oy, b.x + 0.02, b.y + 0.02, b.x + b.w - 0.02, b.y + b.d - 0.02, b.z + b.h, (X, Y, px, py) => {
        const l = alongX ? X - b.x : Y - b.y;
        const s = alongX ? Y - b.y : X - b.x;
        if (l > 0.14 && l < 0.34 && s > 0.14 && s < 0.34) return '#c9ccd6';
        if (hash2(px >> 1, py >> 1, 5) < 0.12) return '#d6b02a';
        return (px + py) % 5 === 0 ? '#2a9a66' : null;
      });
    }));
    boxes.push(mk(2.12, 2.3, 0.28, 0.4, z0, 3, '#111827', '#0b0f1a', '#06080f', { noOutline: true }));
    boxes.push(mk(2.12, 2.3, 0.44, 0.56, z0, 3, '#111827', '#0b0f1a', '#06080f', { noOutline: true }));
    boxes.push(mk(2.5, 2.9, 0.34, 0.74, z0, 8, '#9aa6c0', '#7480a0', '#4a5470'));
    // lamp arm with a bright head
    boxes.push(mk(2.36, 2.4, 0.2, 0.24, z0, 18, '#59606e', '#3a4150', '#242a38', { noOutline: true }));
    boxes.push(mk(2.2, 2.56, 0.16, 0.3, z0 + 18, 3, '#fff6d2', '#ffe9a8', '#e8c476', { noOutline: true }));
    void f;
    return { z1: z0 + 22, shadow: { alpha: 0.3 }, boxes };
  },
};
