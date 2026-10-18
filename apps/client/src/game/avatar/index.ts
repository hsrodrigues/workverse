import { sanitizeAvatar, type AvatarV2, type HeldItem } from '@workverse/shared';
import { createCanvas } from '../pixel';
import { FH, FRAME_COUNT, FW, VIEWS, type View } from './engine';
import { renderFrame } from './compose';

export {
  ANCHOR_X, ANCHOR_Y, FH, FRAME_COUNT, FRAMES_DRINK, FRAMES_IDLE, FRAMES_SIT, FRAMES_TYPE, FRAMES_WALK, FRAMES_WAVE, FRAME_DRINK, FRAME_IDLE, FRAME_SIT, FRAME_TYPE, FRAME_WALK, FRAME_WAVE, FW, SIT_LIFT, VIEWS,
  type View,
} from './engine';
export { renderFrame, poseOfFrame } from './compose';
export { registerDrawer, getDrawer, drawerKeys } from './registry';

/** Draws one frame of the avatar into ctx at (ox, oy). Accepts v2 or a legacy config (migrated). */
export function drawAvatarFrame(ctx: CanvasRenderingContext2D, ox: number, oy: number, cfg: AvatarV2 | unknown, view: View, frame: number, held: HeldItem | null = null) {
  const buf = renderFrame(sanitizeAvatar(cfg), view, frame, held);
  const img = new ImageData(FW, FH);
  new Uint32Array(img.data.buffer).set(buf);
  ctx.putImageData(img, ox, oy);
}

/** One canvas holding every frame: one row per view (see VIEWS). */
export function buildAvatarSheet(cfg: AvatarV2 | unknown, held: HeldItem | null = null): HTMLCanvasElement {
  const av = sanitizeAvatar(cfg);
  const { canvas, ctx } = createCanvas(FW * FRAME_COUNT, FH * VIEWS.length);
  VIEWS.forEach((view, row) => {
    for (let f = 0; f < FRAME_COUNT; f++) drawAvatarFrame(ctx, f * FW, row * FH, av, view, f, held);
  });
  return canvas;
}
