import Phaser from 'phaser';
import { planEventDecor, slotRuns, tileToScreen, type BuiltRoom, type EventDef, type EventId, type Furniture, type WallSlot } from '@workverse/shared';
import { Plane, createCanvas } from './pixel';
import { THEMES, renderFloor, renderWalls, windowGlass, windowSpots } from './roomArt';
import { dayState, effectiveHour } from './dayCycle';
import { currentEvents, onEventsChange } from '../eventsStore';
import * as A from './eventArt';

/**
 * Decoracao de eventos: camada VISUAL (o servidor nao sabe dela, nada bloqueia o movimento). Pecas de parede num canvas
 * por cima da parede; objetos de chao como sprites ordenados em profundidade com os avatares e moveis; brilhos aditivos
 * que seguem o ciclo dia/noite e o interruptor da sala. Onde pode ir vem de `planEventDecor` (shared/eventLayout.ts).
 */

const TINT_DEPTH = 900_000.5;
const GLOW_DEPTH = 900_002;
const WALL_ART_DEPTH = 1.2;
const FIREWORK_DEPTH = 0.7;

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

interface Recipe {
  props: PropSpec[];
  bunting?: { shape: A.BuntingShape; cols: string[] };
  banner?: string[];
  items?: Array<(p: Plane, a: number, z: number, def: EventDef, i: number) => void>;
  itemMax?: number;
  web?: boolean;
  streamers?: boolean;
  confetti?: string[];
  fireworks?: boolean;
  clock?: boolean;
  bats?: boolean;
}

const BALLOONS = (cols: string[], seed: number): PropSpec => ({ id: `balloons:${cols.join('')}`, frames: [() => A.balloonsProp(cols, seed)] });

