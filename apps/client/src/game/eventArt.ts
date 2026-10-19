import { Plane, createCanvas, shade, type Ctx } from './pixel';

/**
 * Pixel art ORIGINAL das decoracoes de eventos (tudo desenhado por codigo, sem imagens de terceiros). Funcoes sem Phaser:
 * pecas de parede desenhadas num `Plane` (a = ao longo da parede, z = altura) e objetos de chao em canvases pequenos.
 */

// ---- fonte 3x5 --------------------------------------------------------------------------------------------------

const G: Record<string, string> = {
  A: '.#.|#.#|###|#.#|#.#', B: '##.|#.#|##.|#.#|##.', C: '.##|#..|#..|#..|.##', D: '##.|#.#|#.#|#.#|##.',
  E: '###|#..|##.|#..|###', F: '###|#..|##.|#..|#..', G: '.##|#..|#.#|#.#|.##', H: '#.#|#.#|###|#.#|#.#',
  I: '###|.#.|.#.|.#.|###', J: '..#|..#|..#|#.#|.#.', K: '#.#|#.#|##.|#.#|#.#', L: '#..|#..|#..|#..|###',
  M: '#.#|###|###|#.#|#.#', N: '##.|#.#|#.#|#.#|#.#', O: '.#.|#.#|#.#|#.#|.#.', P: '##.|#.#|##.|#..|#..',
  Q: '.#.|#.#|#.#|##.|.##', R: '##.|#.#|##.|#.#|#.#', S: '.##|#..|.#.|..#|##.', T: '###|.#.|.#.|.#.|.#.',
  U: '#.#|#.#|#.#|#.#|###', V: '#.#|#.#|#.#|#.#|.#.', W: '#.#|#.#|###|###|#.#', X: '#.#|#.#|.#.|#.#|#.#',
  Y: '#.#|#.#|.#.|.#.|.#.', Z: '###|..#|.#.|#..|###',
  '0': '###|#.#|#.#|#.#|###', '1': '.#.|##.|.#.|.#.|###', '2': '##.|..#|.#.|#..|###', '3': '##.|..#|.#.|..#|##.',
  '4': '#.#|#.#|###|..#|..#', '5': '###|#..|##.|..#|##.', '6': '.##|#..|###|#.#|###', '7': '###|..#|.#.|.#.|.#.',
  '8': '###|#.#|###|#.#|###', '9': '###|#.#|###|..#|##.',
  ':': '...|.#.|...|.#.|...', '!': '.#.|.#.|.#.|...|.#.', '%': '#.#|..#|.#.|#..|#.#', '-': '...|...|###|...|...', ' ': '...|...|...|...|...',
};
const ACCENT: Record<string, [string, 'acute' | 'tilde' | 'circ' | 'cedil']> = {
  Á: ['A', 'acute'], É: ['E', 'acute'], Í: ['I', 'acute'], Ó: ['O', 'acute'], Ú: ['U', 'acute'], Ã: ['A', 'tilde'], Ô: ['O', 'circ'], Ç: ['C', 'cedil'],
};

export const textWidth = (s: string, scale = 1): number => (s.length * 4 - 1) * scale;

/** Texto em pixel art numa parede (`z` = base das letras). */
export function wallText(p: Plane, a: number, z: number, s: string, color: string, scale = 1) {
  let x = a;
  for (const ch of s.toUpperCase()) {
    const acc = ACCENT[ch];
    const rows = (G[acc ? acc[0] : ch] ?? G[' ']!).split('|');
    rows.forEach((row, r) => {
      for (let c = 0; c < 3; c++) if (row[c] === '#') p.rect(x + c * scale, x + (c + 1) * scale, z + (4 - r) * scale, z + (5 - r) * scale, color);
    });
    if (acc) {
      const top = z + 5 * scale;
      if (acc[1] === 'acute') p.rect(x + 2 * scale, x + 3 * scale, top, top + scale, color);
      else if (acc[1] === 'tilde') p.rect(x, x + 3 * scale, top, top + scale, color);
      else if (acc[1] === 'circ') p.rect(x + scale, x + 2 * scale, top, top + scale, color);
      else p.rect(x + scale, x + 2 * scale, z - scale, z, color);
    }
    x += 4 * scale;
  }
}

/** Texto em pixel art num canvas comum (blocos de montar, placas). */
export function flatText(ctx: Ctx, x: number, y: number, s: string, color: string, scale = 1) {
  ctx.fillStyle = color;
  let cx = x;
  for (const ch of s.toUpperCase()) {
    const rows = (G[ch] ?? G[' ']!).split('|');
    rows.forEach((row, r) => {
      for (let c = 0; c < 3; c++) if (row[c] === '#') ctx.fillRect(cx + c * scale, y + r * scale, scale, scale);
    });
    cx += 4 * scale;
  }
}

// ---- utilidades ---------------------------------------------------------------------------------------------------

