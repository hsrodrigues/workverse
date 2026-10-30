import { Plane, createCanvas, hash2, shade, type Ctx } from './pixel';

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
  ':': '...|.#.|...|.#.|...', '?': '##.|..#|.#.|...|.#.', '.': '...|...|...|...|.#.', "'": '.#.|.#.|...|...|...', '!': '.#.|.#.|.#.|...|.#.', '%': '#.#|..#|.#.|#..|#.#', '-': '...|...|###|...|...', ' ': '...|...|...|...|...',
};
const ACCENT: Record<string, [string, 'acute' | 'tilde' | 'circ' | 'cedil']> = {
  Á: ['A', 'acute'], É: ['E', 'acute'], Í: ['I', 'acute'], Ó: ['O', 'acute'], Ú: ['U', 'acute'], Ã: ['A', 'tilde'], Ô: ['O', 'circ'], Ç: ['C', 'cedil'],
};

export const textWidth = (s: string, scale = 1): number => (s.length * 4 - 1) * scale;

/** Texto em pixel art numa parede (`z` = base das letras). */
export function wallText(p: Plane, a: number, z: number, s: string, color: string, scale = 1, mirror = false) {
  let x = a;
  const chars = [...s.toUpperCase()];
  for (const [i, ch] of chars.entries()) {
    // `mirror`: west-wall planes run right to left on screen, so the glyphs and their order are reversed to read normally
    if (mirror) x = a + (chars.length - 1 - i) * 4 * scale;
    const acc = ACCENT[ch];
    const rows = (G[acc ? acc[0] : ch] ?? G[' ']!).split('|');
    rows.forEach((row, r) => {
      for (let c = 0; c < 3; c++) if (row[c] === '#') p.rect(x + (mirror ? 2 - c : c) * scale, x + (mirror ? 3 - c : c + 1) * scale, z + (4 - r) * scale, z + (5 - r) * scale, color);
    });
    if (acc) {
      const top = z + 5 * scale;
      if (acc[1] === 'acute') p.rect(x + 2 * scale, x + 3 * scale, top, top + scale, color);
      else if (acc[1] === 'tilde') p.rect(x, x + 3 * scale, top, top + scale, color);
      else if (acc[1] === 'circ') p.rect(x + scale, x + 2 * scale, top, top + scale, color);
      else p.rect(x + scale, x + 2 * scale, z - scale, z, color);
    }
    if (!mirror) x += 4 * scale;
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
        void outline; // a borda de 1px vem do passe global (outlinePass em finish)
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
      const ed = shade(c, -0.6);
      for (let r = 0; r < 8; r++) {
        const half = 3 - Math.floor(r / 2.2);
        const l = a - 3 + Math.floor(r / 2.2);
        const rr = a + 3 - Math.floor(r / 2.2);
        const row = z - r;
        p.rect(l, rr + 1, row, row + 1, ed);
        if (r > 0 && half >= 0) p.rect(l + 1, rr, row, row + 1, r < 3 ? shade(c, 0.22) : c);
        if (r > 0 && r % 2 === 1) p.px(a + 1, row, shade(c, -0.22));
      }
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

/** Faixa de parede: fundo chapado em 2 tons, borda escura de 1px, texto pixel (escala 1 ou 2) com sombra solida. */
export function banner(p: Plane, a0: number, a1: number, text: string, bg: string, fg: string, trim: string, scale = 1) {
  const h = scale === 2 ? 18 : 14;
  const z1 = 99;
  const z0 = z1 - h;
  const B = sideShade(bg, p.side);
  const edge = shade(B, -0.62);
  p.rect(a0 + 1, a1 + 1, z0 - 1, z1 - 1, shade(B, -0.5)); // sombra de contato
  p.rect(a0, a1, z0, z1, edge);
  p.rect(a0 + 1, a1 - 1, z0 + 1, z1 - 1, B);
  p.rect(a0 + 1, a1 - 1, z1 - 3, z1 - 1, shade(B, 0.2));
  p.rect(a0 + 1, a1 - 1, z0 + 1, z0 + 2, shade(B, -0.25));
  // pontilhado de acabamento (1px) em cima e embaixo
  const T = sideShade(trim, p.side);
  for (let a = a0 + 3; a < a1 - 3; a += 3) {
    p.px(a, z1 - 2, T);
    p.px(a, z0 + 1, T);
  }
  // cordas
  p.line(a0 + 1, z1, a0 + 4, z1 + 4, '#3a2a1a');
  p.line(a1 - 2, z1, a1 - 5, z1 + 4, '#3a2a1a');
  const tw = textWidth(text, scale);
  const x = a0 + Math.round((a1 - a0 - tw) / 2);
  const zt = z0 + Math.round((h - 5 * scale) / 2) - 1;
  wallText(p, x, zt - 1, text, edge, scale, p.side === 'w');
  wallText(p, x, zt, text, sideShade(fg, p.side), scale, p.side === 'w');
}

/** Guirlanda continua de pinheiro com laços vermelhos e luzinhas (as luzes sao devolvidas em `lights` para piscar em bandas). */
export function garland(p: Plane, a0: number, a1: number, zTop: number, lights: LightPt[], cols: readonly string[]) {
  const span = 64;
  const sag = (a: number) => Math.round(Math.sin((((a - a0) % span) / span) * Math.PI) * 6);
  for (let a = a0; a < a1; a++) {
    const z = zTop - sag(a);
    p.px(a, z + 2, sideShade('#0f2c1a', p.side));
    for (let k = 1; k >= -4; k--) {
      const tuft = ((a * 7 + k * 3) & 3) === 0 ? 1 : 0;
      if (k === -4 && tuft === 0) continue;
      const tone = k >= 1 ? '#164a2a' : k === 0 ? '#2a8247' : k > -3 ? (((a >> 1) + k) & 1 ? '#3fae62' : '#2f8f4e') : '#237a40';
      p.px(a, z + k, sideShade(tone, p.side));
    }
    p.px(a, z - 5, sideShade('#0f2c1a', p.side));
  }
  let i = 0;
  for (let a = a0 + 6; a < a1 - 4; a += 8, i++) {
    lights.push({ side: p.side, a, z: zTop - sag(a) - 7, c: cols[i % cols.length]!, k: i });
    p.px(a, zTop - sag(a) - 6, sideShade('#1c1226', p.side));
    p.rect(a, a + 2, zTop - sag(a) - 8, zTop - sag(a) - 6, sideShade(shade(cols[i % cols.length]!, -0.5), p.side));
  }
  // laços vermelhos nos pontos de ancoragem
  for (let a = a0; a <= a1; a += span) {
    const z = zTop + 1;
    const r = sideShade('#c92f2f', p.side);
    p.rect(a - 4, a - 1, z - 3, z + 1, shade(r, -0.55));
    p.rect(a - 3, a - 1, z - 2, z, r);
    p.rect(a + 1, a + 4, z - 3, z + 1, shade(r, -0.55));
    p.rect(a + 1, a + 3, z - 2, z, r);
    p.rect(a - 1, a + 1, z - 3, z, shade(r, -0.35));
    p.px(a - 3, z - 1, shade(r, 0.35));
  }
}

/** Ponto luminoso que pisca em bandas (posicao no plano da parede). */
export interface LightPt {
  side: 'n' | 'w';
  a: number;
  z: number;
  c: string;
  k: number;
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
const OUTLINE = '#1c1226';
/** Borda escura de 1px em volta de tudo que e opaco (sombras e brilhos translucidos ficam de fora). Chapado, sem antialias. */
export function outlinePass(canvas: HTMLCanvasElement, color = OUTLINE) {
  const ctx = canvas.getContext('2d')!;
  const { width: w, height: h } = canvas;
  const src = ctx.getImageData(0, 0, w, h);
  const d = src.data;
  const solid = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && d[(y * w + x) * 4 + 3]! >= 200;
  const rgb = [parseInt(color.slice(1, 3), 16), parseInt(color.slice(3, 5), 16), parseInt(color.slice(5, 7), 16)];
  const out = ctx.createImageData(w, h);
  out.data.set(d);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (solid(x, y)) continue;
    if (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1)) {
      const i = (y * w + x) * 4;
      out.data[i] = rgb[0]!;
      out.data[i + 1] = rgb[1]!;
      out.data[i + 2] = rgb[2]!;
      out.data[i + 3] = 255;
    }
  }
  ctx.putImageData(out, 0, 0);
}
const finish = (c: { canvas: HTMLCanvasElement }, h: number, outline = true): Prop => {
  if (outline) outlinePass(c.canvas);
  return { canvas: c.canvas, ax: 24, ay: 68, h };
};
const shadow = (ctx: Ctx, rx = 14) => shadowAt(ctx, 24, 68, rx);
const shadowAt = (ctx: Ctx, cx: number, cy: number, rx = 14) => {
  ctx.fillStyle = 'rgba(22,16,44,0.28)';
  for (let y = -3; y <= 3; y++) {
    const w = Math.round(rx * Math.sqrt(1 - (y / 3.6) ** 2));
    ctx.fillRect(cx - w, cy + y, w * 2, 1);
  }
};
/** Objetos assinatura: tela grande (96x144), base no centro do tile. */
const newBig = () => createCanvas(96, 144);
const finishBig = (c: { canvas: HTMLCanvasElement }, h: number): Prop => {
  outlinePass(c.canvas);
  return { canvas: c.canvas, ax: 48, ay: 136, h };
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

// ---- Dia do Profissional de TI (diati): homenagens genericas de ficcao cientifica, tudo original -----------------------

const NEON_CY = '#27d9ff';
const NEON_GR = '#39ff88';
const NEON_BL = '#2a6bff';
const NEON_PK = '#ff5fb0';

/** Quadro "DON'T PANIC": letras grandes e amigaveis (2x) em duas linhas, sobre azul-noite com contorno ciano. */
export function dontPanic(p: Plane, a: number, z: number) {
  const S = (c: string) => sideShade(c, p.side);
  const a0 = a - 25;
  const a1 = a + 25;
  const z0 = z + 30;
  const z1 = z + 70;
  p.rect(a0 + 2, a1 + 2, z0 - 2, z1 - 2, 'rgba(10,8,30,0.3)');
  p.rect(a0, a1, z0, z1, S('#0b1230'));
  p.rect(a0 + 1, a1 - 1, z0 + 1, z1 - 1, S('#16245a'));
  p.rect(a0 + 1, a1 - 1, z1 - 2, z1 - 1, S('#2f4aa8'));
  p.rect(a0 + 3, a1 - 3, z0 + 3, z1 - 3, S('#0e1a44'));
  // estrelinhas
  for (const [da, dz] of [[6, 30], [40, 33], [12, 6], [38, 8], [24, 34]] as const) p.px(a0 + da, z0 + dz, S('#cfe8ff'));
  const line = (text: string, zz: number) => {
    const w = textWidth(text, 2);
    const x = a - Math.round(w / 2);
    wallText(p, x + 1, zz - 1, text, S('#050a1e'), 2);
    wallText(p, x, zz, text, S('#f4fbff'), 2);
    wallText(p, x, zz + 1, text, S(NEON_CY), 2);
    wallText(p, x, zz, text, S('#fffbe0'), 2);
  };
  line("DON'T", z0 + 22);
  line('PANIC', z0 + 7);
  // moldura ciano e um sorriso pequeno
  p.rect(a0, a1, z0, z0 + 1, S(NEON_CY));
  p.rect(a0, a1, z1 - 1, z1, S(NEON_CY));
  p.rect(a0, a0 + 1, z0, z1, S(NEON_CY));
  p.rect(a1 - 1, a1, z0, z1, S(NEON_CY));
  p.px(a1 - 8, z0 + 5, S('#f4fbff'));
  p.px(a1 - 6, z0 + 5, S('#f4fbff'));
  p.rect(a1 - 8, a1 - 5, z0 + 3, z0 + 4, S('#f4fbff'));
}

/** Toalha pendurada num gancho (toalha de banho listrada, com franja). */
export function towelHook(p: Plane, a: number, z: number) {
  const S = (c: string) => sideShade(c, p.side);
  const top = z + 66;
  p.rect(a - 12, a + 12, top, top + 2, S('#5a4a3a'));
  p.rect(a - 12, a + 12, top + 1, top + 2, S('#8a7358'));
  for (const k of [-10, 10]) p.rect(a + k - 1, a + k + 2, top - 2, top + 3, S('#c9a227'));
  // pano: duas faces (frente curta e fundo mais longo) com listras e franja
  const cloth = (a0: number, a1: number, z0: number, z1: number, c: string) => {
    for (let aa = a0; aa < a1; aa++) {
      for (let zz = z0; zz < z1; zz++) {
        const stripe = (zz - z0) % 9 < 2 || z1 - zz < 3;
        let col = stripe ? '#ffffff' : c;
        if (aa === a0) col = shade(c, 0.2);
        else if (aa === a1 - 1) col = shade(c, -0.3);
        else if ((aa + zz) % 5 === 0) col = shade(col, -0.06);
        p.px(aa, zz, S(col));
      }
    }
  };
  cloth(a - 8, a + 9, top - 34, top, '#2fb7c8');
  // dobra por cima do ferro
  p.rect(a - 9, a + 10, top - 4, top - 2, S('#53d4e3'));
  p.rect(a - 9, a + 10, top - 5, top - 4, S('#1d8a98'));
  for (let aa = a - 8; aa < a + 9; aa += 2) p.rect(aa, aa + 1, top - 38, top - 34, S('#e8f6f8'));
  // etiqueta
  p.rect(a + 2, a + 7, top - 14, top - 9, S('#fff3a0'));
  p.px(a + 4, top - 12, S('#a87a1a'));
}

/** Cartaz "Ja tentou desligar e ligar de novo?" com um botao de energia desenhado em cima. */
export function poster(p: Plane, a: number, z: number) {
  const S = (c: string) => sideShade(c, p.side);
  const a0 = a - 25;
  const a1 = a + 25;
  const z0 = z + 28;
  const z1 = z + 76;
  p.rect(a0 + 2, a1 + 2, z0 - 2, z1 - 2, 'rgba(10,8,30,0.25)');
  p.rect(a0, a1, z0, z1, S('#f6f2e4'));
  p.rect(a0, a1, z1 - 2, z1, S('#e0553c'));
  p.rect(a0, a0 + 1, z0, z1, S('#c9c2a8'));
  p.rect(a1 - 1, a1, z0, z1, S('#b8b090'));
  // fita nos cantos
  p.rect(a0 - 1, a0 + 5, z1 - 3, z1 + 1, S('#ffe27a'));
  p.rect(a1 - 5, a1 + 1, z1 - 3, z1 + 1, S('#ffe27a'));
  // botao liga/desliga
  const cx = a;
  const cz = z1 - 12;
  for (let aa = -6; aa <= 6; aa++) for (let zz = -6; zz <= 6; zz++) {
    const d = Math.hypot(aa, zz);
    if (d > 6 || d < 4 || (Math.abs(aa) < 2 && zz > 0)) continue;
    p.px(cx + aa, cz + zz, S('#1f2a44'));
  }
  p.rect(cx - 1, cx + 1, cz, cz + 7, S('#1f2a44'));
  p.px(cx, cz + 3, S(NEON_CY));
  const lines = ['JÁ TENTOU', 'DESLIGAR E', 'LIGAR DE', 'NOVO?'];
  lines.forEach((t, i) => {
    const w = textWidth(t, 1);
    wallText(p, a - Math.round(w / 2), z1 - 28 - i * 7, t, S(i === 3 ? '#e0553c' : '#1f2a44'), 1);
  });
}

/** Placa digital "42" (a resposta para tudo), com legenda. */
export function plaque42(p: Plane, a: number, z: number) {
  const S = (c: string) => sideShade(c, p.side);
  const a0 = a - 17;
  const a1 = a + 17;
  const z0 = z + 40;
  const z1 = z + 74;
  p.rect(a0 + 2, a1 + 2, z0 - 2, z1 - 2, 'rgba(10,8,30,0.3)');
  p.rect(a0, a1, z0, z1, S('#0a0e1c'));
  p.rect(a0 + 1, a1 - 1, z0 + 1, z1 - 1, S('#141c3a'));
  p.rect(a0, a1, z1 - 1, z1, S('#3a4a88'));
  const w = textWidth('42', 3);
  const x = a - Math.round(w / 2);
  wallText(p, x, z0 + 12, '42', S('#0b5f3a'), 3);
  wallText(p, x, z0 + 13, '42', S(NEON_GR), 3);
  wallText(p, x + 1, z0 + 13, '42', S('#9dffc6'), 3);
  const cap = 'A RESPOSTA';
  wallText(p, a - Math.round(textWidth(cap, 1) / 2), z0 + 3, cap, S('#7a9ad8'), 1);
  p.px(a0 + 3, z1 - 4, S('#ff5fb0'));
  p.px(a1 - 4, z1 - 4, S(NEON_CY));
}

/** Painel de ponte de nave espacial (original): botoes, deslizantes e um radar com varredura. */
export function bridgePanel(p: Plane, a: number, z: number) {
  const S = (c: string) => sideShade(c, p.side);
  const a0 = a - 22;
  const a1 = a + 22;
  const z0 = z + 34;
  const z1 = z + 70;
  p.rect(a0 + 2, a1 + 2, z0 - 2, z1 - 2, 'rgba(10,8,30,0.3)');
  p.rect(a0, a1, z0, z1, S('#222a40'));
  p.rect(a0, a1, z1 - 1, z1, S('#59668f'));
  p.rect(a0, a0 + 1, z0, z1, S('#3a4468'));
  p.rect(a0 + 2, a1 - 2, z0 + 2, z1 - 2, S('#0d1224'));
  // radar
  const rx = a0 + 11;
  const rz = z1 - 13;
  for (let aa = -8; aa <= 8; aa++) for (let zz = -8; zz <= 8; zz++) {
    const d = Math.hypot(aa, zz);
    if (d > 8) continue;
    const ring = Math.abs(d - 8) < 1 || Math.abs(d - 4) < 0.6 || (aa === 0 && zz % 2 === 0) || (zz === 0 && aa % 2 === 0);
    p.px(rx + aa, rz + zz, S(ring ? '#1f8f5a' : '#06180f'));
  }
  p.line(rx, rz, rx + 6, rz + 5, S(NEON_GR));
  p.px(rx + 4, rz - 3, S('#ffffff'));
  p.px(rx - 3, rz + 2, S(NEON_PK));
  // deslizantes e botoes
  for (let i = 0; i < 4; i++) {
    const aa = a0 + 24 + i * 4;
    p.rect(aa, aa + 1, z1 - 18, z1 - 5, S('#3a4468'));
    p.rect(aa - 1, aa + 2, z1 - 14 + ((i * 5) % 6), z1 - 12 + ((i * 5) % 6), S(i % 2 ? NEON_CY : NEON_PK));
  }
  const cols = [NEON_GR, '#ffb347', NEON_CY, NEON_PK, NEON_GR, '#e04848', NEON_CY, NEON_GR];
  cols.forEach((c, i) => {
    const aa = a0 + 4 + (i % 4) * 9;
    const zz = z0 + 4 + Math.floor(i / 4) * 6;
    p.rect(aa, aa + 4, zz, zz + 3, S(shade(c, -0.35)));
    p.rect(aa + 1, aa + 3, zz + 1, zz + 2, S(c));
  });
  p.rect(a0 + 22, a1 - 3, z0 + 3, z0 + 4, S('#3a4468'));
}

/** Plaquinha "Funciona na minha maquina" com selo de aprovado. */
export function worksOnMine(p: Plane, a: number, z: number) {
  const S = (c: string) => sideShade(c, p.side);
  const a0 = a - 27;
  const a1 = a + 27;
  const z0 = z + 46;
  const z1 = z + 68;
  p.rect(a0 + 2, a1 + 2, z0 - 2, z1 - 2, 'rgba(10,8,30,0.28)');
  p.rect(a0, a1, z0, z1, S('#8a5a2c'));
  p.rect(a0 + 1, a1 - 1, z0 + 1, z1 - 1, S('#d9a869'));
  p.rect(a0 + 1, a1 - 1, z1 - 2, z1 - 1, S('#ecc58a'));
  p.rect(a0 + 3, a1 - 3, z0 + 3, z1 - 3, S('#f6ecd6'));
  ['FUNCIONA NA', 'MINHA MÁQUINA'].forEach((t, i) => {
    wallText(p, a - Math.round(textWidth(t, 1) / 2) - 3, z1 - 10 - i * 7, t, S('#3a2a1a'), 1);
  });
  // selo com visto
  const sx = a1 - 8;
  const sz = z0 + 8;
  for (let aa = -4; aa <= 4; aa++) for (let zz = -4; zz <= 4; zz++) if (Math.hypot(aa, zz) <= 4.3) p.px(sx + aa, sz + zz, S('#2f9f60'));
  p.line(sx - 2, sz, sx - 1, sz - 2, S('#ffffff'));
  p.line(sx - 1, sz - 2, sx + 2, sz + 2, S('#ffffff'));
}

/** Cabos de rede e fibra pendurados no alto da parede: curvas finas coloridas com pontas luminosas. */
export function fiberCables(p: Plane, a0: number, a1: number, zTop: number, rand: () => number) {
  const cols = [NEON_CY, NEON_GR, NEON_PK, '#ffb347', NEON_BL];
  const n = Math.max(3, Math.floor((a1 - a0) / 18));
  for (let i = 0; i < n; i++) {
    const c = sideShade(cols[i % cols.length]!, p.side);
    const s = a0 + 4 + Math.round(((i + rand() * 0.5) * (a1 - a0 - 8)) / n);
    const e = Math.min(a1 - 2, s + 22 + Math.floor(rand() * 16));
    const sag = 5 + Math.floor(rand() * 7);
    for (let aa = s; aa <= e; aa++) {
      const u = (aa - s) / Math.max(1, e - s);
      p.px(aa, zTop - Math.round(Math.sin(u * Math.PI) * sag), c);
    }
    // conector na ponta esquerda e led na direita
    p.rect(s - 1, s + 1, zTop, zTop + 3, sideShade('#2b3350', p.side));
    p.px(s, zTop + 3, sideShade('#8f94a0', p.side));
    p.px(e, zTop, sideShade('#ffffff', p.side));
    p.px(e + 1, zTop, c);
    p.px(e, zTop - 1, c);
  }
  // abracadeiras no varal
  for (let aa = a0 + 6; aa < a1 - 4; aa += 28) p.rect(aa, aa + 2, zTop + 1, zTop + 5, sideShade('#59668f', p.side));
  p.rect(a0 + 2, a1 - 2, zTop + 4, zTop + 5, sideShade('#3a4468', p.side));
}

/** Nebulosa e estrelas no vidro de uma janela (a0..a1 x zb..zt do plano), com os caixilhos refeitos por cima. */
export function spaceWindow(p: Plane, a0: number, trim: string) {
  const g0 = a0 + 1;
  const g1 = a0 + 23;
  const zb = 45;
  const zt = 89;
  const w = g1 - g0;
  p.rectFn(g0, g1, zb, zt, (a, z) => {
    const u = (a - g0) / w;
    const v = (z - zb) / (zt - zb);
    let c: RGB3 = [8 + 14 * v, 6 + 8 * v, 30 + 40 * v];
    const n1 = Math.sin(u * 5 + v * 3) * 0.5 + 0.5;
    const n2 = Math.sin(u * 9 - v * 6 + 1.3) * 0.5 + 0.5;
    const cloud = Math.max(0, 1 - Math.hypot((u - 0.55) * 1.6, (v - 0.6) * 1.2) * 1.5) * (0.55 + 0.45 * n1 * n2);
    if (cloud > 0.05) c = mix3(c, hash2(a >> 1, z >> 1, 4) < 0.5 ? [200, 70, 190] : [60, 190, 255], Math.min(0.85, cloud * 1.2));
    if (hash2(a, z, 17) < 0.045) c = [255, 255, 255 - Math.floor(hash2(a, z, 3) * 60)];
    // planeta com anel, embaixo a esquerda
    const d = Math.hypot(a - (g0 + 6), (z - (zb + 9)) * 1.1);
    if (d < 4.6) c = d < 3 && a - g0 > 5 ? [236, 180, 96] : [190, 120, 60];
    if (Math.abs(z - (zb + 9) - (a - g0 - 6) * -0.3) < 0.7 && Math.abs(a - (g0 + 6)) < 8 && d > 3.4) c = [255, 226, 160];
    return `rgb(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])})`;
  });
  const T = sideShade(trim, p.side);
  const mid = a0 + 11;
  p.rect(mid, mid + 2, zb, zt, T);
  p.rect(mid, mid + 1, zb, zt, shade(T, 0.12));
  const mz = 63;
  p.rect(g0, g1, mz, mz + 2, T);
  p.rect(g0, g1, mz + 1, mz + 2, shade(T, -0.12));
}

type RGB3 = [number, number, number];
const mix3 = (a: RGB3, b: RGB3, t: number): RGB3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** Projetor de holograma: pedestal escuro com anel ciano e um globo de arame flutuando (2 quadros: gira e pisca). */
export function hologramProp(frame: number): Prop {
  const c = newProp();
  const { ctx } = c;
  shadow(ctx, 13);
  // pedestal
  disc(ctx, 24, 64, 12, 4, '#1c2440', '#0a0e1c');
  px(ctx, 14, 62, NEON_CY, 20, 1);
  disc(ctx, 24, 60, 8, 3, '#2b3556', '#0a0e1c');
  px(ctx, 17, 60, NEON_CY, 14, 1);
  // cone de luz
  for (let y = 0; y < 22; y++) {
    const w = 4 + y * 0.55;
    px(ctx, 24 - w, 58 - y, 'rgba(39,217,255,0.16)', w * 2, 1);
  }
  // globo de arame
  const R = 12;
  const cx = 24;
  const cy = 30;
  for (let a = 0; a < 6.3; a += 0.06) {
    px(ctx, cx + Math.cos(a) * R, cy + Math.sin(a) * R, NEON_CY);
  }
  for (let k = -2; k <= 2; k++) {
    const yy = cy + k * 4;
    const rw = Math.sqrt(Math.max(0, R * R - (k * 4) ** 2));
    for (let a = 0; a < 6.3; a += 0.12) px(ctx, cx + Math.cos(a) * rw, yy + Math.sin(a) * rw * 0.25, 'rgba(39,217,255,0.8)');
  }
  for (const ph of [0, 1, 2]) {
    const off = (frame * 0.5 + ph * 1.05) % 3.14;
    for (let t = -1.5; t < 1.5; t += 0.1) {
      const ex = Math.sin(off) * R * Math.cos(t);
      px(ctx, cx + ex, cy + Math.sin(t) * R, 'rgba(120,235,255,0.85)');
    }
  }
  // pontinhos de dados girando
  for (let i = 0; i < 4; i++) {
    const a = frame * 1.3 + i * 1.57;
    px(ctx, cx + Math.cos(a) * 16, cy + Math.sin(a) * 5 - 4, i % 2 ? NEON_GR : '#ffffff', 2, 2);
  }
  px(ctx, cx - 1, cy - 1, '#ffffff', 3, 3);
  return finish(c, 60, false);
}

/** Robozinho decorativo (2 quadros: antena acende e o bracinho acena). Variante muda as cores. */
export function robotProp(frame: number, variant = 0): Prop {
  const c = newProp();
  const { ctx } = c;
  shadow(ctx, 11);
  const body = variant ? '#ffd45a' : '#eef2f8';
  const trim = variant ? '#e08a1a' : '#8fa0bf';
  const eye = variant ? NEON_PK : NEON_CY;
  // esteiras
  px(ctx, 14, 62, '#2b3350', 20, 6);
  px(ctx, 14, 62, '#59668f', 20, 1);
  for (let x = 15; x < 33; x += 3) px(ctx, x, 66, '#10152a', 1, 2);
  // corpo
  px(ctx, 16, 46, body, 16, 16);
  px(ctx, 16, 46, '#ffffff', 16, 1);
  px(ctx, 16, 46, '#ffffff', 1, 16);
  px(ctx, 31, 46, trim, 1, 16);
  px(ctx, 16, 61, trim, 16, 1);
  px(ctx, 20, 51, '#10152a', 8, 6);
  px(ctx, 21, 52, frame ? NEON_GR : '#1f8f5a', 2, 2);
  px(ctx, 24, 52, NEON_CY, 2, 2);
  px(ctx, 21, 55, '#ffb347', 6, 1);
  // bracos
  px(ctx, 12, 48, trim, 4, 10);
  px(ctx, 12, 48, body, 3, 9);
  if (frame) px(ctx, 32, 40, trim, 4, 12);
  else px(ctx, 32, 48, trim, 4, 10);
  // cabeca
  px(ctx, 14, 28, body, 20, 16);
  px(ctx, 14, 28, '#ffffff', 20, 1);
  px(ctx, 14, 28, '#ffffff', 1, 16);
  px(ctx, 33, 28, trim, 1, 16);
  px(ctx, 14, 43, trim, 20, 1);
  px(ctx, 17, 32, '#10152a', 14, 8);
  px(ctx, 19, 34, eye, 3, 3);
  px(ctx, 26, 34, eye, 3, 3);
  px(ctx, 19, 34, '#ffffff', 1, 1);
  px(ctx, 26, 34, '#ffffff', 1, 1);
  px(ctx, 22, 38, eye, 4, 1);
  px(ctx, 12, 33, trim, 2, 5);
  px(ctx, 34, 33, trim, 2, 5);
  // antena com bulbo
  px(ctx, 23, 20, '#59668f', 2, 8);
  disc(ctx, 24, 18, 3, 3, frame ? NEON_GR : '#1f8f5a', '#0a0e1c');
  px(ctx, 23, 17, '#ffffff', 1, 1);
  return finish(c, 52);
}

/** Cupcake grande com glacê ciano, vela e uma bandeirinha "SUDO" (e um cupcake pequeno ao lado). */
export function cakeProp(): Prop {
  const c = newProp();
  const { ctx } = c;
  shadow(ctx, 14);
  // pratinho
  disc(ctx, 24, 66, 13, 3, '#e8ecf4', '#6b7488');
  // cupcake grande: forminha listrada, glace em espiral
  for (let y = 0; y < 14; y++) {
    const w = 9 + Math.floor(y * 0.2);
    px(ctx, 24 - w, 50 + y, y % 4 < 2 ? '#2a6bff' : '#1b4fcf', w * 2, 1);
    px(ctx, 24 - w, 50 + y, '#6f9cff', 1, 1);
  }
  px(ctx, 14, 50, '#ffffff', 20, 1);
  disc(ctx, 24, 46, 11, 6, '#27d9ff', '#0b5a6e');
  disc(ctx, 24, 38, 8, 5, '#7ae8ff', '#0b5a6e');
  disc(ctx, 24, 31, 5, 4, '#bff4ff', '#0b5a6e');
  px(ctx, 21, 30, '#ffffff', 2, 1);
  // granulado
  for (const [x, y, col] of [[17, 46, NEON_PK], [29, 44, NEON_GR], [22, 40, '#ffffff'], [27, 38, NEON_PK], [18, 42, NEON_GR]] as const) px(ctx, x, y, col, 2, 1);
  // vela
  px(ctx, 23, 20, '#ffb347', 2, 8);
  px(ctx, 23, 20, '#fff3a0', 1, 8);
  px(ctx, 23, 15, '#ffe27a', 2, 4);
  px(ctx, 24, 13, '#ff7a3a', 1, 3);
  // palito com a bandeirinha SUDO
  px(ctx, 33, 22, '#8a5a2c', 1, 22);
  px(ctx, 34, 22, '#10152a', 18, 9);
  px(ctx, 34, 22, NEON_GR, 18, 1);
  flatText(ctx, 35, 24, 'SUDO', NEON_GR, 1);
  // cupcake pequeno
  for (let y = 0; y < 7; y++) px(ctx, 7 + Math.floor(y * 0.1), 61 + y, y % 3 < 2 ? '#ff5fb0' : '#d13a85', 9, 1);
  disc(ctx, 11, 59, 5, 3, '#ffe0f0', '#a83a78');
  px(ctx, 11, 55, '#ff3a6a', 2, 2);
  return finish(c, 60);
}

/** Xicara de cha com estrelinhas e espirais: a "bomba de improbabilidade" fofa (2 quadros). */
export function teaProp(frame: number): Prop {
  const c = newProp();
  const { ctx } = c;
  shadow(ctx, 11);
  // mesinha pequena
  px(ctx, 17, 56, '#4a3a5a', 14, 2);
  px(ctx, 23, 58, '#4a3a5a', 2, 9);
  px(ctx, 17, 66, '#4a3a5a', 14, 2);
  // xicara e pires
  disc(ctx, 24, 55, 9, 2, '#ffffff', '#8a8fa8');
  for (let y = 0; y < 8; y++) {
    const w = 7 - Math.floor(y * 0.15);
    px(ctx, 24 - w, 47 + y, '#f4f8ff', w * 2, 1);
    px(ctx, 24 - w, 47 + y, '#ffffff', 2, 1);
    px(ctx, 24 + w - 2, 47 + y, '#b6bfd8', 2, 1);
  }
  px(ctx, 17, 47, '#8a8fa8', 14, 1);
  px(ctx, 31, 49, '#f4f8ff', 3, 1);
  px(ctx, 33, 49, '#f4f8ff', 1, 4);
  px(ctx, 31, 53, '#f4f8ff', 3, 1);
  px(ctx, 20, 49, NEON_PK, 3, 3);
  px(ctx, 21, 50, '#ffffff', 1, 1);
  // cha com espiral e estrelinhas flutuando
  px(ctx, 18, 47, '#7a4a2a', 12, 1);
  const f = frame * 2;
  for (let i = 0; i < 6; i++) {
    const ang = i * 1.05 + f * 0.6;
    const r = 3 + i * 2.2;
    const x = 24 + Math.cos(ang) * r * 0.9;
    const y = 42 - i * 3.2 + Math.sin(ang) * 2;
    const col = [NEON_CY, NEON_PK, NEON_GR, '#ffe27a', NEON_CY, NEON_PK][i]!;
    px(ctx, x, y, col, 2, 2);
    px(ctx, x - 1, y + 0, col, 1, 1);
    px(ctx, x + 2, y + 1, col, 1, 1);
  }
  // etiquetinha
  px(ctx, 31, 40, '#f6ecd6', 12, 7);
  flatText(ctx, 32, 41, '42', '#1b4fcf', 2);
  return finish(c, 52);
}

/** Placa de chao em cavalete com o numero 42 em neon verde-matriz. */
export function sign42Prop(): Prop {
  const c = newProp();
  const { ctx } = c;
  shadow(ctx, 12);
  px(ctx, 14, 40, '#6b4a2a', 2, 28);
  px(ctx, 32, 40, '#6b4a2a', 2, 28);
  px(ctx, 12, 66, '#4a3a2a', 24, 2);
  px(ctx, 10, 20, '#0a0e1c', 28, 28);
  px(ctx, 11, 21, '#141c3a', 26, 26);
  px(ctx, 10, 20, NEON_CY, 28, 1);
  px(ctx, 10, 47, NEON_CY, 28, 1);
  px(ctx, 10, 20, NEON_CY, 1, 28);
  px(ctx, 37, 20, NEON_CY, 1, 28);
  flatText(ctx, 15, 25, '42', '#0b5f3a', 4);
  flatText(ctx, 14, 24, '42', NEON_GR, 4);
  flatText(ctx, 14, 24, '4', '#9dffc6', 1);
  px(ctx, 13, 22, '#ffffff', 1, 1);
  px(ctx, 35, 44, NEON_PK, 2, 1);
  return finish(c, 48);
}

// ---- pecas assinatura e apoio (arte grande, chapada em 3 tons, borda de 1px) ------------------------------------------

const fillR = (ctx: Ctx, x: number, y: number, w: number, h: number, c: string) => px(ctx, x, y, c, w, h);

/** Caixa de presente: corpo em 3 tons, fita em cruz e laco. */
function giftBox(ctx: Ctx, x: number, y: number, w: number, h: number, col: string, rib: string) {
  fillR(ctx, x, y, w, h, col);
  fillR(ctx, x, y, w, 2, shade(col, 0.28));
  fillR(ctx, x, y, 2, h, shade(col, 0.16));
  fillR(ctx, x + w - 3, y + 2, 3, h - 2, shade(col, -0.3));
  fillR(ctx, x, y + h - 2, w, 2, shade(col, -0.38));
  const cx = x + Math.floor(w / 2) - 1;
  fillR(ctx, cx, y, 3, h, rib);
  fillR(ctx, x, y + Math.floor(h / 2) - 1, w, 3, rib);
  fillR(ctx, cx, y, 1, h, shade(rib, 0.3));
  fillR(ctx, cx - 4, y - 4, 4, 4, rib);
  fillR(ctx, cx + 3, y - 4, 4, 4, rib);
  fillR(ctx, cx - 1, y - 2, 4, 3, shade(rib, -0.3));
}

const STAR9 = ['....#....', '....#....', '...###...', '#########', '.#######.', '..#####..', '..#####..', '.###.###.', '.##...##.'];

/** Arvore de Natal grande: 4 andares com sombra de beira, guirlanda dourada, bolas, estrela e luzinhas (2 fases piscam), presentes embaixo. */
export function treeBigProp(phase: number): Prop {
  const c = newBig();
  const { ctx } = c;
  shadowAt(ctx, 48, 136, 36);
  fillR(ctx, 44, 114, 8, 16, '#6b4426');
  fillR(ctx, 44, 114, 2, 16, '#a8693c');
  const tiers: Array<[number, number, number]> = [[18, 48, 15], [36, 72, 22], [56, 96, 29], [78, 122, 36]];
  const GL = '#3fae62';
  const GM = '#2a8247';
  const GD = '#1d5e34';
  tiers.forEach(([top, bot, hw]) => {
    for (let y = top; y <= bot; y++) {
      const u = (y - top) / (bot - top);
      const w = Math.round(hw * (0.1 + 0.9 * u));
      for (let x = -w; x <= w; x++) {
        const edgeY = bot - ((x + 200) % 12 < 6 ? 0 : 3);
        if (y > edgeY) continue;
        let col = x < -w * 0.3 ? GL : x > w * 0.35 ? GD : GM;
        if (y >= edgeY - 1) col = '#164a2a';
        else if ((x * 2 + y * 3) % 11 === 0 && Math.abs(x) < w - 1) col = shade(col, -0.18);
        px(ctx, 48 + x, y, col);
      }
    }
  });
  const colsL = ['#ff4a4a', '#ffd95a', '#4aa8ff', '#ff9ccf'];
  tiers.slice(1).forEach(([top, bot, hw], ti) => {
    const base = top + Math.round((bot - top) * 0.52);
    const wAt = (y: number) => Math.round(hw * (0.1 + 0.9 * ((y - top) / (bot - top))));
    for (let x = -hw; x <= hw; x++) {
      const gy = base + Math.round(6 * (1 - (x / hw) ** 2));
      if (Math.abs(x) > wAt(gy) - 2) continue;
      px(ctx, 48 + x, gy, '#f6d96b');
      px(ctx, 48 + x, gy + 1, '#c9a227');
    }
    for (let k = -3; k <= 3; k++) {
      const x = Math.round((k * hw) / 3.6);
      const gy = base + Math.round(6 * (1 - (x / hw) ** 2)) + 3;
      if (Math.abs(x) > wAt(gy) - 3) continue;
      const lit = (k + ti + phase + 6) % 2 === 0;
      const col = colsL[(k + 3 + ti) % 4]!;
      if (lit) {
        px(ctx, 48 + x - 1, gy - 1, shade(col, 0.55), 1, 1);
        px(ctx, 48 + x, gy, col, 2, 2);
        px(ctx, 48 + x + 2, gy + 2, shade(col, 0.4), 1, 1);
      } else px(ctx, 48 + x, gy, shade(col, -0.55), 2, 2);
    }
  });
  const balls: Array<[number, number, string]> = [[40, 56, '#d03a3a'], [58, 62, '#4aa8ff'], [34, 82, '#ffd95a'], [62, 86, '#d03a3a'], [48, 90, '#ff9ccf'], [28, 106, '#4aa8ff'], [68, 108, '#ffd95a'], [46, 110, '#d03a3a'], [56, 40, '#ffd95a'], [43, 30, '#4aa8ff']];
  balls.forEach(([x, y, col]) => {
    disc(ctx, x, y, 2.6, 2.6, col);
    px(ctx, x - 1, y - 1, '#ffffff', 1, 1);
  });
  STAR9.forEach((row, y) => [...row].forEach((ch, x) => ch === '#' && px(ctx, 44 + x, 6 + y, y < 3 ? '#fff0a0' : y > 6 ? '#e0a82a' : '#ffd95a')));
  if (phase) px(ctx, 41, 9, '#ffffff', 1, 1);
  else px(ctx, 54, 5, '#ffffff', 1, 1);
  disc(ctx, 48, 131, 27, 6, '#b02a2a');
  fillR(ctx, 24, 130, 48, 1, '#f4f1ea');
  giftBox(ctx, 7, 116, 20, 16, '#3a8fd0', '#ffd95a');
  giftBox(ctx, 24, 124, 13, 9, '#d03a3a', '#f4f1ea');
  giftBox(ctx, 66, 113, 22, 19, '#9a5ad0', '#ffd95a');
  giftBox(ctx, 58, 123, 12, 10, '#2f8f4e', '#ffffff');
  return finishBig(c, 130);
}

/** Boneco de neve: 3 bolas, chapeu, cachecol vermelho, nariz de cenoura e bracos de galho. */
export function snowmanProp(): Prop {
  const c = newProp();
  const { ctx } = c;
  shadow(ctx, 15);
  for (const [x0, x1, y] of [[8, 17, 40], [31, 40, 40]] as const) {
    px(ctx, x0, y, '#6b4426', x1 - x0, 2);
    px(ctx, x0, y - 4, '#6b4426', 2, 4);
  }
  disc(ctx, 24, 56, 14, 12, '#e8f0fa');
  disc(ctx, 24, 36, 10, 9, '#e8f0fa');
  disc(ctx, 24, 21, 8, 8, '#f4f8ff');
  px(ctx, 14, 28, '#d03a3a', 20, 4);
  px(ctx, 14, 28, '#ff6a6a', 20, 1);
  px(ctx, 30, 31, '#d03a3a', 4, 9);
  px(ctx, 30, 31, '#a82a2a', 1, 9);
  px(ctx, 19, 17, '#1c1226', 2, 2);
  px(ctx, 27, 17, '#1c1226', 2, 2);
  px(ctx, 22, 21, '#ff8a1c', 8, 2);
  px(ctx, 22, 21, '#ffc06a', 4, 1);
  for (const y of [40, 47, 54]) px(ctx, 23, y, '#1c1226', 2, 2);
  px(ctx, 15, 9, '#2a2236', 18, 3);
  px(ctx, 18, 1, '#2a2236', 12, 8);
  px(ctx, 18, 7, '#d03a3a', 12, 1);
  px(ctx, 19, 2, '#4a3e60', 2, 5);
  return finish(c, 66);
}

/** Pilha de presentes media: 3 caixas. */
export function giftPileProp(c1: string, c2: string, c3: string): Prop {
  const c = newProp();
  const { ctx } = c;
  shadow(ctx, 16);
  giftBox(ctx, 6, 54, 20, 14, c1, '#ffd95a');
  giftBox(ctx, 25, 57, 16, 11, c2, '#f4f1ea');
  giftBox(ctx, 12, 40, 13, 13, c3, '#ffffff');
  return finish(c, 40);
}

/** Abobora-lanterna GRANDE: gomos em 3 tons, cabo, rosto recortado aceso por dentro (2 quadros tremeluzem) e 2 aboboras pequenas. */
export function jackBigProp(phase: number): Prop {
  const c = newBig();
  const { ctx } = c;
  shadowAt(ctx, 48, 136, 40);
  const cx = 48;
  const cy = 98;
  const rx = 33;
  const ry = 27;
  for (let y = cy - ry; y <= cy + ry; y++) for (let x = cx - rx; x <= cx + rx; x++) {
    const u = (x + 0.5 - cx) / rx;
    const v = (y + 0.5 - cy) / ry;
    if (u * u + v * v > 1) continue;
    const lobe = Math.abs(Math.sin(u * Math.PI * 1.5));
    let col = '#f28a1c';
    if (u < -0.35 && v < 0.2) col = '#ffa83a';
    else if (u > 0.4 || v > 0.62) col = '#d66f10';
    if (lobe < 0.12 || v > 0.86) col = '#a8480c';
    px(ctx, x, y, col);
  }
  fillR(ctx, 44, cy - ry - 7, 8, 9, '#3f7a2a');
  fillR(ctx, 44, cy - ry - 7, 3, 9, '#6fb04a');
  fillR(ctx, 49, cy - ry - 7, 3, 9, '#2c5a1e');
  fillR(ctx, 50, cy - ry - 10, 6, 4, '#3f7a2a');
  const glow = phase ? '#ffd45a' : '#ffe98a';
  const deep = phase ? '#ff9a2a' : '#ffb03a';
  const tri = (x0: number, y0: number, w: number, h: number) => {
    for (let r = 0; r < h; r++) {
      const ww = Math.max(1, Math.round((w * (r + 1)) / h));
      fillR(ctx, x0 + Math.round((w - ww) / 2), y0 + r, ww, 1, r > h - 3 ? deep : glow);
    }
  };
  tri(cx - 21, cy - 12, 14, 12);
  tri(cx + 7, cy - 12, 14, 12);
  tri(cx - 3, cy + 1, 7, 6);
  for (let x = -20; x <= 20; x++) {
    const yy = cy + 9 + Math.round(Math.abs(x) * 0.12 - 3 * Math.cos((x / 20) * 1.2));
    fillR(ctx, cx + x, yy, 1, 9, (x + 100) % 8 < 3 ? '#a8480c' : x % 8 === 0 ? deep : glow);
  }
  fillR(ctx, cx - 6, cy + 11, 3, 4, '#a8480c');
  fillR(ctx, cx + 5, cy + 11, 3, 4, '#a8480c');
  const mini = (mx: number, my: number, r: number, col: string) => {
    disc(ctx, mx, my, r, r * 0.8, col);
    fillR(ctx, mx - 1, Math.round(my - r * 0.8 - 3), 3, 3, '#3f7a2a');
    px(ctx, Math.round(mx - r * 0.5), my, '#a8480c', 1, 3);
    px(ctx, Math.round(mx + r * 0.5), my, '#a8480c', 1, 3);
    px(ctx, mx - 3, my - 1, '#ffe27a', 2, 2);
    px(ctx, mx + 2, my - 1, '#ffe27a', 2, 2);
    px(ctx, mx - 2, my + 3, '#ffe27a', 5, 1);
  };
  mini(14, 124, 9, '#e8791a');
  mini(82, 126, 8, '#f28a1c');
  fillR(ctx, 70, 114, 4, 12, '#f4f1ea');
  fillR(ctx, 70, 114, 1, 12, '#ffffff');
  fillR(ctx, 71, 108, 2, 5, phase ? '#ffd45a' : '#ff9a2a');
  return finishBig(c, 126);
}

/** Caldeirao preto com pocao verde borbulhando (2 quadros) sobre brasas. */
export function cauldronProp(phase: number): Prop {
  const c = newProp();
  const { ctx } = c;
  shadow(ctx, 15);
  fillR(ctx, 12, 62, 24, 3, '#6b4426');
  fillR(ctx, 15, 59, 18, 3, '#d8541a');
  fillR(ctx, 20, 58, 8, 2, '#ffc23a');
  fillR(ctx, 14, 62, 4, 6, '#2a2a38');
  fillR(ctx, 30, 62, 4, 6, '#2a2a38');
  disc(ctx, 24, 48, 16, 14, '#3a3a4c');
  px(ctx, 14, 40, '#5a5a70', 4, 8);
  fillR(ctx, 6, 36, 36, 4, '#2a2a38');
  fillR(ctx, 6, 36, 36, 1, '#5a5a70');
  disc(ctx, 24, 36, 17, 4, '#5ae03a');
  fillR(ctx, 14, 35, 20, 2, '#a6ff7a');
  const b = phase ? [[18, 26], [28, 30], [24, 20]] : [[20, 30], [29, 24], [23, 26]];
  b.forEach(([x, y]) => {
    disc(ctx, x!, y!, 2.5, 2.5, '#7aff5a');
    px(ctx, x! - 1, y! - 1, '#ffffff', 1, 1);
  });
  px(ctx, 22, phase ? 14 : 18, '#a6ff7a', 2, 2);
  return finish(c, 56);
}

/** Lapide com "RIP", musgo e terra remexida. */
export function tombProp(): Prop {
  const c = newProp();
  const { ctx } = c;
  shadow(ctx, 14);
  disc(ctx, 24, 64, 15, 3, '#4a3424');
  for (let y = 20; y < 64; y++) {
    const top = y < 32 ? Math.round(Math.sqrt(Math.max(0, 1 - ((32 - y) / 12) ** 2)) * 12) : 12;
    fillR(ctx, 24 - top, y, top * 2, 1, y < 24 ? '#a8aab8' : '#8d8fa0');
    fillR(ctx, 24 - top, y, 2, 1, '#c4c6d4');
    fillR(ctx, 24 + top - 3, y, 3, 1, '#6a6c80');
  }
  flatText(ctx, 15, 30, 'RIP', '#3a3a4c', 2);
  fillR(ctx, 18, 52, 5, 3, '#3f7a2a');
  fillR(ctx, 28, 58, 4, 3, '#3f7a2a');
  fillR(ctx, 22, 40, 4, 1, '#6a6c80');
  return finish(c, 48);
}

/** Fantasminha flutuando (2 quadros: sobe e desce). */
export function ghostProp(phase: number): Prop {
  const c = newProp();
  const { ctx } = c;
  shadow(ctx, 9);
  const y0 = 22 + phase * 3;
  for (let y = 0; y < 34; y++) {
    const w = y < 10 ? Math.round(Math.sqrt(Math.max(0, 1 - ((10 - y) / 10) ** 2)) * 11) : 11;
    if (y > 28 && (Math.floor(y / 2) + phase) % 2 !== 0) continue;
    fillR(ctx, 24 - w, y0 + y, w * 2, 1, y > 26 ? '#cdd6ee' : '#f4f8ff');
    fillR(ctx, 24 + w - 4, y0 + y, 4, 1, '#cdd6ee');
  }
  fillR(ctx, 18, y0 + 10, 3, 5, '#1c1226');
  fillR(ctx, 27, y0 + 10, 3, 5, '#1c1226');
  fillR(ctx, 22, y0 + 19, 4, 4, '#1c1226');
  return finish(c, 58);
}

/** Arco de baloes GRANDE (Ano Novo): dourado, prata e azul-noite; 4 quadros balancam; o ano vai numa placa. */
export function balloonArchProp(frame: number, year: number): Prop {
  const c = newBig();
  const { ctx } = c;
  shadowAt(ctx, 48, 136, 40);
  const cols = ['#f4d35e', '#c9d6e8', '#2a3a7a', '#f4d35e', '#ffffff', '#7aa8ff'];
  const sway = [0, 1, 0, -1][frame % 4]!;
  for (const bx of [14, 82]) {
    fillR(ctx, bx - 5, 124, 10, 10, '#f4f1ea');
    fillR(ctx, bx - 5, 124, 10, 2, '#ffffff');
    fillR(ctx, bx - 5, 128, 10, 2, '#f4d35e');
  }
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    const x = 14 + 68 * t;
    const y = 112 - 86 * Math.sin(t * Math.PI) ** 0.9;
    const dx = Math.round(sway * (1 - y / 130) * (i % 2 ? 1 : -1));
    const pillar = i <= 2 || i >= 10;
    for (let k = 0; k < (pillar ? 2 : 1); k++) {
      const ox = k ? (x < 48 ? -6 : 6) : 0;
      const oy = k ? 11 : 0;
      disc(ctx, Math.round(x + dx + ox), Math.round(y + oy), 7.5, 8.5, cols[(i + k * 2) % cols.length]!);
      px(ctx, Math.round(x + dx + ox - 4), Math.round(y + oy - 4), '#ffffff', 2, 3);
    }
  }
  // ganchos do letreiro (o letreiro vivo e desenhado por eventDecor.ts)
  for (const x of [26, 70]) fillR(ctx, x, 17, 1, 11, '#f4d35e');
  void year;
  return finishBig(c, 130);
}

/** Balde de gelo com champanhe e duas tacas (apoio de Ano Novo). */
export function champagneProp(phase: number): Prop {
  const c = newProp();
  const { ctx } = c;
  shadow(ctx, 13);
  fillR(ctx, 21, 14, 6, 24, '#2f5a2a');
  fillR(ctx, 21, 14, 2, 24, '#4a8a3a');
  fillR(ctx, 22, 8, 4, 6, '#2f5a2a');
  fillR(ctx, 21, 6, 6, 3, '#f4d35e');
  fillR(ctx, 20, 26, 8, 5, '#f4d35e');
  for (let y = 0; y < 22; y++) {
    const w = 11 + Math.floor(y * 0.15);
    fillR(ctx, 24 - w, 40 + y, w * 2, 1, y < 2 ? '#e8ecf4' : y % 6 < 3 ? '#9aa6c8' : '#8592b8');
    fillR(ctx, 24 - w, 40 + y, 2, 1, '#c9d6e8');
  }
  fillR(ctx, 11, 40, 26, 2, '#dfe9f8');
  for (const [x, y] of [[16, 38], [22, 37], [28, 38], [32, 39]] as const) disc(ctx, x, y, 2.4, 2.4, '#e8f4ff');
  for (const gx of [1, 39]) {
    fillR(ctx, gx + 3, 50, 2, 10, '#dfe9f8');
    fillR(ctx, gx, 58, 8, 2, '#dfe9f8');
    fillR(ctx, gx, 44, 8, 6, '#bfe6ff');
    fillR(ctx, gx + 1, 47, 6, 3, '#f4d35e');
  }
  px(ctx, phase ? 25 : 22, phase ? 2 : 0, '#ffffff', 1, 1);
  px(ctx, phase ? 21 : 26, phase ? 0 : 3, '#f4d35e', 1, 1);
  return finish(c, 60);
}

/** Coelho de Pascoa GRANDE (orelhas rosa, laco, cenoura) ao lado de um cesto de ovos decorados; 3 quadros: orelha mexe e pisca. */
export function bunnyBigProp(phase: number): Prop {
  const c = newBig();
  const { ctx } = c;
  shadowAt(ctx, 48, 136, 40);
  const fur = '#f6f2ee';
  const furD = '#d4cdd2';
  const ear = (x: number, tilt: number) => {
    for (let r = 0; r < 38; r++) {
      const w = r < 4 ? 3 + r : r > 33 ? 8 - (r - 33) : 8;
      const xx = x + Math.round(tilt * r * 0.12);
      fillR(ctx, xx - w, 4 + (37 - r), w * 2 + 1, 1, fur);
      fillR(ctx, xx + w - 2, 4 + (37 - r), 3, 1, furD);
      if (r > 4 && r < 32) fillR(ctx, xx - w + 3, 4 + (37 - r), w * 2 - 5, 1, '#ffb8d8');
    }
  };
  ear(32, -1);
  ear(50, phase === 1 ? 5 : 2);
  disc(ctx, 40, 106, 22, 24, fur);
  disc(ctx, 40, 66, 18, 15, fur);
  fillR(ctx, 27, 58, 5, 2, '#ffffff');
  disc(ctx, 40, 112, 12, 14, '#ffffff');
  fillR(ctx, 18, 128, 14, 8, fur);
  fillR(ctx, 48, 128, 14, 8, fur);
  fillR(ctx, 18, 134, 14, 2, furD);
  fillR(ctx, 48, 134, 14, 2, furD);
  fillR(ctx, 22, 130, 2, 4, '#ffb8d8');
  fillR(ctx, 52, 130, 2, 4, '#ffb8d8');
  fillR(ctx, 30, 64, 4, phase === 2 ? 1 : 5, '#1c1226');
  fillR(ctx, 46, 64, 4, phase === 2 ? 1 : 5, '#1c1226');
  if (phase !== 2) {
    fillR(ctx, 31, 64, 1, 2, '#ffffff');
    fillR(ctx, 47, 64, 1, 2, '#ffffff');
  }
  fillR(ctx, 38, 72, 4, 3, '#ff7aa8');
  fillR(ctx, 39, 75, 2, 3, '#1c1226');
  fillR(ctx, 35, 77, 4, 1, '#1c1226');
  fillR(ctx, 41, 77, 4, 1, '#1c1226');
  fillR(ctx, 24, 72, 5, 3, '#ffc2dc');
  fillR(ctx, 51, 72, 5, 3, '#ffc2dc');
  fillR(ctx, 28, 85, 8, 7, '#3a8fd0');
  fillR(ctx, 44, 85, 8, 7, '#3a8fd0');
  fillR(ctx, 28, 85, 8, 2, '#6fb8f0');
  fillR(ctx, 44, 85, 8, 2, '#6fb8f0');
  fillR(ctx, 36, 86, 8, 6, '#27689e');
  for (let r = 0; r < 20; r++) fillR(ctx, 54 + Math.floor(r / 4), 100 + r, Math.max(2, 7 - Math.floor(r / 3)), 1, r % 5 === 0 ? '#c9570e' : '#ff8a1c');
  fillR(ctx, 53, 94, 3, 7, '#3f9a3a');
  fillR(ctx, 57, 92, 3, 8, '#58b858');
  const egg = (x: number, y: number, c1: string, c2: string, kind: number) => {
    for (let r = 0; r < 14; r++) {
      const w = Math.max(1, Math.round(Math.sin(((r + 0.5) / 14) * Math.PI) ** 0.75 * 6 + (r > 6 ? 1 : 0)));
      for (let xx = -w; xx <= w; xx++) {
        let col = xx < -w * 0.4 ? shade(c1, 0.25) : xx > w * 0.45 ? shade(c1, -0.25) : c1;
        if (kind === 0 && r % 5 === 2) col = c2;
        if (kind === 1 && ((xx + r) & 3) === 0) col = c2;
        if (kind === 2 && (r + (xx & 1)) % 5 === 3) col = c2;
        px(ctx, x + xx, y + r, col);
      }
    }
  };
  for (let y = 0; y < 14; y++) {
    const w = 17 - Math.floor(y / 4);
    for (let x = -w; x <= w; x++) px(ctx, 74 + x, 118 + y, (x + y) % 4 === 0 ? '#7a4a22' : y % 3 === 0 ? '#b57a3a' : '#c98f4c');
  }
  fillR(ctx, 56, 116, 36, 3, '#8a5628');
  fillR(ctx, 62, 112, 20, 5, '#58b858');
  egg(64, 98, '#ff9ccf', '#ffffff', 0);
  egg(75, 94, '#9be0ff', '#3a8fd0', 1);
  egg(85, 99, '#ffe27a', '#ff9a3a', 2);
  egg(70, 106, '#b9a0ff', '#ffffff', 1);
  egg(81, 107, '#9be0a0', '#ffffff', 0);
  return finishBig(c, 130);
}

/** Pintinho amarelo pulando (2 quadros) no meio da grama. */
export function chickProp(phase: number): Prop {
  const c = newProp();
  const { ctx } = c;
  shadow(ctx, 11);
  const y = 36 + (phase ? 0 : 3);
  disc(ctx, 24, y + 14, 11, 11, '#ffe27a');
  disc(ctx, 24, y - 2, 8, 8, '#ffe27a');
  fillR(ctx, 20, y - 5, 2, 3, '#1c1226');
  fillR(ctx, 27, y - 5, 2, 3, '#1c1226');
  fillR(ctx, 22, y - 1, 5, 3, '#ff8a1c');
  fillR(ctx, 23, y - 12, 2, 4, '#ffc23a');
  fillR(ctx, 14, y + 10, 4, 6, '#f2c230');
  fillR(ctx, 20, y + 24, 2, 4, '#ff8a1c');
  fillR(ctx, 27, y + 24, 2, 4, '#ff8a1c');
  for (let x = 8; x < 40; x++) {
    const h = (x * 7) % 5 < 2 ? 7 : 4;
    fillR(ctx, x, 68 - h, 1, h, x % 3 === 0 ? '#3f9a3a' : '#58b858');
  }
  return finish(c, 56);
}

/** Mascara de carnaval GRANDE num pedestal: roxa e dourada, penas de 5 cores e fitas; 2 quadros brilham e as fitas balancam. */
export function maskBigProp(phase: number): Prop {
  const c = newBig();
  const { ctx } = c;
  shadowAt(ctx, 48, 136, 32);
  fillR(ctx, 44, 78, 8, 52, '#6a4a2a');
  fillR(ctx, 44, 78, 2, 52, '#a8783a');
  disc(ctx, 48, 132, 22, 5, '#4a3a5a');
  disc(ctx, 48, 128, 16, 4, '#7a5af0');
  const fe = ['#e83c8a', '#ffcf1f', '#1fbf6a', '#3a8fd0', '#ff7a1f', '#7a5af0', '#e83c8a'];
  fe.forEach((col, i) => {
    const ang = -2.3 + (i / (fe.length - 1)) * 1.6;
    for (let r = 14; r < 46; r++) {
      const x = 48 + Math.cos(ang) * r;
      const y = 58 + Math.sin(ang) * r;
      fillR(ctx, Math.round(x) - 2, Math.round(y), 5, 1, r > 40 ? shade(col, 0.4) : r % 7 === 0 ? shade(col, -0.25) : col);
    }
  });
  const my0 = 54;
  for (let y = 0; y < 24; y++) {
    const hw = y < 9 ? 22 + Math.round(y * 0.9) : 30 - Math.round((y - 9) * 1.1);
    for (let x = -hw; x <= hw; x++) {
      const eyeL = ((Math.abs(x) - 14) / 8) ** 2 + ((y - 10) / 4.5) ** 2 < 1;
      const rim = Math.abs(x) >= hw - 1 || y === 0 || y === 23;
      const col = eyeL ? '#1c1226' : rim ? '#ffd45a' : x < -8 ? '#9a7aff' : x > 12 ? '#5a3ad0' : '#7a5af0';
      px(ctx, 48 + x, my0 + y, col);
    }
  }
  fillR(ctx, 44, my0 + 11, 8, 8, '#1c1226');
  fillR(ctx, 46, my0 + 11, 4, 5, '#7a5af0');
  fillR(ctx, 20, my0 + 3, 4, 1, '#ffd45a');
  fillR(ctx, 72, my0 + 3, 4, 1, '#ffd45a');
  for (const [gx, gy] of [[30, my0 + 4], [66, my0 + 4], [48, my0 + 2], [36, my0 + 18], [60, my0 + 18]] as const) fillR(ctx, gx, gy, 2, 2, (gx + phase) % 2 ? '#ffffff' : '#ffd45a');
  ([['#e83c8a', 22], ['#ffcf1f', 74]] as const).forEach(([col, x], i) => {
    for (let y = 0; y < 30; y++) fillR(ctx, x + Math.round(Math.sin(y * 0.4 + i + phase) * 2), 76 + y, 3, 1, y % 6 === 5 ? shade(col, -0.25) : col);
  });
  return finishBig(c, 128);
}

/** Surdo de samba: tambor azul com aros dourados e baquetas. */
export function drumProp(): Prop {
  const c = newProp();
  const { ctx } = c;
  shadow(ctx, 15);
  for (let y = 0; y < 30; y++) {
    fillR(ctx, 10, 36 + y, 28, 1, y < 3 || y > 26 ? '#f2c230' : y % 4 === 0 ? '#2a6bb8' : '#3a8fd0');
    fillR(ctx, 10, 36 + y, 4, 1, '#6fb8f0');
    fillR(ctx, 34, 36 + y, 4, 1, '#1f5a96');
  }
  disc(ctx, 24, 36, 14, 5, '#f4f1ea');
  fillR(ctx, 14, 35, 20, 2, '#d8d2c4');
  px(ctx, 22, 28, '#8a5628', 2, 10);
  px(ctx, 30, 24, '#8a5628', 2, 12);
  disc(ctx, 23, 27, 2.5, 2.5, '#e83c8a');
  disc(ctx, 31, 23, 2.5, 2.5, '#ffcf1f');
  return finish(c, 50);
}

/** Fogueira GRANDE de festa junina: pedras, lenhas em cruz e 3 quadros de chama (vermelho, laranja, amarelo, branco) com faiscas. */
export function bonfireBigProp(frame: number): Prop {
  const c = newBig();
  const { ctx } = c;
  shadowAt(ctx, 48, 136, 36);
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    disc(ctx, Math.round(48 + Math.cos(a) * 26), Math.round(128 + Math.sin(a) * 7), 5, 3.4, k % 2 ? '#8b8b96' : '#a8a8b6');
  }
  const log = (x0: number, y0: number, x1: number, y1: number) => {
    for (let i = 0; i <= 40; i++) {
      const x = Math.round(x0 + ((x1 - x0) * i) / 40);
      const y = Math.round(y0 + ((y1 - y0) * i) / 40);
      fillR(ctx, x - 2, y - 2, 5, 4, i % 9 < 2 ? '#4a2c18' : '#7a4a28');
      px(ctx, x - 2, y - 2, '#a8693c', 5, 1);
    }
  };
  log(24, 128, 70, 108);
  log(72, 128, 26, 108);
  const flame = (x: number, h: number, w0: number, col: string, jig: number) => {
    for (let r = 0; r < h; r++) {
      const u = r / h;
      const w = Math.max(1, Math.round(Math.sin(Math.min(1, u * 1.15 + 0.1) * Math.PI) ** 0.8 * w0 * (1 - u * 0.55)));
      const sway = Math.round(Math.sin(u * 5 + jig) * 2 * u);
      fillR(ctx, x - w + sway, 112 - r, w * 2, 1, col);
    }
  };
  flame(48, 74 + frame * 6, 17, '#d8341c', frame);
  flame(34, 44 + ((frame + 1) % 3) * 6, 11, '#f28a1c', frame + 1);
  flame(62, 48 + ((frame + 2) % 3) * 6, 11, '#f28a1c', frame + 2);
  flame(48, 50 + frame * 5, 11, '#ffc23a', frame + 3);
  flame(48, 26 + frame * 4, 6, '#fff2b0', frame + 4);
  const sp: Array<[number, number]> = frame === 0 ? [[38, 28], [58, 18], [70, 36]] : frame === 1 ? [[44, 22], [64, 30], [30, 40]] : [[52, 14], [34, 30], [68, 22]];
  sp.forEach(([x, y]) => px(ctx, x, y, '#ffd45a', 2, 2));
  return finishBig(c, 100);
}

