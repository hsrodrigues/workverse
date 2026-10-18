import {
  DEFAULT_AVATAR,
  cloneAvatar,
  defaultColorOf,
  equipItem,
  itemColors,
  thumbFocusOf,
  type AvatarV2,
  type ItemDef,
  type ThumbFocus,
} from '@workverse/shared';
import { FH, FW, drawAvatarFrame, type View } from '../../game/avatarRenderer';
import { createCanvas } from '../../game/pixel';

/**
 * Item thumbnails: the real sprite of the item drawn by the avatar engine on a neutral body, cropped to the part
 * of the body it belongs to. Crops have an integer size so the editor can scale them by whole numbers (crisp pixels).
 */
interface Crop {
  x: number;
  y: number;
  w: number;
  h: number;
  view: View;
  /** Whole-number zoom used in the editor cards (the card is w*scale px of crisp pixels). */
  scale: number;
}

// Frame is 64x128; head spans y 13-49, torso 49-78, legs 76-92, feet 90-106 (see game/avatar/engine.ts).
// Crops were measured against what each item really draws (front view: glasses x19-45, watch x42-48 y73-75,
// hand items x28-47 y53-80; back view for the backpack).
const CROPS: Record<ThumbFocus, Crop> = {
  head: { x: 12, y: 8, w: 40, h: 40, view: 'front', scale: 2 },
  face: { x: 18, y: 26, w: 28, h: 28, view: 'front', scale: 3 },
  torso: { x: 12, y: 50, w: 40, h: 40, view: 'front', scale: 2 },
  legs: { x: 12, y: 70, w: 40, h: 40, view: 'front', scale: 2 },
  feet: { x: 12, y: 72, w: 40, h: 40, view: 'front', scale: 2 },
  full: { x: 12, y: 10, w: 40, h: 40, view: 'front', scale: 2 },
  back: { x: 12, y: 42, w: 40, h: 40, view: 'back', scale: 2 },
  wrist: { x: 36, y: 64, w: 20, h: 20, view: 'front', scale: 4 },
  hand: { x: 22, y: 50, w: 40, h: 40, view: 'front', scale: 2 },
};

/** Crop size and the whole-number zoom to show it at (compact = small rows such as "Vestindo agora"). */
export const thumbSize = (item: ItemDef, compact = false) => {
  const c = CROPS[thumbFocusOf(item)];
  return { w: c.w, h: c.h, scale: compact ? Math.max(1, Math.floor(60 / c.w)) : c.scale };
};

/** Color an item thumbnail shows: the one worn in the slot when the item accepts it, otherwise its default. */
export function thumbColor(item: ItemDef, preferred?: string): string | undefined {
  if (!item.palette) return undefined;
  return preferred && itemColors(item).some((c) => c.id === preferred) ? preferred : defaultColorOf(item);
}

const cache = new Map<string, HTMLCanvasElement>();
const scratch = () => createCanvas(FW, FH);
let shared: ReturnType<typeof scratch> | undefined;

function crop(look: AvatarV2, c: Crop): HTMLCanvasElement {
  shared ??= scratch();
  shared.ctx.clearRect(0, 0, FW, FH);
  drawAvatarFrame(shared.ctx, 0, 0, look, c.view, 0);
  const out = createCanvas(c.w, c.h);
  out.ctx.drawImage(shared.canvas, c.x, c.y, c.w, c.h, 0, 0, c.w, c.h);
  return out.canvas;
}

/** Cached thumbnail canvas for an item in a color, on the given skin tone. */
export function itemThumb(item: ItemDef, color: string | undefined, skin: string): HTMLCanvasElement {
  const key = `${item.id}|${color ?? ''}|${skin}`;
  let hit = cache.get(key);
  if (!hit) {
    const base = cloneAvatar({ ...DEFAULT_AVATAR, skin });
    const r = equipItem(base, item.id, color);
    hit = crop(r.ok ? r.avatar : base, CROPS[thumbFocusOf(item)]);
    cache.set(key, hit);
  }
  return hit;
}

/** Thumbnail of a whole look (outfit cards): full body, frame 0. */
export function lookThumb(look: AvatarV2): HTMLCanvasElement {
  return crop(look, { x: 12, y: 12, w: 40, h: 96, view: 'front', scale: 2 });
}
export const LOOK_THUMB = { w: 40, h: 96 };
