import { useState } from 'react';
import { EVENT_DEFS, ITEMS, formatDayMonth, nextEventSpan, type EventMode } from '@workverse/shared';
import { rawEvents, serverEvents, useEventsVersion } from '../../eventsStore';
import { Chip, Field, usePanel } from './staffUi';

/**
 * Eventos e comemoracoes: datas, estado (automatico / forcado), itens de avatar que cada evento libera, e botoes para
 * ligar/desligar o evento (staff_event, nivel moderador) e conceder/revogar `event:<id>` ou `item:<id>` a uma conta
 * (staff_item, nivel administrador). O servidor valida nivel, servico e taxa, e registra tudo no log de auditoria.
 */
export function EventsTab() {
  const p = usePanel();
  useEventsVersion();
  const [target, setTarget] = useState('');
  const view = serverEvents();
  const active = new Set(rawEvents().map((e) => e.id as string));
  const now = new Date();
  const set = (id: string, mode: EventMode, label: string) => p.cmd({ t: 'staff_event', id, mode }, label);
  const grant = (key: string, on: boolean) => p.cmd({ t: 'staff_item', target: target.trim(), key, grant: on }, `${on ? 'Concedido' : 'Revogado'} ${key}.`);

  return (
    <div data-testid="staff-tab-events-body">
      <div className="sf-card">
        <h3 className="sf-card-title">Eventos</h3>
        <p className="sf-hint">Automático segue a data do servidor. “Forçar” liga na hora para todos; “Desligar” apaga a decoração mesmo na data. Os itens do evento ficam liberados enquanto ele estiver ativo.</p>
        <Field label="Conta para conceder / revogar (nome ou id)">
          <input className="sf-input" value={target} maxLength={64} onChange={(e) => setTarget(e.target.value)} data-testid="staff-event-target" />
        </Field>
      </div>
      {EVENT_DEFS.map((e) => {
        const span = nextEventSpan(e, now, { companyDate: null });
        const mode: EventMode = view?.forced.includes(e.id) ? 'on' : view?.disabled.includes(e.id) ? 'off' : 'auto';
        const items = ITEMS.filter((i) => i.unlock === `event:${e.id}`);
        return (
          <div className="sf-card" key={e.id} data-testid={`staff-event-${e.id}`}>
            <h4 className="sf-card-title">
              {e.name} {active.has(e.id) ? <Chip tone="gold">Ativo</Chip> : <Chip>Inativo</Chip>} <Chip>{mode === 'auto' ? 'Automático' : mode === 'on' ? 'Forçado ligado' : 'Forçado desligado'}</Chip>
            </h4>
            <p className="sf-hint">
              {e.blurb} {span ? `Datas: ${formatDayMonth(span.start)} a ${formatDayMonth(span.end)}.` : 'Data configurada pela empresa (WORKVERSE_COMPANY_DATE).'}
              {e.optIn ? ' Opcional (WORKVERSE_OPTIONAL_EVENTS).' : ''}
            </p>
            <div className="sf-group">
              <button type="button" className="mini gold" disabled={!p.can('events.control') || mode === 'on'} onClick={() => set(e.id, 'on', `Evento ${e.name} forçado.`)} data-testid={`staff-event-on-${e.id}`}>
                Ativar
              </button>
              <button type="button" className="mini" disabled={!p.can('events.control') || mode === 'off'} onClick={() => set(e.id, 'off', `Evento ${e.name} desligado.`)} data-testid={`staff-event-off-${e.id}`}>
                Desativar
              </button>
              <button type="button" className="mini" disabled={!p.can('events.control') || mode === 'auto'} onClick={() => set(e.id, 'auto', `Evento ${e.name} volta ao automático.`)}>
                Automático
              </button>
            </div>
            {items.length > 0 && (
              <ul className="sf-powers">
                {items.map((i) => (
                  <li key={i.id} className="ok">
                    <span>
                      {i.name} <small>({i.id})</small>
                    </span>{' '}
                    <button type="button" className="mini" disabled={!p.can('item.grant') || !target.trim()} onClick={() => grant(`item:${i.id}`, true)}>
                      Conceder
                    </button>{' '}
                    <button type="button" className="mini" disabled={!p.can('item.grant') || !target.trim()} onClick={() => grant(`item:${i.id}`, false)}>
                      Revogar
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="sf-group">
              <button type="button" className="mini" disabled={!p.can('item.grant') || !target.trim()} onClick={() => grant(`event:${e.id}`, true)}>
                Conceder todos os itens do evento
              </button>
              <button type="button" className="mini" disabled={!p.can('item.grant') || !target.trim()} onClick={() => grant(`event:${e.id}`, false)}>
                Revogar
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
