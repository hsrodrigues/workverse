import Phaser from 'phaser';
import { footprint, tileToScreen, type BuiltRoom, type Furniture } from '@workverse/shared';
import { Plane, bayer, createCanvas, hash2, type RGB } from './pixel';
import { windowGlass, windowSpots, type Layer, type Theme } from './roomArt';
import { dayModeVersion, dayState, effectiveHour, skySignature, softenTint, type DayState, type SkyState } from './dayCycle';

/** Above every sprite and avatar (depths grow from 10) but below names, balloons and badges (1_000_000). */
const OVERLAY_DEPTH = 900_000;
const GLOW_DEPTH = 900_001;
/** Luminarias de teto: acima de avatares e moveis, abaixo da camada de tom do dia (para escurecer a noite). */
const FIXTURE_DEPTH = 800_000;
const REFRESH_MS = 30_000;

const rgbStr = (c: RGB, k = 1) => `rgb(${Math.round(c[0] * k)},${Math.round(c[1] * k)},${Math.round(c[2] * k)})`;
const mixC = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const toInt = (c: RGB) => (Math.round(c[0]) << 16) | (Math.round(c[1]) << 8) | Math.round(c[2]);

// ---------------------------------------------------------------------------
// Sky behind the windows

interface SkyLayer {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  ox: number;
  oy: number;
  sig: string;
}

const skyCache = new Map<string, SkyLayer>();

function paintSky(layer: SkyLayer, room: BuiltRoom, theme: Theme, sky: SkyState) {
  const { ctx } = layer;
  ctx.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
  const north = new Plane(ctx, 'n', layer.ox, layer.oy);
  const west = new Plane(ctx, 'w', layer.ox, layer.oy);
  const white: RGB = [255, 255, 255];
  for (const s of windowSpots(room, theme)) {
    const p = s.side === 'n' ? north : west;
    const dim = s.side === 'w' ? 0.92 : 1;
    const { a0, a1, zb, zt } = windowGlass(s);
    const gw = a1 - a0;
    const sunA = a0 + 3 + sky.sunPos * (gw - 6);
    const sunZ = zb + 5 + Math.sin(sky.sunPos * Math.PI) * 26;
    const moonA = a0 + 5 + sky.moonPos * (gw - 10);
    const moonZ = zb + 8 + Math.sin(sky.moonPos * Math.PI) * 24;
    const low = 1 - Math.sin(sky.sunPos * Math.PI); // 1 near the horizon
    const sunC: RGB = mixC([255, 244, 190], [255, 150, 70], low);
    p.rectFn(a0, a1, zb, zt, (a, z) => {
      const t = (zt - z) / (zt - zb); // 0 top .. 1 bottom
      const u = Math.min(1, Math.max(0, Math.floor(t * 6 + bayer(a, z)) / 6));
      let c = mixC(sky.top, sky.bottom, u);
      // stars (upper part only)
      if (sky.stars > 0.05 && t < 0.78 && hash2(a, z, 7) < 0.045 * sky.stars) c = mixC(c, hash2(a, z, 9) < 0.3 ? [255, 236, 190] : white, 0.5 + 0.5 * sky.stars);
      // clouds
      const cl = (a - a0 - 4) ** 2 / 20 + (z - (zt - 18)) ** 2 / 5;
      const cl2 = (a - a0 - 15) ** 2 / 12 + (z - (zt - 11)) ** 2 / 4;
      if ((cl < 1 || cl2 < 1) && sky.cloudAmount > 0.1) {
        const core = cl < 0.5 || cl2 < 0.5;
        c = mixC(c, core ? mixC(sky.cloud, white, 0.25) : sky.cloud, Math.min(1, sky.cloudAmount) * (core ? 0.95 : 0.8));
      }
      // sun
      if (sky.sun > 0.02) {
        const d = Math.hypot(a - sunA, (z - sunZ) * 1.0);
        if (d < 3.6) c = mixC(c, sunC, sky.sun);
        else if (d < 7 && bayer(a, z) < (7 - d) / 3.4 * 0.45) c = mixC(c, sunC, sky.sun * 0.5);
      }
      // moon: disc with a bite taken out of it
      if (sky.moon > 0.02) {
        const d = Math.hypot(a - moonA, z - moonZ);
        if (d < 3.8 && Math.hypot(a - moonA - 2, z - moonZ - 1) >= 3.2) c = mixC(c, [244, 240, 214], sky.moon);
      }
      return rgbStr(c, dim);
    });
  }
}


