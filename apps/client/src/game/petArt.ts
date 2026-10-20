import { createCanvas } from './pixel';

/**
 * Arte do Byte, o gatinho-robo do escritorio: pixel art desenhada por codigo (sem arquivos). Cada quadro e montado num
 * buffer de pixels 32x32 (silhueta -> contorno automatico -> detalhes), em duas vistas (frente e costas; as direcoes
 * SE/NE sao o espelho de SW/NW, feito pelo flip do sprite) e seis posturas. A folha existe em duas versoes: LED normal e LED aceso
 * (a "batida de coracao" do autoping troca para a aceso por um instante).
 */

export const PET_FW = 32;
export const PET_FH = 32;
/** Ponto dos pes no quadro. */
export const PET_AX = 16;
export const PET_AY = 28;

export type PetPose = 'idle' | 'walk' | 'sit' | 'sleep' | 'happy' | 'eat';
export type PetSide = 'front' | 'back';

/** Quadros por postura (a vista de costas so tem parado, andando e sentado; as outras posturas usam a frente). */
export const PET_FRAMES: Record<PetSide, Partial<Record<PetPose, number>>> = {
  front: { idle: 3, walk: 4, sit: 3, sleep: 2, happy: 2, eat: 2 },
  back: { idle: 2, walk: 4, sit: 2 },
};
const ROWS: Array<[PetSide, PetPose]> = [
  ['front', 'idle'], ['front', 'walk'], ['front', 'sit'], ['front', 'sleep'], ['front', 'happy'], ['front', 'eat'],
  ['back', 'idle'], ['back', 'walk'], ['back', 'sit'],
];
const COLS = 4;

export const petFrameName = (side: PetSide, pose: PetPose, i: number) => `${side}:${pose}:${i}`;
export const hasBackPose = (pose: PetPose) => PET_FRAMES.back[pose] !== undefined;

// ---- paleta -------------------------------------------------------------------------------------------------
const OL = '#222a3f';
const B1 = '#8fa3bc';
const B2 = '#bccbde';
const B3 = '#687d99';
const B4 = '#52647f';
const PANEL = '#dbe5f0';
const LED = '#2fe0f8';
const LEDX = '#c9fdff';
const LEDD = '#1c8fa8';
const EYE = '#3af58c';
const EYEH = '#eafff2';
const EYED = '#14a85a';
const NOSE = '#ff8fb0';
const COLLAR = '#e4506a';
const COLLAR2 = '#b03650';
const TAG = '#ffd24a';
const TAGD = '#9a6a10';
const BLUSH = '#ff9fb4';
const TREAT = '#d99a4e';
const TREATD = '#a56a2c';

// ---- buffer de pixels -----------------------------------------------------------------------------------------

class Buf {
  readonly px = new Map<number, string>();
  set(x: number, y: number, c: string) {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= PET_FW || y >= PET_FH) return;
    this.px.set(y * PET_FW + x, c);
  }
  has(x: number, y: number) {
    return this.px.has(y * PET_FW + x);
  }
  rect(x: number, y: number, w: number, h: number, c: string) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c);
  }
  /** Linhas simetricas em torno do eixo 15.5 com as larguras dadas (pares). */
  rows(y: number, widths: number[], c: string, shift = 0) {
    widths.forEach((w, r) => {
      const x0 = 16 - Math.floor(w / 2) + shift;
      this.rect(x0, y + r, w, 1, c);
    });
  }
  /** Contorno de 1 px em volta de tudo o que foi desenhado. */
  outline(c: string) {
    const add: number[] = [];
    for (let y = -1; y <= PET_FH; y++) {
      for (let x = -1; x <= PET_FW; x++) {
        if (x >= 0 && y >= 0 && x < PET_FW && y < PET_FH && this.has(x, y)) continue;
        if (this.has(x - 1, y) || this.has(x + 1, y) || this.has(x, y - 1) || this.has(x, y + 1)) {
          if (x >= 0 && y >= 0 && x < PET_FW && y < PET_FH) add.push(y * PET_FW + x);
        }
      }
    }
    for (const k of add) this.px.set(k, c);
  }
  paint(ctx: CanvasRenderingContext2D, ox: number, oy: number) {
    for (const [k, c] of this.px) {
      ctx.fillStyle = c;
      ctx.fillRect(ox + (k % PET_FW), oy + Math.floor(k / PET_FW), 1, 1);
    }
  }
}