const recipes = (def: EventDef): Recipe | null => {
  const t = def.theme;
  switch (def.id as EventId) {
    case 'halloween':
      return {
        props: [0, 2, 1].map((v) => ({ id: `pumpkin${v}`, frames: [() => A.pumpkinProp(v)], glow: { rgb: [255, 150, 40], size: 70, dy: -14, base: 0.9, flicker: 0.25 } })),
        banner: ['FELIZ HALLOWEEN', 'HALLOWEEN'],
        web: true,
        bats: true,
        items: [(p, a, z) => A.bat(p, a - 6, z + 40), (p, a, z) => A.bat(p, a - 6, z + 28)],
        itemMax: 4,
      };
    case 'natal':
      return {
        props: [
          { id: 'tree0', frames: [() => A.treeProp(0), () => A.treeProp(1)], every: 650, glow: { rgb: [255, 214, 120], size: 90, dy: -34, base: 0.55, flicker: 0.15 } },
          { id: 'gifts-red', frames: [() => A.giftsProp('#d03a3a', '#2f8f4e', '#3a8fd0')] },
          { id: 'gifts-gold', frames: [() => A.giftsProp('#2f8f4e', '#d03a3a', '#f2c230')] },
        ],
        bunting: { shape: 'pine', cols: ['#d03a3a', '#ffd95a', '#4aa8ff'] },
        banner: ['FELIZ NATAL'],
        items: [(p, a, z) => A.wreath(p, a, z + 62, '#d03a3a'), (p, a, z) => A.stocking(p, a - 2, z + 46), (p, a, z) => A.star5(p, a, z + 56, '#ffd95a')],
        itemMax: 4,
        confetti: ['#ffffff', '#dfe9f5'],
      };
    case 'carnaval':
      return {
        props: [BALLOONS(['#ffcf1f', '#1fbf6a', '#e83c8a', '#3a8fd0'], 3), BALLOONS(['#e83c8a', '#ffcf1f', '#7a5af0'], 8), BALLOONS(['#1fbf6a', '#ffcf1f', '#e83c8a'], 5)],
        bunting: { shape: 'flag', cols: ['#ffcf1f', '#1fbf6a', '#e83c8a', '#3a8fd0', '#ff7a1f'] },
        banner: ['CARNAVAL', 'FOLIA'],
        streamers: true,
        items: [(p, a, z, _d, i) => A.mask(p, a, z + 50, i % 2 ? '#e83c8a' : '#7a5af0', i % 2 ? '#ffcf1f' : '#1fbf6a')],
        itemMax: 3,
        confetti: ['#ffcf1f', '#1fbf6a', '#e83c8a', '#3a8fd0', '#ff7a1f'],
      };
    case 'anonovo':
      return {
        props: [BALLOONS(['#f4d35e', '#c9d6e8', '#7aa8ff'], 1), BALLOONS(['#c9d6e8', '#f4d35e', '#ffffff'], 6), { id: 'gifts-gold2', frames: [() => A.giftsProp('#f4d35e', '#c9d6e8', '#7aa8ff')] }],
        bunting: { shape: 'star', cols: ['#f4d35e', '#c9d6e8'] },
        banner: ['FELIZ ANO NOVO', 'ANO NOVO'],
        streamers: true,
        fireworks: true,
        clock: true,
        items: [(p, a, z) => A.star5(p, a, z + 56, '#f4d35e')],
        itemMax: 2,
        confetti: ['#f4d35e', '#c9d6e8', '#7aa8ff'],
      };
    case 'pascoa':
      return {
        props: [{ id: 'bunny', frames: [() => A.bunnyProp()] }, { id: 'basket', frames: [() => A.eggBasketProp()] }, { id: 'bunny2', frames: [() => A.bunnyProp()] }],
        bunting: { shape: 'egg', cols: ['#ff9ccf', '#9be0ff', '#ffe27a', '#b9a0ff', '#9be0a0'] },
        banner: ['FELIZ PÁSCOA', 'PÁSCOA'],
        items: [(p, a, z, _d, i) => (i % 2 ? A.paperBunny(p, a, z + 48, '#f4f1ea') : A.bigEgg(p, a, z + 48, '#ff9ccf', '#9be0ff'))],
        itemMax: 4,
      };
    case 'junina':
      return {
        props: [{ id: 'bonfire', frames: [() => A.bonfireProp(0), () => A.bonfireProp(1), () => A.bonfireProp(2)], every: 170, glow: { rgb: [255, 150, 50], size: 110, dy: -16, base: 0.8, flicker: 0.3 } }, { id: 'hay', frames: [() => A.hayProp()] }],
        bunting: { shape: 'flag', cols: ['#e8452c', '#f2c230', '#3a8fd0', '#2f8f4e', '#e83c8a'] },
        banner: ['FESTA JUNINA', 'ARRAIÁ'],
        items: [(p, a, z, _d, i) => A.lantern(p, a, z + 52, ['#e8452c', '#f2c230', '#3a8fd0'][i % 3]!)],
        itemMax: 4,
      };
    case 'namorados':
      return {
        props: [{ id: 'vase', frames: [() => A.vaseProp()] }, BALLOONS(['#ff4d7e', '#ffb3c7', '#e8344e'], 2)],
        bunting: { shape: 'heart', cols: ['#ff4d7e', '#ffb3c7', '#e8344e'] },
        banner: ['NAMORADOS', 'AMOR'],
        items: [(p, a, z, _d, i) => A.heart(p, a - 7, z + 52, i % 2 ? '#ffb3c7' : '#ff4d7e', 2)],
        itemMax: 4,
        confetti: ['#ff4d7e', '#ffb3c7'],
      };
    case 'criancas':
      return {
        props: [{ id: 'blocks', frames: [() => A.blocksProp()] }, BALLOONS(['#3aa0ff', '#ffcc2e', '#ff5d73', '#3ed08a'], 4), { id: 'gifts-kids', frames: [() => A.giftsProp('#3aa0ff', '#ffcc2e', '#ff5d73')] }],
        bunting: { shape: 'star', cols: ['#3aa0ff', '#ffcc2e', '#ff5d73', '#3ed08a'] },
        banner: ['DIA DAS CRIANÇAS', 'CRIANÇAS'],
        items: [(p, a, z, _d, i) => A.star5(p, a, z + 52, ['#ffcc2e', '#ff5d73', '#3aa0ff'][i % 3]!)],
        itemMax: 3,
        confetti: ['#3aa0ff', '#ffcc2e', '#ff5d73'],
      };
    case 'trabalho':
      return {
        props: [BALLOONS(['#2f6fd0', '#f2c230', '#ffffff'], 7), { id: 'gifts-work', frames: [() => A.giftsProp('#2f6fd0', '#f2c230', '#ffffff')] }],
        bunting: { shape: 'flag', cols: ['#2f6fd0', '#f2c230', '#ffffff'] },
        banner: ['DIA DO TRABALHO', 'TRABALHO'],
        items: [(p, a, z) => A.gear(p, a, z + 54, '#2f6fd0')],
        itemMax: 3,
      };
    case 'aniversario':
      return {
        props: [BALLOONS(['#7a5af0', '#ffc83d', '#ff6fa8'], 9), { id: 'gifts-bday', frames: [() => A.giftsProp('#7a5af0', '#ffc83d', '#ff6fa8')] }, BALLOONS(['#ffc83d', '#ff6fa8', '#7a5af0'], 2)],
        bunting: { shape: 'flag', cols: ['#7a5af0', '#ffc83d', '#ff6fa8'] },
        banner: ['PARABÉNS!', 'PARABÉNS'],
        streamers: true,
        items: [(p, a, z) => A.star5(p, a, z + 54, '#ffc83d')],
        itemMax: 3,
        confetti: ['#7a5af0', '#ffc83d', '#ff6fa8'],
      };
    case 'blackfriday':
      return {
        props: [BALLOONS(['#1c1c24', '#f0b429', '#ffffff'], 4), { id: 'gifts-bf', frames: [() => A.giftsProp('#1c1c24', '#f0b429', '#3a3a48')] }],
        bunting: { shape: 'flag', cols: ['#1c1c24', '#f0b429'] },
        banner: ['BLACK FRIDAY', 'OFERTAS'],
        items: [(p, a, z) => A.wallText(p, a - 8, z + 54, '-50%', '#f0b429', 2)],
        itemMax: 3,
      };
  }
  return null;
};

