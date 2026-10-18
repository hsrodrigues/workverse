/**
 * Auditorium model shared by server and client: roles, limits, the image deck and its validation, and image
 * signature checks. Nothing here touches the DOM, so the server validates with the very same code the client uses.
 */

import { footprintTiles, type BuiltRoom } from './rooms';
import { isWalkable } from './pathfinding';
import type { Dir8, Point } from './geometry';

export const STAGE_LIMITS = {
  maxSlides: 40,
  maxTitleChars: 80,
  maxAltChars: 120,
  /** Per image, after the client downscaled it. */
  maxImageBytes: 1_500_000,
  /** All images of one stage room together. */
  maxTotalImageBytes: 24_000_000,
  maxImageSide: 4096,
  maxHands: 30,
  maxVoices: 3,
} as const;

export const IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export type ImageMime = (typeof IMAGE_MIME_TYPES)[number];
export const IMAGE_ID_PATTERN = /^[a-f0-9]{24}$/;

/** A slide is just an image the speaker uploaded. */
export interface Slide {
  kind: 'image';
  imageId: string;
  alt?: string;
}

export interface Deck {
  title: string;
  slides: Slide[];
}

export interface HandView {
  id: string;
  name: string;
}

/** Who holds the stage and who asked for the floor. Sent to everyone in the room. */
export interface StageView {
  speakerId: string | null;
  speakerName: string | null;
  /** Audience members waiting for the floor, oldest first. */
  hands: HandView[];
  /** Audience members the speaker allowed to speak (audio only). */
  voices: string[];
  /** Open stage: while true, anybody in the room may turn on microphone, camera and screen share. */
  open: boolean;
}

export interface SlideState {
  live: boolean;
  index: number;
}

export type StageRole = 'speaker' | 'voice' | 'audience';

/** A room is an auditorium when it has a podium. */
export const STAGE_FURNI_KIND = 'podium';

/**
 * Where the speaker stands: on the stage, behind the podium, facing the audience (+y, the side of the seats).
 * Ordered by preference; callers take the first one nobody occupies. The stage is drawn flat at floor level, so
 * the spot needs no height. Empty when the room has no podium.
 */
export function stageSpots(built: BuiltRoom): Array<Point & { dir: Dir8 }> {
  const podium = built.def.furniture.find((f) => f.kind === STAGE_FURNI_KIND);
  if (!podium) return [];
  const stage = built.def.furniture.find((f) => f.kind === 'stage');
  const onStage = new Set((stage ? footprintTiles(stage) : []).map((t) => `${t.x},${t.y}`));
  const { x, y } = podium;
  const ordered: Point[] = [
    { x, y: y - 1 },
    { x: x - 1, y: y - 1 },
    { x: x + 1, y: y - 1 },
    { x: x - 1, y },
    { x: x + 1, y },
    { x, y: y + 1 },
  ];
  return ordered
    .filter((t) => (!stage || onStage.has(`${t.x},${t.y}`)) && isWalkable(built.grid, t.x, t.y))
    .map((t) => ({ ...t, dir: 2 as Dir8 }));
}

// ---------------------------------------------------------------------------
// Text cleaning and validation

/** Control, zero-width and bidi-override characters are never allowed; line breaks are kept for slide text. */
function isForbidden(code: number): boolean {
  return (
    (code < 32 && code !== 10) ||
    (code >= 0x7f && code <= 0x9f) ||
    (code >= 0x200b && code <= 0x200f) ||
    (code >= 0x2028 && code <= 0x202e) ||
    (code >= 0x2066 && code <= 0x2069)
  );
}

export function cleanSlideText(raw: string, max: number): string {
  let out = '';
  for (const ch of raw.replace(/\r\n?/g, '\n')) out += isForbidden(ch.codePointAt(0)!) ? ' ' : ch;
  return out.slice(0, max);
}

export type DeckCheck = { ok: true; deck: Deck } | { ok: false; error: string };

