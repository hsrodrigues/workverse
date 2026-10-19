import Phaser from 'phaser';
import { tileToScreen, type Deck, type Furniture } from '@workverse/shared';
import { worldStore } from '../worldStore';
import { screenFeed } from '../media/indicators';
import { imagesVersion, slideImage } from '../stage/images';
import { SLIDE_H, SLIDE_W, drawNotice, drawSlide, drawVideo } from '../stage/slideRender';
import { tvScreenSurface } from './furniture';

/**
 * A display surface on a vertical iso plane (`n` = +y face, `w` = +x face), in plane pixels: `a` along the plane and
 * `z` up, from the plane origin (`ox`, `oy` = world pixels of the plane origin). Same convention as `Plane` (pixel.ts).
 */
interface Surface {
  side: 'n' | 'w';
  ox: number;
  oy: number;
  a0: number;
  a1: number;
  z0: number;
  z1: number;
  /** `tv` = TV of a meeting room (bigger overlay, "TV livre" notice); `stage` = the auditorium screen. */
  flavor: 'stage' | 'tv';
}

/** The display area drawn by the `screen` furniture on the north wall, in wall pixels (see furniture.ts). */
const WALL_DISPLAY = { a0: 8, a1: 152, z0: 12, z1: 93 };
const MAX_SCALE = 4;
const UI_FONT = '"Segoe UI", system-ui, -apple-system, sans-serif';
const TITLE_FONT = '"Pixelify Sans", "Segoe UI", system-ui, sans-serif';

let counter = 0;
const deckIds = new WeakMap<Deck, number>();
const deckId = (d: Deck) => {
  let id = deckIds.get(d);
  if (!id) deckIds.set(d, (id = ++counter));
  return id;
};

function surfaceOf(f: Furniture): Surface | null {
  if (f.kind === 'tv_stand') {
    const s = tvScreenSurface(f);
    if (s.back) return null; // the back of the set shows no screen
    return {
      side: s.side,
      ox: Math.round((s.tx - s.ty) * 32),
      oy: Math.round((s.tx + s.ty) * 16 - s.z),
      a0: s.a0,
      a1: s.a1,
      z0: s.z0,
      z1: s.z1,
      flavor: 'tv',
    };
  }
  const o = tileToScreen(f.x, f.y);
  return { side: f.dir % 2 === 0 ? 'n' : 'w', ox: o.x, oy: o.y, ...WALL_DISPLAY, flavor: 'stage' };
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Free-stage notice: dark gradient, a microphone icon and two lines, all in slide units. */
function drawFreeStage(ctx: CanvasRenderingContext2D, title: string, sub: string) {
  const g = ctx.createLinearGradient(0, 0, SLIDE_W * 0.5, SLIDE_H);
  g.addColorStop(0, '#171428');
  g.addColorStop(1, '#2d2a63');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, SLIDE_W, SLIDE_H);
  const cx = SLIDE_W / 2;
  ctx.fillStyle = '#ffe27a';
  roundRect(ctx, cx - 34, 110, 68, 130, 34);
  ctx.fill();
  ctx.strokeStyle = '#ffe27a';
  ctx.lineWidth = 12;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(cx, 205, 66, 0.15 * Math.PI, 0.85 * Math.PI);
  ctx.moveTo(cx, 271);
  ctx.lineTo(cx, 315);
  ctx.moveTo(cx - 40, 315);
  ctx.lineTo(cx + 40, 315);
  ctx.stroke();
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffffff';
  ctx.font = `700 120px ${TITLE_FONT}`;
  ctx.fillText(title, cx, 470);
  ctx.fillStyle = '#d6d2f5';
  ctx.font = `600 60px ${UI_FONT}`;
  ctx.fillText(sub, cx, 560);
}