export const rng = (seed: number) => {
  let s = (seed ^ 0x9e3779b9) >>> 0;
  return () => {
    s = Math.imul(s ^ (s >>> 15), 2246822519) >>> 0;
    s = Math.imul(s ^ (s >>> 13), 3266489917) >>> 0;
    return ((s ^ (s >>> 16)) >>> 0) / 4294967296;
  };
};

const px = (ctx: Ctx, x: number, y: number, c: string, w = 1, h = 1) => {
  ctx.fillStyle = c;
  ctx.fillRect(Math.round(x), Math.round(y), w, h);
};

/** Elipse preenchida em pixels, com luz em cima a esquerda: [base, claro, escuro]. */
function disc(ctx: Ctx, cx: number, cy: number, rx: number, ry: number, base: string, outline?: string, light = true) {
  const lt = shade(base, 0.28);
  const sh = shade(base, -0.28);
  for (let y = Math.floor(cy - ry - 1); y <= Math.ceil(cy + ry + 1); y++) {
    for (let x = Math.floor(cx - rx - 1); x <= Math.ceil(cx + rx + 1); x++) {
      const d = ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2;
      if (d > 1) {
        if (outline && d <= 1.5) {
          const dx = (x + 0.5 - cx) / rx;
          const dy = (y + 0.5 - cy) / ry;
          if (d <= 1 + 0.5 / Math.min(rx, ry) + 0.25) px(ctx, x, y, outline);
          void dx;
          void dy;
        }
        continue;
      }
      const u = (x + 0.5 - cx) / rx;
      const v = (y + 0.5 - cy) / ry;
      px(ctx, x, y, light ? (u + v < -0.7 ? lt : u + v > 0.75 ? sh : base) : base);
    }
  }
}

const sideShade = (c: string, side: 'n' | 'w') => (side === 'w' ? shade(c, -0.1) : c);

// ---- pecas de parede ----------------------------------------------------------------------------------------------

export type BuntingShape = 'flag' | 'heart' | 'egg' | 'star' | 'light' | 'pine';

/** Varal entre a0 e a1 (px do plano) com pecas penduradas; a corda faz uma barriga a cada ~64 px. */
export function bunting(p: Plane, a0: number, a1: number, zTop: number, cols: readonly string[], shape: BuntingShape, rand: () => number) {
  const rope = sideShade('#5a4a3a', p.side);
  const span = 64;
  const ropeZ = (a: number) => {
    const u = ((a - a0) % span) / span;
    return zTop - Math.round(Math.sin(u * Math.PI) * 4);
  };
  for (let a = a0; a < a1; a++) p.px(a, ropeZ(a), shape === 'pine' ? sideShade('#245c38', p.side) : rope);
  const step = shape === 'pine' ? 4 : shape === 'light' ? 7 : 7;
  let i = 0;
  for (let a = a0 + 3; a < a1 - 3; a += step, i++) {
    const c = sideShade(cols[i % cols.length]!, p.side);
    const z = ropeZ(a) - 1;
    const dk = shade(c, -0.3);
    if (shape === 'flag') {
      for (let r = 0; r < 6; r++) p.rect(a - 2 + Math.floor(r / 3), a + 3 - Math.floor(r / 3), z - r, z - r + 1, r === 5 ? dk : c);
      p.px(a - 2, z, shade(c, 0.3));
    } else if (shape === 'heart') {
      for (const [da, dz] of [[-2, 0], [-1, 0], [1, 0], [2, 0], [-2, -1], [-1, -1], [0, -1], [1, -1], [2, -1], [-1, -2], [0, -2], [1, -2], [0, -3]] as const) p.px(a + da, z + dz, dz === 0 && da < 0 ? shade(c, 0.25) : c);
      p.px(a - 1, z - 1, shade(c, 0.35));
    } else if (shape === 'egg') {
      p.line(a, z, a, z - 1, rope);
      for (let r = 0; r < 6; r++) {
        const w = r === 0 || r === 5 ? 1 : 2;
        p.rect(a - w, a + w + 1, z - 2 - r, z - 1 - r, c);
      }
      p.rect(a - 2, a + 3, z - 5, z - 4, shade(c, -0.25));
      p.px(a - 1, z - 3, '#ffffff');
    } else if (shape === 'star') {
      for (const [da, dz] of [[0, 0], [-1, -1], [0, -1], [1, -1], [-2, -2], [-1, -2], [0, -2], [1, -2], [2, -2], [-1, -3], [0, -3], [1, -3], [-1, -4], [1, -4]] as const) p.px(a + da, z + dz, c);
      p.px(a, z - 2, shade(c, 0.4));
    } else if (shape === 'light') {
      p.px(a, z - 1, '#2a2a2a');
      p.rect(a - 1, a + 2, z - 4, z - 1, c);
      p.px(a, z - 3, shade(c, 0.5));
    } else {
      // pine: ramo com folhas
      for (let k = 0; k < 4; k++) p.px(a - 1 + (k % 2), z - 1 - Math.floor(k / 2), sideShade(k % 2 ? '#2f8f4e' : '#1f6a38', p.side));
      if (i % 3 === 0) {
        p.rect(a - 1, a + 2, z - 4, z - 2, c);
        p.px(a, z - 3, shade(c, 0.4));
      }
    }
    void rand;
  }
}

