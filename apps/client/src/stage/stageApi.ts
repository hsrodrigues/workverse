import { IMAGE_MIME_TYPES, STAGE_LIMITS, type ApiErrorBody } from '@workverse/shared';

/** Name sent as X-Dev-Name when the page runs with the dev shortcut (?name=), where there is no session cookie. */
let devName: string | undefined;
export const setStageDevName = (name: string | undefined) => {
  devName = name;
};
const headers = (extra: Record<string, string> = {}) => ({ ...(devName ? { 'X-Dev-Name': devName } : {}), ...extra });

export class StageApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function failure(res: Response): Promise<StageApiError> {
  try {
    const body = (await res.json()) as ApiErrorBody;
    return new StageApiError(res.status, body.error?.message ?? 'Falha ao enviar a imagem.');
  } catch {
    return new StageApiError(res.status, 'Falha ao enviar a imagem.');
  }
}

/** Uploads one slide image (speaker only). The server re-validates signature, type and size. */
export async function uploadSlideImage(blob: Blob): Promise<{ id: string; width: number; height: number }> {
  let res: Response;
  try {
    res = await fetch('/api/stage/image', { method: 'POST', credentials: 'same-origin', headers: headers({ 'Content-Type': blob.type }), body: blob });
  } catch {
    throw new StageApiError(0, 'Sem conexão com o servidor.');
  }
  if (!res.ok) throw await failure(res);
  return (await res.json()) as { id: string; width: number; height: number };
}

export async function downloadSlideImage(id: string): Promise<Blob> {
  const res = await fetch(`/api/stage/image/${id}`, { credentials: 'same-origin', headers: headers() });
  if (!res.ok) throw await failure(res);
  return res.blob();
}

/**
 * Turns a user file into something the server accepts: PNG, JPEG or WebP under the size limit. Big images are
 * scaled down and re-encoded (which also drops metadata). SVG is refused on purpose.
 */
export async function prepareImage(file: Blob, maxSide = 1920): Promise<Blob> {
  if (!(IMAGE_MIME_TYPES as readonly string[]).includes(file.type)) {
    throw new StageApiError(415, file.type === 'image/svg+xml' ? 'SVG não é aceito. Use PNG, JPEG ou WebP.' : 'Use uma imagem PNG, JPEG ou WebP.');
  }
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new StageApiError(415, 'Não foi possível ler essa imagem.');
  }
  try {
    const small = bitmap.width <= maxSide && bitmap.height <= maxSide;
    if (small && file.size <= STAGE_LIMITS.maxImageBytes * 0.9) return file;
    const k = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * k));
    canvas.height = Math.max(1, Math.round(bitmap.height * k));
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return await canvasToJpeg(canvas);
  } finally {
    bitmap.close();
  }
}

/** JPEG under the per-image limit, lowering the quality until it fits. */
export async function canvasToJpeg(canvas: HTMLCanvasElement): Promise<Blob> {
  for (const q of [0.88, 0.78, 0.66, 0.5, 0.35]) {
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', q));
    if (blob && blob.size <= STAGE_LIMITS.maxImageBytes * 0.95) return blob;
  }
  throw new StageApiError(413, 'A imagem continua grande demais depois de reduzida.');
}