/** Cesta de milho (espigas amarelas com palha verde). */
export function cornProp(): Prop {
  const c = newProp();
  const { ctx } = c;
  shadow(ctx, 14);
  for (const [x, tilt] of [[17, -3], [24, 0], [31, 3]] as const) {
    for (let r = 0; r < 22; r++) {
      const cx = x + Math.round((tilt * (22 - r)) / 22);
      fillR(ctx, cx - 3, 30 + r, 7, 1, r % 4 === 1 ? '#d4a82a' : '#f2c230');
      if (r > 10) fillR(ctx, cx - 3, 30 + r, 2, 1, '#3f9a3a');
    }
    fillR(ctx, x - 3 + Math.round(tilt * 0.8), 26, 7, 4, '#58b858');
  }
  for (let y = 0; y < 14; y++) {
    const w = 15 - Math.floor(y / 4);
    for (let x = -w; x <= w; x++) px(ctx, 24 + x, 52 + y, (x + y) % 4 === 0 ? '#7a4a22' : y % 3 === 0 ? '#b57a3a' : '#c98f4c');
  }
  fillR(ctx, 8, 50, 32, 3, '#8a5628');
  return finish(c, 46);
}

// ---- bloco 2: Namorados, Criancas, Trabalho, Aniversario, Black Friday, Dia da TI ------------------------------------------