const strHash = (s: string) => {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return h >>> 0;
};

class PropActor implements Sortable {
  img: Phaser.GameObjects.Image;
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
  }
}

export class EventDecor {
  private objects: Phaser.GameObjects.GameObject[] = [];
  private texKeys: string[] = [];
  private actors: PropActor[] = [];
  private tint: Phaser.GameObjects.Rectangle | null = null;
  private fireworks: { g: Phaser.GameObjects.Graphics; x: number; y: number; t0: number; period: number }[] = [];
  private lights: { img: Phaser.GameObjects.Image; base: number; flicker: number; seed: number }[] = [];
  private blink: { img: Phaser.GameObjects.Image; on: string; off: string; every: number }[] = [];
  private clockSpot: { img: Phaser.GameObjects.Image; a: number; z: number; side: 'n' | 'w'; ox: number; oy: number; key: string; last: string } | null = null;
  private last: { built: BuiltRoom; furniture: readonly Furniture[]; furniOn: Record<string, boolean> } | null = null;
  private nextSlow = 0;
  private lightsLevel = -1;
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
    this.fireworks = [];
    this.lights = [];
    this.blink = [];
    this.clockSpot = null;
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
    const events = currentEvents();
    const def = events[0];
    const recipe = def ? recipes(def) : null;
    if (!def || !recipe) return;
    const theme = THEMES[built.def.id] ?? THEMES.office;
    const spots = windowSpots(built, theme);
    const plan = planEventDecor(built.def, spots, strHash(built.def.id));
    const rand = A.rng(strHash(`${built.def.id}:${def.id}`));
    const sc = this.scene;

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