const mirror = (x: number) => 31 - x;
const both = (b: Buf, x: number, y: number, c: string) => {
  b.set(x, y, c);
  b.set(mirror(x), y, c);
};

interface Look {
  led: boolean;
  /** 0..1: fase da balancada da antena. */
  wag: number;
}

// ---- pecas -------------------------------------------------------------------------------------------------

/** Ponta da cauda com antena e LED. `x,y` = onde a haste comeca; `lean` inclina a antena. */
function antenna(b: Buf, x: number, y: number, lean: number, look: Look) {
  b.set(x, y, B4);
  b.set(x + lean, y - 1, B4);
  b.set(x + lean, y - 2, look.led ? LEDX : LED);
  if (look.led) {
    b.set(x + lean - 1, y - 2, LED);
    b.set(x + lean + 1, y - 2, LED);
    b.set(x + lean, y - 3, LED);
  }
}

function tailUp(b: Buf, look: Look, base: { x: number; y: number }) {
  const sway = look.wag > 0.5 ? 1 : 0;
  const seg: Array<[number, number]> = [
    [base.x, base.y],
    [base.x + 2, base.y - 1],
    [base.x + 3, base.y - 3],
    [base.x + 3, base.y - 5],
    [base.x + 2 + sway, base.y - 7],
  ];
  seg.forEach(([x, y], i) => b.rect(x, y, 2, 2, i % 2 === 0 ? B3 : B1));
  antenna(b, base.x + 2 + sway, base.y - 8, sway ? 1 : 0, look);
}

function headFront(b: Buf, hy: number, look: Look, face: 'open' | 'blink' | 'happy' | 'closed', mouth: 'none' | 'smile' | 'open' | 'chew') {
  const y0 = hy + 3;
  // orelhas (triangulos) com LED
  const earL: Array<[number, number]> = [[11, 1], [10, 3], [10, 4]];
  earL.forEach(([x, w], r) => {
    b.rect(x, hy + r, w, 1, B1);
    b.rect(mirror(x) - w + 1, hy + r, w, 1, B1);
  });
  // cabeca
  b.rows(y0, [10, 12, 14, 14, 14, 14, 14, 14, 13, 12, 10], B1);
  // luz no alto-esquerda, sombra embaixo-direita
  b.rect(10, y0 + 1, 4, 1, B2);
  b.rect(9, y0 + 2, 2, 3, B2);
  b.rect(mirror(9) - 0, y0 + 3, 1, 5, B3);
  b.rect(11, y0 + 10, 10, 1, B3);
  b.rect(10, y0 + 9, 2, 1, B3);
  b.rect(20, y0 + 9, 2, 1, B3);
  // mascara do rosto (painel claro)
  b.rows(y0 + 3, [12, 12, 12, 12, 10, 8, 6], PANEL);
  // LED das orelhas
  const led = look.led ? LEDX : LED;
  both(b, 11, hy + 1, led);
  both(b, 11, hy + 2, led);
  both(b, 12, hy + 2, look.led ? LED : LEDD);
  both(b, 11, hy + 3, look.led ? LED : LEDD);
  if (look.led) {
    both(b, 10, hy + 2, LED);
    both(b, 12, hy + 1, LED);
  }
  // olhos
  const ey = y0 + 4;
  if (face === 'open') {
    for (const x of [11, 19]) {
      b.rect(x, ey, 2, 3, EYE);
      b.set(x, ey, EYEH);
      b.set(x + 1, ey + 2, EYED);
    }
  } else if (face === 'blink' || face === 'closed') {
    for (const x of [11, 19]) b.rect(x, ey + 1, 2, 1, OL);
  } else {
    // feliz: ^ ^
    for (const x of [10, 19]) {
      b.set(x, ey + 2, EYE);
      b.set(x + 1, ey + 1, EYE);
      b.set(x + 2, ey + 2, EYE);
    }
    both(b, 9, y0 + 7, BLUSH);
    both(b, 10, y0 + 7, BLUSH);
  }
  // nariz e boca
  b.rect(15, y0 + 6, 2, 1, NOSE);
  if (mouth === 'smile') {
    b.set(14, y0 + 7, OL);
    b.set(17, y0 + 7, OL);
    b.rect(15, y0 + 8, 2, 1, OL);
  } else if (mouth === 'open') {
    b.rect(15, y0 + 7, 2, 2, OL);
    b.set(15, y0 + 8, NOSE);
  } else if (mouth === 'chew') {
    b.set(14, y0 + 7, OL);
    b.set(17, y0 + 7, OL);
    b.rect(15, y0 + 8, 2, 1, OL);
  } else {
    b.set(15, y0 + 7, OL);
    b.set(16, y0 + 7, OL);
  }
  // bigodes
  b.set(7, y0 + 6, B3);
  b.set(8, y0 + 6, B3);
  b.set(23, y0 + 6, B3);
  b.set(24, y0 + 6, B3);
}