/** Luminaria de teto: painel de LED em losango isometrico pendurado por cabos (pixel art 2D, luz esquerda-cima). */
function fixtureCanvas(): HTMLCanvasElement {
  const W = 48;
  const H = 52;
  const { canvas, ctx } = createCanvas(W, H);
  const px = (x: number, y: number, w: number, h: number, c: string) => {
    ctx.fillStyle = c;
    ctx.fillRect(x, y, w, h);
  };
  // suporte no teto + cabos
  px(21, 0, 6, 3, '#4a4f5c');
  px(22, 0, 4, 1, '#6b717e');
  px(23, 3, 2, 14, '#2b2f3a');
  px(10, 14, 1, 10, '#2b2f3a');
  px(37, 14, 1, 10, '#2b2f3a');
  // painel: losango 2:1 (largura 36, altura 18) com moldura, luz e face inferior
  const cx = 24;
  const top = 22;
  for (let r = 0; r < 18; r++) {
    const half = r < 9 ? (r + 1) * 2 : (18 - r) * 2;
    const x0 = cx - half;
    const w = half * 2;
    const frame = r < 2 || r > 15 || half < 4;
    px(x0, top + r, w, 1, frame ? '#4a4f5c' : '#fff3cf');
    if (!frame && r > 3 && r < 12) px(x0 + 3, top + r, Math.max(0, w - 6), 1, '#fffbea');
  }
  // espessura (face sul) e sombra
  for (let x = cx - 18; x < cx; x++) px(x, top + 9 + Math.floor((x - (cx - 18)) / 2), 1, 3, '#2f333e');
  for (let x = cx; x < cx + 18; x++) px(x, top + 18 - Math.floor((x - cx) / 2), 1, 3, '#23262f');
  return canvas;
}

// ---------------------------------------------------------------------------
// Dithered additive glows