/** Validates and normalises an untrusted deck. Never throws. */
export function validateDeck(input: unknown): DeckCheck {
  if (typeof input !== 'object' || input === null) return { ok: false, error: 'Apresentação inválida.' };
  const raw = input as Record<string, unknown>;
  if (raw.title !== undefined && typeof raw.title !== 'string') return { ok: false, error: 'Título inválido.' };
  if (!Array.isArray(raw.slides)) return { ok: false, error: 'Lista de slides inválida.' };
  if (raw.slides.length === 0) return { ok: false, error: 'Inclua pelo menos um slide.' };
  if (raw.slides.length > STAGE_LIMITS.maxSlides) return { ok: false, error: `No máximo ${STAGE_LIMITS.maxSlides} slides.` };
  const slides: Slide[] = [];
  for (const s of raw.slides) {
    if (typeof s !== 'object' || s === null) return { ok: false, error: 'Slide inválido.' };
    const slide = s as Record<string, unknown>;
    if (slide.kind !== 'image') return { ok: false, error: 'Tipo de slide desconhecido.' };
    if (typeof slide.imageId !== 'string' || !IMAGE_ID_PATTERN.test(slide.imageId)) return { ok: false, error: 'Imagem inválida.' };
    const alt = typeof slide.alt === 'string' ? cleanSlideText(slide.alt, STAGE_LIMITS.maxAltChars).replace(/\n/g, ' ').trim() : '';
    slides.push(alt ? { kind: 'image', imageId: slide.imageId, alt } : { kind: 'image', imageId: slide.imageId });
  }
  const title = cleanSlideText(typeof raw.title === 'string' ? raw.title : '', STAGE_LIMITS.maxTitleChars).replace(/\n/g, ' ').trim();
  return { ok: true, deck: { title, slides } };
}

export function deckImageIds(deck: Deck): string[] {
  const ids = new Set<string>();
  for (const s of deck.slides) if (s.kind === 'image') ids.add(s.imageId);
  return [...ids];
}

// ---------------------------------------------------------------------------
// Image signatures (shared so the client can pre-check before uploading)

export interface ImageInfo {
  mime: ImageMime;
  width: number;
  height: number;
}

const u16be = (b: Uint8Array, o: number) => (b[o] << 8) | b[o + 1];
const u32be = (b: Uint8Array, o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
const u24le = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8) | (b[o + 2] << 16);
const ascii = (b: Uint8Array, o: number, s: string) => {
  for (let i = 0; i < s.length; i++) if (b[o + i] !== s.charCodeAt(i)) return false;
  return true;
};

/**
 * Identifies PNG, JPEG and WebP by their magic bytes and reads the pixel size from the header.
 * Anything else (SVG, HTML, GIF, truncated data...) returns null.
 */
export function sniffImage(b: Uint8Array): ImageInfo | null {
  if (b.length >= 24 && b[0] === 0x89 && ascii(b, 1, 'PNG') && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a && ascii(b, 12, 'IHDR')) {
    return { mime: 'image/png', width: u32be(b, 16), height: u32be(b, 20) };
  }
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    let o = 2;
    while (o + 9 < b.length) {
      if (b[o] !== 0xff) {
        o++;
        continue;
      }
      const marker = b[o + 1];
      if (marker === 0xff) {
        o++;
        continue;
      }
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        o += 2;
        continue;
      }
      const len = u16be(b, o + 2);
      // SOF0..SOF15 except DHT (C4), JPG (C8) and DAC (CC)
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { mime: 'image/jpeg', height: u16be(b, o + 5), width: u16be(b, o + 7) };
      }
      if (len < 2) return null;
      o += 2 + len;
    }
    return null;
  }
  if (b.length >= 30 && ascii(b, 0, 'RIFF') && ascii(b, 8, 'WEBP')) {
    if (ascii(b, 12, 'VP8 ')) return { mime: 'image/webp', width: (b[26] | (b[27] << 8)) & 0x3fff, height: (b[28] | (b[29] << 8)) & 0x3fff };
    if (ascii(b, 12, 'VP8L') && b[20] === 0x2f) {
      const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
      return { mime: 'image/webp', width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
    }
    if (ascii(b, 12, 'VP8X')) return { mime: 'image/webp', width: u24le(b, 24) + 1, height: u24le(b, 27) + 1 };
  }
  return null;
}

export type ImageCheck = { ok: true; info: ImageInfo } | { ok: false; error: string; status: 400 | 413 | 415 };

/** Validates uploaded bytes: signature, declared type, byte size and pixel size. */
export function checkImageUpload(bytes: Uint8Array, declaredMime: string): ImageCheck {
  if (bytes.length === 0) return { ok: false, error: 'Arquivo vazio.', status: 400 };
  if (bytes.length > STAGE_LIMITS.maxImageBytes) return { ok: false, error: 'Imagem grande demais.', status: 413 };
  if (!(IMAGE_MIME_TYPES as readonly string[]).includes(declaredMime)) return { ok: false, error: 'Use PNG, JPEG ou WebP.', status: 415 };
  const info = sniffImage(bytes);
  if (!info) return { ok: false, error: 'O arquivo não é uma imagem PNG, JPEG ou WebP válida.', status: 415 };
  if (info.mime !== declaredMime) return { ok: false, error: 'O conteúdo não corresponde ao tipo informado.', status: 415 };
  if (info.width < 1 || info.height < 1 || info.width > STAGE_LIMITS.maxImageSide || info.height > STAGE_LIMITS.maxImageSide) {
    return { ok: false, error: `Dimensões inválidas (máx. ${STAGE_LIMITS.maxImageSide}px).`, status: 413 };
  }
  return { ok: true, info };
}