/** Coracao de pixels (7x6) em 3 tons, com brilho. */
function heartAt(ctx: Ctx, x: number, y: number, col: string, k = 1) {
  const rows = ['.##.##.', '#######', '#######', '.#####.', '..###..', '...#...'];
  rows.forEach((row, r) => {
    for (let c = 0; c < 7; c++) {
      if (row[c] !== '#') continue;
      const tone = r === 1 && c < 3 ? shade(col, 0.32) : c > 4 || r > 3 ? shade(col, -0.25) : col;
      fillR(ctx, x + c * k, y + r * k, k, k, tone);
    }
  });
}

/** Arco de rosas GRANDE com coracao no topo (Namorados); 2 quadros brilham. */
export function roseArchProp(phase: number): Prop {
  const c = newBig();
  const { ctx } = c;
  shadowAt(ctx, 48, 136, 38);
  for (const bx of [12, 76]) {
    fillR(ctx, bx, 40, 8, 92, '#f4f1ea');
    fillR(ctx, bx, 40, 2, 92, '#ffffff');
    fillR(ctx, bx + 6, 40, 2, 92, '#cfc9b8');
    fillR(ctx, bx - 2, 128, 12, 6, '#e0dac8');
    fillR(ctx, bx - 2, 36, 12, 5, '#f4f1ea');
  }
  // folhagem e rosas pelo arco
  const arc: Array<[number, number]> = [];
  for (let i = 0; i <= 20; i++) {
    const t = i / 20;
    arc.push([12 + 72 * t, 56 - 40 * Math.sin(t * Math.PI) ** 0.8]);
  }
  arc.forEach(([x, y], i) => {
    disc(ctx, Math.round(x), Math.round(y), 6, 5, i % 2 ? '#2f8f4e' : '#237a40');
  });
  for (let y = 44; y < 124; y += 9) for (const bx of [16, 80]) disc(ctx, bx + ((y / 9) % 2 ? -3 : 3), y, 4, 4, '#2f8f4e');
  const rose = (x: number, y: number, col: string) => {
    disc(ctx, x, y, 4, 4, col);
    px(ctx, x - 1, y - 1, shade(col, -0.4), 2, 1);
    px(ctx, x, y, shade(col, 0.35), 1, 1);
  };
  arc.forEach(([x, y], i) => {
    if (i % 2) rose(Math.round(x), Math.round(y) - 1, ['#e8344e', '#ff4d7e', '#ff9ab5'][i % 3]!);
  });
  for (let y = 54; y < 124; y += 12) {
    rose(14, y, '#e8344e');
    rose(82, y + 5, '#ff4d7e');
  }
  heartAt(ctx, 36, 2, phase ? '#ff6a96' : '#ff4d7e', 3);
  if (phase) px(ctx, 40, 5, '#ffffff', 2, 2);
  else px(ctx, 54, 8, '#ffffff', 2, 2);
  // petalas no chao
  for (const [x, y] of [[30, 130], [60, 128], [44, 134], [68, 133]] as const) px(ctx, x, y, '#ff4d7e', 2, 1);
  return finishBig(c, 130);
}

