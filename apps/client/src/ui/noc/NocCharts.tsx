import { useEffect, useRef, useState } from 'react';
import {
  GAUGE_MAX,
  GAUGE_MIN,
  areaPath,
  barFractions,
  extent,
  gaugeArc,
  gaugeFraction,
  lastPoint,
  linePath,
  linearScale,
  niceAxis,
  seriesPoints,
  tempZone,
  timeTicks,
  type Num,
} from './nocLogic';

/** Graficos SVG desenhados a mao (sem biblioteca). A largura vem do proprio elemento para o texto ficar nitido em qualquer tela. */

/** Largura em pixels do elemento (ResizeObserver); `fallback` antes de medir e em ambientes sem ResizeObserver. */
export function useWidth<T extends HTMLElement>(fallback = 320): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => setW(Math.max(120, Math.floor(el.clientWidth || fallback)));
    read();
    if (typeof ResizeObserver !== 'function') return;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [fallback]);
  return [ref, w];
}

export interface LineSeries {
  key: string;
  label: string;
  values: Num[];
  /** Cor CSS (variavel do tema). */
  color: string;
  area?: boolean;
  /** Linha em degraus tracejada (meta). */
  step?: boolean;
}

interface LineChartProps {
  series: LineSeries[];
  /** Tempo entre pontos (ms), para o eixo de tempo. */
  stepMs: number;
  height?: number;
  /** Contagens ancoram o eixo em 0. */
  floorZero?: boolean;
  /** Dominio minimo (ex.: temperatura nunca mostra uma faixa menor que 6 graus). */
  minSpan?: number;
  format: (n: number) => string;
  ariaLabel: string;
  testId?: string;
}

export function LineChart({ series, stepMs, height = 170, floorZero = false, minSpan = 0, format, ariaLabel, testId }: LineChartProps) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const ext = extent(series.map((s) => s.values));
  let lo = ext?.min ?? 0;
  let hi = ext?.max ?? 1;
  if (hi - lo < minSpan) {
    const mid = (hi + lo) / 2;
    lo = mid - minSpan / 2;
    hi = mid + minSpan / 2;
  }
  const { domain, ticks } = niceAxis(lo, hi, 4, floorZero);
  const left = 40;
  const right = 10;
  const top = 10;
  const bottom = 24;
  const box = { x: left, y: top, w: Math.max(40, width - left - right), h: height - top - bottom };
  const sy = linearScale(domain, box.y + box.h, box.y);
  const n = Math.max(0, ...series.map((s) => s.values.length));
  const span = Math.max(0, (n - 1) * stepMs);
  const xt = timeTicks(span, width < 420 ? 3 : 5);
  const empty = !ext;

  return (
    <div ref={ref} className="noc-chart" data-testid={testId}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={ariaLabel}>
        <title>{ariaLabel}</title>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={box.x} x2={box.x + box.w} y1={sy(t)} y2={sy(t)} className="noc-grid" />
            <text x={box.x - 6} y={sy(t) + 4} textAnchor="end" className="noc-axis">
              {format(t)}
            </text>
          </g>
        ))}
        {xt.map((t) => (
          <text key={t.at} x={box.x + t.at * box.w} y={height - 6} textAnchor={t.at <= 0.01 ? 'start' : t.at >= 0.99 ? 'end' : 'middle'} className="noc-axis">
            {t.label}
          </text>
        ))}
        {series.map((s) => {
          const pts = seriesPoints(s.values, box, domain);
          const last = lastPoint(pts);
          return (
            <g key={s.key} style={{ color: s.color }}>
              {s.area && <path d={areaPath(pts, box.y + box.h)} className="noc-area" />}
              <path d={linePath(pts, s.step)} className={`noc-line${s.step ? ' step' : ''}`} fill="none" />
              {last && !s.step && <circle cx={last[0]} cy={last[1]} r={3.5} className="noc-dot" />}
            </g>
          );
        })}
        {empty && (
          <text x={box.x + box.w / 2} y={box.y + box.h / 2} textAnchor="middle" className="noc-axis">
            Coletando dados...
          </text>
        )}
      </svg>
    </div>
  );
}

