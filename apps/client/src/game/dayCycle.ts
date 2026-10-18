/**
 * Ciclo de dia: funcoes puras (sem Phaser) que transformam a hora local em cor de iluminacao, intensidade das
 * luzes, feixes de sol e ceu das janelas. A parte visual fica em dayLighting.ts.
 */

export type RGB = readonly [number, number, number];
export type DayMode = 'auto' | 'day' | 'night';

export interface SkyState {
  /** Gradient of the window glass, top and bottom. */
  top: RGB;
  bottom: RGB;
  /** 0..1 */
  stars: number;
  /** Cloud colour and opacity (0..1). */
  cloud: RGB;
  cloudAmount: number;
  /** Sun / moon: visibility 0..1 and progress along their arc 0..1. */
  sun: number;
  sunPos: number;
  moon: number;
  moonPos: number;
}

export interface DayState {
  hour: number;
  phase: 'madrugada' | 'amanhecer' | 'dia' | 'entardecer' | 'anoitecer' | 'noite';
  /** Colour multiplied over the world (white = no change). */
  tint: RGB;
  /** 0 = lights off, 1 = fully on (lamps, monitors, TVs). */
  lights: number;
  /** Sun beams on the floor, 0..1. */
  beams: number;
  sky: SkyState;
}

interface Key {
  h: number;
  tint: RGB;
  lights: number;
  beams: number;
  top: RGB;
  bottom: RGB;
  stars: number;
  cloud: RGB;
  cloudAmount: number;
}

const NIGHT: Omit<Key, 'h'> = {
  tint: [108, 122, 184],
  lights: 1,
  beams: 0,
  top: [8, 12, 40],
  bottom: [28, 40, 92],
  stars: 1,
  cloud: [40, 52, 96],
  cloudAmount: 0.5,
};

// Keyframes by local hour (the last one repeats the first at 24h so the day wraps smoothly).
const KEYS: Key[] = [
  { h: 0, ...NIGHT },
  { h: 4.5, ...NIGHT, tint: [114, 124, 186] },
  { h: 5.75, tint: [190, 150, 170], lights: 0.85, beams: 0, top: [40, 50, 110], bottom: [214, 120, 120], stars: 0.35, cloud: [210, 130, 140], cloudAmount: 0.6 },
  { h: 6.75, tint: [250, 200, 176], lights: 0.4, beams: 0.35, top: [120, 150, 210], bottom: [255, 176, 120], stars: 0, cloud: [255, 200, 170], cloudAmount: 0.9 },
  { h: 8, tint: [255, 250, 240], lights: 0, beams: 0.9, top: [96, 170, 232], bottom: [190, 226, 248], stars: 0, cloud: [255, 255, 255], cloudAmount: 1 },
  { h: 12, tint: [255, 255, 255], lights: 0, beams: 1, top: [84, 160, 230], bottom: [196, 232, 250], stars: 0, cloud: [255, 255, 255], cloudAmount: 1 },
  { h: 16.5, tint: [255, 250, 238], lights: 0, beams: 0.9, top: [92, 166, 230], bottom: [200, 230, 246], stars: 0, cloud: [255, 252, 244], cloudAmount: 1 },
  { h: 17.75, tint: [255, 214, 160], lights: 0.35, beams: 0.7, top: [110, 140, 205], bottom: [255, 170, 90], stars: 0, cloud: [255, 200, 150], cloudAmount: 0.95 },
  { h: 19, tint: [224, 150, 140], lights: 0.8, beams: 0.15, top: [60, 64, 140], bottom: [240, 110, 80], stars: 0.2, cloud: [230, 120, 110], cloudAmount: 0.8 },
  { h: 20.25, tint: [150, 130, 175], lights: 1, beams: 0, top: [22, 28, 80], bottom: [112, 78, 130], stars: 0.7, cloud: [90, 80, 130], cloudAmount: 0.6 },
  { h: 21.5, ...NIGHT },
  { h: 24, ...NIGHT },
];

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerpRgb = (a: RGB, b: RGB, t: number): RGB => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const smooth = (t: number) => t * t * (3 - 2 * t);
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Arc progress (0..1) of a body that is up from `from` to `to` (hours, may wrap past 24), or -1 when down. */
function arc(hour: number, from: number, to: number): number {
  const len = to - from;
  let d = hour - from;
  if (d < 0) d += 24;
  return d <= len ? d / len : -1;
}

