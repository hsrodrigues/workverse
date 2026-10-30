import Phaser from 'phaser';
import {
  DECOR_LIMITS,
  decorLevel,
  eventStack,
  newYearCountdown,
  newYearNumber,
  planEventDecor,
  slotRuns,
  spreadSlots,
  tileToScreen,
  type BuiltRoom,
  type EventDef,
  type EventId,
  type Furniture,
  type WallSlot,
} from '@workverse/shared';
import { Plane, createCanvas } from './pixel';
import { THEMES, renderFloor, renderWalls, windowGlass, windowSpots } from './roomArt';
import { dayState, effectiveHour } from './dayCycle';
import { currentEvents, onEventsChange } from '../eventsStore';
import * as A from './eventArt';

/**
 * Decoracao de eventos: camada VISUAL (o servidor nao sabe dela, nada bloqueia o movimento). Pecas de parede num canvas
 * por cima da parede; objetos de chao como sprites ordenados em profundidade com os avatares e moveis; brilhos aditivos.
 * Onde pode ir vem de `planEventDecor` (shared/eventLayout.ts).
 *
 * Luz: a decoracao tem circuito proprio ("luz de festa"): as luzinhas e o brilho NAO apagam com o interruptor de teto;
 * ficam mais fortes quando a sala esta escura (noite ou interruptor desligado) e suaves de dia. O tint do evento e
 * multiplicado sobre a cena e acompanha o ciclo dia/noite.
 * Densidade: 3 niveis por sala (recepcao/escritorio = 3, salas medias = 2, pequenas = 1). Com dois eventos ao mesmo tempo
 * o de maior prioridade desenha a peca assinatura (um nivel mais enxuto) e o outro so reforca com bandeirolas.
 * Movimento: tudo respeita `prefers-reduced-motion` (quadro unico, sem particulas nem efeitos de janela animados).
 */

const TINT_DEPTH = 900_000.5;
const GLOW_DEPTH = 900_002;
const PARTICLE_DEPTH = 899_990;
const WALL_ART_DEPTH = 1.2;
const FIREWORK_DEPTH = 0.7;