/** Ursinho de pelucia com coracao. */
export function teddyProp(): Prop {
  const c = newProp();
  const { ctx } = c;
  shadow(ctx, 14);
  const fur = '#c98f4c';
  disc(ctx, 24, 54, 13, 12, fur);
  disc(ctx, 24, 53, 7, 7, '#ecc88a');
  disc(ctx, 24, 30, 11, 10, fur);
  disc(ctx, 14, 21, 4, 4, fur);
  disc(ctx, 34, 21, 4, 4, fur);
  disc(ctx, 14, 21, 2, 2, '#ecc88a');
  disc(ctx, 34, 21, 2, 2, '#ecc88a');
  disc(ctx, 24, 34, 5, 4, '#ecc88a');
  fillR(ctx, 19, 27, 2, 3, '#1c1226');
  fillR(ctx, 28, 27, 2, 3, '#1c1226');
  fillR(ctx, 23, 32, 3, 2, '#1c1226');
  disc(ctx, 10, 50, 4, 6, fur);
  disc(ctx, 38, 50, 4, 6, fur);
  disc(ctx, 16, 66, 5, 3, fur);
  disc(ctx, 32, 66, 5, 3, fur);
  heartAt(ctx, 21, 46, '#e8344e', 1);
  fillR(ctx, 18, 40, 12, 3, '#d03a3a');
  return finish(c, 62);
}

