import { useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as RPointerEvent } from 'react';
import { buildContext, ifaceViews, type Topology } from '@workverse/shared';
import { ICON_SIZE, IconDefs } from './icons';
import { bounds, cableState } from './netsimLogic';

export type Selection = { kind: 'device'; id: string } | { kind: 'cable'; id: string } | null;
export type Tool = 'select' | 'cable';

interface Props {
  topo: Topology;
  selection: Selection;
  tool: Tool;
  /** Primeira ponta do cabo em andamento. */
  cableFrom: string | null;
  canEdit: boolean;
  zoom: number;
  onSelect(s: Selection): void;
  onMove(id: string, x: number, y: number): void;
  onCableClick(devId: string): void;
}

const HALF = ICON_SIZE / 2;

/** Canvas SVG da topologia: icones pixel art arrastaveis, cabos com LEDs verde/vermelho. */
export function NetsimCanvas({ topo, selection, tool, cableFrom, canEdit, zoom, onSelect, onMove, onCableClick }: Props) {
  const svg = useRef<SVGSVGElement>(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const panRef = useRef<{ px: number; py: number; x: number; y: number; moved: boolean } | null>(null);
  const [drag, setDrag] = useState<{ id: string; x: number; y: number; dx: number; dy: number; moved: boolean } | null>(null);
  const ctx = useMemo(() => buildContext(topo), [topo]);
  const box = useMemo(() => bounds(topo), [topo]);
  const byId = useMemo(() => new Map(topo.devices.map((d) => [d.id, d])), [topo]);
  const ips = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of topo.devices) {
      const v = ifaceViews(topo, d.id, ctx).find((x) => x.ip);
      if (v?.ip) m.set(d.id, v.ip);
    }
    return m;
  }, [topo, ctx]);

  const pos = (id: string) => {
    const d = byId.get(id)!;
    return drag && drag.id === id ? { x: drag.x, y: drag.y } : { x: d.x, y: d.y };
  };

  const toSvg = (e: { clientX: number; clientY: number }) => {
    const el = svg.current;
    const m = el?.getScreenCTM();
    if (!el || !m) return { x: 0, y: 0 };
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return { x: p.x, y: p.y };
  };

  const down = (e: RPointerEvent<SVGGElement>, id: string) => {
    e.stopPropagation();
    if (tool === 'cable') {
      onCableClick(id);
      return;
    }
    onSelect({ kind: 'device', id });
    if (!canEdit) return;
    const d = byId.get(id)!;
    const p = toSvg(e);
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    setDrag({ id, x: d.x, y: d.y, dx: p.x - d.x, dy: p.y - d.y, moved: false });
  };
  const moveEv = (e: RPointerEvent<SVGGElement>) => {
    if (!drag) return;
    const p = toSvg(e);
    const nx = Math.round(p.x - drag.dx);
    const ny = Math.round(p.y - drag.dy);
    if (nx === drag.x && ny === drag.y) return;
    setDrag({ ...drag, x: nx, y: ny, moved: true });
  };
  const up = () => {
    if (drag?.moved) onMove(drag.id, drag.x, drag.y);
    setDrag(null);
  };
  const key = (e: KeyboardEvent<SVGGElement>, id: string) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (tool === 'cable') onCableClick(id);
      else onSelect({ kind: 'device', id });
    }
  };

  const vw = box.w / zoom;
  const vh = box.h / zoom;
  const vx = box.x + (box.w - vw) / 2 + pan.x;
  const vy = box.y + (box.h - vh) / 2 + pan.y;

  const bgDown = (e: RPointerEvent<SVGSVGElement>) => {
    panRef.current = { px: e.clientX, py: e.clientY, x: pan.x, y: pan.y, moved: false };
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
  };
  const bgMove = (e: RPointerEvent<SVGSVGElement>) => {
    const p = panRef.current;
    const el = svg.current;
    if (!p || !el) return;
    const r = el.getBoundingClientRect();
    const dx = e.clientX - p.px;
    const dy = e.clientY - p.py;
    if (!p.moved && Math.abs(dx) + Math.abs(dy) < 4) return;
    p.moved = true;
    setPan({ x: p.x - (dx * vw) / (r.width || 1), y: p.y - (dy * vh) / (r.height || 1) });
  };
  const bgUp = () => {
    if (panRef.current && !panRef.current.moved) onSelect(null);
    panRef.current = null;
  };

  return (
    <svg
      ref={svg}
      className="ns-canvas"
      viewBox={`${vx} ${vy} ${vw} ${vh}`}
      role="group"
      aria-label={`Topologia da rede com ${topo.devices.length} dispositivos e ${topo.cables.length} cabos`}
      data-testid="netsim-canvas"
      onPointerDown={bgDown}
      onPointerMove={bgMove}
      onPointerUp={bgUp}
      onPointerCancel={() => (panRef.current = null)}
    >
      <IconDefs />
      <g className="ns-cables">
        {topo.cables.map((c) => {
          if (!byId.has(c.a.dev) || !byId.has(c.b.dev)) return null;
          const a = pos(c.a.dev);
          const b = pos(c.b.dev);
          const st = cableState(topo, c.id);
          const sel = selection?.kind === 'cable' && selection.id === c.id;
          const color = st.up ? '#3fb67a' : '#e5484d';
          const ax = a.x + HALF;
          const ay = a.y + HALF;
          const bx = b.x + HALF;
          const by = b.y + HALF;
          const led = (x0: number, y0: number, x1: number, y1: number) => {
            const len = Math.hypot(x1 - x0, y1 - y0) || 1;
            const t = Math.min(0.28, 26 / len);
            return { x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t };
          };
          const la = led(ax, ay, bx, by);
          const lb = led(bx, by, ax, ay);
          return (
            <g key={c.id} data-testid={`netsim-cable-${c.id}`} data-up={st.up ? '1' : '0'}>
              <line x1={ax} y1={ay} x2={bx} y2={by} stroke="transparent" strokeWidth={14} onPointerDown={(e) => { e.stopPropagation(); onSelect({ kind: 'cable', id: c.id }); }} style={{ cursor: 'pointer' }} />
              <line x1={ax} y1={ay} x2={bx} y2={by} stroke={sel ? '#ffd24a' : color} strokeWidth={sel ? 3 : 2} strokeDasharray={c.up ? undefined : '4 3'} pointerEvents="none" />
              <rect x={la.x - 3} y={la.y - 3} width={6} height={6} fill={color} stroke="#0b1020" strokeWidth={1} pointerEvents="none" />
              <rect x={lb.x - 3} y={lb.y - 3} width={6} height={6} fill={color} stroke="#0b1020" strokeWidth={1} pointerEvents="none" />
            </g>
          );
        })}
      </g>
      <g className="ns-devices">
        {topo.devices.map((d) => {
          const p = pos(d.id);
          const sel = selection?.kind === 'device' && selection.id === d.id;
          const ip = ips.get(d.id);
          return (
            <g
              key={d.id}
              transform={`translate(${p.x} ${p.y})`}
              className={`ns-dev${sel ? ' sel' : ''}${d.off ? ' off' : ''}${cableFrom === d.id ? ' from' : ''}`}
              role="button"
              tabIndex={0}
              aria-label={`${d.name}, ${d.kind}${ip ? `, IP ${ip}` : ''}${d.off ? ', desligado' : ''}`}
              aria-pressed={sel}
              data-testid={`netsim-dev-${d.name}`}
              onPointerDown={(e) => down(e, d.id)}
              onPointerMove={moveEv}
              onPointerUp={up}
              onPointerCancel={() => setDrag(null)}
              onKeyDown={(e) => key(e, d.id)}
              style={{ cursor: tool === 'cable' ? 'crosshair' : canEdit ? 'grab' : 'pointer' }}
            >
              <rect x={-4} y={-4} width={ICON_SIZE + 8} height={ICON_SIZE + 8} className="ns-halo" />
              <use href={`#nsi-${d.kind}`} opacity={d.off ? 0.4 : 1} />
              {d.off && <path d={`M0 0 L${ICON_SIZE} ${ICON_SIZE} M${ICON_SIZE} 0 L0 ${ICON_SIZE}`} stroke="#e5484d" strokeWidth={2} />}
              <text x={HALF} y={ICON_SIZE + 12} textAnchor="middle" className="ns-name">
                {d.name}
              </text>
              {ip && (
                <text x={HALF} y={ICON_SIZE + 23} textAnchor="middle" className="ns-ip">
                  {ip}
                </text>
              )}
            </g>
          );
        })}
      </g>
    </svg>
  );
}
