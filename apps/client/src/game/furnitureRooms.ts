import type { FurniKind, Furniture } from '@workverse/shared';
import { Plane, blob, boxPlane, hash2, project, shade, type Box, type Ctx } from './pixel';
import { wallText } from './eventArt';
import type { Builder, Parts } from './furniture';

/**
 * Pecas das salas do Hall 2 (RH, Diretoria, Laboratorio, Refeitorio, Jogos, Terraco, Biblioteca e Estudio).
 * Pixel art original, desenhada por codigo, no mesmo estilo das demais pecas: luz vinda de cima a esquerda, faces
 * esquerda (+y) mais claras que as direitas (+x), sombra de contato e contorno. Ver furniture.ts para as regras de
 * orientacao (`dir`): pecas largas giram com a parede, pecas 1x1 mostram a frente na face +x (dir 0) ou +y (dir 1).
 */

const tone = (side: 'n' | 'w', c: string) => (side === 'w' ? shade(c, -0.13) : c);

function withDetail(b: Box, fn: (ctx: Ctx, ox: number, oy: number, b: Box) => void): Box {
  b.detail = (ctx, ox, oy) => fn(ctx, ox, oy, b);
  return b;
}

const onWall = (f: Furniture, fn: (p: Plane, side: 'n' | 'w') => void) => (ctx: Ctx, ox: number, oy: number) => {
  const side: 'n' | 'w' = f.dir % 2 === 0 ? 'n' : 'w';
  fn(new Plane(ctx, side, ox, oy), side);
};
const wallShadow = (p: Plane, a0: number, a1: number, z0: number, z1: number) => p.rect(a0 + 2, a1 + 2, z0 - 2, z1 - 2, 'rgba(25,20,45,0.22)');

/** Monta caixas ao longo de uma parede: `l` = posicao ao longo da peca, `s` = distancia da parede (0 = a parede). */
const along =
  (alongX: boolean) =>
  (l0: number, l1: number, s0: number, s1: number, z: number, h: number, top: string, left?: string, right?: string, extra: Partial<Box> = {}): Box =>
    alongX ? { x: l0, y: s0, w: l1 - l0, d: s1 - s0, z, h, top, left, right, ...extra } : { x: s0, y: l0, w: s1 - s0, d: l1 - l0, z, h, top, left, right, ...extra };

/** Pinta um padrao num retangulo horizontal (tile-space) na altura `z`. */
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

export type { Parts };

type RoomKinds = Extract<FurniKind, 'notice_board' | 'board_table' | 'sideboard' | 'printer3d' | 'bench' | 'long_table' | 'buffet' | 'foosball' | 'pingpong' | 'arcade' | 'railing' | 'parasol' | 'garden_bed' | 'tall_shelf' | 'podcast_table' | 'acoustic_panel' | 'on_air' | 'camera_tripod'>;