/** Torre de blocos de montar GRANDE (Dia das Criancas): A, B, C, 1, 2, 3 com estrela no topo e um carrinho; 2 quadros: a estrela pisca. */
export function blockTowerProp(phase: number): Prop {
  const c = newBig();
  const { ctx } = c;
  shadowAt(ctx, 48, 136, 38);
  const block = (x: number, y: number, w: number, col: string, ch: string) => {
    fillR(ctx, x, y, w, 26, col);
    fillR(ctx, x, y, w, 3, shade(col, 0.35));
    fillR(ctx, x, y, 3, 26, shade(col, 0.2));
    fillR(ctx, x + w - 4, y + 3, 4, 23, shade(col, -0.3));
    fillR(ctx, x, y + 23, w, 3, shade(col, -0.42));
    // pinos de encaixe
    for (const px0 of [x + 6, x + w - 14]) {
      fillR(ctx, px0, y - 3, 8, 3, shade(col, 0.2));
      fillR(ctx, px0, y - 3, 8, 1, shade(col, 0.45));
    }
    A_flat(ctx, x + Math.round(w / 2) - 5, y + 8, ch, '#ffffff', 2);
  };
  block(8, 108, 38, '#3aa0ff', 'A');
  block(50, 108, 38, '#ff5d73', 'B');
  block(18, 80, 38, '#ffcc2e', 'C');
  block(58, 80, 30, '#3ed08a', '1');
  block(34, 52, 38, '#9a5ad0', '2');
  // estrela no topo
  const col = phase ? '#fff0a0' : '#ffd95a';
  fillR(ctx, 46, 28, 3, 24, '#8a5628');
  star7(ctx, 47, 14, col);
  if (phase) {
    px(ctx, 36, 12, '#ffffff', 2, 2);
    px(ctx, 58, 20, '#ffffff', 2, 2);
  } else px(ctx, 56, 8, '#ffffff', 2, 2);
  return finishBig(c, 130);
}
const A_flat = (ctx: Ctx, x: number, y: number, s: string, col: string, k: number) => flatText(ctx, x, y, s, col, k);
function star7(ctx: Ctx, cx: number, cy: number, col: string) {
  const rows = ['...#...', '...#...', '#######', '.#####.', '..###..', '.##.##.', '.#...#.'];
  rows.forEach((row, y) => [...row].forEach((ch, x) => ch === '#' && fillR(ctx, cx - 10 + x * 3, cy - 6 + y * 3, 3, 3, y < 3 ? shade(col, 0.2) : col)));
}