export function streamers(p: Plane, a: number, count: number, len: number, cols: readonly string[], rand: () => number) {
  for (let k = 0; k < count; k++) {
    const c = sideShade(cols[k % cols.length]!, p.side);
    const base = a + k * 4;
    const l = len - Math.floor(rand() * 10);
    const ph = rand() * 6;
    for (let z = 0; z < l; z++) {
      const off = Math.round(Math.sin(z * 0.55 + ph) * 1.6);
      p.px(base + off, 101 - z, z % 5 === 4 ? shade(c, -0.25) : c);
      p.px(base + off + 1, 101 - z, shade(c, -0.18));
    }
  }
}

export function cobweb(p: Plane, size: number) {
  const c = 'rgba(236,236,248,0.85)';
  const top = 101;
  const spokes = [0, 0.3, 0.62, 0.95, 1.25, Math.PI / 2];
  for (const th of spokes) p.line(1, top, 1 + Math.round(Math.cos(th) * size), top - Math.round(Math.sin(th) * size), c);
  for (let r = 6; r <= size; r += 6) {
    for (let k = 0; k < spokes.length - 1; k++) {
      const a1 = 1 + Math.cos(spokes[k]!) * r;
      const z1 = top - Math.sin(spokes[k]!) * r;
      const a2 = 1 + Math.cos(spokes[k + 1]!) * r;
      const z2 = top - Math.sin(spokes[k + 1]!) * r;
      p.line(Math.round(a1), Math.round(z1), Math.round((a1 + a2) / 2 - 1), Math.round((z1 + z2) / 2 + 1), c);
      p.line(Math.round((a1 + a2) / 2 - 1), Math.round((z1 + z2) / 2 + 1), Math.round(a2), Math.round(z2), c);
    }
  }
  // aranha pendurada
  const sa = 1 + Math.round(size * 0.55);
  p.line(sa, top - 4, sa, top - Math.round(size * 0.5), 'rgba(236,236,248,0.9)');
  const sz = top - Math.round(size * 0.5) - 2;
  p.rect(sa - 1, sa + 2, sz - 1, sz + 1, '#1c1424');
  p.px(sa, sz + 1, '#1c1424');
  for (const d of [-2, 2]) {
    p.px(sa + d, sz + 1, '#1c1424');
    p.px(sa + d * 2 + (d > 0 ? 0 : 1), sz, '#1c1424');
    p.px(sa + d * 2 + (d > 0 ? 0 : 1), sz - 1, '#1c1424');
  }
  p.px(sa, sz, '#e83c3c');
}

export function bat(p: Plane, a: number, z: number) {
  const c = sideShade('#2a1c3a', p.side);
  const rows = ['#.....#.....#', '##...###...##', '#####.#.#####', '.####...####.', '..##.....##..'];
  rows.forEach((row, r) => {
    for (let k = 0; k < row.length; k++) if (row[k] === '#') p.px(a + k, z - r + 2, c);
  });
  p.px(a + 5, z + 1, '#ff4a4a');
  p.px(a + 7, z + 1, '#ff4a4a');
}

export function banner(p: Plane, a0: number, a1: number, text: string, bg: string, fg: string, trim: string) {
  const z0 = 86;
  const z1 = 98;
  p.rect(a0 + 1, a1 + 1, z0 - 1, z1 - 1, "rgba(10,8,20,0.28)");
  p.rect(a0, a1, z0, z1, sideShade(bg, p.side));
  p.rect(a0, a1, z1 - 1, z1, shade(sideShade(bg, p.side), 0.25));
  p.rect(a0, a1, z0, z0 + 1, shade(sideShade(bg, p.side), -0.3));
  for (let a = a0 + 2; a < a1 - 2; a += 4) p.px(a, z0 + 1, sideShade(trim, p.side));
  // cordas
  p.line(a0, z1, a0 + 3, z1 + 4, '#4a3a2a');
  p.line(a1 - 1, z1, a1 - 4, z1 + 4, '#4a3a2a');
  const tw = textWidth(text, 1);
  wallText(p, a0 + Math.round((a1 - a0 - tw) / 2) + 1, z0 + 3, text, 'rgba(10,8,20,0.45)', 1);
  wallText(p, a0 + Math.round((a1 - a0 - tw) / 2), z0 + 4, text, sideShade(fg, p.side), 1);
}