    const runs = slotRuns(plan.wallTop).sort((a, b) => b.length - a.length);
    if (recipe.banner && runs.length) {
      const run = runs.find((r) => r.length >= 2 && r[0]!.side === 'n') ?? runs.find((r) => r.length >= 2);
      if (run) {
        const avail = run.length * 32 - 8;
        const text = recipe.banner.find((s) => A.textWidth(s) + 10 <= avail);
        if (text) {
          const w = A.textWidth(text) + 10;
          const a0 = run[0]!.t * 32 + Math.round((run.length * 32 - w) / 2);
          A.banner(P(run[0]!.side), a0, a0 + w, text, def.theme.secondary === '#ffffff' ? '#222' : bannerBg(def), '#ffffff', def.theme.accent);
          run.forEach((s) => usedTop.add(key(s)));
        }
      }
    }
    if (recipe.bunting) {
      for (const run of runs) {
        if (run.some((s) => usedTop.has(key(s)))) continue;
        const a0 = run[0]!.t * 32 + 3;
        const a1 = (run[run.length - 1]!.t + 1) * 32 - 3;
        A.bunting(P(run[0]!.side), a0, a1, 100, recipe.bunting.cols, recipe.bunting.shape, rand);
        run.forEach((s) => usedTop.add(key(s)));
      }
    }
    if (recipe.streamers) {
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
      if (hasN) A.cobweb(pn, 26);
      if (hasW) A.cobweb(pw, 26);
    }
    if (recipe.items && recipe.itemMax) {
      const slots = [...plan.wallFree];
      // espalha: sorteia, mantem os que nao encostam um no outro
      for (let i = slots.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [slots[i], slots[j]] = [slots[j]!, slots[i]!];
      }
      const chosen: WallSlot[] = [];
      for (const s of slots) {
        if (chosen.length >= recipe.itemMax) break;
        if (chosen.some((c) => c.side === s.side && Math.abs(c.t - s.t) < 2)) continue;
        chosen.push(s);
      }
      chosen.forEach((s, i) => recipe.items![i % recipe.items!.length]!(P(s.side), s.t * 32 + 16, 0, def, i));
    }
    if (recipe.clock) {
      const s = plan.wallFree.find((x) => x.side === 'n') ?? plan.wallFree[0];
      if (s) this.addClock(s, walls, wl);
    }
    const wkey = this.tex(`ev:wall:${built.def.id}:${def.id}:${Date.now()}`, wl.canvas);
    this.objects.push(sc.add.image(-walls.ox, -walls.oy, wkey).setOrigin(0, 0).setDepth(WALL_ART_DEPTH));