/** Engrenagens GRANDES com capacete amarelo no topo (Dia do Trabalho): azul e dourado, discreto. */
export function gearsBigProp(): Prop {
  const c = newBig();
  const { ctx } = c;
  shadowAt(ctx, 48, 136, 34);
  // pedestal
  fillR(ctx, 22, 118, 52, 12, '#4a5a78');
  fillR(ctx, 22, 118, 52, 3, '#7a8aa8');
  fillR(ctx, 22, 127, 52, 3, '#2a3550');
  fillR(ctx, 36, 123, 24, 3, '#f2c230');
  const gear = (cx: number, cy: number, r: number, col: string) => {
    for (let y = -r - 5; y <= r + 5; y++) for (let x = -r - 5; x <= r + 5; x++) {
      const d = Math.hypot(x, y);
      const ang = Math.atan2(y, x);
      const teeth = d > r - 1 && d <= r + 4 && Math.floor(((ang + Math.PI) / (Math.PI * 2)) * 10 + 0.5) % 2 === 0;
      const body = d <= r && d > r * 0.35;
      if (!body && !teeth) continue;
      px(ctx, cx + x, cy + y, x + y < -r * 0.6 ? shade(col, 0.28) : x + y > r * 0.6 ? shade(col, -0.3) : col);
    }
    disc(ctx, cx, cy, r * 0.22, r * 0.22, shade(col, -0.45));
  };
  gear(34, 90, 20, '#2f6fd0');
  gear(66, 82, 15, '#f2c230');
  gear(50, 54, 11, '#8aa8e0');
  // capacete
  disc(ctx, 48, 30, 15, 12, '#ffcf1f');
  fillR(ctx, 30, 36, 36, 5, '#e0a80a');
  fillR(ctx, 30, 36, 36, 1, '#fff0a0');
  fillR(ctx, 45, 14, 6, 14, '#e0a80a');
  fillR(ctx, 45, 14, 2, 14, '#fff0a0');
  fillR(ctx, 38, 26, 4, 3, '#ffffff');
  return finishBig(c, 124);
}

