import { useCallback, useEffect, useState } from 'react';
import type { AuditRecord } from '@workverse/shared';
import { useWorld } from '../../worldStore';
import { Chip, Field, fmtDateTime, fmtTime, usePanel } from './staffUi';
import { staffApi, type AuditFilters } from './staffApi';

const ACTIONS = [
  ['', 'Todas as ações'],
  ['mute', 'Silenciar'],
  ['unmute', 'Liberar'],
  ['kick', 'Expulsões'],
  ['goto', 'Ir até'],
  ['bring', 'Trazer'],
  ['announce', 'Avisos'],
  ['dm', 'Mensagem de staff'],
  ['room', 'Salas'],
  ['account', 'Contas'],
  ['staff', 'Equipe de staff'],
  ['item', 'Itens'],
  ['audit', 'Exportações'],
] as const;

/** `YYYY-MM-DD` do campo de data -> ms no horário local (fim do dia quando `end`). */
const dayMs = (v: string, end: boolean): number | undefined => {
  if (!v) return undefined;
  const d = new Date(`${v}T${end ? '23:59:59.999' : '00:00:00'}`);
  return Number.isNaN(d.getTime()) ? undefined : d.getTime();
};

export function LogTab() {
  const w = useWorld();
  const p = usePanel();
  const full = p.level !== 'helper';
  const [actor, setActor] = useState('');
  const [target, setTarget] = useState('');
  const [action, setAction] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [rows, setRows] = useState<AuditRecord[]>([]);
  const [loaded, setLoaded] = useState(false);
  const { run } = p;

  const filters = (): AuditFilters => ({ actor: actor.trim() || undefined, target: target.trim() || undefined, action: action || undefined, from: dayMs(from, false), to: dayMs(to, true) });

  const search = useCallback(
    async (f: AuditFilters) => {
      const r = await run(() => staffApi.audit(f));
      if (r) setRows(r);
      setLoaded(true);
    },
    [run],
  );
  useEffect(() => {
    if (full) void search({});
  }, [full, search]);

  if (!full) {
    return (
      <div data-testid="staff-tab-log">
        <p className="sf-hint sf-banner">O histórico completo com filtros e exportação é para moderadores e administradores. Abaixo, as últimas ações ao vivo.</p>
        <ol className="sf-log" data-testid="staff-log">
          {[...w.staffLog].reverse().map((l, i) => (
            <li key={`${l.at}-${i}`}>
              <time>{fmtTime(l.at)}</time> <b>{l.actor}</b> {l.action}
              {l.target ? ` → ${l.target}` : ''}
              {l.detail ? <span className="sf-detail"> ({l.detail})</span> : null}
            </li>
          ))}
          {w.staffLog.length === 0 && <li className="sf-empty">Nenhuma ação registrada.</li>}
        </ol>
      </div>
    );
  }

  return (
    <div data-testid="staff-tab-log">
      <form
        className="sf-card"
        onSubmit={(e) => {
          e.preventDefault();
          void search(filters());
        }}
      >
        <div className="sf-grid3">
          <Field label="Quem agiu (staff)">
            <input className="sf-input" value={actor} maxLength={64} onChange={(e) => setActor(e.target.value)} data-testid="staff-log-actor" />
          </Field>
          <Field label="Alvo">
            <input className="sf-input" value={target} maxLength={64} onChange={(e) => setTarget(e.target.value)} data-testid="staff-log-target" />
          </Field>
          <Field label="Ação">
            <select className="sf-input sf-select" value={action} onChange={(e) => setAction(e.target.value)} data-testid="staff-log-action">
              {ACTIONS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </Field>
          <Field label="De">
            <input className="sf-input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} data-testid="staff-log-from" />
          </Field>
          <Field label="Até">
            <input className="sf-input" type="date" value={to} onChange={(e) => setTo(e.target.value)} data-testid="staff-log-to" />
          </Field>
        </div>
        <div className="sf-group">
          <button className="mini gold" data-testid="staff-log-search">
            Filtrar
          </button>
          <button
            type="button"
            className="mini"
            onClick={() => {
              setActor('');
              setTarget('');
              setAction('');
              setFrom('');
              setTo('');
              void search({});
            }}
          >
            Limpar
          </button>
          <button type="button" className="mini" onClick={() => void run(() => staffApi.downloadAudit(filters()), 'Exportação iniciada (CSV).')} data-testid="staff-log-export">
            Exportar CSV
          </button>
        </div>
      </form>

      <div className="sf-count">
        <strong>{rows.length}</strong> registro{rows.length === 1 ? '' : 's'} {rows.length >= 300 && '(mostrando os 300 mais recentes; use os filtros ou exporte)'}
      </div>
      <div className="sf-tablewrap">
        <table className="sf-table" data-testid="staff-audit-table">
          <thead>
            <tr>
              <th>Quando</th>
              <th>Staff</th>
              <th>Ação</th>
              <th>Alvo</th>
              <th>Detalhe</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="nowrap">{fmtDateTime(r.at)}</td>
                <td>
                  {r.actor} {r.level && <Chip>{r.level}</Chip>}
                </td>
                <td>
                  <code>{r.action}</code>
                </td>
                <td>{r.target ?? ''}</td>
                <td className="sf-detail">{r.detail ?? ''}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="sf-empty">
                  {loaded ? 'Nada encontrado com esses filtros.' : 'Carregando…'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