/** Free TV: standby look (dim, not lit) with a "cast" icon, "TV livre" and "Clique para apresentar". */
function drawFreeTv(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = '#0d0f17';
  ctx.fillRect(0, 0, SLIDE_W, SLIDE_H);
  const cx = SLIDE_W / 2;
  // monitor with a play triangle
  ctx.strokeStyle = '#8f8bd0';
  ctx.lineWidth = 16;
  ctx.lineJoin = 'round';
  roundRect(ctx, cx - 120, 78, 240, 150, 18);
  ctx.stroke();
  ctx.fillStyle = '#8f8bd0';
  ctx.fillRect(cx - 8, 232, 16, 30);
  ctx.fillRect(cx - 62, 258, 124, 14);
  ctx.fillStyle = '#ffe27a';
  ctx.beginPath();
  ctx.moveTo(cx - 28, 118);
  ctx.lineTo(cx - 28, 188);
  ctx.lineTo(cx + 36, 153);
  ctx.closePath();
  ctx.fill();
  ctx.textAlign = 'center';
  ctx.fillStyle = '#e9e7ff';
  ctx.font = `700 150px ${TITLE_FONT}`;
  ctx.fillText('TV livre', cx, 470);
  ctx.fillStyle = '#9a96c8';
  ctx.font = `600 78px ${UI_FONT}`;
  ctx.fillText('Clique para apresentar', cx, 580);
}

