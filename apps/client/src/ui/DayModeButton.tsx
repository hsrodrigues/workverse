import { Icon } from '../media/icons';
import { useEffect, useState } from 'react';
import { getDayMode, onDayMode, setDayMode, type DayMode } from '../game/dayCycle';
import { listen } from '../bus';
import { isDecorOff, rawEvents, setDecorEnabled, useEventsVersion } from '../eventsStore';

const OPTIONS: ReadonlyArray<{ id: DayMode; label: string }> = [
  { id: 'auto', label: 'Automático (hora do computador)' },
  { id: 'day', label: 'Sempre dia' },
  { id: 'night', label: 'Sempre noite' },
];

/** Botão de configurações do ambiente: ciclo de dia automático, sempre dia ou sempre noite. */
export function DayModeButton() {
  const [open, setOpen] = useState<{ x: number; y: number } | null>(null);
  const [mode, setMode] = useState<DayMode>(getDayMode());
  useEventsVersion();
  const events = rawEvents();

  useEffect(() => onDayMode(() => setMode(getDayMode())), []);
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(null);
    const off = listen('closeMenus', close);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    const onDown = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('.daymode-menu, .daymode-btn')) close();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onDown);
    return () => {
      off();
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onDown);
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        className="tool daymode-btn"
        data-testid="daymode-btn"
        title="Configurações: ciclo de dia"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setOpen(open ? null : { x: Math.max(8, Math.min(r.left, window.innerWidth - 250)), y: window.innerHeight - r.top + 8 });
        }}
      >
        <span className="ico"><Icon name="contrast" /></span>
      </button>
      {open && (
        <div className="ctx daymode-menu" style={{ left: open.x, bottom: open.y, width: 240 }} role="menu" aria-label="Ciclo de dia">
          <div className="ctx-title">Ciclo de dia</div>
          {OPTIONS.map((o) => (
            <button
              key={o.id}
              role="menuitemradio"
              aria-checked={mode === o.id}
              data-testid={`daymode-${o.id}`}
              onClick={() => {
                setDayMode(o.id);
                setOpen(null);
              }}
            >
              {mode === o.id ? '● ' : '○ '}
              {o.label}
            </button>
          ))}
          {events.length > 0 && (
            <>
              <div className="ctx-title">Evento: {events[0]!.name}</div>
              <button role="menuitemcheckbox" aria-checked={!isDecorOff()} data-testid="event-decor-toggle" onClick={() => setDecorEnabled(isDecorOff())}>
                {isDecorOff() ? '○ ' : '● '}
                Decoração de evento
              </button>
            </>
          )}
        </div>
      )}
    </>
  );
}