/** Caixa de ferramentas aberta com chave e martelo. */
export function toolboxProp(): Prop {
  const c = newProp();
  const { ctx } = c;
  shadow(ctx, 14);
  fillR(ctx, 8, 46, 32, 20, '#d03a3a');
  fillR(ctx, 8, 46, 32, 3, '#ff6a6a');
  fillR(ctx, 8, 46, 3, 20, '#e85a5a');
  fillR(ctx, 36, 49, 4, 17, '#a82a2a');
  fillR(ctx, 8, 62, 32, 4, '#7a1a1a');
  fillR(ctx, 8, 54, 32, 2, '#2a2a38');
  fillR(ctx, 20, 40, 8, 6, '#8a8794');
  fillR(ctx, 20, 40, 8, 1, '#c9c6d4');
  fillR(ctx, 14, 30, 3, 14, '#8a5628');
  fillR(ctx, 10, 28, 12, 5, '#8a8794');
  fillR(ctx, 28, 34, 3, 12, '#c9c6d4');
  fillR(ctx, 26, 30, 7, 5, '#c9c6d4');
  return finish(c, 40);
}

/** Bolo de aniversario GRANDE de 3 andares com velas acesas (3 quadros: chamas dancam) e confeitos. */
export function cakeBigProp(frame: number): Prop {
  const c = newBig();
  const { ctx } = c;
  shadowAt(ctx, 48, 136, 36);
  disc(ctx, 48, 128, 32, 7, '#e8ecf4');
  fillR(ctx, 20, 126, 56, 2, '#c9d0e0');
  const tier = (cx: number, y0: number, hw: number, h: number, base: string, cream: string) => {
    for (let y = 0; y < h; y++) for (let x = -hw; x <= hw; x++) {
      const col = x < -hw * 0.45 ? shade(base, 0.22) : x > hw * 0.5 ? shade(base, -0.25) : base;
      px(ctx, cx + x, y0 + y, y < 5 ? cream : col);
    }
    for (let x = -hw; x <= hw; x += 5) fillR(ctx, cx + x, y0 + 5, 3, 3 + (x % 3 === 0 ? 3 : 1), cream);
    for (let x = -hw + 3; x < hw - 2; x += 7) fillR(ctx, cx + x, y0 + h - 8, 3, 3, ['#ffd45a', '#3aa0ff', '#7ae85a'][((x + 99) / 7 | 0) % 3]!);
    disc(ctx, cx, y0, hw, 3, cream);
  };
  tier(48, 94, 32, 32, '#ff6fa8', '#fff4f8');
  tier(48, 64, 23, 30, '#7a5af0', '#f4eeff');
  tier(48, 38, 15, 26, '#ffc83d', '#fff8e0');
  // velas
  const flame = (x: number, f: number) => {
    fillR(ctx, x, 22, 3, 14, '#f4f1ea');
    fillR(ctx, x, 22, 1, 14, '#ffffff');
    fillR(ctx, x + 1, 24, 1, 2, '#ff6fa8');
    fillR(ctx, x + 1, 30, 1, 2, '#ff6fa8');
    const h = 6 + (f % 2);
    fillR(ctx, x, 22 - h, 3, h, '#ff9a2a');
    fillR(ctx, x + 1, 22 - h + 1, 1, h - 1, '#ffe27a');
    if (f === 2) fillR(ctx, x + 2, 22 - h - 1, 1, 2, '#ff9a2a');
  };
  flame(38, frame);
  flame(47, frame + 1);
  flame(56, frame + 2);
  return finishBig(c, 130);
}