export const ROOM_BUILDERS: Record<RoomKinds, Builder> = {
  /** Mesa de diretoria: tampo de nogueira escura com friso claro, dois pedestais, blocos de anotacao, copos e jarras. */
  board_table: (fw, fd) => {
    const alongX = fw >= fd;
    const L = alongX ? fw : fd;
    const S = alongX ? fd : fw;
    const mk = along(alongX);
    const H = 23;
    const TH = 4;
    const top = withDetail(mk(0.02, L - 0.02, 0.04, S - 0.04, H, TH, '#6a4429', '#4a2e1a', '#33200f'), (ctx, ox, oy, b) => {
      paintTop(ctx, ox, oy, b.x + 0.03, b.y + 0.03, b.x + b.w - 0.03, b.y + b.d - 0.03, b.z + b.h, (X, Y, px, py) => {
        const l = alongX ? X - b.x : Y - b.y;
        const s = alongX ? Y - b.y : X - b.x;
        // brass-toned inlay line around the top and soft grain along the length
        if (s > 0.08 && s < 0.1) return '#b08a4a';
        if (s > S - 0.18 && s < S - 0.16) return '#b08a4a';
        if (hash2(Math.floor(l * 14), Math.floor(s * 40), 5) < 0.14) return '#7a5234';
        if (hash2(px, py, 6) < 0.03) return '#8a6040';
        return null;
      });
    });
    const boxes: Box[] = [
      mk(L * 0.16, L * 0.16 + 0.5, 0.34, S - 0.34, 0, H, '#3a2314', '#4a2e1a', '#26160b'),
      mk(L * 0.84 - 0.5, L * 0.84, 0.34, S - 0.34, 0, H, '#3a2314', '#4a2e1a', '#26160b'),
      mk(L * 0.16 + 0.1, L * 0.84 - 0.1, S / 2 - 0.05, S / 2 + 0.05, 5, 3, '#2a190d', '#33200f', '#1d1109', { noOutline: true }),
      top,
    ];
    const z = H + TH;
    for (let i = 0; i < Math.floor(L); i++) {
      const c = i + 0.5;
      for (const near of [true, false]) {
        const s0 = near ? 0.16 : S - 0.4;
        boxes.push(mk(c - 0.22, c + 0.2, s0, s0 + 0.24, z, 1, '#f4f1ea', '#d9d4c4', '#a8a396', { noOutline: true }));
        boxes.push(mk(c + 0.26, c + 0.35, near ? 0.2 : S - 0.36, near ? 0.29 : S - 0.27, z, 4, '#dff1fb', '#b8d9ea', '#86a8bb', { noOutline: true }));
      }
    }
    // center: two carafes and a low flower bowl
    boxes.push(mk(L / 2 - 0.5, L / 2 - 0.38, S / 2 - 0.06, S / 2 + 0.06, z, 7, '#e6f4fb', '#bfdcea', '#8bb0c4'));
    boxes.push(mk(L / 2 + 0.38, L / 2 + 0.5, S / 2 - 0.06, S / 2 + 0.06, z, 7, '#e6f4fb', '#bfdcea', '#8bb0c4'));
    boxes.push(mk(L / 2 - 0.12, L / 2 + 0.12, S / 2 - 0.12, S / 2 + 0.12, z, 4, '#f4f1ea', '#d9d4c4', '#a8a396'));
    return {
      z1: z + 9,
      shadow: { alpha: 0.32 },
      boxes,
      post: (ctx, ox, oy) => {
        const [cx, cy] = project(ox, oy, alongX ? L / 2 : S / 2, alongX ? S / 2 : L / 2, z + 5);
        for (const [dx, dy, c] of [[-2, -3, '#e8593a'], [1, -4, '#f2d24a'], [3, -2, '#f08aa8'], [-1, -1, '#58b45f'], [0, -3, '#ffffff']] as const) {
          ctx.fillStyle = c;
          ctx.fillRect(cx + dx, cy + dy, 2, 2);
        }
      },
    };
  },

/** Impressora 3D: base escura com visor, quatro colunas, cabine de vidro, cabeca laranja, uma peca em camadas e o carretel no topo. */
  printer3d: (_fw, _fd, f, on) => {
    const side: 'n' | 'w' = f.dir % 2 === 0 ? 'w' : 'n';
    const rear = ((f.dir % 4) + 4) % 4 >= 2;
    const base = withDetail({ x: 0.1, y: 0.1, z: 0, w: 0.8, d: 0.8, h: 9, top: '#39404f', left: '#2b313d', right: '#1e232c' }, (ctx, ox, oy, b) => {
      const p = boxPlane(ctx, ox, oy, b, side);
      const W = Math.round((side === 'n' ? b.w : b.d) * 32);
      const t = (c: string) => tone(side, c);
      if (rear) {
        p.rectFn(3, W - 3, 2, 7, (a, z) => (z % 3 === 0 && a % 5 < 3 ? t('#14181f') : null));
        return;
      }
      p.rect(2, W - 2, 1, 8, t('#242a35'));
      p.rect(4, 15, 2, 7, t('#06140c'));
      p.rect(5, 14, 5, 6, t('#58ffa0'));
      p.rect(5, on ? 11 : 8, 3, 4, t('#35d8ff'));
      p.px(W - 6, 5, on ? '#58e08a' : '#ffb347');
      p.px(W - 9, 5, '#e04848');
    });
    const posts: Box[] = [];
    for (const [x, y] of [[0.12, 0.12], [0.82, 0.12], [0.12, 0.82], [0.82, 0.82]] as const) posts.push({ x, y, z: 9, w: 0.06, d: 0.06, h: 30, top: '#e1e5ec', left: '#aeb4c0', right: '#6b717e', noOutline: true });
    const frame: Box = { x: 0.1, y: 0.1, z: 39, w: 0.8, d: 0.8, h: 2, top: '#dfe3ea', left: '#aeb4c0', right: '#6b717e' };
    const plate: Box = { x: 0.2, y: 0.2, z: 9, w: 0.6, d: 0.6, h: 2, top: '#2a2f3a', left: '#1b1f27', right: '#14171e', noOutline: true };
    const part = withDetail({ x: 0.38, y: 0.38, z: 11, w: 0.24, d: 0.24, h: 9, top: '#ffb06a', left: '#ff8a3a', right: '#c4601f' }, (ctx, ox, oy, b) => {
      for (const sd of ['n', 'w'] as const) {
        const q = boxPlane(ctx, ox, oy, b, sd);
        const W = Math.round((sd === 'n' ? b.w : b.d) * 32);
        for (let z = 1; z < 9; z += 2) q.rect(0, W, z, z + 1, shade(sd === 'n' ? '#ff8a3a' : '#c4601f', -0.22));
      }
    });
    const bar: Box = { x: 0.12, y: 0.46, z: 27, w: 0.76, d: 0.08, h: 2, top: '#8f94a0', left: '#aeb4c0', right: '#59606e', noOutline: true };
    const head: Box = { x: 0.42, y: 0.4, z: 21, w: 0.16, d: 0.2, h: 7, top: '#ff6a3a', left: '#e0502a', right: '#9a3418' };
    const spoolHub: Box = { x: 0.36, y: 0.36, z: 41, w: 0.28, d: 0.28, h: 6, top: '#ffb06a', left: '#ff7a2a', right: '#b4501a' };
    const spoolCore: Box = { x: 0.46, y: 0.46, z: 47, w: 0.08, d: 0.08, h: 1, top: '#f1f1f1', noOutline: true };
    return {
      z1: 48,
      shadow: { alpha: 0.28 },
      boxes: [base, plate, ...posts, part, bar, head, frame, spoolHub, spoolCore],
      post: (ctx, ox, oy) => {
        // glass enclosure: a faint cyan veil and a soft highlight over the two visible faces
        for (const sd of ['n', 'w'] as const) {
          const q = boxPlane(ctx, ox, oy, { x: 0.1, y: 0.1, z: 9, w: 0.8, d: 0.8 }, sd);
          const W = 26;
          q.rect(1, W, 1, 30, 'rgba(150,215,235,0.16)');
          q.line(4, 4, 14, 26, 'rgba(255,255,255,0.35)');
          q.line(7, 4, 17, 26, 'rgba(255,255,255,0.18)');
        }
      },
    };
  },

  /** Banco de refeitorio sem encosto: tabua de madeira com travessas de metal; varios lado a lado parecem um banco corrido. */
  bench: () => {
    const H = 12;
    const seat = withDetail({ x: 0, y: 0.18, z: H - 3, w: 1, d: 0.64, h: 3, top: '#d9a96a', left: '#b98a52', right: '#946a3a' }, (ctx, ox, oy, b) => {
      paintTop(ctx, ox, oy, b.x, b.y + 0.03, b.x + b.w, b.y + b.d - 0.03, b.z + b.h, (_X, Y, px, py) => (Math.abs(Y * 8 - Math.round(Y * 8)) < 0.06 ? '#b98a52' : hash2(px, py, 21) < 0.04 ? '#e8c590' : null));
    });
    return {
      z1: H,
      shadow: { alpha: 0.22 },
      boxes: [
        { x: 0.08, y: 0.24, z: 0, w: 0.08, d: 0.52, h: H - 3, top: '#59606e', left: '#8f94a0', right: '#3a3f4c', noOutline: true },
        { x: 0.84, y: 0.24, z: 0, w: 0.08, d: 0.52, h: H - 3, top: '#59606e', left: '#8f94a0', right: '#3a3f4c', noOutline: true },
        seat,
      ],
    };
  },

  /** Mesa comprida de refeitorio: tampo de laminado claro com friso, pernas de metal e bandejas com comida. */
  long_table: (fw, fd, f) => {
    const alongX = fw >= fd;
    const L = alongX ? fw : fd;
    const S = alongX ? fd : fw;
    const mk = along(alongX);
    const H = 24;
    const top = withDetail(mk(0, L, 0.14, S - 0.14, H - 3, 3, '#efe9da', '#cdbf9c', '#a89a76'), (ctx, ox, oy, b) => {
      paintTop(ctx, ox, oy, b.x + 0.02, b.y + 0.02, b.x + b.w - 0.02, b.y + b.d - 0.02, b.z + b.h, (X, Y, px, py) => {
        const s = alongX ? Y - b.y : X - b.x;
        const span = alongX ? b.d : b.w;
        if (s < 0.06 || span - s < 0.06) return '#d8cdb0';
        return hash2(px, py, 22) < 0.035 ? '#e0d8c4' : null;
      });
    });
    const boxes: Box[] = [];
    for (const l of [0.14, L - 0.22]) for (const s of [0.2, S - 0.28]) boxes.push(mk(l, l + 0.08, s, s + 0.08, 0, H - 3, '#59606e', '#8f94a0', '#3a3f4c', { noOutline: true }));
    boxes.push(mk(0.14, L - 0.14, S / 2 - 0.03, S / 2 + 0.03, 4, 2, '#59606e', '#6b7280', '#3a3f4c', { noOutline: true }), top);
    const z = H;
    const FOOD = ['#d9473a', '#e8b73a', '#58b45f', '#a55a2a'] as const;
    const tray = (l: number, s: number, n: number) => {
      const c = FOOD[n % FOOD.length]!;
      boxes.push(mk(l, l + 0.4, s, s + 0.26, z, 1, '#8f94a0', '#6b7280', '#4a5060', { noOutline: true }));
      boxes.push(mk(l + 0.04, l + 0.2, s + 0.04, s + 0.22, z + 1, 1, '#f4f1ea', '#d9d4c4', '#a8a396', { noOutline: true }));
      boxes.push(mk(l + 0.08, l + 0.16, s + 0.08, s + 0.18, z + 2, 1, c, shade(c, -0.15), shade(c, -0.3), { noOutline: true }));
      boxes.push(mk(l + 0.26, l + 0.34, s + 0.1, s + 0.18, z + 1, 4, '#ffffff', '#e8e8e8', '#b8bcc6', { noOutline: true }));
    };
    const seed = Math.floor(hash2(f.x, f.y, 23) * 4);
    tray(0.1, 0.16, seed);
    if (L > 1.5) tray(L - 0.56, S - 0.42, seed + 1);
    return { z1: z + 6, shadow: { alpha: 0.28 }, boxes };
  },

  /** Balcao de self-service: inox com tres cubas (arroz, feijao e salada), protetor de vidro e pilha de bandejas. */
  buffet: (fw, fd, f) => {
    const alongX = fw >= fd;
    const side: 'n' | 'w' = alongX ? 'n' : 'w';
    const L = alongX ? fw : fd;
    const rear = ((f.dir % 4) + 4) % 4 >= 2;
    const mk = along(alongX);
    const H = 25;
    const carcass = withDetail(mk(0.02, L - 0.02, 0.1, 0.9, 0, H, '#c9ced8', '#aeb4c0', '#7d8594'), (ctx, ox, oy, b) => {
      const p = boxPlane(ctx, ox, oy, b, side);
      const W = Math.round((alongX ? b.w : b.d) * 32);
      const t = (c: string) => tone(side, c);
      if (rear) {
        p.rect(0, W, 0, H, t('#9aa0ac'));
        return;
      }
      p.rect(0, W, 0, H, t('#aeb4c0'));
      p.rect(0, W, H - 2, H, t('#e8ebf0'));
      p.rect(0, W, 0, 3, t('#59606e'));
      for (let a0 = 0; a0 < W; a0 += 32) {
        p.rect(a0, a0 + 1, 3, H - 2, t('#7d8594'));
        p.rect(a0 + 4, a0 + 29, 6, 17, t('#c9ced8'));
        p.rect(a0 + 4, a0 + 29, 16, 17, t('#eef1f6'));
        p.rect(a0 + 13, a0 + 20, 11, 12, t('#59606e'));
      }
    });
    const boxes: Box[] = [carcass];
    const FOOD: ReadonlyArray<readonly [string, string, string]> = [
      ['#f4f1e4', '#d8d3bf', '#a8a38e'],
      ['#6b4423', '#4e301a', '#38210f'],
      ['#58b45f', '#3f8a46', '#2c6232'],
    ];
    const cell = (L - 0.4) / 3;
    for (let i = 0; i < 3; i++) {
      const l0 = 0.2 + i * cell;
      boxes.push(mk(l0, l0 + cell - 0.08, 0.22, 0.78, H, 3, '#dfe3ea', '#aeb4c0', '#6b717e', { noOutline: true }));
      const [t0, t1, t2] = FOOD[i]!;
      boxes.push(mk(l0 + 0.04, l0 + cell - 0.12, 0.28, 0.72, H + 3, 2, t0, t1, t2, { noOutline: true }));
    }
    // sneeze guard: two glass posts and a slanted glass strip over the pans; a stack of trays at the near end
    boxes.push(mk(0.06, 0.1, 0.78, 0.82, H, 14, '#dfe3ea', '#aeb4c0', '#6b717e', { noOutline: true }), mk(L - 0.1, L - 0.06, 0.78, 0.82, H, 14, '#dfe3ea', '#aeb4c0', '#6b717e', { noOutline: true }));
    boxes.push(mk(0.06, L - 0.06, 0.74, 0.84, H + 12, 2, 'rgba(190,230,245,0.55)', 'rgba(150,200,220,0.5)', 'rgba(110,160,185,0.5)', { noOutline: true }));
    boxes.push(mk(L - 0.36, L - 0.14, 0.18, 0.46, H, 4, '#e0714f', '#c25b3a', '#9a4528', { noOutline: true }));
    void f;
    return { z1: H + 16, shadow: { alpha: 0.3 }, boxes };
  },

  /** Mesa de pebolim: campo verde, hastes com bonecos vermelhos e azuis; ao jogar (`on`) os bonecos giram e a bolinha anda. */
  foosball: (fw, fd, f, on) => {
    const alongX = fw >= fd;
    const L = alongX ? fw : fd;
    const mk = along(alongX);
    const H = 22;
    const body = withDetail(mk(0.04, L - 0.04, 0.1, 0.9, H - 6, 6, '#7a4a2a', '#5c3a1e', '#3e2713'), (ctx, ox, oy, b) => {
      paintTop(ctx, ox, oy, b.x + 0.06, b.y + 0.06, b.x + b.w - 0.06, b.y + b.d - 0.06, b.z + b.h, (X, Y, px, py) => {
        const l = alongX ? X - b.x : Y - b.y;
        if (Math.abs(l - (alongX ? b.w : b.d) / 2) < 0.02) return '#e8f5e0';
        return hash2(px, py, 31) < 0.1 ? '#3f9a52' : '#2f8445';
      });
    });
    const boxes: Box[] = [
      mk(0.12, 0.2, 0.2, 0.28, 0, H - 6, '#59606e', '#8f94a0', '#3a3f4c', { noOutline: true }),
      mk(L - 0.2, L - 0.12, 0.2, 0.28, 0, H - 6, '#59606e', '#8f94a0', '#3a3f4c', { noOutline: true }),
      mk(0.12, 0.2, 0.72, 0.8, 0, H - 6, '#59606e', '#8f94a0', '#3a3f4c', { noOutline: true }),
      mk(L - 0.2, L - 0.12, 0.72, 0.8, 0, H - 6, '#59606e', '#8f94a0', '#3a3f4c', { noOutline: true }),
      body,
      // low rim around the field
      mk(0.04, L - 0.04, 0.1, 0.16, H, 3, '#8a5a30', '#6b4423', '#4a2f17', { noOutline: true }),
      mk(0.04, L - 0.04, 0.84, 0.9, H, 3, '#8a5a30', '#6b4423', '#4a2f17', { noOutline: true }),
    ];
    const rods = [0.3, 0.55, 0.8, 1.05, 1.3, 1.55].filter((l) => l < L - 0.2);
    rods.forEach((l, i) => {
      const red = i % 2 === 0;
      const c = red ? '#d9473a' : '#3b82c4';
      boxes.push(mk(l, l + 0.04, 0.02, 0.98, H + 3, 1, '#c9ced8', '#8f94a0', '#59606e', { noOutline: true }));
      for (const s of i % 3 === 1 ? [0.3, 0.5, 0.7] : [0.36, 0.64]) {
        const sh = on ? (i % 2 === 0 ? 0.08 : -0.08) : 0;
        boxes.push(mk(l - 0.02, l + 0.06, s + sh - 0.04, s + sh + 0.04, H - 1, 6, shade(c, 0.2), c, shade(c, -0.3), { noOutline: true }));
      }
      boxes.push(mk(l - 0.02, l + 0.06, 0.0, 0.07, H + 2, 3, '#2b2f3a', '#3a3f4c', '#14161d', { noOutline: true }));
    });
    boxes.push(mk(L * (on ? 0.62 : 0.45), L * (on ? 0.62 : 0.45) + 0.06, 0.48, 0.54, H, 2, '#ffffff', '#e8e8e8', '#b8bcc6', { noOutline: true }));
    void f;
    return { z1: H + 8, shadow: { alpha: 0.3 }, boxes };
  },

  /** Mesa de ping-pong: tampo azul com linhas brancas, rede no meio, raquetes e bolinha; a bolinha pula ao jogar (`on`). */
  pingpong: (fw, fd, f, on) => {
    const alongX = fw >= fd;
    const L = alongX ? fw : fd;
    const S = alongX ? fd : fw;
    const mk = along(alongX);
    const H = 24;
    const top = withDetail(mk(0.04, L - 0.04, 0.06, S - 0.06, H - 2, 2, '#1f5aa6', '#16427a', '#0f2f58'), (ctx, ox, oy, b) => {
      paintTop(ctx, ox, oy, b.x + 0.03, b.y + 0.03, b.x + b.w - 0.03, b.y + b.d - 0.03, b.z + b.h, (X, Y, px, py) => {
        const l = alongX ? X - b.x : Y - b.y;
        const s = alongX ? Y - b.y : X - b.x;
        const ln = alongX ? b.w : b.d;
        const sn = alongX ? b.d : b.w;
        if (l < 0.05 || ln - l < 0.05 || s < 0.05 || sn - s < 0.05) return '#f4f6fa';
        if (Math.abs(s - sn / 2) < 0.025) return '#f4f6fa';
        return hash2(px, py, 32) < 0.04 ? '#2b6cc0' : null;
      });
    });
    const boxes: Box[] = [];
    for (const l of [0.3, L - 0.42]) for (const s of [0.24, S - 0.36]) boxes.push(mk(l, l + 0.12, s, s + 0.12, 0, H - 2, '#2b2f3a', '#59606e', '#14161d', { noOutline: true }));
    boxes.push(mk(0.3, L - 0.3, S / 2 - 0.03, S / 2 + 0.03, 6, 2, '#2b2f3a', '#3a3f4c', '#14161d', { noOutline: true }), top);
    // net across the middle of the length, posts at the sides
    const mid = L / 2;
    boxes.push(mk(mid - 0.02, mid + 0.02, 0.0, S, H, 6, 'rgba(255,255,255,0.8)', 'rgba(235,238,244,0.75)', 'rgba(190,196,210,0.7)', { noOutline: true }));
    boxes.push(mk(mid - 0.03, mid + 0.03, -0.0, 0.06, H, 7, '#c9ced8', '#8f94a0', '#59606e', { noOutline: true }), mk(mid - 0.03, mid + 0.03, S - 0.06, S, H, 7, '#c9ced8', '#8f94a0', '#59606e', { noOutline: true }));
    // two paddles resting on the table and the ball
    boxes.push(mk(0.3, 0.5, 0.3, 0.46, H, 1, '#d9473a', '#b13a30', '#8a2c25', { noOutline: true }), mk(L - 0.6, L - 0.4, S - 0.5, S - 0.34, H, 1, '#2b2f3a', '#1a1d26', '#0e1016', { noOutline: true }));
    const bl = on ? mid + 0.35 : 0.9;
    boxes.push(mk(bl, bl + 0.07, S * 0.5 - 0.03, S * 0.5 + 0.04, H + (on ? 7 : 0), 3, '#ffffff', '#e8e8e8', '#b8bcc6', { noOutline: true }));
    void f;
    return { z1: H + 12, shadow: { alpha: 0.3 }, boxes };
  },

  /** Fliperama: gabinete escuro com arte neon nas laterais, marquise, tela, joystick e botoes; a tela anima ao jogar (`on`). */
  arcade: (_fw, _fd, f, on) => {
    const side: 'n' | 'w' = f.dir % 2 === 0 ? 'w' : 'n';
    const rear = ((f.dir % 4) + 4) % 4 >= 2;
    const H = 62;
    const body = withDetail({ x: 0.14, y: 0.14, z: 0, w: 0.72, d: 0.72, h: H, top: '#2a1f4a', left: '#3b2a6a', right: '#1d1536' }, (ctx, ox, oy, b) => {
      const p = boxPlane(ctx, ox, oy, b, side);
      const W = Math.round((side === 'n' ? b.w : b.d) * 32);
      const t = (c: string) => tone(side, c);
      if (rear) {
        p.rect(0, W, 0, H, t('#1d1536'));
        return;
      }
      p.rect(0, W, 0, H, t('#2a1f4a'));
      p.rect(0, 2, 0, H, t('#ff3fb0'));
      p.rect(W - 2, W, 0, H, t('#35d8ff'));
      // marquee
      p.rect(2, W - 2, H - 9, H - 2, t('#14102a'));
      p.rect(3, W - 3, H - 8, H - 3, t('#7a2fd6'));
      p.rectFn(4, W - 4, H - 7, H - 4, (a, z) => ((a + z) % 4 === 0 ? t('#ffd45e') : null));
      // screen
      p.rect(3, W - 3, 28, H - 11, t('#06060f'));
      p.rect(4, W - 4, 29, H - 12, on ? t('#1a6cff') : t('#10204a'));
      const sh = on ? 5 : 0;
      p.rect(7 + sh, 11 + sh, 34, 37, t('#ffe27a'));
      p.rect(14 - sh, 17 - sh, 42, 45, t('#ff5f5f'));
      p.px(W - 9, 48, t('#58ff9a'));
      // control deck: joystick and buttons
      p.rect(1, W - 1, 22, 28, t('#14102a'));
      p.rect(7, 8, 24, 28, t('#c9ced8'));
      p.rect(6, 10, 28, 30, t('#d9473a'));
      for (const [a, c] of [[W - 13, '#ffd45e'], [W - 9, '#35d8ff'], [W - 5, '#58ff9a']] as const) p.rect(a, a + 2, 24, 26, t(c));
      // coin slot and lower panel
      p.rect(W / 2 - 3, W / 2 + 3, 12, 16, t('#0e0b1e'));
      p.rect(W / 2 - 1, W / 2 + 1, 13, 15, t('#ffd45e'));
    });
    return { z1: H + 1, shadow: { alpha: 0.3 }, boxes: [body, { x: 0.1, y: 0.1, z: H, w: 0.8, d: 0.8, h: 1, top: '#14102a', noOutline: true }] };
  },

  /** Guarda-corpo de vidro com colunas e corrimao de aco: corre pela borda do terraco (dir 0 sul, 1 leste, 2 norte, 3 oeste). */
  railing: (_fw, _fd, f) => {
    const dir = ((f.dir % 4) + 4) % 4;
    const alongX = dir % 2 === 0;
    const mk = along(alongX);
    // distance from the tile's near edge: the rail stands at the outer edge of the tile (south/east) or the inner edge (north/west)
    const s0 = dir === 0 || dir === 1 ? 0.84 : 0.08;
    const s1 = s0 + 0.08;
    const H = 34;
    const post = (l: number): Box => mk(l, l + 0.07, s0 - 0.01, s1 + 0.01, 0, H, '#dfe3ea', '#aeb4c0', '#6b717e', { noOutline: true });
    return {
      z1: H + 3,
      shadow: { alpha: 0.18 },
      boxes: [
        mk(0, 1, s0, s1, 0, 3, '#6b717e', '#8f94a0', '#4a5060', { noOutline: true }),
        mk(0.02, 0.98, s0 + 0.02, s1 - 0.02, 3, H - 4, 'rgba(170,225,245,0.34)', 'rgba(150,210,235,0.3)', 'rgba(120,175,205,0.3)', { noOutline: true }),
        post(0),
        post(0.93),
        mk(0, 1, s0 - 0.01, s1 + 0.01, H, 3, '#eef1f6', '#c9ced8', '#8f94a0'),
      ],
    };
  },

  /** Mesa redonda de jardim com guarda-sol listrado de vermelho e branco, presa a um mastro central. */
  parasol: () => ({
    z1: 74,
    shadow: { alpha: 0.26 },
    boxes: [
      { x: 0.3, y: 0.3, z: 0, w: 0.4, d: 0.4, h: 2, top: '#59606e', left: '#8f94a0', right: '#3a3f4c', noOutline: true },
      { x: 0.46, y: 0.46, z: 2, w: 0.08, d: 0.08, h: 58, top: '#e1e5ec', left: '#aeb4c0', right: '#6b717e', noOutline: true },
      withDetail({ x: 0.14, y: 0.14, z: 20, w: 0.72, d: 0.72, h: 3, top: '#f1ede4', left: '#cdbf9c', right: '#a89a76' }, (ctx, ox, oy, b) => {
        paintTop(ctx, ox, oy, b.x + 0.03, b.y + 0.03, b.x + b.w - 0.03, b.y + b.d - 0.03, b.z + b.h, (X, Y) => (Math.hypot(X - 0.5, Y - 0.5) > 0.3 ? '#d9d2bd' : null));
      }),
      { x: 0.34, y: 0.34, z: 23, w: 0.1, d: 0.1, h: 4, top: '#ffffff', left: '#e8e8e8', right: '#b8bcc6', noOutline: true },
      { x: 0.58, y: 0.5, z: 23, w: 0.1, d: 0.1, h: 3, top: '#f6d7a8', left: '#e5bd86', right: '#b88a54', noOutline: true },
      // canopy: wide striped slab under a smaller cap
      withDetail({ x: -0.18, y: -0.18, z: 58, w: 1.36, d: 1.36, h: 4, top: '#e8e2d6', left: '#d9473a', right: '#9a2f26' }, (ctx, ox, oy, b) => {
        paintTop(ctx, ox, oy, b.x, b.y, b.x + b.w, b.y + b.d, b.z + b.h, (X, Y) => (Math.floor((X + Y) * 5) % 2 === 0 ? '#d9473a' : '#f4efe4'));
        for (const sd of ['n', 'w'] as const) {
          const q = boxPlane(ctx, ox, oy, b, sd);
          const W = Math.round((sd === 'n' ? b.w : b.d) * 32);
          for (let a = 0; a < W; a++) q.rect(a, a + 1, 0, 4, Math.floor(a / 6) % 2 === 0 ? (sd === 'n' ? '#d9473a' : '#9a2f26') : sd === 'n' ? '#f4efe4' : '#cfc8b8');
        }
      }),
      { x: 0.1, y: 0.1, z: 62, w: 0.8, d: 0.8, h: 4, top: '#f4efe4', left: '#e8e2d6', right: '#b8b2a2', noOutline: true },
      { x: 0.42, y: 0.42, z: 66, w: 0.16, d: 0.16, h: 6, top: '#ffd45e', left: '#e0b43a', right: '#a8821f', noOutline: true },
    ],
  }),

  /** Mini-jardim: canteiro de madeira com terra, grama, flores coloridas e pedras. */
  garden_bed: (fw, fd, f) => {
    const alongX = fw >= fd;
    const L = alongX ? fw : fd;
    const mk = along(alongX);
    const H = 9;
    const frame = mk(0.02, L - 0.02, 0.14, 0.86, 0, H, '#8a5a30', '#6b4423', '#4a2f17');
    const soil = withDetail(mk(0.08, L - 0.08, 0.2, 0.8, H, 1, '#5c3a1e', '#4a2f17', '#38210f', { noOutline: true }), (ctx, ox, oy, b) => {
      paintTop(ctx, ox, oy, b.x, b.y, b.x + b.w, b.y + b.d, b.z + b.h, (X, Y, px, py) => (hash2(px, py, 41) < 0.55 ? '#4cad57' : hash2(px, py, 42) < 0.5 ? '#3a8a46' : '#2f7a3c'));
    });
    const boxes: Box[] = [frame, soil];
    // stones and flower heads
    boxes.push(mk(0.3, 0.42, 0.62, 0.74, H + 1, 3, '#c9ced8', '#aeb4c0', '#7d8594', { noOutline: true }));
    const cols = ['#ff6fa8', '#ffd45e', '#ffffff', '#b78cff', '#ff8a3a'] as const;
    return {
      z1: H + 18,
      shadow: { alpha: 0.24 },
      boxes,
      post: (ctx, ox, oy) => {
        const n = Math.round(L * 3);
        for (let i = 0; i < n; i++) {
          const l = 0.18 + ((i + 0.5) / n) * (L - 0.36);
          const s = 0.34 + hash2(i, f.x + f.y, 43) * 0.3;
          const [cx, cy] = project(ox, oy, alongX ? l : s, alongX ? s : l, H + 1);
          const h = 5 + Math.floor(hash2(i, f.x, 44) * 8);
          ctx.fillStyle = '#2f7a3c';
          ctx.fillRect(cx, cy - h, 1, h);
          blob(ctx, cx, cy - h - 1, 2, 2, ['#97e583', '#58bc60', '#3b9150', '#2a6a3e']);
          const c = cols[i % cols.length]!;
          ctx.fillStyle = c;
          ctx.fillRect(cx - 1, cy - h - 4, 3, 3);
          ctx.fillStyle = '#ffe27a';
          ctx.fillRect(cx, cy - h - 3, 1, 1);
        }
      },
    };
  },

  /** Estante alta de biblioteca: cinco prateleiras cheias de livros de cores variadas, coroada por uma moldura de madeira. */
  tall_shelf: (fw, fd, f) => {
    const alongX = fw >= fd;
    const side: 'n' | 'w' = alongX ? 'n' : 'w';
    const L = alongX ? fw : fd;
    const rear = ((f.dir % 4) + 4) % 4 >= 2;
    const mk = along(alongX);
    const H = 90;
    const carcass = withDetail(mk(0.02, L - 0.02, 0.1, 0.72, 0, H, '#7a4d27', '#8a5a30', '#4a2f17'), (ctx, ox, oy, b) => {
      const p = boxPlane(ctx, ox, oy, b, side);
      const W = Math.round((alongX ? b.w : b.d) * 32);
      const t = (c: string) => tone(side, c);
      p.rect(0, W, 0, H, t('#6b4423'));
      if (rear) return;
      p.rect(3, W - 3, 4, H - 5, t('#2b1a0e'));
      const covers = ['#d95d4a', '#e8b73a', '#4a8fd9', '#58b858', '#a55ad9', '#f4f1ea', '#e07a3a', '#3fb3b3', '#8a2f3f', '#2f5f8a'];
      for (let r = 0; r < 5; r++) {
        const z0 = 6 + r * 16;
        p.rect(3, W - 3, z0 - 2, z0, t('#a56e3b'));
        let a = 5;
        let n = 0;
        while (a < W - 7) {
          const w = 3 + Math.floor(hash2(n, r, 51) * 3);
          const h = 9 + Math.floor(hash2(n, r, 52) * 5);
          if (hash2(n, r, 53) < 0.07) {
            a += 3;
            n++;
            continue;
          }
          if (a + w > W - 5) break;
          const c = t(covers[Math.floor(hash2(n, r, 54) * covers.length)]!);
          p.rect(a, a + w, z0, z0 + h, c);
          p.rect(a, a + 1, z0, z0 + h, shade(c, 0.28));
          p.rect(a + w - 1, a + w, z0, z0 + h, shade(c, -0.3));
          p.rect(a, a + w, z0 + 3, z0 + 4, shade(c, -0.25));
          a += w;
          n++;
        }
      }
      p.rect(0, 2, 0, H, t('#8a5a30'));
      p.rect(W - 2, W, 0, H, t('#4a2f17'));
      p.rect(0, W, 0, 3, t('#4a2f17'));
    });
    return {
      z1: H + 4,
      shadow: { alpha: 0.3 },
      boxes: [carcass, mk(0, L, 0.06, 0.76, H, 4, '#c48a50', '#a56e3b', '#7a4d27')],
    };
  },

  /** Mesa redonda de podcast: tampo escuro de cantos cortados, quatro microfones em braco articulado com filtro anti-pop e fones. */
  podcast_table: (fw, fd) => {
    const H = 22;
    const top = (x0: number, y0: number, w: number, d: number): Box =>
      withDetail({ x: x0, y: y0, z: H, w, d, h: 3, top: '#3a2a22', left: '#2a1d17', right: '#1c130f' }, (ctx, ox, oy, b) => {
        paintTop(ctx, ox, oy, b.x, b.y, b.x + b.w, b.y + b.d, b.z + b.h, (X, Y, px, py) => (Math.hypot(X - fw / 2, Y - fd / 2) > 0.78 ? '#5a4234' : hash2(px, py, 61) < 0.05 ? '#4a362b' : null));
      });
    const boxes: Box[] = [
      { x: fw / 2 - 0.12, y: fd / 2 - 0.12, z: 0, w: 0.24, d: 0.24, h: H, top: '#2b2f3a', left: '#59606e', right: '#14161d', noOutline: true },
      { x: fw / 2 - 0.4, y: fd / 2 - 0.4, z: 0, w: 0.8, d: 0.8, h: 2, top: '#2b2f3a', left: '#3a3f4c', right: '#14161d', noOutline: true },
      top(0.12, 0.34, fw - 0.24, fd - 0.68),
      top(0.34, 0.12, fw - 0.68, fd - 0.24),
    ];
    const z = H + 3;
    // four mics on boom arms: base, arm, capsule with a translucent pop filter
    for (const [mx, my] of [[fw / 2, 0.36], [fw / 2, fd - 0.36], [0.36, fd / 2], [fw - 0.36, fd / 2]] as const) {
      boxes.push({ x: mx - 0.04, y: my - 0.04, z, w: 0.08, d: 0.08, h: 3, top: '#14161d', left: '#2b2f3a', right: '#0a0b10', noOutline: true });
      boxes.push({ x: mx - 0.02, y: my - 0.02, z: z + 3, w: 0.04, d: 0.04, h: 11, top: '#aeb4c0', left: '#8f94a0', right: '#59606e', noOutline: true });
      boxes.push({ x: mx - 0.07, y: my - 0.07, z: z + 13, w: 0.14, d: 0.14, h: 6, top: '#2b2f3a', left: '#1a1d26', right: '#0e1016', noOutline: true });
      boxes.push({ x: mx - 0.1, y: my - 0.1, z: z + 14, w: 0.2, d: 0.2, h: 5, top: 'rgba(210,225,240,0.35)', left: 'rgba(190,210,230,0.3)', right: 'rgba(150,170,195,0.3)', noOutline: true });
    }
    boxes.push({ x: fw / 2 - 0.14, y: fd / 2 - 0.1, z, w: 0.28, d: 0.2, h: 1, top: '#59606e', left: '#444a56', right: '#2f343e', noOutline: true });
    return { z1: z + 22, shadow: { alpha: 0.3 }, boxes };
  },

  /** Painel acustico de espuma: ondas/piramides em cinza-grafite e laranja sobre moldura escura. */
  acoustic_panel: (_fw, _fd, f) => ({
    boxes: [],
    z0: 36,
    z1: 88,
    shadow: null,
    post: onWall(f, (p, side) => {
      const dk = side === 'w' ? -0.1 : 0;
      const S = (c: string) => shade(c, dk);
      const A0 = 2;
      const A1 = 62;
      const Z0 = 38;
      const Z1 = 86;
      wallShadow(p, A0, A1, Z0, Z1);
      p.rect(A0, A1, Z0, Z1, S('#1a1d26'));
      for (let ci = 0; ci < 3; ci++) {
        const a0 = A0 + 2 + ci * 19;
        const col = ci === 1 ? ['#e0894a', '#c46e34', '#8f4a1e', '#5c2f12'] : ['#6b717e', '#4f5562', '#383d48', '#252932'];
        for (let cj = 0; cj < 3; cj++) {
          const z0 = Z0 + 2 + cj * 15;
          // one foam pyramid: four shaded wedges around the centre
          for (let a = 0; a < 17; a++) {
            for (let z = 0; z < 13; z++) {
              const u = a - 8;
              const v = z - 6;
              const lightSide = u + v < -2 ? 0 : u - v > 3 ? 3 : u + v > 2 ? 2 : 1;
              p.px(a0 + a, z0 + z, S(col[Math.abs(u) + Math.abs(v) > 9 ? 3 : u < 0 && v >= 0 ? 0 : v < 0 ? (u < 0 ? 1 : 2) : lightSide === 0 ? 1 : 2]!));
            }
          }
        }
      }
    }),
  }),

  /** Luz de NO AR: caixa preta com letras vermelhas; acesa (`on`) enquanto alguem fala ao microfone. */
  on_air: (_fw, _fd, f, on) => ({
    boxes: [],
    z0: 58,
    z1: 86,
    shadow: null,
    post: onWall(f, (p, side) => {
      const dk = side === 'w' ? -0.1 : 0;
      const S = (c: string) => shade(c, dk);
      const A0 = 6;
      const A1 = 58;
      const Z0 = 62;
      const Z1 = 82;
      wallShadow(p, A0, A1, Z0, Z1);
      p.rect(A0, A1, Z0, Z1, S('#14161d'));
      p.rect(A0, A1, Z1 - 1, Z1, S('#3a3f4c'));
      p.rect(A0 + 2, A1 - 2, Z0 + 2, Z1 - 3, on ? S('#6a0f14') : S('#2a1416'));
      if (on) {
        p.rect(A0 + 2, A1 - 2, Z0 + 2, Z0 + 3, S('#ff6a6a'));
        p.rect(A0 + 3, A1 - 3, Z0 + 3, Z1 - 4, S('#8f1a20'));
      }
      wallText(p, A0 + 10, Z0 + 6, 'NO AR', on ? S('#ffe9e9') : S('#5a2a2e'), 2, side === 'w');
      p.rect(A0 - 3, A0, Z0 + 8, Z0 + 12, S('#59606e'));
      p.rect(A1, A1 + 3, Z0 + 8, Z0 + 12, S('#59606e'));
    }),
  }),

  /** Camera de video em tripe: tres pernas abertas, cabeca com lente virada para a mesa (dir) e luz de gravacao. */
  camera_tripod: (_fw, _fd, f, on) => {
    const side: 'n' | 'w' = f.dir % 2 === 0 ? 'w' : 'n';
    const rear = ((f.dir % 4) + 4) % 4 >= 2;
    const body = withDetail({ x: 0.28, y: 0.3, z: 40, w: 0.44, d: 0.4, h: 14, top: '#3a3f4c', left: '#2b2f3a', right: '#14161d' }, (ctx, ox, oy, b) => {
      const p = boxPlane(ctx, ox, oy, b, side);
      const W = Math.round((side === 'n' ? b.w : b.d) * 32);
      if (rear) {
        p.rect(3, W - 3, 3, 11, tone(side, '#14161d'));
        p.px(W - 5, 10, on ? '#ff3b3b' : '#6a1a1a');
        return;
      }
      p.rect(W / 2 - 5, W / 2 + 5, 2, 12, tone(side, '#0a0b10'));
      p.rect(W / 2 - 3, W / 2 + 3, 4, 10, tone(side, '#1f3a6a'));
      p.px(W / 2 - 2, 10, tone(side, '#9fd2ff'));
      p.px(W - 4, 11, on ? '#ff3b3b' : '#6a1a1a');
    });
    const legs: Box[] = [
      { x: 0.2, y: 0.2, z: 0, w: 0.07, d: 0.07, h: 28, top: '#59606e', left: '#8f94a0', right: '#3a3f4c', noOutline: true },
      { x: 0.73, y: 0.2, z: 0, w: 0.07, d: 0.07, h: 28, top: '#59606e', left: '#8f94a0', right: '#3a3f4c', noOutline: true },
      { x: 0.46, y: 0.78, z: 0, w: 0.07, d: 0.07, h: 28, top: '#59606e', left: '#8f94a0', right: '#3a3f4c', noOutline: true },
    ];
    return {
      z1: 56,
      shadow: { alpha: 0.24 },
      boxes: [...legs, { x: 0.3, y: 0.3, z: 26, w: 0.4, d: 0.4, h: 3, top: '#2b2f3a', left: '#3a3f4c', right: '#14161d', noOutline: true }, { x: 0.45, y: 0.45, z: 29, w: 0.1, d: 0.1, h: 11, top: '#aeb4c0', left: '#8f94a0', right: '#59606e', noOutline: true }, body],
    };
  },

  /** Aparador de madeira escura com tampo de marmore, garrafas, tacas e um balde de gelo. */
  sideboard: (fw, fd, f) => {
    const alongX = fw >= fd;
    const side: 'n' | 'w' = alongX ? 'n' : 'w';
    const L = alongX ? fw : fd;
    const rear = ((f.dir % 4) + 4) % 4 >= 2;
    const mk = along(alongX);
    const WOOD = '#4a2c1a';
    const plinth = mk(0.05, L - 0.05, 0.14, 0.8, 0, 3, '#1a0f08', '#26160b', '#120a05', { noOutline: true });
    const carcass = withDetail(mk(0.02, L - 0.02, 0.1, 0.86, 3, 23, shade(WOOD, 0.1), WOOD, shade(WOOD, -0.3)), (ctx, ox, oy, b) => {
      const p = boxPlane(ctx, ox, oy, b, side);
      const W = Math.round((alongX ? b.w : b.d) * 32);
      const t = (c: string) => tone(side, c);
      if (rear) {
        p.rect(0, W, 0, 23, t(shade(WOOD, -0.12)));
        return;
      }
      for (let a0 = 0; a0 < W; a0 += 32) {
        const a1 = Math.min(W, a0 + 32);
        p.rect(a0, a0 + 1, 0, 23, t(shade(WOOD, -0.4)));
        p.rect(a0 + 3, a1 - 3, 3, 21, t(shade(WOOD, -0.12)));
        p.rect(a0 + 4, a1 - 4, 4, 20, t(shade(WOOD, 0.06)));
        p.rect(a0 + 4, a1 - 4, 19, 20, t(shade(WOOD, 0.22)));
        p.rect(a0 + 14, a0 + 18, 9, 15, t('#c9a24a'));
        p.rect(a0 + 14, a0 + 15, 9, 15, t('#f1d684'));
      }
    });
    const slab = mk(0, L, 0.06, 0.92, 26, 3, '#ece7dc', '#c9c3b4', '#9c9686');
    const z = 29;
    const boxes: Box[] = [plinth, carcass, slab];
    // bottles (green, amber, clear, red), glasses and an ice bucket
    const bottle = (l: number, s: number, h: number, c: string) => mk(l, l + 0.09, s, s + 0.09, z, h, shade(c, 0.2), c, shade(c, -0.3));
    boxes.push(bottle(0.14, 0.3, 13, '#2f7a4a'), bottle(0.3, 0.42, 11, '#a8651f'), bottle(0.44, 0.28, 14, '#cfe6ee'), bottle(0.58, 0.44, 10, '#9a2a2f'));
    boxes.push(mk(L * 0.62, L * 0.62 + 0.34, 0.3, 0.6, z, 6, '#cfd5df', '#9aa4b4', '#6b7384'));
    boxes.push(mk(L * 0.62 + 0.06, L * 0.62 + 0.14, 0.38, 0.46, z + 6, 9, '#2f7a4a', '#1f5a34', '#143c22', { noOutline: true }));
    for (let i = 0; i < 3; i++) boxes.push(mk(L - 0.68 + i * 0.16, L - 0.58 + i * 0.16, 0.38, 0.48, z, 5, '#e6f4fb', '#bfdcea', '#86a8bb', { noOutline: true }));
    return { z1: z + 14, shadow: { alpha: 0.3 }, boxes };
  },

  /** Quadro de avisos de cortica: moldura de madeira, papeis fixados com tachinhas, um cartaz com o titulo. */
  notice_board: (_fw, _fd, f) => ({
    boxes: [],
    z0: 44,
    z1: 80,
    shadow: null,
    post: onWall(f, (p, side) => {
      const dk = side === 'w' ? -0.1 : 0;
      const S = (c: string) => shade(c, dk);
      const A0 = 3;
      const A1 = 61;
      const Z0 = 47;
      const Z1 = 79;
      wallShadow(p, A0, A1, Z0, Z1);
      p.rect(A0, A1, Z0, Z1, S('#6b4423'));
      p.rect(A0, A1, Z1 - 1, Z1, S('#a56e3b'));
      p.rect(A0, A0 + 1, Z0, Z1, S('#8a5a30'));
      // cork with speckles
      p.rectFn(A0 + 2, A1 - 2, Z0 + 2, Z1 - 2, (a, z) => (hash2(a, z, 3) < 0.16 ? S('#b88a56') : hash2(a, z, 4) < 0.12 ? S('#d4a870') : S('#c89a62')));
      // title strip
      p.rect(A0 + 4, A0 + 30, Z1 - 9, Z1 - 4, S('#2f6f8f'));
      p.rect(A0 + 4, A0 + 30, Z1 - 5, Z1 - 4, S('#6fb7ea'));
      wallText(p, A0 + 6, Z1 - 8, 'AVISOS', S('#ffffff'), 1, side === 'w');
      // pinned papers
      const paper = (a: number, z: number, w: number, h: number, c: string, lines = true) => {
        p.rect(a + 1, a + w + 1, z - 1, z + h - 1, 'rgba(25,20,45,0.25)');
        p.rect(a, a + w, z, z + h, S(c));
        p.rect(a, a + w, z + h - 1, z + h, S(shade(c, 0.25)));
        if (lines) for (let r = 2; r < h - 2; r += 2) p.rect(a + 2, a + w - 2 - (r % 3), z + r, z + r + 1, S(shade(c, -0.28)));
        p.px(a + (w >> 1), z + h - 2, S('#d9473a'));
      };
      paper(A0 + 34, Z0 + 12, 11, 14, '#fffef6');
      paper(A0 + 46, Z0 + 9, 9, 12, '#ffe27a');
      paper(A0 + 6, Z0 + 4, 12, 9, '#9fe0a8');
      paper(A0 + 21, Z0 + 4, 10, 10, '#ff9fb4');
      paper(A0 + 33, Z0 + 3, 9, 8, '#9fd2ff', false);
      p.rect(A0 + 36, A0 + 40, Z0 + 5, Z0 + 7, S('#3b6bb3'));
    }),
  }),
};
