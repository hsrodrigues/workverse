import { FURNI_KINDS, footprintTiles, furniFront, type Furniture } from './rooms';
import type { QuotaLevel } from './mediaEconomy';

/**
 * Painel NOC (monitoramento da Sala da TI): tipos, aneis de amostras, janelas e a regra geometrica da estacao de frente ao videowall.
 * Tudo PURO. O servidor amostra (apps/server/src/noc.ts) e o cliente so desenha (apps/client/src/ui/noc). Ver docs/noc.md.
 */

/** Intervalo entre amostras e tamanho dos aneis: 720 x 30 s = 6 h. A memoria e fixa. */
export const NOC_SAMPLE_MS = 30_000;
export const NOC_CAPACITY = 720;
/** Janelas do seletor, em minutos. */
export const NOC_WINDOWS = [15, 60, 360] as const;
export type NocWindow = (typeof NOC_WINDOWS)[number];
/** Maximo de pontos por serie enviado ao cliente (as series longas sao reduzidas por media). */
export const NOC_MAX_POINTS = 120;
/** Limites de memoria: organizacoes acompanhadas, salas com serie por organizacao e eventos por organizacao. */
export const NOC_MAX_ORGS = 64;
export const NOC_MAX_ROOMS = 24;
export const NOC_MAX_EVENTS = 40;
/** Entrada/saida "em massa": variacao de pessoas entre duas amostras. */
export const NOC_MASS_DELTA = 5;

export const isNocWindow = (v: unknown): v is NocWindow => typeof v === 'number' && (NOC_WINDOWS as readonly number[]).includes(v);

/** `noc_query` estrito: so `t` e `window` (15, 60 ou 360). Devolve a janela ou null. */
export function parseNocQuery(raw: unknown): NocWindow | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  for (const k of Object.keys(r)) if (k !== 't' && k !== 'window') return null;
  return isNocWindow(r.window) ? r.window : null;
}

/** Anel de tamanho fixo (Float32Array; NaN = sem dado). Empurrar alem da capacidade sobrescreve a amostra mais antiga. */
export class Ring {
  private readonly buf: Float32Array;
  private head = 0;
  private count = 0;
  constructor(readonly capacity: number = NOC_CAPACITY) {
    this.buf = new Float32Array(Math.max(1, Math.floor(capacity))).fill(Number.NaN);
  }
  get length(): number {
    return this.count;
  }
  push(v: number): void {
    this.buf[this.head] = Number.isFinite(v) ? v : Number.NaN;
    this.head = (this.head + 1) % this.buf.length;
    if (this.count < this.buf.length) this.count++;
  }
  /** Ultimo valor guardado (NaN se vazio). */
  last(): number {
    return this.count === 0 ? Number.NaN : this.buf[(this.head - 1 + this.buf.length) % this.buf.length]!;
  }
  /** As ultimas `n` amostras, da mais antiga para a mais nova (menos se houver menos). */
  tail(n: number = this.count): number[] {
    const k = Math.max(0, Math.min(this.count, Math.floor(n)));
    const out: number[] = new Array(k);
    for (let i = 0; i < k; i++) out[i] = this.buf[(this.head - k + i + this.buf.length * 2) % this.buf.length]!;
    return out;
  }
}

/** Quantas amostras cabem em `windowMin` minutos. */
export const windowSamples = (windowMin: number, sampleMs: number = NOC_SAMPLE_MS): number => Math.max(1, Math.ceil((windowMin * 60_000) / sampleMs));

/** Reduz a serie para no maximo `maxPoints` pontos pela media de cada grupo (NaN ignorado; grupo sem dado vira null). */
export function downsample(values: readonly number[], maxPoints: number = NOC_MAX_POINTS): Array<number | null> {
  const n = values.length;
  const cap = Math.max(1, Math.floor(maxPoints));
  const toNull = (v: number) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : null);
  if (n <= cap) return values.map(toNull);
  const out: Array<number | null> = [];
  for (let i = 0; i < cap; i++) {
    const from = Math.floor((i * n) / cap);
    const to = Math.max(from + 1, Math.floor(((i + 1) * n) / cap));
    let sum = 0;
    let c = 0;
    for (let j = from; j < to; j++) {
      const v = values[j]!;
      if (Number.isFinite(v)) {
        sum += v;
        c++;
      }
    }
    out.push(c === 0 ? null : Math.round((sum / c) * 100) / 100);
  }
  return out;
}

/** Recorte da janela e reducao: o que vai no `noc_result`. */
export function windowSeries(ring: Ring, windowMin: number, sampleMs: number = NOC_SAMPLE_MS): Array<number | null> {
  return downsample(ring.tail(windowSamples(windowMin, sampleMs)));
}

