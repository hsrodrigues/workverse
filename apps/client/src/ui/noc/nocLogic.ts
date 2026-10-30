import type { NocEvent, NocWindow } from '@workverse/shared';

/** Logica PURA do painel NOC: escalas, ticks "bonitos", caminhos SVG e formatacao pt-BR. Sem DOM (testada em test/noc-logic.test.ts). */

export type Num = number | null;

export interface Domain {
  min: number;
  max: number;
}

/** Passo "bonito" (1, 2, 5 x 10^n) para dividir `span` em cerca de `count` partes. */
export function niceStep(span: number, count: number): number {
  if (!(span > 0) || count < 1) return 1;
  const raw = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / mag;
  const f = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return f * mag;
}

/** Eixo vertical: dominio arredondado e ticks. `floorZero` ancora o minimo em 0 (contagens). */
export function niceAxis(min: number, max: number, count = 4, floorZero = false): { domain: Domain; ticks: number[] } {
  let lo = Number.isFinite(min) ? min : 0;
  let hi = Number.isFinite(max) ? max : 1;
  if (floorZero) lo = Math.min(0, lo);
  if (hi - lo < 1e-9) {
    hi = lo + 1;
    if (!floorZero) lo -= 1;
  }
  const step = niceStep(hi - lo, count);
  const start = Math.floor(lo / step + 1e-9) * step;
  const end = Math.ceil(hi / step - 1e-9) * step;
  const ticks: number[] = [];
  for (let v = start; v <= end + step * 1e-6; v += step) ticks.push(Math.round(v / step) * step);
  return { domain: { min: start, max: end }, ticks };
}

/** Escala linear de `domain` para `range` (o contra-dominio pode ser invertido, como o eixo Y do SVG). */
export function linearScale(domain: Domain, r0: number, r1: number): (v: number) => number {
  const span = domain.max - domain.min || 1;
  return (v) => r0 + ((v - domain.min) / span) * (r1 - r0);
}

/** Dominio dos valores validos de varias series (null se nao ha nenhum). */
export function extent(series: ReadonlyArray<ReadonlyArray<Num>>): Domain | null {
  let min = Infinity;
  let max = -Infinity;
  for (const s of series) for (const v of s) if (v !== null && Number.isFinite(v)) (min = Math.min(min, v)), (max = Math.max(max, v));
  return min === Infinity ? null : { min, max };
}

const f1 = (n: number) => (Math.round(n * 10) / 10).toString();

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Pontos (x,y) de uma serie dentro de `box`; os valores ausentes ficam `null`. Um unico ponto vai ao meio. */
export function seriesPoints(values: ReadonlyArray<Num>, box: Box, domain: Domain): Array<[number, number] | null> {
  const n = values.length;
  const sy = linearScale(domain, box.y + box.h, box.y);
  return values.map((v, i) => {
    if (v === null || !Number.isFinite(v)) return null;
    const x = n <= 1 ? box.x + box.w / 2 : box.x + (i / (n - 1)) * box.w;
    return [Math.round(x * 10) / 10, Math.round(sy(v) * 10) / 10];
  });
}

/** Caminho de linha; lacunas (null) quebram o traco. `step` faz degraus (para metas). */
export function linePath(points: ReadonlyArray<[number, number] | null>, step = false): string {
  let d = '';
  let prev: [number, number] | null = null;
  for (const p of points) {
    if (!p) {
      prev = null;
      continue;
    }
    if (!prev) d += `${d ? ' ' : ''}M${f1(p[0])} ${f1(p[1])}`;
    else if (step) d += ` L${f1(p[0])} ${f1(prev[1])} L${f1(p[0])} ${f1(p[1])}`;
    else d += ` L${f1(p[0])} ${f1(p[1])}`;
    prev = p;
  }
  return d;
}

/** Caminho de area (linha + base), um poligono por trecho contiguo. */
export function areaPath(points: ReadonlyArray<[number, number] | null>, baseY: number): string {
  const runs: Array<Array<[number, number]>> = [];
  let cur: Array<[number, number]> = [];
  for (const p of points) {
    if (!p) {
      if (cur.length) runs.push(cur);
      cur = [];
    } else cur.push(p);
  }
  if (cur.length) runs.push(cur);
  return runs
    .map((r) => {
      const top = r.map((p, i) => `${i === 0 ? 'M' : 'L'}${f1(p[0])} ${f1(p[1])}`).join(' ');
      return `${top} L${f1(r[r.length - 1]![0])} ${f1(baseY)} L${f1(r[0]![0])} ${f1(baseY)} Z`;
    })
    .join(' ');
}

/** Ultimo ponto valido (para o marcador de "agora"). */
export function lastPoint(points: ReadonlyArray<[number, number] | null>): [number, number] | null {
  for (let i = points.length - 1; i >= 0; i--) if (points[i]) return points[i]!;
  return null;
}