/** Letreiro de Black Friday em cavalete: neon dourado "BLACK FRIDAY" e "-70%", lampadas piscam em 2 quadros. */
export function blackSignProp(phase: number): Prop {
  const c = newBig();
  const { ctx } = c;
  shadowAt(ctx, 48, 136, 34);
  fillR(ctx, 24, 100, 5, 32, '#2a2a34');
  fillR(ctx, 67, 100, 5, 32, '#2a2a34');
  fillR(ctx, 18, 128, 60, 5, '#1c1c24');
  fillR(ctx, 8, 28, 80, 76, '#0c0c12');
  fillR(ctx, 10, 30, 76, 72, '#15151c');
  fillR(ctx, 10, 30, 76, 2, '#2a2a38');
  const gold = '#f0b429';
  fillR(ctx, 12, 32, 72, 2, gold);
  fillR(ctx, 12, 98, 72, 2, gold);
  fillR(ctx, 12, 32, 2, 68, gold);
  fillR(ctx, 82, 32, 2, 68, gold);
  // lampadas piscando ao redor
  for (let i = 0; i < 10; i++) {
    const on = (i + phase) % 2 === 0;
    for (const [x, y] of [[14 + i * 7, 26], [14 + i * 7, 102]] as const) fillR(ctx, x, y, 3, 3, on ? '#fff0a0' : '#6a5a2a');
  }
  for (let i = 0; i < 7; i++) {
    const on = (i + phase) % 2 === 1;
    for (const x of [4, 90]) fillR(ctx, x, 32 + i * 10, 3, 3, on ? '#fff0a0' : '#6a5a2a');
  }
  flatText(ctx, 18, 42, 'BLACK', '#6a4a10', 3);
  flatText(ctx, 18, 41, 'BLACK', gold, 3);
  flatText(ctx, 14, 62, 'FRIDAY', '#6a4a10', 3);
  flatText(ctx, 14, 61, 'FRIDAY', '#ffffff', 3);
  fillR(ctx, 20, 82, 56, 12, gold);
  flatText(ctx, 30, 85, 'SO HOJE!', '#15151c', 1);
  return finishBig(c, 132);
}

/** Holograma GRANDE da Sala da TI: pedestal de ponte de comando, globo de arame ciano e dados orbitando (2 quadros). */
export function holoBigProp(frame: number): Prop {
  const c = newBig();
  const { ctx } = c;
  shadowAt(ctx, 48, 136, 34);
  disc(ctx, 48, 128, 30, 7, '#1c2440');
  fillR(ctx, 22, 124, 52, 2, NEON_CY);
  disc(ctx, 48, 120, 20, 5, '#2b3556');
  fillR(ctx, 30, 119, 36, 2, NEON_CY);
  for (let y = 0; y < 60; y++) {
    const w = 8 + y * 0.45;
    fillR(ctx, Math.round(48 - w), 116 - y, Math.round(w * 2), 1, 'rgba(39,217,255,0.14)');
  }
  const R = 24;
  const cx = 48;
  const cy = 62;
  for (let a = 0; a < 6.3; a += 0.03) fillR(ctx, Math.round(cx + Math.cos(a) * R), Math.round(cy + Math.sin(a) * R), 1, 1, NEON_CY);
  for (let k = -3; k <= 3; k++) {
    const yy = cy + k * 6;
    const rw = Math.sqrt(Math.max(0, R * R - (k * 6) ** 2));
    for (let a = 0; a < 6.3; a += 0.07) fillR(ctx, Math.round(cx + Math.cos(a) * rw), Math.round(yy + Math.sin(a) * rw * 0.25), 1, 1, '#7ae8ff');
  }
  for (const ph of [0, 1, 2]) {
    const off = (frame * 0.5 + ph * 1.05) % 3.14;
    for (let t = -1.5; t < 1.5; t += 0.05) fillR(ctx, Math.round(cx + Math.sin(off) * R * Math.cos(t)), Math.round(cy + Math.sin(t) * R), 1, 1, '#bff4ff');
  }
  for (let i = 0; i < 5; i++) {
    const a = frame * 1.1 + i * 1.26;
    fillR(ctx, Math.round(cx + Math.cos(a) * 32), Math.round(cy + Math.sin(a) * 9 - 6), 3, 3, i % 2 ? NEON_GR : '#ffffff');
  }
  fillR(ctx, cx - 2, cy - 2, 4, 4, '#ffffff');
  return { canvas: c.canvas, ax: 48, ay: 136, h: 120 };
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