export function wreath(p: Plane, a: number, z: number, bow: string) {
  for (let ang = 0; ang < 6.3; ang += 0.12) {
    const aa = a + Math.round(Math.cos(ang) * 10);
    const zz = z + Math.round(Math.sin(ang) * 10);
    p.rect(aa - 1, aa + 2, zz - 1, zz + 2, sideShade(((aa + zz) & 1) === 0 ? '#2f8f4e' : '#1f6a38', p.side));
  }
  for (let k = 0; k < 7; k++) p.px(a + Math.round(Math.cos(k * 0.9) * 9), z + Math.round(Math.sin(k * 0.9) * 9), sideShade('#d03a3a', p.side));
  const b = sideShade(bow, p.side);
  p.rect(a - 4, a - 1, z - 12, z - 8, b);
  p.rect(a + 2, a + 5, z - 12, z - 8, b);
  p.rect(a - 1, a + 2, z - 11, z - 9, shade(b, -0.3));
  p.px(a - 3, z - 9, shade(b, 0.3));
}

export function mask(p: Plane, a: number, z: number, c1: string, c2: string) {
  const m = sideShade(c1, p.side);
  p.rect(a - 8, a + 8, z - 2, z + 5, m);
  p.rect(a - 6, a + 6, z - 3, z - 2, m);
  p.rect(a - 8, a + 8, z + 4, z + 5, shade(m, 0.3));
  p.rect(a - 6, a - 2, z, z + 3, '#1a1424');
  p.rect(a + 2, a + 6, z, z + 3, '#1a1424');
  p.rect(a - 5, a - 3, z + 1, z + 2, '#fff4c0');
  p.rect(a + 3, a + 5, z + 1, z + 2, '#fff4c0');
  const f = sideShade(c2, p.side);
  for (let k = 0; k < 4; k++) {
    p.line(a + 7, z + 4, a + 11 + k * 1, z + 9 - k * 2 + (k % 2), f);
    p.line(a - 7, z + 4, a - 11 - k, z + 9 - k * 2 + (k % 2), f);
  }
  p.rect(a - 1, a + 1, z - 5, z - 2, shade(m, -0.2));
}

export function lantern(p: Plane, a: number, z: number, c: string) {
  const col = sideShade(c, p.side);
  p.line(a, z + 10, a, z + 16, '#5a4a3a');
  for (let r = 0; r < 12; r++) {
    const w = Math.round(Math.sin((r / 11) * Math.PI) * 6 + 1.5);
    p.rect(a - w, a + w + 1, z + r - 1, z + r, r % 4 === 2 ? shade(col, -0.25) : col);
    p.px(a - w, z + r - 1, shade(col, 0.3));
  }
  p.rect(a - 1, a + 2, z - 3, z - 1, '#ffd45a');
  p.px(a, z - 2, '#fff2b0');
}

export function paperBunny(p: Plane, a: number, z: number, c: string) {
  const col = sideShade(c, p.side);
  const rows = ['.##...##.', '.##...##.', '.##...##.', '.##...##.', '..#####..', '.#######.', '.#######.', '.#######.', '..#####..', '.#######.', '#########', '.#######.'];
  rows.forEach((row, r) => {
    for (let k = 0; k < row.length; k++) if (row[k] === '#') p.px(a + k - 4, z + 11 - r, r < 4 && k % 6 === 2 ? '#ffb8d8' : col);
  });
  p.px(a - 2, z + 6, '#2a2030');
  p.px(a + 2, z + 6, '#2a2030');
  p.px(a, z + 5, '#ff7aa8');
}

export function bigEgg(p: Plane, a: number, z: number, c1: string, c2: string) {
  for (let r = 0; r < 18; r++) {
    const w = Math.round(Math.sin((r / 17) * Math.PI) ** 0.7 * 7 + (r > 9 ? 1 : 0));
    p.rect(a - w, a + w + 1, z + r, z + r + 1, sideShade(r % 6 < 2 ? c2 : c1, p.side));
  }
  p.px(a - 3, z + 12, '#ffffff');
  p.px(a - 3, z + 11, '#ffffff');
  for (let k = -5; k <= 5; k += 2) p.px(a + k, z + 6 + (k & 2 ? 1 : 0), '#ffffff');
}

export function heart(p: Plane, a: number, z: number, c: string, r = 1) {
  const col = sideShade(c, p.side);
  const rows = ['.##.##.', '#######', '#######', '.#####.', '..###..', '...#...'];
  rows.forEach((row, y) => {
    for (let k = 0; k < 7; k++) if (row[k] === '#') p.rect(a + k * r, a + (k + 1) * r, z + (5 - y) * r, z + (6 - y) * r, y === 1 && k < 3 ? shade(col, 0.3) : col);
  });
}

export function star5(p: Plane, a: number, z: number, c: string) {
  const col = sideShade(c, p.side);
  const rows = ['...#...', '...#...', '#######', '.#####.', '..###..', '.##.##.', '.#...#.'];
  rows.forEach((row, y) => {
    for (let k = 0; k < 7; k++) if (row[k] === '#') p.px(a + k - 3, z + 6 - y, y < 3 ? shade(col, 0.25) : col);
  });
}

