import { useEffect, useRef } from 'react';
import type { ItemDef } from '@workverse/shared';
import { itemThumb, thumbColor, thumbSize, lookThumb, LOOK_THUMB } from './thumbs';
import type { AvatarV2 } from '@workverse/shared';

/** Pixel-crisp thumbnail of an item (canvas scaled by CSS with image-rendering: pixelated). */
export function ItemThumb({ item, color, skin, compact }: { item: ItemDef; color?: string; skin: string; compact?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const { w, h, scale } = thumbSize(item, compact);
  const col = thumbColor(item, color);
  useEffect(() => {
    const ctx = ref.current?.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(itemThumb(item, col, skin), 0, 0);
  }, [item, col, skin, w, h]);
  return <canvas ref={ref} width={w} height={h} className="ae-thumb" style={{ width: w * scale, height: h * scale }} aria-hidden="true" />;
}

/** Thumbnail of a whole look (saved outfits). */
export function LookThumb({ look }: { look: AvatarV2 }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = ref.current?.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, LOOK_THUMB.w, LOOK_THUMB.h);
    ctx.drawImage(lookThumb(look), 0, 0);
  }, [look]);
  return <canvas ref={ref} width={LOOK_THUMB.w} height={LOOK_THUMB.h} className="ae-look-thumb" aria-hidden="true" />;
}