const reducedMotion = (): boolean => {
  try {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
};

interface Sortable {
  box(): { x0: number; y0: number; x1: number; y1: number; z0: number; z1: number };
  setDepth(d: number): void;
}

interface PropSpec {
  id: string;
  frames: Array<() => A.Prop>;
  /** Intervalo de troca de quadro (ms). */
  every?: number;
  glow?: { rgb: readonly [number, number, number]; size: number; dy: number; base: number; flicker?: number };
}

type WinFx = 'snow' | 'moon' | 'lanterns' | 'confetti' | 'butterflies' | 'fireworks' | 'hearts' | 'kites';

interface Recipe {
  /** [0] = peca assinatura (grande); as demais se repetem como apoio. */
  props: PropSpec[];
  /** Assinatura reduzida para salas pequenas (nivel 1). */
  mini?: PropSpec;
  bunting?: { shape: A.BuntingShape; cols: string[] };
  /** Guirlanda continua com luzinhas que piscam em bandas. */
  garland?: { cols: string[] };
  banner?: string[];
  items?: Array<(p: Plane, a: number, z: number, def: EventDef, i: number) => void>;
  itemMax?: number;
  web?: boolean;
  streamers?: boolean;
  confetti?: string[];
  /** Particulas caindo pela sala (niveis 2 e 3). */
  particles?: { cols: string[]; snow?: boolean };
  windowFx?: WinFx;
  clock?: boolean;
  bats?: boolean;
  /** Cabos de rede/fibra pendurados no alto da parede (por baixo da faixa). */
  fiber?: boolean;
  /** Nebulosa e estrelas no vidro das janelas. */
  space?: boolean;
  /** Salas principais do evento: decoração mais rica (mais objetos de chão e de parede). */
  rich?: Record<string, { maxProps: number; itemMax: number }>;
}

const BALLOONS = (cols: string[], seed: number): PropSpec => ({ id: `balloons:${cols.join('')}`, frames: [() => A.balloonsProp(cols, seed)] });

const recipes = (def: EventDef): Recipe | null => {
  switch (def.id as EventId) {
    case 'halloween':
      return {
        props: [
          { id: 'jack-big', frames: [() => A.jackBigProp(0), () => A.jackBigProp(1)], every: 260, glow: { rgb: [255, 150, 40], size: 120, dy: -34, base: 0.95, flicker: 0.3 } },
          { id: 'cauldron', frames: [() => A.cauldronProp(0), () => A.cauldronProp(1)], every: 520, glow: { rgb: [110, 255, 90], size: 60, dy: -30, base: 0.5, flicker: 0.2 } },
          { id: 'tomb', frames: [() => A.tombProp()] },
          { id: 'ghost', frames: [() => A.ghostProp(0), () => A.ghostProp(1)], every: 700 },
          { id: 'pumpkin0', frames: [() => A.pumpkinProp(0)], glow: { rgb: [255, 150, 40], size: 70, dy: -14, base: 0.8, flicker: 0.25 } },
          { id: 'pumpkin1', frames: [() => A.pumpkinProp(1)], glow: { rgb: [255, 150, 40], size: 56, dy: -10, base: 0.8, flicker: 0.25 } },
        ],
        mini: { id: 'pumpkin2', frames: [() => A.pumpkinProp(2)], glow: { rgb: [255, 150, 40], size: 70, dy: -14, base: 0.9, flicker: 0.25 } },
        bunting: { shape: 'flag', cols: ['#ff8a1f', '#6a3d9a', '#1c1226', '#b6f23a'] },
        banner: ['FELIZ HALLOWEEN', 'HALLOWEEN'],
        web: true,
        bats: true,
        windowFx: 'moon',
        items: [(p, a, z) => A.bat(p, a - 6, z + 40), (p, a, z) => A.bat(p, a - 6, z + 28)],
        itemMax: 4,
      };
    case 'natal':
      return {
        props: [
          { id: 'tree-big', frames: [() => A.treeBigProp(0), () => A.treeBigProp(1)], every: 550, glow: { rgb: [255, 214, 120], size: 110, dy: -62, base: 0.5, flicker: 0.12 } },
          { id: 'snowman', frames: [() => A.snowmanProp()] },
          { id: 'gifts-red', frames: [() => A.giftPileProp('#d03a3a', '#2f8f4e', '#3a8fd0')] },
          { id: 'gifts-gold', frames: [() => A.giftPileProp('#2f8f4e', '#d03a3a', '#f2c230')] },
        ],
        mini: { id: 'tree0', frames: [() => A.treeProp(0), () => A.treeProp(1)], every: 650, glow: { rgb: [255, 214, 120], size: 90, dy: -34, base: 0.55, flicker: 0.15 } },
        garland: { cols: ['#ff4a4a', '#ffd95a', '#4aa8ff', '#ff9ccf'] },
        banner: ['FELIZ NATAL', 'NATAL'],
        items: [(p, a, z) => A.wreath(p, a, z + 62, '#d03a3a'), (p, a, z) => A.stocking(p, a - 2, z + 46), (p, a, z) => A.star5(p, a, z + 56, '#ffd95a')],
        itemMax: 5,
        particles: { cols: ['#ffffff', '#dfe9f5'], snow: true },
        windowFx: 'snow',
      };
    case 'carnaval':
      return {
        props: [
          { id: 'mask-big', frames: [() => A.maskBigProp(0), () => A.maskBigProp(1)], every: 420, glow: { rgb: [255, 220, 90], size: 100, dy: -80, base: 0.45, flicker: 0.1 } },
          { id: 'drum', frames: [() => A.drumProp()] },
          BALLOONS(['#ffcf1f', '#1fbf6a', '#e83c8a', '#3a8fd0'], 3),
          BALLOONS(['#e83c8a', '#ffcf1f', '#7a5af0'], 8),
        ],
        mini: BALLOONS(['#ffcf1f', '#1fbf6a', '#e83c8a', '#3a8fd0'], 3),
        bunting: { shape: 'flag', cols: ['#ffcf1f', '#1fbf6a', '#e83c8a', '#3a8fd0', '#ff7a1f'] },
        banner: ['CARNAVAL', 'FOLIA'],
        streamers: true,
        windowFx: 'confetti',
        items: [(p, a, z, _d, i) => A.mask(p, a, z + 50, i % 2 ? '#e83c8a' : '#7a5af0', i % 2 ? '#ffcf1f' : '#1fbf6a')],
        itemMax: 4,
        confetti: ['#ffcf1f', '#1fbf6a', '#e83c8a', '#3a8fd0', '#ff7a1f'],
        particles: { cols: ['#ffcf1f', '#1fbf6a', '#e83c8a', '#3a8fd0', '#ff7a1f'] },
      };
    case 'anonovo': {
      const yr = newYearNumber(new Date());
      return {
        props: [
          { id: `arch${yr}`, frames: [0, 1, 2, 3].map((f) => () => A.balloonArchProp(f, yr)), every: 520, glow: { rgb: [255, 232, 150], size: 130, dy: -70, base: 0.4, flicker: 0.1 } },
          { id: 'champagne', frames: [() => A.champagneProp(0), () => A.champagneProp(1)], every: 600 },
          { id: 'gifts-gold2', frames: [() => A.giftPileProp('#f4d35e', '#c9d6e8', '#7aa8ff')] },
          BALLOONS(['#c9d6e8', '#f4d35e', '#ffffff'], 6),
        ],
        mini: BALLOONS(['#f4d35e', '#c9d6e8', '#7aa8ff'], 1),
        bunting: { shape: 'star', cols: ['#f4d35e', '#c9d6e8'] },
        banner: ['FELIZ ANO NOVO', 'ANO NOVO'],
        streamers: true,
        windowFx: 'fireworks',
        clock: true,
        items: [(p, a, z) => A.star5(p, a, z + 56, '#f4d35e')],
        itemMax: 3,
        confetti: ['#f4d35e', '#c9d6e8', '#7aa8ff'],
        particles: { cols: ['#f4d35e', '#c9d6e8', '#7aa8ff', '#ffffff'] },
      };
    }
    case 'pascoa':
      return {
        props: [
          { id: 'bunny-big', frames: [0, 0, 1, 0, 0, 2].map((f) => () => A.bunnyBigProp(f)), every: 380 },
          { id: 'chick', frames: [() => A.chickProp(0), () => A.chickProp(1)], every: 450 },
          { id: 'basket', frames: [() => A.eggBasketProp()] },
          { id: 'bunny', frames: [() => A.bunnyProp()] },
        ],
        mini: { id: 'bunny', frames: [() => A.bunnyProp()] },
        bunting: { shape: 'egg', cols: ['#ff9ccf', '#9be0ff', '#ffe27a', '#b9a0ff', '#9be0a0'] },
        banner: ['FELIZ PÁSCOA', 'PÁSCOA'],
        windowFx: 'butterflies',
        items: [(p, a, z, _d, i) => (i % 2 ? A.paperBunny(p, a, z + 48, '#f4f1ea') : A.bigEgg(p, a, z + 48, '#ff9ccf', '#9be0ff'))],
        itemMax: 4,
      };
    case 'junina':
      return {
        props: [
          { id: 'bonfire-big', frames: [0, 1, 2].map((f) => () => A.bonfireBigProp(f)), every: 150, glow: { rgb: [255, 150, 50], size: 140, dy: -34, base: 0.8, flicker: 0.3 } },
          { id: 'corn', frames: [() => A.cornProp()] },
          { id: 'hay', frames: [() => A.hayProp()] },
        ],
        mini: { id: 'bonfire', frames: [() => A.bonfireProp(0), () => A.bonfireProp(1), () => A.bonfireProp(2)], every: 170, glow: { rgb: [255, 150, 50], size: 110, dy: -16, base: 0.8, flicker: 0.3 } },
        bunting: { shape: 'flag', cols: ['#e8452c', '#f2c230', '#3a8fd0', '#2f8f4e', '#e83c8a'] },
        banner: ['FESTA JUNINA', 'ARRAIÁ'],
        windowFx: 'lanterns',
        items: [(p, a, z, _d, i) => A.lantern(p, a, z + 52, ['#e8452c', '#f2c230', '#3a8fd0'][i % 3]!)],
        itemMax: 4,
      };
    case 'namorados':
      return {
        props: [
          { id: 'rose-arch', frames: [() => A.roseArchProp(0), () => A.roseArchProp(1)], every: 700, glow: { rgb: [255, 130, 170], size: 110, dy: -70, base: 0.4, flicker: 0.1 } },
          { id: 'vase', frames: [() => A.vaseProp()] },
          { id: 'teddy', frames: [() => A.teddyProp()] },
          BALLOONS(['#ff4d7e', '#ffb3c7', '#e8344e'], 2),
          { id: 'gifts-love', frames: [() => A.giftPileProp('#ff4d7e', '#ffb3c7', '#e8344e')] },
        ],
        mini: { id: 'vase', frames: [() => A.vaseProp()] },
        bunting: { shape: 'heart', cols: ['#ff4d7e', '#ffb3c7', '#e8344e'] },
        banner: ['NAMORADOS', 'AMOR'],
        items: [(p, a, z, _d, i) => A.heart(p, a - 7, z + 52, i % 2 ? '#ffb3c7' : '#ff4d7e', 2)],
        itemMax: 4,
        confetti: ['#ff4d7e', '#ffb3c7'],
        particles: { cols: ['#ff4d7e', '#ffb3c7', '#ffffff'] },
        windowFx: 'hearts',
      };
    case 'criancas':
      return {
        props: [
          { id: 'block-tower', frames: [() => A.blockTowerProp(0), () => A.blockTowerProp(1)], every: 600, glow: { rgb: [255, 240, 150], size: 100, dy: -110, base: 0.35, flicker: 0.1 } },
          { id: 'teddy', frames: [() => A.teddyProp()] },
          BALLOONS(['#3aa0ff', '#ffcc2e', '#ff5d73', '#3ed08a'], 4),
          { id: 'gifts-kids', frames: [() => A.giftPileProp('#3aa0ff', '#ffcc2e', '#ff5d73')] },
        ],
        mini: BALLOONS(['#3aa0ff', '#ffcc2e', '#ff5d73', '#3ed08a'], 4),
        bunting: { shape: 'star', cols: ['#3aa0ff', '#ffcc2e', '#ff5d73', '#3ed08a'] },
        banner: ['DIA DAS CRIANÇAS', 'CRIANÇAS'],
        items: [(p, a, z, _d, i) => A.star5(p, a, z + 52, ['#ffcc2e', '#ff5d73', '#3aa0ff'][i % 3]!)],
        itemMax: 3,
        confetti: ['#3aa0ff', '#ffcc2e', '#ff5d73'],
        particles: { cols: ['#3aa0ff', '#ffcc2e', '#ff5d73', '#3ed08a'] },
        windowFx: 'kites',
      };
    case 'trabalho':
      return {
        props: [
          { id: 'gears-big', frames: [() => A.gearsBigProp()] },
          { id: 'toolbox', frames: [() => A.toolboxProp()] },
          BALLOONS(['#2f6fd0', '#f2c230', '#ffffff'], 7),
          { id: 'gifts-work', frames: [() => A.giftPileProp('#2f6fd0', '#f2c230', '#ffffff')] },
        ],
        mini: { id: 'toolbox', frames: [() => A.toolboxProp()] },
        bunting: { shape: 'flag', cols: ['#2f6fd0', '#f2c230', '#ffffff'] },
        banner: ['DIA DO TRABALHO', 'TRABALHO'],
        items: [(p, a, z) => A.gear(p, a, z + 54, '#2f6fd0')],
        itemMax: 3,
      };
    case 'aniversario':
      return {
        props: [
          { id: 'cake-big', frames: [0, 1, 2].map((f) => () => A.cakeBigProp(f)), every: 260, glow: { rgb: [255, 200, 110], size: 100, dy: -90, base: 0.55, flicker: 0.3 } },
          BALLOONS(['#7a5af0', '#ffc83d', '#ff6fa8'], 9),
          { id: 'gifts-bday', frames: [() => A.giftPileProp('#7a5af0', '#ffc83d', '#ff6fa8')] },
          BALLOONS(['#ffc83d', '#ff6fa8', '#7a5af0'], 2),
        ],
        mini: BALLOONS(['#7a5af0', '#ffc83d', '#ff6fa8'], 9),
        bunting: { shape: 'flag', cols: ['#7a5af0', '#ffc83d', '#ff6fa8'] },
        banner: ['PARABÉNS!', 'PARABÉNS'],
        streamers: true,
        windowFx: 'confetti',
        items: [(p, a, z) => A.star5(p, a, z + 54, '#ffc83d')],
        itemMax: 3,
        confetti: ['#7a5af0', '#ffc83d', '#ff6fa8'],
        particles: { cols: ['#7a5af0', '#ffc83d', '#ff6fa8', '#3ed08a'] },
      };
    case 'diati': {
      const NEON = ['#27d9ff', '#39ff88', '#2a6bff', '#ff5fb0'];
      return {
        props: [
          { id: 'holo-big', frames: [() => A.holoBigProp(0), () => A.holoBigProp(1)], every: 420, glow: { rgb: [60, 210, 255], size: 100, dy: -60, base: 0.32, flicker: 0.15 } },
          { id: 'robot0', frames: [() => A.robotProp(0, 0), () => A.robotProp(1, 0)], every: 700, glow: { rgb: [60, 220, 255], size: 50, dy: -26, base: 0.5, flicker: 0.1 } },
          { id: 'cake', frames: [() => A.cakeProp()], glow: { rgb: [255, 200, 120], size: 56, dy: -50, base: 0.55, flicker: 0.3 } },
          BALLOONS(NEON, 11),
          { id: 'tea', frames: [() => A.teaProp(0), () => A.teaProp(1)], every: 600 },
          { id: 'sign42', frames: [() => A.sign42Prop()], glow: { rgb: [57, 255, 136], size: 70, dy: -34, base: 0.55, flicker: 0.12 } },
          { id: 'robot1', frames: [() => A.robotProp(1, 1), () => A.robotProp(0, 1)], every: 800 },
          BALLOONS(['#39ff88', '#27d9ff', '#ffffff'], 5),
        ],
        banner: ['FELIZ DIA DO PROFISSIONAL DE TI', 'DIA DO PROFISSIONAL DE TI', 'FELIZ DIA DA TI', 'DIA DA TI'],
        fiber: true,
        space: true,
        items: [
          (p, a, z) => A.dontPanic(p, a, z),
          (p, a, z) => A.poster(p, a, z),
          (p, a, z) => A.plaque42(p, a, z),
          (p, a, z) => A.bridgePanel(p, a, z),
          (p, a, z) => A.towelHook(p, a, z),
          (p, a, z) => A.worksOnMine(p, a, z),
        ],
        itemMax: 5,
        mini: { id: 'holo', frames: [() => A.hologramProp(0), () => A.hologramProp(1)], every: 420, glow: { rgb: [60, 210, 255], size: 110, dy: -26, base: 0.75, flicker: 0.2 } },
        rich: { ti: { maxProps: 8, itemMax: 6 } },
        confetti: ['#27d9ff', '#39ff88', '#2a6bff'],
      };
    }
    case 'blackfriday':
      return {
        props: [
          { id: 'bf-sign', frames: [() => A.blackSignProp(0), () => A.blackSignProp(1)], every: 600, glow: { rgb: [255, 200, 80], size: 110, dy: -80, base: 0.4, flicker: 0.08 } },
          { id: 'gifts-bf', frames: [() => A.giftPileProp('#1c1c24', '#f0b429', '#3a3a48')] },
          BALLOONS(['#1c1c24', '#f0b429', '#ffffff'], 4),
        ],
        mini: { id: 'gifts-bf', frames: [() => A.giftPileProp('#1c1c24', '#f0b429', '#3a3a48')] },
        bunting: { shape: 'flag', cols: ['#1c1c24', '#f0b429'] },
        banner: ['BLACK FRIDAY', 'OFERTAS'],
        items: [(p, a, z) => A.wallText(p, a - 8, z + 54, '-50%', '#f0b429', 2)],
        itemMax: 3,
      };
  }
  return null;
};

/** Cores da faixa por evento: fundo chapado + texto de alto contraste + pontilhado. */
function bannerStyle(def: EventDef): { bg: string; fg: string; trim: string } {
  switch (def.id) {
    case 'halloween':
      return { bg: '#3a2160', fg: '#ff9a2a', trim: '#b6f23a' };
    case 'natal':
      return { bg: '#a82a2a', fg: '#ffffff', trim: '#ffd95a' };
    case 'anonovo':
      return { bg: '#1c2a52', fg: '#f4d35e', trim: '#c9d6e8' };
    case 'pascoa':
      return { bg: '#d9619f', fg: '#ffffff', trim: '#ffe27a' };
    case 'carnaval':
      return { bg: '#6a2a9a', fg: '#ffe04a', trim: '#1fbf6a' };
    case 'junina':
      return { bg: '#b8321c', fg: '#ffe27a', trim: '#3a8fd0' };
    case 'namorados':
      return { bg: '#c9264f', fg: '#ffffff', trim: '#ffb3c7' };
    case 'criancas':
      return { bg: '#2a7fd0', fg: '#ffe04a', trim: '#ff5d73' };
    case 'trabalho':
      return { bg: '#2f6fd0', fg: '#ffffff', trim: '#f2c230' };
    case 'aniversario':
      return { bg: '#6a46d8', fg: '#ffd45a', trim: '#ff6fa8' };
    case 'blackfriday':
      return { bg: '#15151c', fg: '#f0b429', trim: '#f0b429' };
    case 'diati':
      return { bg: '#0b1d4a', fg: '#7ae8ff', trim: '#27d9ff' };
    default:
      return { bg: def.theme.primary, fg: '#ffffff', trim: def.theme.accent };
  }
}

const strHash = (s: string) => {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return h >>> 0;
};
const hexNum = (c: string) => parseInt(c.slice(1), 16);

class PropActor implements Sortable {
  img: Phaser.GameObjects.Image;
  /** Peca presa ao objeto (letreiro vivo) que acompanha a profundidade. */
  extra?: Phaser.GameObjects.Image;
  glow?: Phaser.GameObjects.Image;
  frame = 0;
  nextAt = 0;
  constructor(
    readonly spec: PropSpec,
    readonly tile: { x: number; y: number },
    img: Phaser.GameObjects.Image,
  ) {
    this.img = img;
  }
  box() {
    const { x, y } = this.tile;
    return { x0: x + 0.15, y0: y + 0.15, x1: x + 0.85, y1: y + 0.85, z0: 0, z1: 40 };
  }
  setDepth(d: number) {
    this.img.setDepth(d);
    this.extra?.setDepth(d + 0.001);
  }
}

interface WinSpot {
  g: Phaser.GameObjects.Graphics;
  x: number;
  y: number;
  i: number;
  period: number;
}

/** Efeitos na vista das janelas (desenhados atras da parede, que recorta o excesso). `t` em ms; `dark` = ceu de noite. */
const WIN_DRAW: Record<WinFx, (g: Phaser.GameObjects.Graphics, t: number, cx: number, cy: number, i: number, dark: boolean) => void> = {
  snow(g, t, cx, cy, i) {
    for (let k = 0; k < 10; k++) {
      const per = 4200 + k * 330;
      const u = ((t + i * 900 + k * 977) % per) / per;
      const x = cx - 10 + ((k * 53) % 21) + Math.round(Math.sin(u * 9 + k) * 1.5);
      g.fillStyle(0xffffff, 0.95);
      g.fillRect(x, Math.round(cy - 24 + u * 48), k % 3 === 0 ? 2 : 1, k % 3 === 0 ? 2 : 1);
    }
  },
  moon(g, t, cx, cy, i, dark) {
    if (!dark) return;
    g.fillStyle(0xf4f0d0, 1);
    for (let y = -4; y <= 4; y++) g.fillRect(cx + 2 - Math.round(Math.sqrt(25 - y * y)), cy - 12 + y, Math.round(Math.sqrt(25 - y * y)) * 2, 1);
    g.fillStyle(0xcfc8a0, 1);
    g.fillRect(cx + 1, cy - 14, 2, 2);
    g.fillRect(cx + 4, cy - 10, 2, 1);
    const u = ((t + i * 1700) % 7000) / 7000;
    if (u < 0.7) {
      const bx = Math.round(cx - 14 + (u / 0.7) * 30);
      const by = Math.round(cy + 6 - Math.sin((u / 0.7) * Math.PI) * 10);
      g.fillStyle(0x0a0614, 1);
      const up = Math.floor(t / 150) % 2 === 0;
      g.fillRect(bx, by, 3, 2);
      g.fillRect(bx - 2, by + (up ? -1 : 1), 2, 1);
      g.fillRect(bx + 3, by + (up ? -1 : 1), 2, 1);
    }
  },
  lanterns(g, t, cx, cy, i, dark) {
    if (!dark) return;
    const cols = [0xe8452c, 0xf2c230, 0xff8a1f];
    for (let k = 0; k < 3; k++) {
      const u = ((t + i * 1300 + k * 3100) % 9000) / 9000;
      const x = Math.round(cx - 7 + k * 7 + Math.sin(u * 7 + k) * 2);
      const y = Math.round(cy + 22 - u * 46);
      g.fillStyle(cols[k]!, 1);
      g.fillRect(x - 2, y, 5, 5);
      g.fillStyle(0xffe27a, 1);
      g.fillRect(x - 1, y + 1, 3, 2);
      g.fillStyle(0x6a2a10, 1);
      g.fillRect(x - 1, y + 5, 3, 1);
    }
  },
  confetti(g, t, cx, cy, i) {
    const cols = [0xffcf1f, 0x1fbf6a, 0xe83c8a, 0x3a8fd0];
    for (let k = 0; k < 10; k++) {
      const per = 3000 + k * 260;
      const u = ((t + i * 700 + k * 613) % per) / per;
      g.fillStyle(cols[k % 4]!, 1);
      g.fillRect(cx - 10 + ((k * 47) % 21) + Math.round(Math.sin(u * 8 + k) * 2), Math.round(cy - 24 + u * 48), 2, 1);
    }
  },
  butterflies(g, t, cx, cy, i, dark) {
    if (dark) return;
    for (let k = 0; k < 2; k++) {
      const u = ((t + i * 900 + k * 2900) % 6400) / 6400;
      const x = Math.round(cx - 12 + u * 24);
      const y = Math.round(cy + Math.sin(u * 9 + k * 2) * 8 - 4 + k * 10);
      const up = Math.floor(t / 180 + k) % 2 === 0;
      g.fillStyle(k ? 0xffe27a : 0xff9ccf, 1);
      g.fillRect(x - 2, y + (up ? -1 : 0), 2, up ? 2 : 1);
      g.fillRect(x + 1, y + (up ? -1 : 0), 2, up ? 2 : 1);
      g.fillStyle(0x3a2a40, 1);
      g.fillRect(x, y, 1, 2);
    }
  },
  hearts(g, t, cx, cy, i) {
    for (let k = 0; k < 4; k++) {
      const u = ((t + i * 800 + k * 1900) % 6400) / 6400;
      const x = Math.round(cx - 8 + k * 5 + Math.sin(u * 6 + k) * 2);
      const y = Math.round(cy + 22 - u * 46);
      g.fillStyle(k % 2 ? 0xffb3c7 : 0xff4d7e, 1);
      g.fillRect(x - 2, y, 2, 2);
      g.fillRect(x + 1, y, 2, 2);
      g.fillRect(x - 1, y + 2, 3, 1);
      g.fillRect(x, y + 3, 1, 1);
    }
  },
  kites(g, t, cx, cy, i, dark) {
    if (dark) return;
    const x = Math.round(cx + Math.sin(t / 1400 + i) * 5);
    const y = Math.round(cy - 6 + Math.sin(t / 1100 + i * 2) * 4);
    g.fillStyle(0xff5d73, 1);
    g.fillRect(x - 1, y - 4, 3, 2);
    g.fillRect(x - 3, y - 2, 7, 2);
    g.fillRect(x - 1, y, 3, 3);
    g.fillStyle(0xffcc2e, 1);
    g.fillRect(x, y - 3, 1, 5);
    for (let k = 0; k < 5; k++) {
      g.fillStyle(k % 2 ? 0x3aa0ff : 0xffcc2e, 1);
      g.fillRect(x + Math.round(Math.sin(t / 300 + k) * 1.5), y + 4 + k * 2, 1, 1);
    }
  },
  fireworks() {
    /* desenhado a parte (ver tickFireworks) */
  },
};

export class EventDecor {
  private objects: Phaser.GameObjects.GameObject[] = [];
  private texKeys: string[] = [];
  private actors: PropActor[] = [];
  private tint: Phaser.GameObjects.Rectangle | null = null;
  private windows: WinSpot[] = [];
  private winFx: WinFx | null = null;
  private lights: { img: Phaser.GameObjects.Image; base: number; flicker: number; seed: number }[] = [];
  /** Luzinhas das guirlandas: piscam em 3 bandas (um terco acesa por vez). */
  private bulbs: { x: number; y: number; c: number; hi: number; k: number }[] = [];
  private bulbG: Phaser.GameObjects.Graphics | null = null;
  private bulbPhase = -1;
  private particles: { fx: number; fy: number; per: number; ph: number; c: number; w: number; sway: number }[] = [];
  private particleG: Phaser.GameObjects.Graphics | null = null;
  private partSnow = false;
  private signs: { tex: Phaser.Textures.CanvasTexture; ctx: CanvasRenderingContext2D; last: string }[] = [];
  private clockState: { tex: Phaser.Textures.CanvasTexture; ctx: CanvasRenderingContext2D; plane: Plane; a0: number; w: number; zb: number; zt: number; w2: number; last: string } | null = null;
  private last: { built: BuiltRoom; furniture: readonly Furniture[]; furniOn: Record<string, boolean> } | null = null;
  private nextSlow = 0;
  private nextFx = 0;
  private lightsLevel = -1;
  private dark = false;
  private reduced = reducedMotion();
  private readonly off: () => void;

  constructor(private readonly scene: Phaser.Scene) {
    this.off = onEventsChange(() => {
      if (this.last) this.load(this.last.built, this.last.furniture, this.last.furniOn);
    });
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.off());
  }

  /** Objetos de chao para a ordenacao de profundidade da cena (junto com moveis e avatares). */
  get sortables(): Sortable[] {
    return this.actors;
  }

  clear() {
    this.objects.forEach((o) => o.destroy());
    this.objects = [];
    for (const k of this.texKeys) if (this.scene.textures.exists(k)) this.scene.textures.remove(k);
    this.texKeys = [];
    this.actors = [];
    this.windows = [];
    this.winFx = null;
    this.lights = [];
    this.bulbs = [];
    this.bulbG = null;
    this.bulbPhase = -1;
    this.particles = [];
    this.particleG = null;
    this.clockState = null;
    this.signs = [];
    this.tint = null;
    this.lightsLevel = -1;
  }

  private tex(key: string, canvas: HTMLCanvasElement, perm = false): string {
    if (!this.scene.textures.exists(key)) {
      this.scene.textures.addCanvas(key, canvas);
      if (!perm) this.texKeys.push(key);
    }
    return key;
  }

  /** `furniOn` e lido ao vivo (o cenario o atualiza): `true` no interruptor = luzes da sala apagadas. */
  load(built: BuiltRoom, furniture: readonly Furniture[], furniOn: Record<string, boolean>) {
    this.last = { built, furniture, furniOn };
    this.clear();
    this.reduced = reducedMotion();
    const { primary: def, secondary } = eventStack(currentEvents());
    const recipe = def ? recipes(def) : null;
    if (!def || !recipe) return;
    const theme = THEMES[built.def.id] ?? THEMES.office;
    const spots = windowSpots(built, theme);
    const walkable = built.grid.floor.reduce((n, f, i) => n + (f && !built.grid.blocked[i] ? 1 : 0), 0);
    const level = decorLevel(built.def.id, walkable, secondary.length > 0);
    const lim = DECOR_LIMITS[level];
    const rich = recipe.rich?.[built.def.id];
    const plan = planEventDecor(built.def, spots, strHash(built.def.id), rich?.maxProps ?? lim.props);
    const rand = A.rng(strHash(`${built.def.id}:${def.id}`));
    const sc = this.scene;
    const style = bannerStyle(def);

    // luz do clima (multiplicada sobre a sala, abaixo dos nomes)
    this.tint = sc.add.rectangle(0, 0, 9000, 9000, (def.theme.tint[0] << 16) | (def.theme.tint[1] << 8) | def.theme.tint[2]).setDepth(TINT_DEPTH).setBlendMode(Phaser.BlendModes.MULTIPLY);
    this.objects.push(this.tint);

    // ---- parede --------------------------------------------------------------------------------------------
    const walls = renderWalls(built, theme);
    const wl = createCanvas(walls.canvas.width, walls.canvas.height);
    const planeOf = (s: 'n' | 'w') => new Plane(wl.ctx, s, walls.ox, walls.oy);
    const pn = planeOf('n');
    const pw = planeOf('w');
    const P = (s: 'n' | 'w') => (s === 'n' ? pn : pw);
    const usedTop = new Set<string>();
    const key = (s: WallSlot) => `${s.side}${s.t}`;
    const lightPts: A.LightPt[] = [];

    const runs = slotRuns(plan.wallTop).sort((a, b) => b.length - a.length);
    if (recipe.fiber) {
      for (const run of runs) A.fiberCables(P(run[0]!.side), run[0]!.t * 32 + 3, (run[run.length - 1]!.t + 1) * 32 - 3, 94, rand);
    }
    if (recipe.space) for (const s of spots) A.spaceWindow(P(s.side), s.t * 32 + 4, theme.trim);
    if (recipe.garland) {
      for (const run of runs) A.garland(P(run[0]!.side), run[0]!.t * 32 + 3, (run[run.length - 1]!.t + 1) * 32 - 3, 100, lightPts, recipe.garland.cols);
    }
    if (recipe.banner && runs.length) {
      const sig = plan.props[0];
      // a faixa nao fica atras da peca assinatura (que e alta e encostada no canto)
      const behindSig = (r: WallSlot[]) => !!sig && r.some((s) => (s.side === 'n' ? Math.abs(s.t - sig.x) <= 2 && sig.y <= 2 : Math.abs(s.t - sig.y) <= 2 && sig.x <= 2));
      const run = runs.find((r) => r.length >= 2 && !behindSig(r)) ?? runs.find((r) => r.length >= 3);
      if (run && (level >= 2 || run.length >= 3)) {
        const avail = run.length * 32 - 8;
        let pick: { text: string; scale: number } | null = null;
        for (const scale of [2, 1]) {
          const text = recipe.banner.find((s) => A.textWidth(s, scale) + 12 <= avail);
          if (text && (scale === 1 || A.textWidth(text, 2) + 16 <= avail)) {
            pick = { text, scale };
            break;
          }
        }
        if (pick) {
          const w = A.textWidth(pick.text, pick.scale) + 12;
          const a0 = run[0]!.t * 32 + Math.round((run.length * 32 - w) / 2);
          A.banner(P(run[0]!.side), a0, a0 + w, pick.text, style.bg, style.fg, style.trim, pick.scale);
          run.forEach((s) => usedTop.add(key(s)));
        }
      }
    }
    const buntingFor = [recipe.bunting, ...secondary.map((e) => recipes(e)?.bunting)].filter(Boolean) as NonNullable<Recipe['bunting']>[];
    if (buntingFor.length) {
      let bi = 0;
      for (const run of runs) {
        if (run.some((s) => usedTop.has(key(s)))) continue;
        const b = buntingFor[bi++ % buntingFor.length]!;
        if (recipe.garland && b === recipe.bunting) continue;
        A.bunting(P(run[0]!.side), run[0]!.t * 32 + 3, (run[run.length - 1]!.t + 1) * 32 - 3, 100, b.cols, b.shape, rand);
        run.forEach((s) => usedTop.add(key(s)));
      }
    }
    if (recipe.streamers && level >= 2) {
      const free = plan.wallTop.filter((s) => !usedTop.has(key(s)));
      const n = Math.min(3, free.length);
      for (let i = 0; i < n; i++) {
        const s = free[Math.floor(((i + 0.5) * free.length) / n)]!;
        A.streamers(P(s.side), s.t * 32 + 6, 6, 26 + Math.floor(rand() * 10), [def.theme.primary, def.theme.secondary, def.theme.accent], rand);
      }
    }
    if (recipe.web) {
      const hasN = plan.wallTop.some((s) => s.side === 'n' && s.t === 0);
      const hasW = plan.wallTop.some((s) => s.side === 'w' && s.t === 0);
      if (hasN) A.cobweb(pn, level >= 2 ? 30 : 20);
      if (hasW) A.cobweb(pw, level >= 2 ? 30 : 20);
    }

    // relogio de contagem (Ano Novo): precisa de 2 tiles livres seguidos na mesma parede
    let freeWall = [...plan.wallFree];
    if (recipe.clock && level >= 2) {
      const pair = this.findPair(freeWall);
      if (pair) {
        this.addClock(pair, walls, wl);
        freeWall = freeWall.filter((s) => !(s.side === pair.side && Math.abs(s.t - pair.t) <= 2));
      }
    }
    if (recipe.items && recipe.itemMax) {
      const n = Math.min(rich?.itemMax ?? Math.min(lim.items, recipe.itemMax), freeWall.length);
      const chosen = spreadSlots(freeWall, n, 2);
      chosen.forEach((s, i) => {
        // ordem simetrica: o tipo da peca depende da distancia ao centro da fileira
        const idx = Math.min(i, chosen.length - 1 - i);
        recipe.items![idx % recipe.items!.length]!(P(s.side), s.t * 32 + 16, 0, def, idx);
      });
    }
    const wkey = this.tex(`ev:wall:${built.def.id}:${def.id}:${Date.now()}`, wl.canvas);
    this.objects.push(sc.add.image(-walls.ox, -walls.oy, wkey).setOrigin(0, 0).setDepth(WALL_ART_DEPTH));

    // luzinhas das guirlandas (pisca em bandas)
    if (lightPts.length) {
      this.bulbs = lightPts.map((l) => {
        const pl = P(l.side);
        return { x: pl.sx(l.a) - walls.ox, y: pl.sy(l.a, l.z) - walls.oy, c: hexNum(l.c), hi: hexNum(l.c) | 0x808080, k: l.k };
      });
      this.bulbG = sc.add.graphics().setDepth(WALL_ART_DEPTH + 0.05);
      this.objects.push(this.bulbG);
    }

    // ---- confete no chao ---------------------------------------------------------------------------------------
    if (recipe.confetti && level >= 2) {
      const floor = renderFloor(built, theme);
      const fl = createCanvas(floor.canvas.width, floor.canvas.height);
      const { width, height } = built.grid;
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        if (!built.grid.floor[y * width + x]) continue;
        if ((built.furniAt.get(y * width + x) ?? []).length) continue;
        const n = 2 + Math.floor(rand() * 4);
        for (let k = 0; k < n; k++) {
          const fx = x + rand();
          const fy = y + rand();
          fl.ctx.fillStyle = recipe.confetti[Math.floor(rand() * recipe.confetti.length)]!;
          fl.ctx.fillRect(floor.ox + Math.round((fx - fy) * 32), floor.oy + Math.round((fx + fy) * 16), rand() < 0.3 ? 2 : 1, 1);
        }
      }
      const fkey = this.tex(`ev:floor:${built.def.id}:${def.id}:${Date.now()}`, fl.canvas);
      this.objects.push(sc.add.image(-floor.ox, -floor.oy, fkey).setOrigin(0, 0).setDepth(0.3));
    }

    // ---- particulas (confete / neve) caindo pela sala ----------------------------------------------------------
    if (recipe.particles && lim.particles > 0) {
      const tiles: Array<{ x: number; y: number }> = [];
      const { width, height } = built.grid;
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (built.grid.floor[y * width + x]) tiles.push({ x, y });
      const cols = recipe.particles.cols;
      for (let k = 0; k < lim.particles && tiles.length; k++) {
        const t = tiles[Math.floor(rand() * tiles.length)]!;
        this.particles.push({ fx: t.x + rand(), fy: t.y + rand(), per: 6500 + Math.floor(rand() * 4000), ph: rand(), c: hexNum(cols[k % cols.length]!), w: rand() < 0.35 ? 2 : 1, sway: rand() * 6 });
      }
      this.partSnow = !!recipe.particles.snow;
      this.particleG = sc.add.graphics().setDepth(PARTICLE_DEPTH);
      this.objects.push(this.particleG);
    }

    // ---- objetos de chao --------------------------------------------------------------------------------------
    const specs = level === 1 && recipe.mini ? [recipe.mini, ...recipe.props.slice(1)] : recipe.props;
    plan.props.forEach((tile, i) => {
      const spec = i === 0 ? specs[0] : specs[specs.length > 1 ? 1 + ((i - 1) % (specs.length - 1)) : 0];
      if (!spec) return;
      const c = tileToScreen(tile.x + 0.5, tile.y + 0.5);
      const frames = (this.reduced ? spec.frames.slice(0, 1) : spec.frames).map((mk, f) => {
        const k = `ev:prop:${spec.id}:${f}`;
        if (!sc.textures.exists(k)) this.tex(k, mk().canvas, true);
        const pr = sc.textures.get(k).getSourceImage() as HTMLCanvasElement;
        return { k, w: pr.width, h: pr.height };
      });
      const first = frames[0]!;
      // ancora: a base do objeto (ax, ay) fica no centro do tile; tela pequena 48x76 -> (24,68), grande 96x144 -> (48,136)
      const big = first.w > 60;
      const img = sc.add.image(Math.round(c.x), Math.round(c.y + 4), first.k).setOrigin(big ? 48 / 96 : 24 / 48, big ? 136 / 144 : 68 / 76);
      this.objects.push(img);
      const actor = new PropActor(spec, tile, img);
      actor.nextAt = performance.now() + (spec.every ?? 0);
      this.actors.push(actor);
      if (spec.id.startsWith('arch')) actor.extra = this.addSign(c.x - 30, c.y + 4 - 134);
      if (spec.glow) {
        const g = spec.glow;
        const gk = `ev:glow:${g.rgb.join(',')}:${g.size}`;
        this.tex(gk, A.glowCanvas(g.size, g.rgb), true);
        const gi = sc.add.image(Math.round(c.x), Math.round(c.y + g.dy), gk).setDepth(GLOW_DEPTH).setBlendMode(Phaser.BlendModes.ADD);
        actor.glow = gi;
        this.objects.push(gi);
        this.lights.push({ img: gi, base: g.base, flicker: this.reduced ? 0 : (g.flicker ?? 0), seed: tile.x * 7 + tile.y });
      }
    });

    // ---- vista das janelas -----------------------------------------------------------------------------------
    if (recipe.windowFx) {
      this.winFx = recipe.windowFx;
      spots.forEach((s, i) => {
        const gl = windowGlass(s);
        const pl = new Plane(wl.ctx, s.side, walls.ox, walls.oy);
        const sx = pl.sx((gl.a0 + gl.a1) / 2) - walls.ox;
        const sy = pl.sy((gl.a0 + gl.a1) / 2, (gl.zb + gl.zt) / 2 + 4) - walls.oy;
        const g = sc.add.graphics().setDepth(FIREWORK_DEPTH);
        this.objects.push(g);
        this.windows.push({ g, x: sx, y: sy, i, period: 3200 + (i % 3) * 600 });
      });
    }
    this.applyLevel(true);
    this.nextFx = 0;
    this.drawFx(performance.now(), true);
  }

  /** Letreiro vivo do arco de Ano Novo: contagem para 00:00 e, depois da virada, "FELIZ ANO NOVO" piscando. */
  private addSign(x: number, y: number): Phaser.GameObjects.Image {
    const cv = createCanvas(60, 16);
    const key = `ev:sign:${Date.now()}:${this.signs.length}`;
    const tex = this.scene.textures.addCanvas(key, cv.canvas) as Phaser.Textures.CanvasTexture;
    this.texKeys.push(key);
    const img = this.scene.add.image(Math.round(x), Math.round(y), key).setOrigin(0, 0);
    this.objects.push(img);
    const sign = { tex, ctx: cv.ctx, last: '' };
    this.signs.push(sign);
    this.drawSign(sign, Date.now());
    return img;
  }

  private drawSign(s: { tex: Phaser.Textures.CanvasTexture; ctx: CanvasRenderingContext2D; last: string }, nowMs: number) {
    const clk = newYearCountdown(nowMs);
    const blink = this.reduced ? 0 : Math.floor(nowMs / 500) % 2;
    const k = clk.phase === 'party' ? `p${blink}` : `${clk.h}:${clk.m}:${clk.s}:${blink}`;
    if (k === s.last) return;
    s.last = k;
    const { ctx } = s;
    ctx.clearRect(0, 0, 60, 16);
    ctx.fillStyle = '#06081a';
    ctx.fillRect(0, 0, 60, 16);
    ctx.fillStyle = '#f4d35e';
    ctx.fillRect(1, 1, 58, 14);
    ctx.fillStyle = '#10153a';
    ctx.fillRect(2, 2, 56, 12);
    ctx.fillStyle = '#1c2a62';
    ctx.fillRect(2, 2, 56, 2);
    const pad = (n: number) => String(n).padStart(2, '0');
    if (clk.phase === 'count') {
      const hot = clk.h === 0 && clk.m === 0 && clk.s < 10;
      const col = hot ? (blink ? '#ff6a6a' : '#ff3a3a') : '#ffd45a';
      const hm = `${pad(clk.h)}:${pad(clk.m)}`;
      const x0 = Math.round((60 - (A.textWidth(hm, 2) + 3 + A.textWidth(pad(clk.s), 1))) / 2);
      A.flatText(ctx, x0 + 1, 4, hm, '#6a4a10', 2);
      A.flatText(ctx, x0, 3, hm, col, 2);
      A.flatText(ctx, x0 + A.textWidth(hm, 2) + 3, 8, pad(clk.s), hot ? '#ff6a6a' : '#ffffff', 1);
    } else {
      const t = 'FELIZ ANO NOVO';
      A.flatText(ctx, 2, 6, t, '#050a1e', 1);
      A.flatText(ctx, 2, 5, t, blink ? '#ffd45a' : '#ffffff', 1);
      ctx.fillStyle = blink ? '#7ae8ff' : '#ff9ccf';
      ctx.fillRect(4, 3, 1, 1);
      ctx.fillRect(55, 11, 1, 1);
    }
    s.tex.refresh();
  }

  /** Dois tiles livres consecutivos na mesma parede, o mais proximo do meio da parede norte. */
  private findPair(slots: WallSlot[]): WallSlot | null {
    const has = (side: 'n' | 'w', t: number) => slots.some((s) => s.side === side && s.t === t);
    const pairs = slots.filter((s) => has(s.side, s.t + 1));
    if (!pairs.length) return null;
    const north = pairs.filter((s) => s.side === 'n');
    const list = north.length ? north : pairs;
    const mid = (list[0]!.t + list[list.length - 1]!.t) / 2;
    return [...list].sort((a, b) => Math.abs(a.t - mid) - Math.abs(b.t - mid))[0]!;
  }

  /** Relogio digital de 2 tiles: textura viva (1 desenho por segundo) sobre a parede. */
  private addClock(s: WallSlot, walls: { ox: number; oy: number }, wl: { ctx: CanvasRenderingContext2D; canvas: HTMLCanvasElement }) {
    const wp = new Plane(wl.ctx, s.side, walls.ox, walls.oy);
    const a0 = s.t * 32 + 1;
    const w = 62;
    const zb = 40;
    const zt = 70;
    const M = 3;
    const xs = [wp.sx(a0 - M), wp.sx(a0 + w + M)];
    const left = Math.min(...xs);
    const right = Math.max(...xs);
    const top = wp.sy(a0 - M, zt + M);
    const bottom = wp.sy(a0 + w + M, zb - M);
    const cv = createCanvas(right - left + 2, bottom - top + 2);
    const key = `ev:clock:${s.side}${s.t}:${Date.now()}`;
    const tex = this.scene.textures.addCanvas(key, cv.canvas) as Phaser.Textures.CanvasTexture;
    this.texKeys.push(key);
    const img = this.scene.add.image(left - walls.ox, top - walls.oy, key).setOrigin(0, 0).setDepth(WALL_ART_DEPTH + 0.1);
    this.objects.push(img);
    this.clockState = { tex, ctx: cv.ctx, plane: new Plane(cv.ctx, s.side, walls.ox - left, walls.oy - top), a0, w, zb, zt, w2: 0, last: '' };
    this.drawClock(Date.now());
  }

  private drawClock(nowMs: number) {
    const cs = this.clockState;
    if (!cs) return;
    const clk = newYearCountdown(nowMs);
    const blink = this.reduced ? 0 : Math.floor(nowMs / 500) % 2;
    const k = clk.phase === 'party' ? `p${blink}` : `${clk.h}:${clk.m}:${clk.s}`;
    if (k === cs.last) return;
    cs.last = k;
    const { ctx, plane: p, a0, w, zb, zt } = cs;
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    const edge = '#06081a';
    const gold = '#f4d35e';
    p.rect(a0 - 1, a0 + w + 1, zb - 1, zt + 1, edge);
    p.rect(a0, a0 + w, zb, zt, gold);
    p.rect(a0 + 1, a0 + w - 1, zb + 1, zt - 1, '#10153a');
    p.rect(a0 + 1, a0 + w - 1, zt - 3, zt - 1, '#1c2a62');
    p.rect(a0 + 2, a0 + w - 2, zb + 2, zb + 3, '#c9a227');
    const wt = (text: string, x: number, z: number, scale: number, col: string, sh: string) => {
      const mirror = p.side === 'w';
      A.wallText(p, x, z - 1, text, sh, scale, mirror);
      A.wallText(p, x, z, text, col, scale, mirror);
    };
    const pad = (n: number) => String(n).padStart(2, '0');
    if (clk.phase === 'count') {
      const hot = clk.h === 0 && clk.m === 0 && clk.s < 10;
      const col = hot && blink === 0 && !this.reduced ? '#ff6a6a' : hot ? '#ff3a3a' : '#ffd45a';
      const lab = 'FALTAM PARA 00:00';
      wt(lab, a0 + Math.round((w - A.textWidth(lab, 1)) / 2), zt - 9, 1, '#7ae8ff', '#050a1e');
      const hm = `${pad(clk.h)}:${pad(clk.m)}`;
      const total = A.textWidth(hm, 2) + 3 + A.textWidth(pad(clk.s), 1) + 1;
      const x0 = a0 + Math.round((w - total) / 2);
      wt(hm, x0, zb + 6, 2, col, '#6a4a10');
      wt(pad(clk.s), x0 + A.textWidth(hm, 2) + 3, zb + 6, 1, hot ? '#ff6a6a' : '#ffffff', '#6a4a10');
    } else {
      const c1 = blink ? '#ffd45a' : '#ffffff';
      const c2 = blink ? '#7ae8ff' : '#ff9ccf';
      const l1 = 'FELIZ';
      const l2 = 'ANO NOVO';
      wt(l1, a0 + Math.round((w - A.textWidth(l1, 2)) / 2), zb + 11, 2, c1, '#6a4a10');
      wt(l2, a0 + Math.round((w - A.textWidth(l2, 1)) / 2), zb + 4, 1, c2, '#050a1e');
    }
    cs.tex.refresh();
  }

  /** Brilhos: mais fortes a noite ou com o interruptor desligado. */
  private applyLevel(force = false) {
    if (!this.last) return;
    const st = dayState(effectiveHour());
    const off = this.last.furniture.some((f) => f.kind === 'light_switch' && this.last!.furniOn[f.id] === true);
    const level = Math.round(Math.max(st.lights, off ? 0.9 : 0) * 20) / 20;
    this.dark = st.sky.stars > 0.3;
    if (!force && level === this.lightsLevel) return;
    this.lightsLevel = level;
  }

  /** Luzinhas em bandas, particulas e vista das janelas (~15 quadros por segundo; congelado com movimento reduzido). */
  private drawFx(now: number, force = false) {
    const t = this.reduced ? 1800 : now;
    if (this.bulbG && this.bulbs.length) {
      const ph = this.reduced ? 0 : Math.floor(now / 520) % 3;
      if (force || ph !== this.bulbPhase) {
        this.bulbPhase = ph;
        this.bulbG.clear();
        for (const b of this.bulbs) {
          if ((b.k + ph) % 3 !== 0) continue;
          this.bulbG.fillStyle(b.hi, 1);
          this.bulbG.fillRect(b.x - 1, b.y - 1, 1, 1);
          this.bulbG.fillStyle(b.c, 1);
          this.bulbG.fillRect(b.x, b.y, 2, 2);
        }
      }
    }
    if (this.particleG && this.particles.length) {
      const g = this.particleG;
      g.clear();
      for (const p of this.particles) {
        const u = (((t / p.per) + p.ph) % 1 + 1) % 1;
        const z = 96 * (1 - u);
        const sway = this.partSnow ? Math.round(Math.sin(u * 9 + p.sway) * 3) : Math.round(Math.sin(u * 14 + p.sway) * 2);
        const s = tileToScreen(p.fx, p.fy);
        g.fillStyle(p.c, u > 0.92 ? 0.5 : 1);
        g.fillRect(Math.round(s.x + sway), Math.round(s.y - z), p.w, p.w === 2 && this.partSnow ? 2 : 1);
      }
    }
    if (this.windows.length && this.winFx) {
      if (this.winFx === 'fireworks') this.tickFireworks(t);
      else {
        const draw = WIN_DRAW[this.winFx];
        for (const w of this.windows) {
          w.g.clear();
          draw(w.g, t, w.x, w.y, w.i, this.dark);
        }
      }
    }
  }

  private tickFireworks(now: number) {
    for (const f of this.windows) {
      f.g.clear();
      if (!this.dark) continue;
      const t = (now + f.i * 700) % f.period;
      const dur = 1500;
      if (t > dur) continue;
      const u = t / dur;
      const hue = [0xffd95a, 0xff7aa8, 0x7aa8ff, 0x9bffa0][Math.floor((now + f.i * 700) / f.period) % 4]!;
      const cx = f.x;
      const cy = f.y - 8 * Math.min(1, u * 3) + 6 * u * u;
      if (u < 0.2) {
        f.g.fillStyle(0xffffff, 1);
        f.g.fillRect(Math.round(f.x), Math.round(f.y + 14 - u * 5 * 14), 1, 2);
      } else {
        const r = 4 + (u - 0.2) * 14;
        const alpha = 1 - (u - 0.2) / 0.8;
        f.g.fillStyle(hue, alpha);
        for (let k = 0; k < 12; k++) {
          const ang = (k / 12) * Math.PI * 2;
          f.g.fillRect(Math.round(cx + Math.cos(ang) * r), Math.round(cy + Math.sin(ang) * r + u * 4), 1, 1);
          if (u > 0.4) f.g.fillRect(Math.round(cx + Math.cos(ang) * r * 0.6), Math.round(cy + Math.sin(ang) * r * 0.6 + u * 6), 1, 1);
        }
        f.g.fillRect(Math.round(cx), Math.round(cy), 2, 2);
      }
    }
  }

  tick(now: number) {
    if (!this.actors.length && !this.windows.length && !this.clockState && !this.signs.length && !this.particles.length && !this.bulbs.length) return;
    if (now >= this.nextSlow) {
      this.nextSlow = now + 250;
      this.applyLevel();
      this.drawClock(Date.now());
      for (const sg of this.signs) this.drawSign(sg, Date.now());
      if (this.reduced) this.drawFx(now, true);
    }
    const mood = 0.35 + 0.65 * Math.max(this.lightsLevel, 0);
    for (const l of this.lights) {
      const f = 1 - l.flicker * (0.5 + 0.5 * Math.sin(now / 90 + l.seed) * Math.sin(now / 37 + l.seed * 2));
      l.img.setAlpha(Math.min(1, l.base * mood * f));
    }
    if (!this.reduced) {
      for (const a of this.actors) {
        const n = a.spec.frames.length;
        if (n > 1 && a.spec.every && now >= a.nextAt) {
          a.nextAt = now + a.spec.every;
          a.frame = (a.frame + 1) % n;
          a.img.setTexture(`ev:prop:${a.spec.id}:${a.frame}`);
        }
      }
      if (now >= this.nextFx) {
        this.nextFx = now + 66;
        this.drawFx(now);
      }
    }
  }
}
