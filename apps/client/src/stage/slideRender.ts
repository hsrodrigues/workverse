import type { Deck, Slide } from '@workverse/shared';

/**
 * Draws slides (images) and notices on a canvas of any size. Nothing here touches the DOM as markup: the only text
 * is our own notices, drawn with `fillText`.
 */

export type SlideImageResolver = (slide: Slide) => CanvasImageSource | null;

/** Logical size everything is laid out in; the canvas just scales it. */
export const SLIDE_W = 1280;
export const SLIDE_H = 720;

const TITLE_FONT = '"Pixelify Sans", "Segoe UI", system-ui, sans-serif';
const BODY_FONT = '"Segoe UI", system-ui, -apple-system, sans-serif';

function background(ctx: CanvasRenderingContext2D) {
  const g = ctx.createLinearGradient(0, 0, SLIDE_W * 0.4, SLIDE_H);
  g.addColorStop(0, '#1b1830');
  g.addColorStop(1, '#2f2a68');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, SLIDE_W, SLIDE_H);
}

function dims(src: CanvasImageSource): [number, number] {
  const s = src as { videoWidth?: number; videoHeight?: number; naturalWidth?: number; naturalHeight?: number; width?: number; height?: number };
  return [s.videoWidth || s.naturalWidth || (s.width as number) || 1, s.videoHeight || s.naturalHeight || (s.height as number) || 1];
}

function drawContain(ctx: CanvasRenderingContext2D, img: CanvasImageSource) {
  const [iw, ih] = dims(img);
  const k = Math.min(SLIDE_W / iw, SLIDE_H / ih);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, (SLIDE_W - iw * k) / 2, (SLIDE_H - ih * k) / 2, iw * k, ih * k);
}

/** Font that fits `text` in the slide width with a margin (shrinks from `size`, never below 20px). */
function fitFont(ctx: CanvasRenderingContext2D, text: string, weight: number, size: number, family: string): string {
  ctx.font = `${weight} ${size}px ${family}`;
  const w = ctx.measureText(text).width;
  const max = SLIDE_W - 100;
  const px = w > max ? Math.max(20, Math.floor((size * max) / w)) : size;
  return `${weight} ${px}px ${family}`;
}

/** Message centred on a dark background (no presentation, loading image...). */
export function drawNotice(ctx: CanvasRenderingContext2D, title: string, subtitle?: string) {
  ctx.save();
  background(ctx);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffe27a';
  ctx.font = fitFont(ctx, title, 700, 76, TITLE_FONT);
  ctx.fillText(title, SLIDE_W / 2, SLIDE_H / 2 - (subtitle ? 6 : -26));
  if (subtitle) {
    ctx.fillStyle = '#b9b3de';
    ctx.font = fitFont(ctx, subtitle, 400, 38, BODY_FONT);
    ctx.fillText(subtitle, SLIDE_W / 2, SLIDE_H / 2 + 56);
  }
  ctx.restore();
}

/** Draws slide `index` of `deck` (an image, letterboxed) into the (0,0)-(SLIDE_W,SLIDE_H) area of the current transform. */
export function drawSlide(ctx: CanvasRenderingContext2D, deck: Deck, index: number, resolve: SlideImageResolver, opts: { progress?: boolean } = {}) {
  const slide = deck.slides[index];
  if (!slide) return drawNotice(ctx, 'Sem slides');
  const img = resolve(slide);
  if (!img) return drawNotice(ctx, 'Carregando imagem…');
  ctx.save();
  ctx.fillStyle = '#0b0d12';
  ctx.fillRect(0, 0, SLIDE_W, SLIDE_H);
  drawContain(ctx, img);
  if (opts.progress && deck.slides.length > 1) {
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(0, SLIDE_H - 8, SLIDE_W, 8);
    ctx.fillStyle = '#ffe27a';
    ctx.fillRect(0, SLIDE_H - 8, (SLIDE_W * (index + 1)) / deck.slides.length, 8);
  }
  ctx.restore();
}

/** Draws a video frame (screen share) letterboxed into the slide area. */
export function drawVideo(ctx: CanvasRenderingContext2D, video: HTMLVideoElement, label: string) {
  ctx.save();
  ctx.fillStyle = '#0b0d12';
  ctx.fillRect(0, 0, SLIDE_W, SLIDE_H);
  if (video.readyState >= 2 && video.videoWidth > 0) drawContain(ctx, video);
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(0, SLIDE_H - 64, SLIDE_W, 64);
  ctx.fillStyle = '#ffffff';
  ctx.font = `400 34px ${BODY_FONT}`;
  ctx.textAlign = 'left';
  ctx.fillText(label, 28, SLIDE_H - 20);
  ctx.restore();
}

/** Paints with the slide-sized coordinate system onto a canvas of any size. */
export function paintScaled(target: HTMLCanvasElement, draw: (ctx: CanvasRenderingContext2D) => void) {
  const ctx = target.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(target.width / SLIDE_W, 0, 0, target.height / SLIDE_H, 0, 0);
  ctx.imageSmoothingEnabled = true;
  draw(ctx);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}
