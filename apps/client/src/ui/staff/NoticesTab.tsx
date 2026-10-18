import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AuditRecord } from '@workverse/shared';
import { net } from '../../net';
import { useWorld } from '../../worldStore';
import { Chip, Field, fmtDateTime, usePanel } from './staffUi';
import { staffApi } from './staffApi';

type Scope = 'room' | 'org' | 'all';

export function NoticesTab() {
  const w = useWorld();
  const p = usePanel();
  const [scope, setScope] = useState<Scope>('room');
  const [orgId, setOrgId] = useState('');
  const [roomKey, setRoomKey] = useState('');
  const [text, setText] = useState('');
  const [highlight, setHighlight] = useState(false);
  const [history, setHistory] = useState<AuditRecord[]>([]);

  useEffect(() => {
    if (p.online) net.send({ t: 'staff_rooms' });
  }, [p.online]);

  const orgs = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of w.staffRooms) m.set(r.orgId, r.orgName);
    return [...m.entries()];
  }, [w.staffRooms]);
  useEffect(() => {
    if (!orgId && orgs[0]) setOrgId(orgs[0][0]);
  }, [orgs, orgId]);
  const rooms = w.staffRooms.filter((r) => r.orgId === orgId);
  useEffect(() => {
    if (scope === 'room' && !rooms.some((r) => r.roomId === roomKey) && rooms[0]) setRoomKey(rooms[0].roomId);
  }, [scope, rooms, roomKey]);

  const { run } = p;
  const load = useCallback(async () => {
    const r = await run(() => staffApi.announcements());
    if (r) setHistory(r);
  }, [run]);
  useEffect(() => {
    void load();
    // só ao abrir a aba
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const need = scope === 'all' ? 'announce.all' : scope === 'org' ? 'announce.org' : 'announce.room';
  const dest = scope === 'all' ? 'todas as pessoas online' : scope === 'org' ? `a organização ${orgs.find(([id]) => id === orgId)?.[1] ?? ''}` : `a sala ${rooms.find((r) => r.roomId === roomKey)?.name ?? ''}`;

  const send = async () => {
    const t = text.trim();
    if (!t) return;
    if (scope === 'all') {
      const ok = await p.confirm({
        title: 'Enviar aviso geral?',
        message: (
          <>
            O aviso aparece para <b>todas as pessoas online</b> de todas as organizações: “{t}”.
          </>
        ),
        confirmLabel: 'Enviar a todos',
      });
      if (!ok) return;
    }
    p.cmd(
      scope === 'all'
        ? { t: 'staff_announce', scope, text: t, highlight }
        : scope === 'org'
          ? { t: 'staff_announce', scope, orgId, text: t, highlight }
          : { t: 'staff_announce', scope, orgId, roomId: roomKey, text: t, highlight },
      'Aviso enviado.',
    );
    setText('');
    setTimeout(() => void load(), 700);
  };

  return (
    <div data-testid="staff-tab-notices">
      <form
        className="sf-card"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <h3 className="sf-card-title">Novo aviso</h3>
        <div className="sf-grid2">
          <Field label="Destino">
            <select className="sf-input sf-select" value={scope} onChange={(e) => setScope(e.target.value as Scope)} data-testid="staff-notice-scope">
              <option value="room">Uma sala</option>
              <option value="org">Uma organização</option>
              <option value="all">Todos online (global)</option>
            </select>
          </Field>
          {scope !== 'all' && (
            <Field label="Organização">
              <select className="sf-input sf-select" value={orgId} onChange={(e) => setOrgId(e.target.value)} data-testid="staff-notice-org">
                {orgs.map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {scope === 'room' && (
            <Field label="Sala">
              <select className="sf-input sf-select" value={roomKey} onChange={(e) => setRoomKey(e.target.value)} data-testid="staff-notice-room">
                {rooms.map((r) => (
                  <option key={r.roomId} value={r.roomId}>
                    {r.name} ({r.count})
                  </option>
                ))}
              </select>
            </Field>
          )}
        </div>
        <Field label={`Texto do aviso (até 200 caracteres) · vai para ${dest}`}>
          <textarea className="sf-input" rows={2} maxLength={200} value={text} onChange={(e) => setText(e.target.value)} data-testid="staff-announce-text" />
        </Field>
        <label className="sf-check">
          <input type="checkbox" checked={highlight} onChange={(e) => setHighlight(e.target.checked)} data-testid="staff-notice-highlight" /> Destaque (faixa maior e mais tempo na tela)
        </label>
        <div className="sf-group">
          <button className="mini gold" disabled={!p.can(need) || !text.trim() || (scope === 'room' && !roomKey)} data-testid="staff-announce-send">
            Enviar aviso
          </button>
          {!p.can('announce.org') && scope === 'org' && <span className="sf-hint">Avisar uma organização exige nível moderador.</span>}
          {!p.can('announce.all') && scope === 'all' && <span className="sf-hint">Aviso global exige nível moderador.</span>}
        </div>
      </form>

      <h3 className="sf-h">Histórico de avisos</h3>
      <ol className="sf-log" data-testid="staff-notice-history">
        {history.map((h) => (
          <li key={h.id}>
            <time>{fmtDateTime(h.at)}</time> <Chip>{h.action.replace('announce.', '')}</Chip> <b>{h.actor}</b>
            <span className="sf-detail"> {h.detail}</span>
          </li>
        ))}
        {history.length === 0 && <li className="sf-empty">Nenhum aviso ainda.</li>}
      </ol>
    </div>
  );
}