function headBack(b: Buf, hy: number, look: Look) {
  const y0 = hy + 3;
  const earL: Array<[number, number]> = [[11, 1], [10, 3], [10, 4]];
  earL.forEach(([x, w], r) => {
    b.rect(x, hy + r, w, 1, B1);
    b.rect(mirror(x) - w + 1, hy + r, w, 1, B1);
  });
  b.rows(y0, [10, 12, 14, 14, 14, 14, 14, 14, 13, 12, 10], B1);
  b.rect(10, y0 + 1, 4, 1, B2);
  b.rect(9, y0 + 2, 2, 3, B2);
  b.rect(mirror(9), y0 + 3, 1, 5, B3);
  b.rect(11, y0 + 10, 10, 1, B3);
  // costura central e entrada da antena
  b.rect(15, y0 + 1, 2, 3, B3);
  b.rect(15, y0 + 1, 2, 1, B4);
  b.rect(13, y0 + 6, 6, 1, B3);
  // LED nas costas das orelhas
  both(b, 11, hy + 2, look.led ? LEDX : LED);
  both(b, 11, hy + 1, look.led ? LED : LEDD);
  if (look.led) both(b, 12, hy + 2, LED);
}

function torsoFront(b: Buf, ty: number) {
  b.rows(ty, [10, 12, 12, 12, 12, 12, 11, 10], B1);
  b.rect(11, ty + 1, 2, 4, B2);
  b.rect(mirror(11) - 0, ty + 2, 1, 5, B3);
  b.rect(12, ty + 7, 8, 1, B3);
  // peitinho claro
  b.rows(ty + 2, [6, 6, 6, 6, 4], PANEL);
}

function torsoBack(b: Buf, ty: number) {
  b.rows(ty, [10, 12, 12, 12, 12, 12, 11, 10], B1);
  b.rect(11, ty + 1, 2, 4, B2);
  b.rect(mirror(11) - 0, ty + 2, 1, 5, B3);
  b.rect(12, ty + 7, 8, 1, B3);
  // tampa de manutencao
  b.rect(13, ty + 2, 6, 4, B3);
  b.rect(14, ty + 3, 4, 2, B4);
  b.set(15, ty + 3, LEDD);
}

function collar(b: Buf, y: number, side: PetSide, plate: boolean) {
  b.rect(11, y, 10, 1, COLLAR);
  b.rect(11, y + 1, 10, 1, COLLAR2);
  if (side === 'front' && plate) {
    // plaquinha "BYTE": placa dourada com um B em pixels
    b.rect(14, y + 2, 5, 7, TAG);
    b.rect(14, y + 8, 5, 1, TAGD);
    const B = ['##.', '#.#', '##.', '#.#', '##.'];
    B.forEach((row, r) => [...row].forEach((ch, c) => ch === '#' && b.set(15 + c, y + 3 + r, TAGD)));
    b.set(14, y + 2, '#fff1a8');
  }
}