export function stocking(p: Plane, a: number, z: number) {
  const red = sideShade('#d03a3a', p.side);
  p.rect(a - 3, a + 4, z + 10, z + 13, '#f4f1ea');
  p.rect(a - 3, a + 3, z + 3, z + 10, red);
  p.rect(a - 3, a + 7, z, z + 4, red);
  p.rect(a - 3, a + 7, z, z + 1, shade(red, -0.3));
  p.px(a - 2, z + 9, shade(red, 0.3));
  p.rect(a + 1, a + 3, z + 6, z + 7, '#f4f1ea');
}

export function clockPlaque(p: Plane, a: number, z: number, hhmm: string, colon: boolean) {
  const bg = '#12141f';
  p.rect(a - 1, a + 25, z - 1, z + 13, '#caa24a');
  p.rect(a, a + 24, z, z + 12, bg);
  const col = '#ffd45a';
  wallText(p, a + 2, z + 4, hhmm.slice(0, 2), col, 1);
  if (colon) wallText(p, a + 10, z + 4, ':', col, 1);
  wallText(p, a + 14, z + 4, hhmm.slice(3), col, 1);
  p.rect(a + 2, a + 22, z + 1, z + 2, '#7a5a1a');
}

export function gear(p: Plane, a: number, z: number, c: string) {
  const col = sideShade(c, p.side);
  for (let y = -8; y <= 8; y++) for (let x = -8; x <= 8; x++) {
    const d = Math.hypot(x, y);
    const ang = Math.atan2(y, x);
    const tooth = d > 6 && d <= 8.5 && Math.floor(((ang + Math.PI) / (Math.PI * 2)) * 8 + 0.5) % 2 === 0;
    if ((d <= 6 && d > 2.5) || tooth) p.px(a + x, z + y, x + y < -4 ? shade(col, 0.25) : col);
  }
}

// ---- objetos de chao ----------------------------------------------------------------------------------------------

export interface Prop {
  canvas: HTMLCanvasElement;
  /** Ancora (base no centro do tile). */
  ax: number;
  ay: number;
  /** Altura (px) para o brilho/ordenacao. */
  h: number;
}

const W = 48;
const H = 76;
const newProp = () => createCanvas(W, H);
const finish = (c: { canvas: HTMLCanvasElement }, h: number): Prop => ({ canvas: c.canvas, ax: 24, ay: 68, h });
const shadow = (ctx: Ctx, rx = 14) => {
  ctx.fillStyle = 'rgba(22,16,44,0.28)';
  for (let y = -3; y <= 3; y++) {
    const w = Math.round(rx * Math.sqrt(1 - (y / 3.6) ** 2));
    ctx.fillRect(24 - w, 68 + y, w * 2, 1);
  }
};

export function pumpkinProp(variant: number): Prop {
  const c = newProp();
  const { ctx } = c;
  shadow(ctx, 15);
  const big = variant % 2 === 0;
  const rx = big ? 14 : 10;
  const ry = big ? 11 : 8;
  const cy = 68 - ry - 1;
  const base = variant === 2 ? '#e8791a' : '#f28a1c';
  disc(ctx, 24 - (big ? 0 : 0), cy, rx, ry, base, '#5a2a0a');
  // gomos
  for (const k of [-0.55, 0, 0.55]) for (let y = cy - ry + 2; y < cy + ry - 1; y++) {
    const w = Math.sqrt(1 - ((y - cy) / ry) ** 2);
    px(ctx, 24 + k * rx * w, y, '#b4540e');
  }
  // cabo
  px(ctx, 23, cy - ry - 3, '#3f7a2a', 3, 4);
  px(ctx, 22, cy - ry - 4, '#2f5a1e', 3, 1);
  px(ctx, 26, cy - ry - 2, '#6fb04a', 1, 2);
  // rosto aceso
  const glow = '#ffe27a';
  const eyeY = cy - 3;
  for (const [dx, w] of [[-rx * 0.45, 1], [rx * 0.45, 1]] as const) {
    px(ctx, 24 + dx - 2, eyeY + 2, glow, 5, 1);
    px(ctx, 24 + dx - 1, eyeY + 1, glow, 3, 1);
    px(ctx, 24 + dx, eyeY, glow, w, 1);
  }
  const my = cy + 3;
  px(ctx, 24 - rx * 0.6, my, glow, rx * 1.2, 1);
  px(ctx, 24 - rx * 0.6 + 1, my + 1, glow, rx * 1.2 - 2, 2);
  for (let k = 0; k < rx * 1.2; k += 3) px(ctx, 24 - rx * 0.6 + k, my + 1, '#7a3a0a', 1, 1);
  return finish(c, ry * 2 + 4);
}

