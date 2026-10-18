import { STAGE_LIMITS, type Deck } from '@workverse/shared';
import { primeSlideImage } from '../images';
import { StageApiError, uploadSlideImage } from '../stageApi';
import type { ConnectorClient } from './connectorClient';

/** Quality presets for "send slides to WorkVerse". */
export const QUALITY_PRESETS = {
  high: { label: 'Alta (1920 px)', width: 1920, quality: 0.9 },
  balanced: { label: 'Equilibrada (1600 px)', width: 1600, quality: 0.8 },
  light: { label: 'Leve (1280 px)', width: 1280, quality: 0.65 },
} as const;
export type QualityKey = keyof typeof QUALITY_PRESETS;

export interface SendProgress {
  phase: 'export' | 'upload' | 'done';
  done: number;
  total: number;
  message: string;
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(new DOMException('Cancelado', 'AbortError'));
    });
  });

/**
 * Re-encodes a slide render to WebP (or JPEG where the browser cannot encode WebP), lowering the quality and
 * then the size until it fits `maxBytes`.
 */
export async function encodeSlide(source: Blob, preset: { width: number; quality: number }, maxBytes: number): Promise<Blob> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(source);
  } catch {
    throw new StageApiError(415, 'Não foi possível ler a imagem exportada pelo PowerPoint.');
  }
  try {
    let scale = Math.min(1, preset.width / bitmap.width);
    for (let round = 0; round < 4; round++) {
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      for (const q of [preset.quality, preset.quality - 0.15, preset.quality - 0.3, 0.3]) {
        for (const mime of ['image/webp', 'image/jpeg'] as const) {
          const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, mime, Math.max(0.2, q)));
          if (!blob || blob.type !== mime) continue; // the browser fell back to PNG: try the next format
          if (blob.size <= maxBytes) return blob;
          break; // webp worked but is too big: lower quality (jpeg would only be bigger)
        }
      }
      scale *= 0.8;
    }
  } finally {
    bitmap.close();
  }
  throw new StageApiError(413, 'Um dos slides continua grande demais depois de reduzido. Escolha a qualidade "Leve".');
}

async function uploadWithRetry(blob: Blob, signal: AbortSignal, onWait: () => void) {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      return await uploadSlideImage(blob);
    } catch (e) {
      // The server limits uploads per account (a short burst, then a few per second): wait and try again.
      if (e instanceof StageApiError && e.status === 429) {
        onWait();
        await sleep(2000, signal);
        continue;
      }
      throw e;
    }
  }
  throw new StageApiError(429, 'O servidor está limitando os envios. Tente novamente em instantes.');
}

export interface SendOptions {
  client: ConnectorClient;
  slideCount: number;
  title: string;
  quality: QualityKey;
  signal: AbortSignal;
  onProgress: (p: SendProgress) => void;
}

/**
 * Mode B: asks the connector to render every slide, shrinks each one and uploads it to the stage as usual
 * (same limits and checks as "+ Imagens"). Returns the deck to send with `deck_set`.
 */
export async function sendSlidesToStage({ client, slideCount, title, quality, signal, onProgress }: SendOptions): Promise<Deck> {
  if (slideCount < 1) throw new Error('A apresentação não tem slides.');
  if (slideCount > STAGE_LIMITS.maxSlides) {
    throw new Error(`Esta apresentação tem ${slideCount} slides e o palco aceita no máximo ${STAGE_LIMITS.maxSlides}. Divida a apresentação ou use o modo "compartilhar tela".`);
  }
  const preset = QUALITY_PRESETS[quality];
  // Budget per image so that all of them fit the room total (24 MB) with some margin.
  const perImage = Math.min(STAGE_LIMITS.maxImageBytes * 0.95, ((STAGE_LIMITS.maxTotalImageBytes * 0.93) / slideCount) * 1.5);
  let progress = await client.startExport(Math.max(preset.width, 1600), 'png');
  const job = progress.job;
  const slides: Deck['slides'] = [];
  let total = 0;

  for (let i = 1; i <= slideCount; i++) {
    while (progress.ready < i) {
      if (progress.state === 'error' || progress.state === 'idle') throw new Error(progress.error ?? 'O PowerPoint não conseguiu exportar os slides.');
      onProgress({ phase: 'export', done: slides.length, total: slideCount, message: `Exportando slide ${Math.min(slideCount, progress.ready + 1)} de ${slideCount} no PowerPoint…` });
      await sleep(150, signal);
      progress = await client.exportProgress();
      if (progress.job !== job) throw new Error('Outra exportação foi iniciada. Tente de novo.');
    }
    const raw = await client.image(i, 'full');
    const blob = await encodeSlide(raw, preset, perImage);
    if (total + blob.size > STAGE_LIMITS.maxTotalImageBytes * 0.97) {
      throw new Error('Os slides passam do limite de tamanho do palco. Tente a qualidade "Leve" ou reduza as imagens da apresentação.');
    }
    onProgress({ phase: 'upload', done: i - 1, total: slideCount, message: `Enviando slide ${i} de ${slideCount}…` });
    const up = await uploadWithRetry(blob, signal, () => onProgress({ phase: 'upload', done: i - 1, total: slideCount, message: `Enviando slide ${i} de ${slideCount} (aguardando o limite do servidor)…` }));
    total += blob.size;
    primeSlideImage(up.id, blob);
    slides.push({ kind: 'image', imageId: up.id, alt: `Slide ${i}` });
  }
  onProgress({ phase: 'done', done: slideCount, total: slideCount, message: `${slideCount} slides enviados (${(total / 1_000_000).toFixed(1)} MB).` });
  return { title: title.slice(0, STAGE_LIMITS.maxTitleChars), slides };
}