/** 'AO VIVO' badge (top-left), presenter name (bottom-left) and slide counter (bottom-right). `u` enlarges it for small screens. */
function drawOverlay(ctx: CanvasRenderingContext2D, speaker: string, counterText: string, u = 1) {
  ctx.save();
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  const m = 28 * u;
  ctx.font = `700 ${40 * u}px ${UI_FONT}`;
  ctx.fillStyle = 'rgba(8,8,14,0.78)';
  roundRect(ctx, m, 24 * u, 214 * u, 64 * u, 14 * u);
  ctx.fill();
  ctx.fillStyle = '#ff4757';
  ctx.beginPath();
  ctx.arc(62 * u, 56 * u, 12 * u, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.fillText('AO VIVO', 84 * u, 57 * u);
  const pill = (text: string, x: number, align: 'left' | 'right') => {
    ctx.font = `600 ${38 * u}px ${UI_FONT}`;
    const w = Math.min(SLIDE_W * 0.6, Math.ceil(ctx.measureText(text).width) + 40 * u);
    const px = align === 'left' ? x : x - w;
    ctx.fillStyle = 'rgba(8,8,14,0.78)';
    roundRect(ctx, px, SLIDE_H - 88 * u, w, 60 * u, 14 * u);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.fillText(text, px + 20 * u, SLIDE_H - 57 * u, w - 30 * u);
  };
  if (speaker) pill(speaker, m, 'left');
  if (counterText) pill(counterText, SLIDE_W - m, 'right');
  ctx.restore();
}

/**
 * Paints the current slide (or the presenter's shared screen) on a display surface: the auditorium's projection screen
 * or the TV of a meeting room. The content is drawn straight into a canvas `scale` times denser than the plane pixels
 * (scale follows camera zoom x devicePixelRatio, so one texel is about one screen pixel), through a shear matrix that
 * follows the isometric plane (1 up/down per 2 along). The texture is filtered bilinearly; the pixel-art frame comes
 * from the furniture itself.
 */
export class StageScreen {
  private canvas!: HTMLCanvasElement;
  private image!: Phaser.GameObjects.Image;
  private texture!: Phaser.Textures.CanvasTexture;
  private key = '';
  private scale = 0;
  private sig = '';
  private lastVideo = 0;
  private readonly surface: Surface | null;
  private readonly cols: number;
  private readonly rows: number;
  /** Extra texture height (plane pixels) that holds the slope of the plane. */
  private readonly shear: number;
  private readonly pos: { x: number; y: number };

  constructor(
    private readonly scene: Phaser.Scene,
    f: Furniture,
    private readonly depth: () => number,
  ) {
    this.surface = surfaceOf(f);
    const s = this.surface ?? { side: 'n' as const, ox: 0, oy: 0, a0: 0, a1: 1, z0: 0, z1: 1, flavor: 'stage' as const };
    this.cols = s.a1 - s.a0;
    this.rows = s.z1 - s.z0;
    this.shear = Math.ceil(this.cols / 2) + 2;
    // `n`: the left-most column is a0 and the top edge slopes down to the right. `w`: the plane runs the other way, the
    // left-most column is a1 - 1 (the lowest) and the top edge slopes up to the right.
    this.pos =
      s.side === 'n'
        ? { x: s.ox + s.a0, y: s.oy + ((s.a0 + 1) >> 1) - s.z1 }
        : { x: s.ox - s.a1, y: s.oy + (s.a1 >> 1) - s.z1 - this.shear };
    if (!this.surface) {
      // no screen to paint (back of the set): keep an invisible placeholder so the rest of the class stays simple
      this.build(2);
      this.image.setVisible(false);
      return;
    }
    this.build(this.wantedScale());
    this.tick(performance.now(), true);
  }

  private wantedScale() {
    const z = this.scene.cameras.main.zoom * Math.min(2, window.devicePixelRatio || 1);
    return Math.max(2, Math.min(MAX_SCALE, Math.round(z)));
  }

  private build(scale: number) {
    const depth = this.image ? this.image.depth : 3;
    this.image?.destroy();
    if (this.key) this.scene.textures.remove(this.key);
    this.scale = scale;
    this.key = `stage-screen:${++counter}`;
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.cols * scale;
    this.canvas.height = (this.rows + this.shear) * scale;
    this.texture = this.scene.textures.addCanvas(this.key, this.canvas)!;
    this.texture.setFilter(Phaser.Textures.FilterMode.LINEAR);
    this.image = this.scene.add.image(this.pos.x, this.pos.y, this.key).setOrigin(0, 0).setScale(1 / scale).setDepth(depth);
    this.sig = '';
  }

  /** Called every frame; repaints only when the content changed (or about 4 times a second for live video). */
  tick(now: number, force = false) {
    const surface = this.surface;
    if (!surface) return;
    const want = this.wantedScale();
    if (want !== this.scale) {
      this.build(want);
      force = true;
    }
    this.image.setDepth(this.depth());
    const w = worldStore.get();
    const tv = surface.flavor === 'tv';
    const video = screenFeed.video && screenFeed.video.readyState >= 2 ? screenFeed.video : null;
    const live = w.slide.live && w.deck;
    const mode = video ? 'video' : live ? 'slide' : w.stage?.speakerId ? 'idle-speaker' : 'idle';
    const sig = `${mode}|${live && w.deck ? deckId(w.deck) : 0}|${w.slide.index}|${imagesVersion()}|${w.stage?.speakerName ?? ''}`;
    const videoDue = mode === 'video' && now - this.lastVideo > 250;
    if (!force && sig === this.sig && !videoDue) return;
    this.sig = sig;
    if (mode === 'video') this.lastVideo = now;

    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    const s = this.scale;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    // slide units -> texels, with the plane shear (the slide's top edge starts at y = 0 and slopes 1 per 2 along x)
    const kx = (this.cols * s) / SLIDE_W;
    const ky = (this.rows * s) / SLIDE_H;
    if (surface.side === 'n') ctx.setTransform(kx, 0.5 * kx, 0, ky, 0, 0);
    else ctx.setTransform(kx, -0.5 * kx, 0, ky, 0, this.shear * s);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    const speaker = w.stage?.speakerName ?? '';
    const u = tv ? 2.2 : 1;
    if (mode === 'video' && video) {
      drawVideo(ctx, video, screenFeed.label);
      drawOverlay(ctx, '', '', u);
    } else if (mode === 'slide' && live) {
      drawSlide(ctx, w.deck!, w.slide.index, slideImage, { progress: false });
      drawOverlay(ctx, speaker, w.deck!.slides.length > 1 ? `${w.slide.index + 1} / ${w.deck!.slides.length}` : '', u);
    } else if (mode === 'idle-speaker') {
      if (tv) drawNotice(ctx, speaker || 'Apresentador', 'está apresentando na TV');
      else drawNotice(ctx, 'Auditório', `${speaker || 'Palestrante'} está no palco`);
    } else if (tv) drawFreeTv(ctx);
    else drawFreeStage(ctx, 'Palco livre', 'Use o púlpito para assumir o palco');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.texture.refresh();
  }

  addTo(list: Phaser.GameObjects.GameObject[]) {
    list.push(this.image);
  }

  destroy() {
    this.image.destroy();
    this.scene.textures.remove(this.key);
  }
}
