import type { Slide } from '@workverse/shared';
import { downloadSlideImage } from './stageApi';

/**
 * Decoded slide images, shared by the HUD viewer and the in-game screen. Server images are fetched once (with the
 * session cookie) and kept as bitmaps.
 */
type Entry = { state: 'loading' } | { state: 'ready'; bitmap: ImageBitmap } | { state: 'error'; at: number };

const cache = new Map<string, Entry>();
const listeners = new Set<() => void>();
let version = 0;

const bump = () => {
  version++;
  listeners.forEach((l) => l());
};

export const imagesVersion = () => version;
export const subscribeImages = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

function load(key: string, getBlob: () => Promise<Blob>) {
  const prev = cache.get(key);
  // A failed download (for instance a draft that is not live yet) is retried after a few seconds.
  if (prev && !(prev.state === 'error' && Date.now() - prev.at > 4000)) return;
  cache.set(key, { state: 'loading' });
  getBlob()
    .then((blob) => createImageBitmap(blob))
    .then((bitmap) => {
      cache.set(key, { state: 'ready', bitmap });
      bump();
    })
    .catch(() => {
      cache.set(key, { state: 'error', at: Date.now() });
      bump();
    });
}

/** Image of a slide, or null while it is loading (a later `subscribeImages` callback signals it is ready). */
export function slideImage(slide: Extract<Slide, { kind: 'image' }>): ImageBitmap | null {
  const key = `srv:${slide.imageId}`;
  load(key, () => downloadSlideImage(slide.imageId));
  const e = cache.get(key);
  return e?.state === 'ready' ? e.bitmap : null;
}

/** Keeps the bytes the speaker just uploaded, so the preview shows at once instead of downloading them again. */
export function primeSlideImage(imageId: string, blob: Blob) {
  load(`srv:${imageId}`, async () => blob);
}

/** Drops everything (leaving the auditorium). */
export function clearImages() {
  for (const e of cache.values()) if (e.state === 'ready') e.bitmap.close();
  cache.clear();
  bump();
}