export function normalizeHour(h: number): number {
  return ((h % 24) + 24) % 24;
}

export function phaseOf(hour: number): DayState['phase'] {
  const h = normalizeHour(hour);
  if (h < 5) return 'madrugada';
  if (h < 7) return 'amanhecer';
  if (h < 17) return 'dia';
  if (h < 19) return 'entardecer';
  if (h < 21) return 'anoitecer';
  return 'noite';
}

/** Pure function: local hour (0-24, fractions allowed) -> lighting state. */
export function dayState(hourIn: number): DayState {
  const hour = normalizeHour(Number.isFinite(hourIn) ? hourIn : 12);
  let i = 0;
  while (i < KEYS.length - 2 && hour >= KEYS[i + 1].h) i++;
  const a = KEYS[i];
  const b = KEYS[i + 1];
  const t = smooth(clamp01((hour - a.h) / (b.h - a.h)));

  const sunP = arc(hour, 5.9, 18.6);
  const moonP = arc(hour, 18.8, 29.2); // up to 05:12
  const edge = (p: number) => (p < 0 ? 0 : clamp01(Math.min(p, 1 - p) / 0.08));
  return {
    hour,
    phase: phaseOf(hour),
    tint: lerpRgb(a.tint, b.tint, t),
    lights: lerp(a.lights, b.lights, t),
    beams: lerp(a.beams, b.beams, t),
    sky: {
      top: lerpRgb(a.top, b.top, t),
      bottom: lerpRgb(a.bottom, b.bottom, t),
      stars: lerp(a.stars, b.stars, t),
      cloud: lerpRgb(a.cloud, b.cloud, t),
      cloudAmount: lerp(a.cloudAmount, b.cloudAmount, t),
      sun: edge(sunP),
      sunPos: Math.max(0, sunP),
      moon: edge(moonP),
      moonPos: Math.max(0, moonP),
    },
  };
}

/** Windowless rooms (auditorium) only get a softer version of the tint. */
export function softenTint(tint: RGB, amount = 0.55): RGB {
  return lerpRgb(tint, [255, 255, 255], amount);
}

/** Signature of what is visible in the sky: the window texture is repainted only when it changes. */
export function skySignature(s: SkyState): string {
  const q = (c: RGB) => c.map((v) => Math.round(v / 6)).join(',');
  return [q(s.top), q(s.bottom), Math.round(s.stars * 8), q(s.cloud), Math.round(s.cloudAmount * 6), Math.round(s.sun * 6), Math.round(s.sunPos * 24), Math.round(s.moon * 6), Math.round(s.moonPos * 24)].join('|');
}

// ---------------------------------------------------------------------------
// Preferencia do usuario e hora efetiva

const KEY = 'workverse.dayMode';
let mode: DayMode = 'auto';
let version = 0;
const subs = new Set<() => void>();

try {
  const v = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null;
  if (v === 'auto' || v === 'day' || v === 'night') mode = v;
} catch {
  /* storage indisponivel: fica no automatico */
}

export const getDayMode = (): DayMode => mode;
export const dayModeVersion = () => version;

export function setDayMode(m: DayMode) {
  if (m === mode) return;
  mode = m;
  version++;
  try {
    localStorage.setItem(KEY, m);
  } catch {
    /* ignora */
  }
  subs.forEach((fn) => fn());
}

export function onDayMode(fn: () => void): () => void {
  subs.add(fn);
  return () => subs.delete(fn);
}

/** Dev-only test override: `?hour=21.5`. */
function urlHour(): number | null {
  try {
    if (!(import.meta as { env?: { DEV?: boolean } }).env?.DEV) return null;
    const raw = new URLSearchParams(location.search).get('hour');
    if (raw === null) return null;
    const v = Number(raw.replace(',', '.'));
    return Number.isFinite(v) ? normalizeHour(v) : null;
  } catch {
    return null;
  }
}

export const localHour = (d: Date = new Date()) => d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;

/** Hour used for lighting: forced by mode, forced by `?hour=` (dev) or the computer clock. */
export function effectiveHour(now: Date = new Date()): number {
  if (mode === 'day') return 12;
  if (mode === 'night') return 23;
  return urlHour() ?? localHour(now);
}