export function treeProp(phase: number): Prop {
  const c = newProp();
  const { ctx } = c;
  shadow(ctx, 17);
  // base/vaso
  px(ctx, 19, 62, '#7a4a2c', 10, 6);
  px(ctx, 19, 62, '#a8693c', 10, 1);
  px(ctx, 26, 63, '#5a3420', 3, 5);
  const layers: Array<[number, number, number]> = [[56, 17, 18], [44, 14, 16], [33, 11, 14], [23, 8, 12]];
  layers.forEach(([by, hw, hgt], li) => {
    for (let r = 0; r < hgt; r++) {
      const w = Math.round((hw * (r + 1)) / hgt);
      const y = by - hgt + r + 1;
      for (let x = -w; x <= w; x++) {
        const edge = Math.abs(x) >= w - 1;
        const col = edge ? '#173d26' : x < -w * 0.3 ? '#2f8f4e' : x > w * 0.45 ? '#1f6a38' : '#27783f';
        px(ctx, 24 + x, y, (r + x + li) % 7 === 0 ? '#3fae62' : col);
      }
    }
  });
  // estrela
  const star = ['..#..', '#####', '.###.', '.#.#.'];
  star.forEach((row, y) => [...row].forEach((ch, x) => ch === '#' && px(ctx, 22 + x, 10 + y, '#ffd95a')));
  px(ctx, 24, 11, '#fff6c0');
  // bolas e luzes (duas fases piscam em alternancia)
  const spots: Array<[number, number]> = [[24, 20], [19, 30], [29, 28], [14, 40], [24, 38], [34, 42], [10, 52], [20, 50], [30, 53], [38, 54], [16, 46], [31, 36]];
  const cols = ['#ff4a4a', '#ffd95a', '#4aa8ff', '#ff9ccf', '#fff'];
  spots.forEach(([x, y], i) => {
    if (i % 2 === phase) {
      px(ctx, x, y, cols[i % cols.length]!, 2, 2);
      px(ctx, x - 1, y - 1, 'rgba(255,255,200,0.5)', 1, 1);
      px(ctx, x + 2, y + 2, 'rgba(255,255,200,0.4)', 1, 1);
    } else {
      px(ctx, x, y, '#c9b04a', 2, 2);
    }
  });
  // guirlanda dourada
  for (let x = 0; x < 20; x++) px(ctx, 14 + x, 35 + Math.round(Math.sin(x * 0.4) * 2) + Math.floor(x / 6), '#f2d36b');
  // presentes
  const gift = (x: number, y: number, w: number, h: number, col: string, rib: string) => {
    px(ctx, x, y, col, w, h);
    px(ctx, x, y, shade(col, 0.3), w, 1);
    px(ctx, x + w - 1, y + 1, shade(col, -0.3), 1, h - 1);
    px(ctx, x + Math.floor(w / 2) - 1, y, rib, 2, h);
    px(ctx, x, y + Math.floor(h / 2) - 1, rib, w, 1);
  };
  gift(5, 61, 9, 7, '#3a8fd0', '#ffd95a');
  gift(34, 62, 8, 6, '#d03a3a', '#f4f1ea');
  gift(38, 58, 6, 5, '#9a5ad0', '#ffd95a');
  return finish(c, 66);
}

export function bunnyProp(): Prop {
  const c = newProp();
  const { ctx } = c;
  shadow(ctx, 12);
  const fur = '#f4f1ea';
  const ear = (x: number, tilt: number) => {
    for (let r = 0; r < 18; r++) {
      const w = r < 3 || r > 15 ? 1 : 2;
      px(ctx, x + Math.round(tilt * r * 0.15) - w, 6 + (17 - r), fur, w * 2 + 1, 1);
      if (r > 3 && r < 15) px(ctx, x + Math.round(tilt * r * 0.15), 6 + (17 - r), '#ffb8d8', 1, 1);
    }
  };
  ear(19, -1);
  ear(29, 1);
  disc(ctx, 24, 56, 11, 11, fur, '#8a8480');
  disc(ctx, 24, 36, 8, 7, fur, '#8a8480');
  ear(19, -1);
  ear(29, 1);
  disc(ctx, 24, 36, 8, 7, fur, '#8a8480');
  px(ctx, 20, 35, '#2a2030', 2, 2);
  px(ctx, 27, 35, '#2a2030', 2, 2);
  px(ctx, 24, 39, '#ff7aa8', 2, 1);
  px(ctx, 23, 40, '#8a8480', 1, 1);
  px(ctx, 26, 40, '#8a8480', 1, 1);
  px(ctx, 17, 40, '#ffc2dc', 2, 1);
  px(ctx, 30, 40, '#ffc2dc', 2, 1);
  // laco
  px(ctx, 19, 44, '#4aa8ff', 4, 3);
  px(ctx, 26, 44, '#4aa8ff', 4, 3);
  px(ctx, 23, 44, '#2a6ab0', 3, 3);
  // patas e rabinho
  px(ctx, 16, 64, fur, 6, 4);
  px(ctx, 27, 64, fur, 6, 4);
  px(ctx, 16, 67, '#8a8480', 6, 1);
  px(ctx, 27, 67, '#8a8480', 6, 1);
  disc(ctx, 36, 62, 3, 3, '#ffffff', '#8a8480');
  return finish(c, 62);
}

