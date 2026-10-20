import { useEffect, useState } from 'react';
import { AC_FAN_LABELS, AC_FAN_LIST, AC_MODE_LABELS, AC_MODE_LIST, AC_TIMER_OPTIONS, TARGET_MAX, TARGET_MIN, formatCountdown, tempDigits, type AcMode } from '@workverse/shared';
import { Icon } from '../../media/icons';
import { useWorld, worldStore } from '../../worldStore';
import './remote.css';

const MODE_ICON: Record<AcMode, 'snow' | 'leaf' | 'wind' | 'auto'> = { cool: 'snow', eco: 'leaf', fan: 'wind', auto: 'auto' };
const TIMER_LABEL: Record<number, string> = { 0: 'Sem timer', 30: '30 min', 60: '1 h', 120: '2 h' };

/**
 * Controle remoto do ar-condicionado da sala: abre ao clicar no split, na torre ou no termostato. Tudo que muda vai ao servidor
 * (`climate_set`) e volta pela mensagem `climate`; a tela mostra sempre o estado confirmado, igual para todos na sala.
 */
export function RemoteControl() {
  const w = useWorld();
  const c = w.climate;
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!w.remoteOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') worldStore.closeRemote();
    };
    window.addEventListener('keydown', onKey);
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      window.removeEventListener('keydown', onKey);
      clearInterval(id);
    };
  }, [w.remoteOpen]);

  if (!w.remoteOpen || !c) return null;
  const set = worldStore.climateSet;
  const left = w.climateEndsAt > 0 ? Math.max(0, w.climateEndsAt - now) : 0;
  const roomName = w.room?.name ?? 'Sala';

  return (
    <div className="rm-backdrop" onPointerDown={(e) => e.target === e.currentTarget && worldStore.closeRemote()} data-testid="remote-backdrop">
      <div className={`rm ${c.on ? 'on' : 'off'}`} role="dialog" aria-modal="true" aria-label={`Controle remoto do ar-condicionado: ${roomName}`} data-testid="remote-control">
        <div className="rm-head">
          <strong>{roomName}</strong>
          <button type="button" className="rm-x" onClick={() => worldStore.closeRemote()} aria-label="Fechar controle remoto" data-testid="remote-close">
            ×
          </button>
        </div>

        <div className="rm-lcd" aria-live="polite" data-testid="remote-lcd">
          <div className="rm-lcd-main">
            <span className="rm-target" data-testid="remote-target">{c.on ? c.target : '--'}</span>
            <span className="rm-unit">°C</span>
            <span className="rm-lcd-side">
              <span>{AC_MODE_LABELS[c.mode]}</span>
              <span>Vent. {AC_FAN_LABELS[c.fan]}</span>
              <span>Aletas {c.swing ? 'ON' : 'OFF'}</span>
            </span>
          </div>
          <div className="rm-lcd-foot">
            <span>Ambiente {tempDigits(c.temp)}°C</span>
            <span data-testid="remote-timer-left">{c.on && left > 0 ? `Desliga em ${formatCountdown(left)}` : c.on ? 'Ligado' : 'Desligado'}</span>
          </div>
        </div>

        <div className="rm-row rm-main">
          <button type="button" className="rm-btn" onClick={() => set({ target: Math.max(TARGET_MIN, c.target - 1) })} disabled={c.target <= TARGET_MIN} aria-label="Diminuir temperatura" data-testid="remote-down">
            <Icon name="down" size={22} />
          </button>
          <button type="button" className={`rm-btn rm-power ${c.on ? 'lit' : ''}`} onClick={() => set({ power: !c.on })} aria-pressed={c.on} data-testid="remote-power">
            <Icon name="power" size={22} /> {c.on ? 'Desligar' : 'Ligar'}
          </button>
          <button type="button" className="rm-btn" onClick={() => set({ target: Math.min(TARGET_MAX, c.target + 1) })} disabled={c.target >= TARGET_MAX} aria-label="Aumentar temperatura" data-testid="remote-up">
            <Icon name="up" size={22} />
          </button>
        </div>

        <div className="rm-label" id="rm-mode">Modo</div>
        <div className="rm-row" role="group" aria-labelledby="rm-mode">
          {AC_MODE_LIST.map((m) => (
            <button key={m} type="button" className="rm-btn rm-chip" aria-pressed={c.mode === m} onClick={() => set({ mode: m })} data-testid={`remote-mode-${m}`}>
              <Icon name={MODE_ICON[m]} size={16} /> {AC_MODE_LABELS[m]}
            </button>
          ))}
        </div>

        <div className="rm-label" id="rm-fan">Ventilador</div>
        <div className="rm-row" role="group" aria-labelledby="rm-fan">
          {AC_FAN_LIST.map((f) => (
            <button key={f} type="button" className="rm-btn rm-chip" aria-pressed={c.fan === f} onClick={() => set({ fan: f })} data-testid={`remote-fan-${f}`}>
              {AC_FAN_LABELS[f]}
            </button>
          ))}
        </div>

        <div className="rm-row rm-split">
          <button type="button" className="rm-btn rm-chip" aria-pressed={c.swing} onClick={() => set({ swing: !c.swing })} data-testid="remote-swing">
            <Icon name="swing" size={16} /> Aletas {c.swing ? 'ligadas' : 'desligadas'}
          </button>
        </div>

        <div className="rm-label" id="rm-timer">
          <Icon name="timer" size={14} /> Timer de desligamento
        </div>
        <div className="rm-row" role="group" aria-labelledby="rm-timer">
          {AC_TIMER_OPTIONS.map((m) => (
            <button key={m} type="button" className="rm-btn rm-chip" aria-pressed={m === 0 ? left === 0 : false} disabled={!c.on} onClick={() => set({ timerMin: m })} data-testid={`remote-timer-${m}`}>
              {TIMER_LABEL[m]}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