    // ---- confete no chao ---------------------------------------------------------------------------------------
    if (recipe.confetti) {
      const floor = renderFloor(built, theme);
      const fl = createCanvas(floor.canvas.width, floor.canvas.height);
      const { width, height } = built.grid;
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        if (!built.grid.floor[y * width + x]) continue;
        if ((built.furniAt.get(y * width + x) ?? []).length) continue;
        const n = 2 + Math.floor(rand() * 4);
        for (let k = 0; k < n; k++) {
          const u = rand();
          const v = rand();
          const fx = x + u;
          const fy = y + v;
          fl.ctx.fillStyle = recipe.confetti[Math.floor(rand() * recipe.confetti.length)]!;
          fl.ctx.fillRect(floor.ox + Math.round((fx - fy) * 32), floor.oy + Math.round((fx + fy) * 16), rand() < 0.3 ? 2 : 1, 1);
        }
      }
      const fkey = this.tex(`ev:floor:${built.def.id}:${def.id}:${Date.now()}`, fl.canvas);
      this.objects.push(sc.add.image(-floor.ox, -floor.oy, fkey).setOrigin(0, 0).setDepth(0.3));
    }

    // ---- objetos de chao --------------------------------------------------------------------------------------
    plan.props.forEach((tile, i) => {
      const spec = recipe.props[i % recipe.props.length];
      if (!spec || i >= recipe.props.length + 1) return;
      const c = tileToScreen(tile.x + 0.5, tile.y + 0.5);
      const frames = spec.frames.map((mk, f) => {
        const k = `ev:prop:${spec.id}:${f}`;
        const pr = mk();
        this.tex(k, pr.canvas, true);
        return { k, pr };
      });
      const first = frames[0]!;
      const img = sc.add.image(Math.round(c.x), Math.round(c.y + 4), first.k).setOrigin(first.pr.ax / first.pr.canvas.width, first.pr.ay / first.pr.canvas.height);
      this.objects.push(img);
      const actor = new PropActor(spec, tile, img);
      actor.nextAt = performance.now() + (spec.every ?? 0);
      this.actors.push(actor);
      if (spec.glow) {
        const g = spec.glow;
        const gk = `ev:glow:${g.rgb.join(',')}:${g.size}`;
        this.tex(gk, A.glowCanvas(g.size, g.rgb), true);
        const gi = sc.add.image(Math.round(c.x), Math.round(c.y + g.dy), gk).setDepth(GLOW_DEPTH).setBlendMode(Phaser.BlendModes.ADD);
        actor.glow = gi;
        this.objects.push(gi);
        this.lights.push({ img: gi, base: g.base, flicker: g.flicker ?? 0, seed: tile.x * 7 + tile.y });
      }
    });

    // ---- fogos pelas janelas ---------------------------------------------------------------------------------
    if (recipe.fireworks) {
      spots.forEach((s, i) => {
        const gl = windowGlass(s);
        const pl = new Plane(wl.ctx, s.side, walls.ox, walls.oy);
        const sx = pl.sx((gl.a0 + gl.a1) / 2) - walls.ox;
        const sy = pl.sy((gl.a0 + gl.a1) / 2, (gl.zb + gl.zt) / 2 + 4) - walls.oy;
        const g = sc.add.graphics().setDepth(FIREWORK_DEPTH);
        this.objects.push(g);
        this.fireworks.push({ g, x: sx, y: sy, t0: i * 700, period: 3200 + (i % 3) * 600 });
      });
    }
    this.applyLevel(true);
  }

  private addClock(s: WallSlot, walls: { ox: number; oy: number }, wl: { ctx: CanvasRenderingContext2D; canvas: HTMLCanvasElement }) {
    // moldura fixa na parede; o horario e uma imagem pequena que se refaz a cada minuto
    const pl = new Plane(wl.ctx, s.side, walls.ox, walls.oy);
    const a = s.t * 32 + 3;
    A.clockPlaque(pl, a, 58, '00:00', true);
    const kcv = createCanvas(1, 1);
    void kcv;
    this.clockSpot = null;
  }

  /** Brilhos: mais fortes a noite ou com o interruptor desligado. */
  private applyLevel(force = false) {
    if (!this.last) return;
    const st = dayState(effectiveHour());
    const off = this.last.furniture.some((f) => f.kind === 'light_switch' && this.last!.furniOn[f.id] === true);
    const level = Math.round(Math.max(st.lights, off ? 0.9 : 0) * 20) / 20;
    if (!force && level === this.lightsLevel) return;
    this.lightsLevel = level;
  }

  tick(now: number) {
    if (!this.actors.length && !this.fireworks.length) return;
    if (now >= this.nextSlow) {
      this.nextSlow = now + 500;
      this.applyLevel();
    }
    const mood = 0.35 + 0.65 * Math.max(this.lightsLevel, 0);
    for (const l of this.lights) {
      const f = 1 - l.flicker * (0.5 + 0.5 * Math.sin(now / 90 + l.seed) * Math.sin(now / 37 + l.seed * 2));
      l.img.setAlpha(Math.min(1, l.base * mood * f));
    }
    for (const a of this.actors) {
      const n = a.spec.frames.length;
      if (n > 1 && a.spec.every && now >= a.nextAt) {
        a.nextAt = now + a.spec.every;
        a.frame = (a.frame + 1) % n;
        a.img.setTexture(`ev:prop:${a.spec.id}:${a.frame}`);
      }
    }
    if (this.fireworks.length) {
      const st = dayState(effectiveHour());
      const dark = st.sky.stars > 0.3;
      for (const f of this.fireworks) {
        f.g.clear();
        if (!dark) continue;
        const t = (now + f.t0) % f.period;
        const dur = 1500;
        if (t > dur) continue;
        const u = t / dur;
        const hue = [0xffd95a, 0xff7aa8, 0x7aa8ff, 0x9bffa0][Math.floor((now + f.t0) / f.period) % 4]!;
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
  }
}

function bannerBg(def: EventDef): string {
  const t = def.theme;
  switch (def.id) {
    case 'halloween':
      return '#4a2a78';
    case 'natal':
      return '#a82a2a';
    case 'anonovo':
      return '#1c2a52';
    case 'blackfriday':
      return '#15151c';
    case 'trabalho':
      return '#2f6fd0';
    default:
      return t.primary;
  }
}
