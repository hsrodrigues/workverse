import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type HTMLAttributes,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { clampPos, parsePos, type Pos } from './windowGeometry';
import './window.css';

/** Em telas até esta largura as janelas abrem fixas (sem arrastar), como já definem os CSS de cada painel. */
const NARROW = '(max-width: 640px)';
const STORAGE_PREFIX = 'wv.win.';
const DRAG_THRESHOLD = 4;
const INTERACTIVE = 'button, a, input, select, textarea, label, [data-nodrag]';

/** Contador de empilhamento: a janela clicada por último fica por cima das outras janelas. */
let zTop = 20;

function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(() => typeof matchMedia === 'function' && matchMedia(NARROW).matches);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const mq = matchMedia(NARROW);
    const on = () => setNarrow(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return narrow;
}

function loadPos(id: string): Pos | null {
  try {
    return parsePos(localStorage.getItem(STORAGE_PREFIX + id));
  } catch {
    return null;
  }
}
function savePos(id: string, p: Pos) {
  try {
    localStorage.setItem(STORAGE_PREFIX + id, JSON.stringify(p));
  } catch {
    /* armazenamento indisponível: a posição só vale nesta sessão */
  }
}

export interface WindowProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  /** Identificador estável: chave da posição lembrada em localStorage. */
  id: string;
  /** Se informado, a janela desenha barra de título (.win-title) + corpo (.win-body). Senão, `children` traz o próprio cabeçalho. */
  title?: ReactNode;
  /** Mostra o botão × e fecha com Esc (quando o foco está dentro da janela). */
  onClose?: () => void;
  closeLabel?: string;
  /** Seletor CSS (dentro da janela) da área de arrasto. Padrão: a barra de título. */
  handle?: string;
  bodyClassName?: string;
}

/**
 * Janela flutuante arrastável (mouse e toque) pela barra de título.
 * Limita à viewport, vai ao primeiro plano ao clicar, lembra a posição e se reajusta quando a tela muda.
 * Em telas estreitas não arrasta: usa o posicionamento do CSS do painel.
 */
export const Window = forwardRef<HTMLDivElement, WindowProps>(function Window(
  { id, title, onClose, closeLabel = 'Fechar', handle = '.win-title', bodyClassName, className, style, children, onKeyDown, ...rest },
  fwd,
) {
  const root = useRef<HTMLDivElement>(null);
  useImperativeHandle(fwd, () => root.current as HTMLDivElement);
  const narrow = useNarrow();
  const [pos, setPos] = useState<Pos | null>(() => loadPos(id));
  const [z, setZ] = useState(() => ++zTop);
  const [dragging, setDragging] = useState(false);
  const cleanup = useRef<(() => void) | null>(null);

  const reclamp = useCallback(() => {
    const el = root.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos((p) => {
      if (!p) return p;
      const c = clampPos(p, { w: r.width, h: r.height }, window.innerWidth, window.innerHeight);
      return c.x === p.x && c.y === p.y ? p : c;
    });
  }, []);

  useLayoutEffect(() => {
    reclamp();
    const el = root.current;
    const ro = typeof ResizeObserver === 'function' && el ? new ResizeObserver(reclamp) : null;
    if (ro && el) ro.observe(el);
    window.addEventListener('resize', reclamp);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', reclamp);
    };
  }, [reclamp, narrow]);

  useEffect(() => () => cleanup.current?.(), []);

  const raise = () => setZ((cur) => (cur === zTop ? cur : ++zTop));

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    raise();
    const el = root.current;
    if (!el || narrow || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const target = e.target as Element;
    const grip = target.closest(handle);
    if (!grip || !el.contains(grip)) return;
    const inner = target.closest(INTERACTIVE);
    if (inner && inner !== grip && grip.contains(inner)) return;

    const rect = el.getBoundingClientRect();
    const start = { px: e.clientX, py: e.clientY, x: rect.left, y: rect.top };
    const size = { w: rect.width, h: rect.height };
    let moved = false;
    let last: Pos = { x: start.x, y: start.y };

    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return;
      const dx = ev.clientX - start.px;
      const dy = ev.clientY - start.py;
      if (!moved) {
        if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
        moved = true;
        setDragging(true);
      }
      ev.preventDefault();
      last = clampPos({ x: start.x + dx, y: start.y + dy }, size, window.innerWidth, window.innerHeight);
      setPos(last);
    };
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      cleanup.current = null;
    };
    const up = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return;
      stop();
      if (!moved) return;
      setDragging(false);
      savePos(id, last);
      // Se a área de arrasto também é um botão (ex.: cabeçalho do dock), o fim do arrasto não pode acionar o clique.
      const eat = (c: MouseEvent) => {
        c.stopPropagation();
        c.preventDefault();
      };
      window.addEventListener('click', eat, { capture: true, once: true });
      setTimeout(() => window.removeEventListener('click', eat, { capture: true }), 0);
    };
    cleanup.current?.();
    cleanup.current = stop;
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  const keyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(e);
    if (e.key === 'Escape' && onClose && !e.defaultPrevented && title !== undefined) {
      e.stopPropagation();
      onClose();
    }
  };

  const placed = pos && !narrow;
  const css: CSSProperties = {
    ...style,
    zIndex: z,
    ...(placed ? { position: 'fixed', left: pos.x, top: pos.y, right: 'auto', bottom: 'auto', transform: 'none', margin: 0 } : null),
  };
  const cls = ['wv-window', narrow ? '' : 'wv-drag', dragging ? 'wv-dragging' : '', className ?? ''].filter(Boolean).join(' ');

  return (
    <div {...rest} ref={root} className={cls} style={css} data-window={id} onPointerDown={onPointerDown} onKeyDown={keyDown}>
      {title !== undefined ? (
        <>
          <div className="win-title">
            <span>{title}</span>
            {onClose && (
              <button type="button" className="x" onClick={onClose} aria-label={closeLabel}>
                ×
              </button>
            )}
          </div>
          <div className={`win-body ${bodyClassName ?? ''}`}>{children}</div>
        </>
      ) : (
        children
      )}
    </div>
  );
});