export function eggBasketProp(): Prop {
  const c = newProp();
  const { ctx } = c;
  shadow(ctx, 14);
  const egg = (x: number, y: number, col: string, col2: string) => {
    for (let r = 0; r < 7; r++) {
      const w = r === 0 || r === 6 ? 1 : 2;
      px(ctx, x - w, y + r, r === 3 ? col2 : col, w * 2 + 1, 1);
    }
    px(ctx, x - 1, y + 1, '#ffffff', 1, 1);
  };
  // grama
  for (let x = 12; x < 36; x += 2) px(ctx, x, 54 + (x % 3), '#58b858', 1, 6);
  egg(17, 49, '#ff9ccf', '#fff');
  egg(24, 46, '#9be0ff', '#4aa8ff');
  egg(31, 49, '#ffe27a', '#ff9a3a');
  egg(21, 52, '#b9a0ff', '#fff');
  egg(28, 53, '#9be0a0', '#fff');
  // cesto trancado
  for (let y = 0; y < 12; y++) {
    const w = 15 - Math.floor(y / 4);
    for (let x = -w; x <= w; x++) px(ctx, 24 + x, 56 + y, (x + y) % 4 === 0 ? '#7a4a22' : (y % 3 === 0 ? '#b57a3a' : '#c98f4c'));
  }
  px(ctx, 9, 55, '#8a5628', 30, 2);
  // alca
  for (let a = 0; a < 3.2; a += 0.1) px(ctx, 24 - Math.cos(a) * 13, 55 - Math.sin(a) * 16, '#8a5628', 2, 2);
  return finish(c, 52);
}

export function balloonsProp(cols: readonly string[], seed: number): Prop {
  const c = newProp();
  const { ctx } = c;
  shadow(ctx, 10);
  // peso: caixinha
  px(ctx, 19, 60, '#f4f1ea', 10, 8);
  px(ctx, 19, 60, '#ffffff', 10, 1);
  px(ctx, 28, 61, '#cfc9b8', 1, 7);
  px(ctx, 23, 60, cols[0]!, 2, 8);
  px(ctx, 19, 63, cols[0]!, 10, 1);
  const r = rng(seed);
  const pos: Array<[number, number]> = [[14, 24], [24, 14], [34, 24], [19, 36], [30, 38]];
  pos.forEach(([x, y], i) => {
    // cordinha ate o peso
    const bx = 24;
    for (let t = 0; t <= 1; t += 0.04) px(ctx, x + (bx - x) * t, y + 9 + (60 - y - 9) * t, '#8a8794');
  });
  pos.forEach(([x, y], i) => {
    const col = cols[(i + Math.floor(r() * 2)) % cols.length]!;
    disc(ctx, x, y, 7, 9, col, shade(col, -0.5));
    px(ctx, x - 1, y + 9, shade(col, -0.4), 3, 2);
    px(ctx, x - 4, y - 5, 'rgba(255,255,255,0.75)', 2, 3);
  });
  return finish(c, 60);
}

export function bonfireProp(frame: number): Prop {
  const c = newProp();
  const { ctx } = c;
  shadow(ctx, 14);
  // pedras
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    disc(ctx, 24 + Math.cos(a) * 12, 63 + Math.sin(a) * 4.5, 3.2, 2.4, k % 2 ? '#8b8b96' : '#a2a2ae', '#3a3a46');
  }
  // lenhas
  px(ctx, 14, 61, '#6b4426', 20, 3);
  px(ctx, 14, 61, '#a8693c', 20, 1);
  px(ctx, 17, 58, '#5a3420', 14, 3);
  // chamas
  const flame = (x: number, h: number, col: string) => {
    for (let r = 0; r < h; r++) {
      const w = Math.max(1, Math.round(Math.sin(((r + 1) / h) * Math.PI * 0.9) * 5));
      px(ctx, x - w + ((frame + r) % 3 === 0 ? 1 : 0), 58 - r, col, w * 2, 1);
    }
  };
  flame(24, 24 + frame * 3, '#e8452c');
  flame(19, 15 + ((frame + 1) % 3) * 2, '#f28a1c');
  flame(29, 17 + ((frame + 2) % 3) * 2, '#f28a1c');
  flame(24, 15 + frame * 2, '#ffd45a');
  flame(24, 8 + frame, '#fff2b0');
  return finish(c, 40);
}