type LegPose = 'down' | 'up';
type Legs = [LegPose, LegPose, LegPose, LegPose];
/** Pernas (frente-esq, frente-dir, tras-esq, tras-dir) em cada quadro da caminhada. */
const WALK_LEGS: Legs[] = [['up', 'down', 'down', 'up'], ['down', 'down', 'down', 'down'], ['down', 'up', 'up', 'down'], ['down', 'down', 'down', 'down']];
function legsFront(b: Buf, ly: number, fl: LegPose, fr: LegPose, bl: LegPose, br: LegPose) {
  // pernas de tras (mais escuras)
  const hindL = bl === 'down' ? 3 : 1;
  const hindR = br === 'down' ? 3 : 1;
  b.rect(10, ly, 2, hindL, B3);
  b.rect(20, ly, 2, hindR, B3);
  const frL = fl === 'down' ? 4 : 2;
  const frR = fr === 'down' ? 4 : 2;
  b.rect(12, ly, 2, frL, B1);
  b.rect(18, ly, 2, frR, B1);
  b.rect(12, ly + frL - 1, 2, 1, PANEL);
  b.rect(18, ly + frR - 1, 2, 1, PANEL);
  b.set(12, ly, B2);
  b.set(19, ly + 1, B3);
}

function legsBack(b: Buf, ly: number, l: LegPose, r: LegPose) {
  const lh = l === 'down' ? 4 : 2;
  const rh = r === 'down' ? 4 : 2;
  b.rect(12, ly, 3, lh, B1);
  b.rect(17, ly, 3, rh, B1);
  b.rect(12, ly + lh - 1, 3, 1, B3);
  b.rect(17, ly + rh - 1, 3, 1, B3);
}

// ---- posturas ---------------------------------------------------------------------------------------------

