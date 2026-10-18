import Phaser from 'phaser';
import { tileToScreen, type Deck, type Furniture } from '@workverse/shared';
import { worldStore } from '../worldStore';
import { screenFeed } from '../media/indicators';
import { imagesVersion, slideImage } from '../stage/images';
import { SLIDE_H, SLIDE_W, drawNotice, drawSlide, drawVideo } from '../stage/slideRender';

/** The display area drawn by the `screen` furniture on the north wall, in wall pixels (see furniture.ts). */
const DISPLAY = { a0: 8, a1: 152, z0: 12, z1: 93 };
const COLS = DISPLAY.a1 - DISPLAY.a0;
const ROWS = DISPLAY.z1 - DISPLAY.z0;
/** The wall rises one pixel for every two along it, so the texture needs this much extra height (in wall pixels). */
const SHEAR = Math.ceil(COLS / 2) + 2;
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

/** 'AO VIVO' badge (top-left), speaker name (bottom-left) and slide counter (bottom-right). */
function drawOverlay(ctx: CanvasRenderingContext2D, speaker: string, counterText: string) {
  ctx.save();
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.font = `700 40px ${UI_FONT}`;
  ctx.fillStyle = 'rgba(8,8,14,0.78)';
  roundRect(ctx, 28, 24, 214, 64, 14);
  ctx.fill();
  ctx.fillStyle = '#ff4757';
  ctx.beginPath();
  ctx.arc(62, 56, 12, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.fillText('AO VIVO', 84, 57);
  const pill = (text: string, x: number, align: 'left' | 'right') => {
    ctx.font = `600 38px ${UI_FONT}`;
    const w = Math.ceil(ctx.measureText(text).width) + 40;
    const px = align === 'left' ? x : x - w;
    ctx.fillStyle = 'rgba(8,8,14,0.78)';
    roundRect(ctx, px, SLIDE_H - 88, w, 60, 14);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.fillText(text, px + 20, SLIDE_H - 57);
  };
  if (speaker) pill(speaker, 28, 'left');
  if (counterText) pill(counterText, SLIDE_W - 28, 'right');
  ctx.restore();
}

/**
 * Paints the current slide (or the speaker's shared screen) on the auditorium's projection screen. The content is drawn
 * straight into a canvas `scale` times denser than the wall pixels (scale follows camera zoom x devicePixelRatio, so one
 * texel is about one screen pixel), through a shear matrix that follows the isometric wall (1 up per 2 along). The
 * texture is filtered bilinearly; the pixel-art frame comes from the furniture itself.
 */
export class StageScreen {
  private canvas!: HTMLCanvasElement;
  private image!: Phaser.GameObjects.Image;
  private texture!: Phaser.Textures.CanvasTexture;
  private key = '';
  private scale = 0;
  private sig = '';
  private lastVideo = 0;
  private readonly pos: { x: number; y: number };

  constructor(
    private readonly scene: Phaser.Scene,
    f: Furniture,
    private readonly depth: () => number,
  ) {
    const o = tileToScreen(f.x, f.y);
    // Top-left of the first column: the wall pixel (a0, z1 - 1) sits at oy + ((a0 + 1) >> 1) - z1.
    this.pos = { x: o.x + DISPLAY.a0, y: o.y + ((DISPLAY.a0 + 1) >> 1) - DISPLAY.z1 };
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
    this.canvas.width = COLS * scale;
    this.canvas.height = (ROWS + SHEAR) * scale;
    this.texture = this.scene.textures.addCanvas(this.key, this.canvas)!;
    this.texture.setFilter(Phaser.Textures.FilterMode.LINEAR);
    this.image = this.scene.add.image(this.pos.x, this.pos.y, this.key).setOrigin(0, 0).setScale(1 / scale).setDepth(depth);
    this.sig = '';
  }

  /** Called every frame; repaints only when the content changed (or about 4 times a second for live video). */
  tick(now: number, force = false) {
    const want = this.wantedScale();
    if (want !== this.scale) {
      this.build(want);
      force = true;
    }
    this.image.setDepth(this.depth());
    const w = worldStore.get();
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
    // slide units -> texels, with the wall shear (the slide's top edge starts at y = 0 and slopes down 1 per 2 along x)
    ctx.setTransform((COLS * s) / SLIDE_W, 0.5 * ((COLS * s) / SLIDE_W), 0, (ROWS * s) / SLIDE_H, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    const speaker = w.stage?.speakerName ?? '';
    if (mode === 'video' && video) {
      drawVideo(ctx, video, screenFeed.label);
      drawOverlay(ctx, '', '');
    } else if (mode === 'slide' && live) {
      drawSlide(ctx, w.deck!, w.slide.index, slideImage, { progress: false });
      drawOverlay(ctx, speaker, w.deck!.slides.length > 1 ? `${w.slide.index + 1} / ${w.deck!.slides.length}` : '');
    } else if (mode === 'idle-speaker') drawNotice(ctx, 'Auditório', `${speaker || 'Palestrante'} está no palco`);
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