export interface NocStats {
  min: number;
  max: number;
  avg: number;
  last: number;
}
/** Minimo/maximo/media/ultimo dos valores validos (null se nao houver nenhum). */
export function seriesStats(values: ReadonlyArray<number | null>): NocStats | null {
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  let c = 0;
  let last = Number.NaN;
  for (const v of values) {
    if (v === null || !Number.isFinite(v)) continue;
    min = Math.min(min, v);
    max = Math.max(max, v);
    sum += v;
    c++;
    last = v;
  }
  return c === 0 ? null : { min, max, avg: sum / c, last };
}

export type NocEventKind = 'mass_join' | 'mass_leave' | 'overheat' | 'overheat_clear' | 'quota';
export interface NocEvent {
  at: number;
  kind: NocEventKind;
  level: 'info' | 'warn' | 'alert';
  text: string;
}

export interface NocRoomView {
  id: string;
  name: string;
  count: number;
  capacity: number;
  /** Maior ocupacao da janela. */
  peak: number;
}
export interface NocClimateView {
  id: string;
  name: string;
  /** A Sala da TI (destaque). */
  it: boolean;
  temp: number;
  target: number;
  on: boolean;
  overheat: boolean;
  temps: Array<number | null>;
  targets: Array<number | null>;
}
export interface NocMediaView {
  /** Conexoes de midia ativas nas salas DESTA organizacao. */
  connections: { now: number; values: Array<number | null> };
  level: QuotaLevel;
  /** So no escopo `full` (a cota e da plataforma inteira). */
  minutes?: { used: number; limit: number; percent: number; values: Array<number | null> };
}
export interface NocServerView {
  uptimeSec: number;
  /** Carga relativa do tick do servidor (0..1: tempo medio de um tick sobre o intervalo). */
  load: number;
  /** Detalhe do processo: so no escopo `full`. */
  detail?: { heapMb: number; tickMs: number; tickMaxMs: number; msgsPerSec: number; heap: Array<number | null>; tick: Array<number | null>; msgs: Array<number | null> };
}

export interface NocView {
  /** `org`: equipe de TI (so da propria organizacao). `full`: staff, dono e admin (inclui o processo e a cota de midia). */
  scope: 'org' | 'full';
  at: number;
  windowMin: NocWindow;
  sampleMs: number;
  /** Milissegundos entre os pontos depois da reducao. */
  stepMs: number;
  online: { now: number; peak: number; values: Array<number | null> };
  rooms: NocRoomView[];
  climate: NocClimateView[];
  media: NocMediaView | null;
  server: NocServerView;
  events: NocEvent[];
}

/**
 * A estacao da Sala da TI "de frente ao videowall": entre as mesas de comando e computadores, a que esta na frente do painel
 * (no lado para onde a frente dele aponta) e mais centrada nele. Regra geometrica estavel: mudar o layout da sala nao quebra.
 */
export function nocStation(furniture: readonly Furniture[]): Furniture | undefined {
  const wall = furniture.find((f) => f.kind === 'videowall');
  if (!wall) return undefined;
  const center = (f: Furniture) => {
    const t = footprintTiles(f);
    return { x: t.reduce((s, p) => s + p.x, 0) / t.length, y: t.reduce((s, p) => s + p.y, 0) / t.length };
  };
  const wc = center(wall);
  const front = furniFront(wall);
  const fx = front === 0 ? 1 : front === 2 ? -1 : 0;
  const fy = front === 1 ? 1 : front === 3 ? -1 : 0;
  let best: Furniture | undefined;
  let bestScore = Infinity;
  for (const f of furniture) {
    if (f.kind !== 'command_desk' && f.kind !== 'computer') continue;
    if (!FURNI_KINDS[f.kind]) continue;
    const c = center(f);
    const rx = c.x - wc.x;
    const ry = c.y - wc.y;
    const along = rx * fx + ry * fy;
    if (along <= 0) continue;
    const lateral = Math.abs(rx * fy) + Math.abs(ry * fx);
    // prefere a mesa de comando ao computador solto e, depois, a mais centrada e mais proxima
    const score = lateral * 2 + along + (f.kind === 'command_desk' ? 0 : 0.5);
    if (score < bestScore - 1e-9 || (Math.abs(score - bestScore) <= 1e-9 && best && f.id < best.id)) {
      best = f;
      bestScore = score;
    }
  }
  return best;
}

/** Mensagens do WebSocket (cliente -> servidor): so a consulta. A abertura (`noc_open`) e o resultado vao no sentido contrario. */
export type NocClientMessage = { t: 'noc_query'; window: number };
export type NocServerMessage = { t: 'noc_open' } | ({ t: 'noc_result' } & NocView);