function drawFront(b: Buf, pose: PetPose, i: number, look: Look): void {
  const HY = 4;
  if (pose === 'idle' || pose === 'walk' || pose === 'happy' || pose === 'eat') {
    let dy = 0;
    let legs: Legs = ['down', 'down', 'down', 'down'];
    let face: 'open' | 'blink' | 'happy' | 'closed' = 'open';
    let mouth: 'none' | 'smile' | 'open' | 'chew' = 'none';
    let headDy = 0;
    if (pose === 'idle') {
      headDy = i === 1 ? 1 : 0;
      if (i === 2) face = 'blink';
    } else if (pose === 'walk') {
      dy = i === 1 || i === 3 ? 1 : 0;
      legs = WALK_LEGS[i]!;
      mouth = 'none';
    } else if (pose === 'happy') {
      dy = i === 0 ? -2 : 0;
      face = 'happy';
      mouth = 'smile';
      legs = i === 0 ? ['up', 'up', 'up', 'up'] : ['down', 'down', 'down', 'down'];
    } else {
      headDy = 2;
      face = i === 0 ? 'open' : 'closed';
      mouth = i === 0 ? 'open' : 'chew';
      dy = 1;
    }
    const ty = 16 + dy;
    const hy = HY + dy + headDy;
    tailUp(b, look, { x: 21, y: ty + 7 });
    legsFront(b, ty + 8, ...legs);
    torsoFront(b, ty);
    headFront(b, hy, look, face, mouth);
    collar(b, hy + 13, 'front', true);
    if (pose === 'eat') {
      // o petisco no chao (osso de biscoito), menor no segundo quadro
      const w = i === 0 ? 6 : 3;
      b.rect(13, 27, w, 2, TREAT);
      b.set(13, 27, TREATD);
      b.set(13 + w - 1, 28, TREATD);
    }
    return;
  }
  if (pose === 'sit') {
    const hy = 6 + (i === 1 ? 1 : 0);
    // cauda no chao em volta, antena para cima
    b.rect(21, 25, 7, 2, B3);
    b.rect(23, 25, 2, 2, B1);
    b.rect(27, 23, 2, 3, B1);
    antenna(b, 27, 22, look.wag > 0.5 ? 1 : 0, look);
    // corpo sentado (mais alto e largo embaixo) + patas
    b.rows(18, [10, 12, 14, 14, 14, 14, 12, 10], B1);
    b.rect(10, 20, 2, 4, B2);
    b.rect(21, 21, 1, 5, B3);
    b.rows(20, [6, 6, 6, 6, 4], PANEL);
    b.rect(12, 26, 3, 2, PANEL);
    b.rect(17, 26, 3, 2, PANEL);
    b.rect(9, 25, 3, 3, B3);
    b.rect(20, 25, 3, 3, B3);
    headFront(b, hy - 2, look, i === 2 ? 'blink' : 'open', 'none');
    collar(b, hy - 2 + 13, 'front', true);
    return;
  }
  // sleep: bolinha enrolada, cabeca apoiada nas patas
  const br = i === 1 ? 1 : 0;
  b.rows(17 - br, [10, 16, 20, 22, 22, 22, 20, 14], B1, 1);
  b.rect(8, 19 - br, 10, 1, B2);
  b.rect(8, 20 - br, 4, 2, B2);
  b.rect(22, 21 - br, 5, 5, B3);
  // cauda enrolada na frente com a antena apagada
  b.rect(18, 26, 10, 2, B3);
  b.rect(21, 26, 2, 2, B1);
  b.rect(26, 24, 2, 3, B1);
  b.set(27, 23, B4);
  b.set(27, 22, LEDD);
  // cabeca baixa a esquerda
  const hx = -2;
  const hy = 17 - br;
  b.rect(8 + hx + 2, hy, 3, 1, B1);
  b.rect(17 + hx - 1, hy, 3, 1, B1);
  b.rows(hy + 1, [10, 12, 14, 14, 14, 12, 10], B1, hx);
  b.rect(9, hy + 2, 2, 2, B2);
  b.rows(hy + 3, [12, 12, 10, 8], PANEL, hx);
  b.set(8 + 0, hy - 1, B1);
  // LEDs das orelhas apagadinhos
  b.set(10 + hx + 1, hy, LEDD);
  b.set(18 + hx, hy, LEDD);
  b.rect(10 + hx + 0, hy + 5, 3, 1, OL);
  b.rect(16 + hx + 0, hy + 5, 3, 1, OL);
  b.rect(14 + hx + 0, hy + 7, 2, 1, NOSE);
  // coleirinha (so a faixa, a placa fica de lado)
  b.rect(8 + hx + 4, hy + 8, 10, 1, COLLAR);
  b.rect(16 + hx, hy + 9, 4, 3, TAG);
  b.rect(16 + hx, hy + 11, 4, 1, TAGD);
}

function drawBack(b: Buf, pose: PetPose, i: number, look: Look): void {
  if (pose === 'sit') {
    const hy = 6 + (i === 1 ? 1 : 0);
    // antena a partir do rabo, no centro
    b.rect(15, 26, 2, 2, B3);
    b.rect(17, 25, 3, 2, B1);
    b.rect(20, 23, 2, 3, B3);
    antenna(b, 21, 22, look.wag > 0.5 ? 1 : 0, look);
    b.rows(18, [10, 12, 14, 14, 14, 14, 12, 10], B1);
    b.rect(10, 20, 2, 4, B2);
    b.rect(21, 21, 1, 5, B3);
    b.rect(13, 21, 6, 3, B3);
    b.rect(9, 25, 3, 3, B3);
    b.rect(20, 25, 3, 3, B3);
    b.rect(13, 26, 6, 2, B1);
    headBack(b, hy - 2, look);
    collar(b, hy - 2 + 13, 'back', false);
    return;
  }
  let dy = 0;
  let l: LegPose = 'down';
  let r: LegPose = 'down';
  let headDy = 0;
  if (pose === 'walk') {
    dy = i === 1 || i === 3 ? 1 : 0;
    l = i === 0 ? 'up' : 'down';
    r = i === 2 ? 'up' : 'down';
  } else headDy = i === 1 ? 1 : 0;
  const ty = 16 + dy;
  tailUp(b, look, { x: 21, y: ty + 7 });
  legsBack(b, ty + 8, l, r);
  torsoBack(b, ty);
  headBack(b, 4 + dy + headDy, look);
  collar(b, 4 + dy + headDy + 13, 'back', false);
}