/** Miniatura de linha (cartoes): so a linha e a area, sem eixos. */
export function Sparkline({ values, color, height = 34, label }: { values: Num[]; color: string; height?: number; label: string }) {
  const [ref, width] = useWidth<HTMLDivElement>(120);
  const ext = extent([values]);
  const { domain } = niceAxis(ext?.min ?? 0, ext?.max ?? 1, 3, false);
  const box = { x: 2, y: 3, w: Math.max(20, width - 4), h: height - 6 };
  const pts = seriesPoints(values, box, domain);
  const last = lastPoint(pts);
  return (
    <div ref={ref} className="noc-spark">
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label} style={{ color }}>
        <title>{label}</title>
        <path d={areaPath(pts, box.y + box.h)} className="noc-area" />
        <path d={linePath(pts)} className="noc-line" fill="none" />
        {last && <circle cx={last[0]} cy={last[1]} r={2.5} className="noc-dot" />}
      </svg>
    </div>
  );
}

export interface BarRow {
  id: string;
  label: string;
  value: number;
  /** Texto a direita da barra. */
  note: string;
  alert?: boolean;
}

/** Barras horizontais (uma por linha, com rotulo e valor). */
export function HBars({ rows, ariaLabel, testId }: { rows: BarRow[]; ariaLabel: string; testId?: string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const rowH = 26;
  const labelW = Math.min(150, Math.floor(width * 0.4));
  const noteW = 52;
  const fr = barFractions(rows.map((r) => r.value));
  const trackW = Math.max(20, width - labelW - noteW - 8);
  const height = Math.max(rowH, rows.length * rowH);
  return (
    <div ref={ref} className="noc-chart" data-testid={testId}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={ariaLabel}>
        <title>{ariaLabel}</title>
        {rows.map((r, i) => {
          const y = i * rowH;
          return (
            <g key={r.id}>
              <text x={0} y={y + 16} className="noc-barlabel">
                {clip(r.label, Math.floor(labelW / 6.6))}
              </text>
              <rect x={labelW} y={y + 6} width={trackW} height={12} className="noc-track" />
              <rect x={labelW} y={y + 6} width={Math.round(trackW * fr[i]!)} height={12} className={`noc-bar${r.alert ? ' alert' : ''}`} />
              <text x={width} y={y + 16} textAnchor="end" className="noc-barnote">
                {r.note}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function clip(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, Math.max(1, max - 1))}…`;
}

/** Gauge de temperatura (arco de 270 graus) com a meta marcada e a leitura grande no centro. */
export function TempGauge({ temp, target, on, text }: { temp: number; target: number; on: boolean; text: string }) {
  const size = 168;
  const c = size / 2;
  const r = 66;
  const zone = tempZone(temp, target, on);
  const f = gaugeFraction(temp);
  const ft = gaugeFraction(target);
  // marcador da meta: pequeno traco radial
  const a = 135 + 270 * ft;
  const rad = (a * Math.PI) / 180;
  const m0 = [c + (r - 11) * Math.cos(rad), c + (r - 11) * Math.sin(rad)];
  const m1 = [c + (r + 9) * Math.cos(rad), c + (r + 9) * Math.sin(rad)];
  return (
    <svg className="noc-gauge" width={size} height={size - 14} viewBox={`0 0 ${size} ${size - 14}`} role="img" aria-label={text} data-zone={zone}>
      <title>{text}</title>
      <path d={gaugeArc(c, c, r, 0, 1)} className="noc-gauge-track" fill="none" />
      <path d={gaugeArc(c, c, r, 0, f)} className={`noc-gauge-fill ${zone}`} fill="none" />
      {on && <line x1={m0[0]} y1={m0[1]} x2={m1[0]} y2={m1[1]} className="noc-gauge-target" />}
      <text x={c} y={c + 6} textAnchor="middle" className={`noc-gauge-value ${zone}`}>
        {(Math.round(temp * 10) / 10).toFixed(1).replace('.', ',')}°
      </text>
      <text x={c} y={c + 26} textAnchor="middle" className="noc-axis">
        {on ? `meta ${target}°` : 'ar desligado'}
      </text>
      <text x={c - r + 2} y={size - 22} textAnchor="middle" className="noc-axis">
        {GAUGE_MIN}
      </text>
      <text x={c + r - 2} y={size - 22} textAnchor="middle" className="noc-axis">
        {GAUGE_MAX}
      </text>
    </svg>
  );
}

/** Medidor de 0..100 (cota e carga). */
export function Meter({ percent, tone, label }: { percent: number; tone: 'ok' | 'warn' | 'alert'; label: string }) {
  const p = Math.min(100, Math.max(0, percent));
  return (
    <div className={`noc-meter ${tone}`} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(p)} aria-label={label}>
      <i style={{ width: `${p}%` }} />
    </div>
  );
}