// ---- eixo de tempo --------------------------------------------------------------------------------------------------

/** "agora", "-5 min", "-1 h", "-1 h 30" a partir de milissegundos atras. */
export function formatAgo(ms: number): string {
  const min = Math.round(ms / 60_000);
  if (min <= 0) return 'agora';
  if (min < 60) return `-${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `-${h} h` : `-${h} h ${String(m).padStart(2, '0')}`;
}

/** Ticks do eixo de tempo: posicao 0..1 (0 = mais antigo, 1 = agora) e rotulo. O span e o tempo coberto pelos dados. */
export function timeTicks(spanMs: number, count = 4): Array<{ at: number; label: string }> {
  const out: Array<{ at: number; label: string }> = [];
  if (!(spanMs > 0)) return [{ at: 1, label: 'agora' }];
  const steps = [60_000, 2 * 60_000, 5 * 60_000, 10 * 60_000, 15 * 60_000, 30 * 60_000, 60 * 60_000, 2 * 60 * 60_000];
  const want = spanMs / Math.max(1, count);
  const step = steps.find((s) => s >= want) ?? steps[steps.length - 1]!;
  for (let ago = 0; ago <= spanMs + 1; ago += step) out.push({ at: 1 - ago / spanMs, label: formatAgo(ago) });
  return out.reverse();
}

export const WINDOW_LABEL: Readonly<Record<NocWindow, string>> = { 15: '15 min', 60: '1 h', 360: '6 h' };

// ---- numeros e textos -----------------------------------------------------------------------------------------------

export function formatInt(n: number): string {
  return Math.round(n).toLocaleString('pt-BR');
}
export function formatTemp(n: number): string {
  return `${(Math.round(n * 10) / 10).toFixed(1).replace('.', ',')} °C`;
}
export function formatPercent(n: number): string {
  return `${(Math.round(n * 10) / 10).toString().replace('.', ',')}%`;
}
/** 93 -> "1 min", 3 725 -> "1 h 02 min", 90 000 -> "1 d 1 h". */
export function formatUptimeShort(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d} d ${h} h`;
  if (h > 0) return `${h} h ${String(m).padStart(2, '0')} min`;
  if (m > 0) return `${m} min`;
  return `${s} s`;
}
export function formatClock(at: number): string {
  const d = new Date(at);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// ---- gauge de temperatura -------------------------------------------------------------------------------------------

export const GAUGE_MIN = 16;
export const GAUGE_MAX = 36;
export const GAUGE_START = 135; // graus (0 = leste, sentido horario): arco de 270 graus aberto embaixo
export const GAUGE_SWEEP = 270;

/** Fracao 0..1 de `value` no arco do gauge. */
export const gaugeFraction = (value: number, min = GAUGE_MIN, max = GAUGE_MAX): number => Math.min(1, Math.max(0, (value - min) / (max - min || 1)));

const rad = (deg: number) => (deg * Math.PI) / 180;
export function polar(cx: number, cy: number, r: number, deg: number): [number, number] {
  return [Math.round((cx + r * Math.cos(rad(deg))) * 100) / 100, Math.round((cy + r * Math.sin(rad(deg))) * 100) / 100];
}
/** Arco SVG entre as fracoes `f0` e `f1` (0..1) do gauge. */
export function gaugeArc(cx: number, cy: number, r: number, f0: number, f1v: number): string {
  const a0 = GAUGE_START + GAUGE_SWEEP * Math.min(f0, f1v);
  const a1 = GAUGE_START + GAUGE_SWEEP * Math.max(f0, f1v);
  if (a1 - a0 < 0.01) return '';
  const [x0, y0] = polar(cx, cy, r, a0);
  const [x1, y1] = polar(cx, cy, r, a1);
  const large = a1 - a0 > 180 ? 1 : 0;
  return `M${x0} ${y0} A${r} ${r} 0 ${large} 1 ${x1} ${y1}`;
}
export type TempZone = 'ok' | 'warm' | 'hot';
/** Faixa de cor: normal, quente (acima da meta + 3) e alerta de superaquecimento (30 C, como o servidor). */
export function tempZone(temp: number, target: number, on: boolean): TempZone {
  if (temp >= 30) return 'hot';
  if (temp >= (on ? target + 3 : 28)) return 'warm';
  return 'ok';
}

// ---- barras e eventos -----------------------------------------------------------------------------------------------

/** Largura (0..1) de cada barra pela maior contagem (nunca 0 para quem tem gente, para a barra aparecer). */
export function barFractions(counts: readonly number[]): number[] {
  const max = Math.max(1, ...counts);
  return counts.map((c) => (c <= 0 ? 0 : Math.max(0.04, c / max)));
}

export const EVENT_ICON: Readonly<Record<NocEvent['kind'], string>> = { mass_join: '▲', mass_leave: '▼', overheat: '!', overheat_clear: '✓', quota: '◔' };