/** Desenha um quadro no contexto, no canto (ox, oy) da folha. */
export function drawPetFrame(ctx: CanvasRenderingContext2D, ox: number, oy: number, side: PetSide, pose: PetPose, i: number, led: boolean) {
  const b = new Buf();
  const look: Look = { led, wag: pose === 'happy' ? i : pose === 'walk' ? (i % 2) : i === 1 ? 1 : 0 };
  if (side === 'front') drawFront(b, pose, i, look);
  else drawBack(b, pose, i, look);
  b.outline(OL);
  b.paint(ctx, ox, oy);
}

/** A folha completa (todas as vistas/posturas/quadros) numa grade de COLS colunas. */
export function buildPetSheet(led: boolean): { canvas: HTMLCanvasElement; frames: Array<{ name: string; x: number; y: number }> } {
  const rows: Array<{ side: PetSide; pose: PetPose; n: number }> = ROWS.map(([side, pose]) => ({ side, pose, n: PET_FRAMES[side][pose]! }));
  const cells = rows.reduce((a, r) => a + r.n, 0);
  const total = Math.ceil(cells / COLS);
  const { canvas, ctx } = createCanvas(COLS * PET_FW, total * PET_FH);
  const frames: Array<{ name: string; x: number; y: number }> = [];
  let k = 0;
  for (const r of rows) {
    for (let i = 0; i < r.n; i++, k++) {
      const x = (k % COLS) * PET_FW;
      const y = Math.floor(k / COLS) * PET_FH;
      drawPetFrame(ctx, x, y, r.side, r.pose, i, led);
      frames.push({ name: petFrameName(r.side, r.pose, i), x, y });
    }
  }
  return { canvas, frames };
}

// ---- icones pequenos (coracoes, Z, ...) -----------------------------------------------------------------------------

const HEART = ['..oo.oo..', '.orrorro.', 'orRrrrrro', 'orrrrrrro', '.orrrrro.', '..orrro..', '...oro...', '....o....'];

function fromRows(rows: string[], pal: Record<string, string>) {
  const { canvas, ctx } = createCanvas(rows[0]!.length, rows.length);
  rows.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      const c = pal[ch];
      if (!c) return;
      ctx.fillStyle = c;
      ctx.fillRect(x, y, 1, 1);
    }),
  );
  return canvas;
}

export const PET_ICON_KEYS = { heart: 'pet:heart', beat: 'pet:beat', z: 'pet:z', spark: 'pet:spark' } as const;

/** Icones: coracao vermelho (carinho), coracao ciano (batida do autoping), Z (sono) e brilho. */
export function buildPetIcons(): Record<keyof typeof PET_ICON_KEYS, HTMLCanvasElement> {
  return {
    heart: fromRows(HEART, { o: '#7a1d3a', r: '#ff5c86', R: '#ffc0d2' }),
    beat: fromRows(HEART, { o: '#0c4a5c', r: '#2fe0f8', R: '#d8feff' }),
    z: fromRows(['.ooooooo.', 'ozzzzzzzo', 'oooooozo.', '.....ozo.', '....ozo..', '...ozo...', '..ozooooo', '.ozzzzzzo', '.ooooooo.'], { o: '#2a3c6b', z: '#dbe9ff' }),
    spark: fromRows(['..o..', '.owo.', 'owwwo', '.owo.', '..o..'], { o: '#0c4a5c', w: '#d8feff' }),
  };
}