export function giftsProp(c1: string, c2: string, c3: string): Prop {
  const c = newProp();
  const { ctx } = c;
  shadow(ctx, 14);
  const gift = (x: number, y: number, w: number, h: number, col: string, rib: string) => {
    px(ctx, x, y, col, w, h);
    px(ctx, x, y, shade(col, 0.3), w, 1);
    px(ctx, x, y, shade(col, 0.2), 1, h);
    px(ctx, x + w - 2, y + 1, shade(col, -0.3), 2, h - 1);
    px(ctx, x, y + h - 1, shade(col, -0.35), w, 1);
    px(ctx, x + Math.floor(w / 2) - 1, y, rib, 2, h);
    px(ctx, x, y + Math.floor(h / 2), rib, w, 2);
    px(ctx, x + Math.floor(w / 2) - 3, y - 3, rib, 3, 3);
    px(ctx, x + Math.floor(w / 2) + 1, y - 3, rib, 3, 3);
  };
  gift(10, 54, 18, 14, c1, '#ffd95a');
  gift(26, 58, 14, 10, c2, '#f4f1ea');
  gift(15, 42, 12, 11, c3, '#ffffff');
  return finish(c, 40);
}

export function vaseProp(): Prop {
  const c = newProp();
  const { ctx } = c;
  shadow(ctx, 10);
  for (let k = 0; k < 7; k++) {
    const x = 24 + (k - 3) * 3;
    px(ctx, x, 36 + Math.abs(k - 3) * 2, '#2f7a4a', 1, 28 - Math.abs(k - 3) * 2);
  }
  const rose = (x: number, y: number, col: string) => {
    disc(ctx, x, y, 4, 4, col, shade(col, -0.45));
    px(ctx, x - 1, y - 1, shade(col, -0.35), 2, 1);
    px(ctx, x, y, shade(col, 0.3), 1, 1);
  };
  rose(24, 24, '#e8344e');
  rose(16, 32, '#ff4d7e');
  rose(32, 32, '#e8344e');
  rose(20, 40, '#ff7aa0');
  rose(28, 40, '#ff4d7e');
  // vaso de vidro
  for (let y = 0; y < 16; y++) {
    const w = 8 - Math.abs(y - 8) * 0.25;
    px(ctx, 24 - w, 52 + y, y === 0 || y === 15 ? '#ffffff' : 'rgba(190,225,245,0.85)', w * 2, 1);
  }
  px(ctx, 18, 54, '#ffffff', 1, 8);
  px(ctx, 16, 60, 'rgba(255,77,126,0.4)', 16, 8);
  return finish(c, 50);
}

export function hayProp(): Prop {
  const c = newProp();
  const { ctx } = c;
  shadow(ctx, 15);
  for (let y = 0; y < 18; y++) for (let x = 0; x < 28; x++) {
    const hue = (x * 7 + y * 13) % 5;
    px(ctx, 10 + x, 50 + y, hue === 0 ? '#a07a2a' : hue === 1 ? '#e6c55a' : hue === 2 ? '#d4ae44' : '#f0d878');
  }
  px(ctx, 10, 50, '#f6e6a0', 28, 1);
  px(ctx, 10, 60, '#8a6a22', 28, 1);
  px(ctx, 10, 50, '#7a5a1a', 1, 18);
  px(ctx, 37, 50, '#7a5a1a', 1, 18);
  // chapeu de palha
  disc(ctx, 24, 48, 13, 4, '#e6c55a', '#7a5a1a');
  disc(ctx, 24, 44, 7, 5, '#f0d878', '#7a5a1a');
  px(ctx, 17, 45, '#d03a3a', 14, 2);
  return finish(c, 30);
}

export function blocksProp(): Prop {
  const c = newProp();
  const { ctx } = c;
  shadow(ctx, 14);
  const block = (x: number, y: number, col: string, ch: string) => {
    px(ctx, x, y, col, 14, 14);
    px(ctx, x, y, shade(col, 0.35), 14, 1);
    px(ctx, x, y, shade(col, 0.2), 1, 14);
    px(ctx, x + 12, y + 1, shade(col, -0.3), 2, 13);
    px(ctx, x, y + 13, shade(col, -0.4), 14, 1);
    flatText(ctx, x + 5, y + 4, ch, '#ffffff', 1);
  };
  block(8, 54, '#3aa0ff', 'A');
  block(24, 54, '#ff5d73', 'B');
  block(16, 40, '#ffcc2e', 'C');
  return finish(c, 30);
}

// ---- brilhos --------------------------------------------------------------------------------------------------------

export function glowCanvas(size: number, rgb: readonly [number, number, number]): HTMLCanvasElement {
  const { canvas, ctx } = createCanvas(size, size);
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const d = Math.hypot((x + 0.5 - size / 2) / (size / 2), (y + 0.5 - size / 2) / (size / 2));
    const lv = Math.round(Math.max(0, 1 - d) ** 1.6 * 8) / 8;
    if (lv <= 0) continue;
    const i = (y * size + x) * 4;
    img.data[i] = rgb[0];
    img.data[i + 1] = rgb[1];
    img.data[i + 2] = rgb[2];
    img.data[i + 3] = Math.round(lv * 255);
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}