function glowCanvas(w: number, h: number, color: RGB, power = 1.7, banded = false): HTMLCanvasElement {
  const { canvas, ctx } = createCanvas(w, h);
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const d = Math.hypot((x + 0.5 - w / 2) / (w / 2), (y + 0.5 - h / 2) / (h / 2));
      const level = Math.max(0, 1 - d) ** power;
      // banded: degraus finos e limpos (sem pontilhado nem aneis marcados); os demais brilhos seguem pontilhados
      const q = banded ? Math.round(level * 10) / 10 : Math.floor(level * 5 + bayer(x, y)) / 5;
      if (q <= 0) continue;
      const i = (y * w + x) * 4;
      img.data[i] = color[0];
      img.data[i + 1] = color[1];
      img.data[i + 2] = color[2];
      img.data[i + 3] = Math.round(Math.min(1, q) * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

type GlowKind = 'ceilPool' | 'ceilPoolL' | 'lampPool' | 'lampHead' | 'screen' | 'tvPool' | 'cyanPool' | 'cyanSpot' | 'spotRed' | 'spotBlue' | 'spotGold';
const GLOWS: Record<GlowKind, { w: number; h: number; color: RGB; power?: number; banded?: boolean }> = {
  // luz de teto (luminarias embutidas): ampla, branco-quente, fica ligada tambem de dia
  ceilPool: { w: 200, h: 100, color: [255, 214, 140], power: 1.9, banded: true },
  ceilPoolL: { w: 250, h: 126, color: [255, 214, 140], power: 1.9, banded: true },
  lampPool: { w: 176, h: 88, color: [255, 190, 100], power: 1.5 },
  lampHead: { w: 34, h: 34, color: [255, 214, 130], power: 1.2 },
  screen: { w: 52, h: 30, color: [110, 180, 255], power: 1.3 },
  tvPool: { w: 150, h: 76, color: [150, 130, 255], power: 1.6 },
  cyanPool: { w: 190, h: 96, color: [60, 190, 255], power: 1.6 },
  cyanSpot: { w: 64, h: 40, color: [60, 210, 255], power: 1.4 },
  spotRed: { w: 150, h: 76, color: [255, 150, 205], power: 1.6 },
  spotBlue: { w: 150, h: 76, color: [130, 205, 255], power: 1.6 },
  spotGold: { w: 150, h: 76, color: [255, 215, 140], power: 1.6 },
};

interface Light {
  img: Phaser.GameObjects.Image;
  base: number;
  /** Computers only glow while their monitor is on. */
  furniId?: string;
  needsOn: boolean;
  /** Keep a faint glow in the daytime too (stage spots). */
  floorLevel: number;
  /** Nivel minimo (0..1) mesmo de dia: luz artificial de teto. */
  dayMin?: number;
  /** Luz da sala (teto e luminarias): o interruptor da parede apaga todas estas. */
  room?: boolean;
}

// Auditorium stage spots (floor tile coordinates, see SPOTS in roomArt.ts)
const STAGE_SPOTS: ReadonlyArray<readonly [number, number, GlowKind]> = [
  [6.4, 4.55, 'spotGold'],
  [9.0, 4.65, 'spotBlue'],
  [11.6, 4.55, 'spotRed'],
];

export class DayLighting {
  private overlay: Phaser.GameObjects.Rectangle | null = null;
  private sky: { layer: SkyLayer; img: Phaser.GameObjects.Image } | null = null;
  private beams: Phaser.GameObjects.Image | null = null;
  private lights: Light[] = [];
  private fixtures: Phaser.GameObjects.Image[] = [];
  /** Interruptores de luz da sala (estado `true` = apagada) e se as luzes estao apagadas agora. */
  private switches = new Set<string>();
  private lightsOff = false;
  private on = new Map<string, boolean>();
  private room: BuiltRoom | null = null;
  private theme: Theme | null = null;
  private windowless = false;
  private nextAt = 0;
  private modeVersion = -1;
  private applied = { tint: -1, lights: -1, beams: -1, sky: '' };

  constructor(private readonly scene: Phaser.Scene) {}

  private glowTexture(kind: GlowKind): string {
    const key = `glow:${kind}`;
    if (!this.scene.textures.exists(key)) {
      const g = GLOWS[kind];
      this.scene.textures.addCanvas(key, glowCanvas(g.w, g.h, g.color, g.power, g.banded));
    }
    return key;
  }

  private addGlow(kind: GlowKind, x: number, y: number, base: number, extra: Partial<Light> = {}): Light {
    const img = this.scene.add
      .image(Math.round(x), Math.round(y), this.glowTexture(kind))
      .setOrigin(0.5, 0.5)
      .setDepth(GLOW_DEPTH)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setVisible(false);
    const l: Light = { img, base, needsOn: false, floorLevel: 0, ...extra };
    this.lights.push(l);
    return l;
  }

  clear() {
    this.overlay?.destroy();
    this.sky?.img.destroy();
    this.beams?.destroy();
    this.lights.forEach((l) => l.img.destroy());
    this.fixtures.forEach((f) => f.destroy());
    this.fixtures = [];
    this.switches.clear();
    this.lightsOff = false;
    this.overlay = null;
    this.sky = null;
    this.beams = null;
    this.lights = [];
    this.room = null;
  }

  /** Called by the scene after the room is built: creates the sky, sun beams, glows and the multiply overlay. */
  load(built: BuiltRoom, theme: Theme, furniture: readonly Furniture[], furniState: Record<string, boolean>, floor: Layer, walls: Layer, roomKey: string) {
    this.clear();
    this.room = built;
    this.theme = theme;
    this.windowless = theme.windows === false;
    this.on = new Map(Object.entries(furniState));
    this.switches = new Set(furniture.filter((f) => f.kind === 'light_switch').map((f) => f.id));
    this.lightsOff = [...this.switches].some((id) => furniState[id] === true);
    this.applied = { tint: -1, lights: -1, beams: -1, sky: '' };

    // sky layer sits between the floor and the walls (the glass is a hole in the wall texture)
    if (windowSpots(built, theme).length) {
      const id = built.def.id;
      let layer = skyCache.get(id);
      if (!layer) {
        const { canvas, ctx } = createCanvas(walls.canvas.width, walls.canvas.height);
        layer = { canvas, ctx, ox: walls.ox, oy: walls.oy, sig: '' };
        skyCache.set(id, layer);
      }
      const key = `${roomKey}:sky`;
      if (!this.scene.textures.exists(key)) this.scene.textures.addCanvas(key, layer.canvas);
      layer.sig = '';
      const img = this.scene.add.image(-walls.ox, -walls.oy, key).setOrigin(0, 0).setDepth(0.5);
      this.sky = { layer, img };
    }
    if (floor.beams) {
      const key = `${roomKey}:beams`;
      if (!this.scene.textures.exists(key)) this.scene.textures.addCanvas(key, floor.beams);
      this.beams = this.scene.add.image(-floor.ox, -floor.oy, key).setOrigin(0, 0).setDepth(0.1).setVisible(false);
    }

    this.overlay = this.scene.add
      .rectangle(0, 0, 9000, 9000, 0xffffff)
      .setOrigin(0.5, 0.5)
      .setDepth(OVERLAY_DEPTH)
      .setBlendMode(Phaser.BlendModes.MULTIPLY);

    for (const f of furniture) {
      const fp = footprint(f);
      if (f.kind === 'lamp') {
        const c = tileToScreen(f.x + 0.5, f.y + 0.5);
        this.addGlow('lampPool', c.x, c.y, 0.5, { room: true });
        this.addGlow('lampHead', c.x, c.y - 49, 0.7, { room: true });
      } else if (f.kind === 'computer') {
        const c = tileToScreen(f.x + 0.5, f.y + 0.5);
        this.addGlow('screen', c.x, c.y - 22, 0.5, { furniId: f.id, needsOn: true });
      } else if (f.kind === 'tv_stand') {
        // the presentation TV glows only while somebody presents (its `on` state comes from the server)
        const dir = ((f.dir % 4) + 4) % 4;
        const c = tileToScreen(f.x + fp.w / 2, f.y + fp.d / 2);
        this.addGlow('screen', c.x, c.y - 42, 0.9, { furniId: f.id, needsOn: true });
        if (dir < 2) {
          const fl = dir === 0 ? tileToScreen(f.x + fp.w / 2, f.y + 1.9) : tileToScreen(f.x + 1.9, f.y + fp.d / 2);
          this.addGlow('tvPool', fl.x, fl.y, 0.4, { furniId: f.id, needsOn: true });
        }
      } else if (f.kind === 'videowall') {
        // big wall of screens: a cyan wash on the floor in front of it that stays on even when the room lights are off
        const north = f.dir % 2 === 0;
        const c = north ? tileToScreen(f.x + fp.w / 2, f.y + 0.1) : tileToScreen(f.x + 0.1, f.y + fp.d / 2);
        this.addGlow('cyanSpot', c.x, c.y - 56, 0.35);
        const fl = north ? tileToScreen(f.x + fp.w / 2, f.y + 1.8) : tileToScreen(f.x + 1.8, f.y + fp.d / 2);
        this.addGlow('cyanPool', fl.x, fl.y, 0.34);
      } else if (f.kind === 'server_rack') {
        const c = tileToScreen(f.x + 0.5, f.y + 0.5);
        this.addGlow('cyanSpot', c.x, c.y - 30, 0.22);
      } else if (f.kind === 'tv') {
        const north = f.dir % 2 === 0;
        const c = north ? tileToScreen(f.x + fp.w / 2, f.y + 0.1) : tileToScreen(f.x + 0.1, f.y + fp.d / 2);
        this.addGlow('tvPool', c.x, c.y - 56, 0.28);
        const fl = north ? tileToScreen(f.x + fp.w / 2, f.y + 1.6) : tileToScreen(f.x + 1.6, f.y + fp.d / 2);
        this.addGlow('tvPool', fl.x, fl.y, 0.3);
      }
    }
    // luz artificial de teto: luminarias espalhadas num reticulado regular (a cada 4 tiles) pela sala toda,
    // penduradas por cabos; tom quente, ligadas o dia todo (mais fortes a noite) e controladas pelo interruptor
    if (theme.fx !== 'hall') {
      const g = built.grid;
      const key = 'fixture:ceil';
      if (!this.scene.textures.exists(key)) this.scene.textures.addCanvas(key, fixtureCanvas());
      for (let y = 2; y < g.height; y += 4) {
        for (let x = 2; x < g.width; x += 4) {
          if (!g.floor[y * g.width + x]) continue;
          const c = tileToScreen(x + 0.5, y + 0.5);
          const fy = c.y - 104;
          // nao cobre o interruptor da parede com uma luminaria
          if (furniture.some((f) => {
            if (f.kind !== 'light_switch') return false;
            const sp = tileToScreen(f.x + 0.5, f.y + 0.5);
            return Math.abs(c.x - sp.x) < 56 && Math.abs(fy - (sp.y - 43)) < 40;
          })) continue;
          this.addGlow('ceilPool', c.x, c.y, 0.3, { dayMin: 0.3, room: true });
          this.fixtures.push(this.scene.add.image(Math.round(c.x), Math.round(fy), key).setOrigin(0.5, 0.5).setDepth(FIXTURE_DEPTH));
          this.addGlow('lampHead', c.x, fy + 6, 1, { dayMin: 0.35, room: true });
        }
      }
    }
    if (theme.fx === 'hall') {
      for (const [x, y, kind] of STAGE_SPOTS) {
        const c = tileToScreen(x, y);
        this.addGlow(kind, c.x, c.y, 0.32);
      }
    }
    this.apply(effectiveHour(), true);
    this.nextAt = performance.now() + REFRESH_MS;
    this.modeVersion = dayModeVersion();
  }

  setOn(id: string, on: boolean) {
    this.on.set(id, on);
    if (this.switches.has(id)) this.lightsOff = on; // `true` = luzes apagadas
    this.syncLights(this.lastLights);
  }

  private lastLights = 0;

  /** Cheap per-frame check: only does work every ~30 s or when the user changes the mode. */
  tick(now: number) {
    if (!this.room) return;
    const v = dayModeVersion();
    if (now < this.nextAt && v === this.modeVersion) return;
    this.nextAt = now + REFRESH_MS;
    this.modeVersion = v;
    this.apply(effectiveHour());
  }

  private syncLights(level: number) {
    // luminarias apagadas ficam acinzentadas
    for (const f of this.fixtures) {
      if (this.lightsOff) f.setTint(0x777c88);
      else f.clearTint();
    }
    for (const l of this.lights) {
      const on = (!l.needsOn || (l.furniId !== undefined && this.on.get(l.furniId) === true)) && !(l.room && this.lightsOff);
      const a = Math.round(Math.max(level, l.dayMin ?? 0) * l.base * 40) / 40;
      l.img.setVisible(on && a > 0.01).setAlpha(a);
    }
  }

  /** Applies the lighting for an hour; every visual piece only changes when its quantised value changes. */
  apply(hour: number, force = false) {
    if (!this.room || !this.theme) return;
    const st: DayState = dayState(hour);
    const tintRgb = this.windowless ? softenTint(st.tint) : st.tint;
    const tint = toInt([Math.round(tintRgb[0] / 3) * 3, Math.round(tintRgb[1] / 3) * 3, Math.round(tintRgb[2] / 3) * 3]);
    if (force || tint !== this.applied.tint) {
      this.overlay?.setFillStyle(tint, 1);
      this.applied.tint = tint;
    }
    const lights = Math.round(st.lights * 50) / 50;
    if (force || lights !== this.applied.lights) {
      this.applied.lights = lights;
      this.lastLights = lights;
      this.syncLights(lights);
    }
    const beams = Math.round(st.beams * 40) / 40;
    if (this.beams && (force || beams !== this.applied.beams)) {
      this.applied.beams = beams;
      this.beams.setVisible(beams > 0.01).setAlpha(beams);
    }
    if (this.sky) {
      const sig = skySignature(st.sky);
      if (force || sig !== this.sky.layer.sig) {
        this.sky.layer.sig = sig;
        paintSky(this.sky.layer, this.room, this.theme, st.sky);
        (this.sky.img.texture as unknown as Phaser.Textures.CanvasTexture).refresh();
      }
    }
  }
}

