import { useEffect, useState, type FormEvent } from 'react';
import type { RoomAccess } from '@workverse/shared';
import { furnishStore, useFurnish } from './furnishStore';

const OPTIONS: Array<{ id: RoomAccess; label: string; hint: string }> = [
  { id: 'org', label: 'Aberta para todos', hint: 'Qualquer pessoa da organização entra.' },
  { id: 'team', label: 'Só uma equipe', hint: 'Só quem está na equipe escolhida.' },
  { id: 'invited', label: 'Por convite', hint: 'Aparece na lista com cadeado; entra quem foi convidado.' },
  { id: 'private', label: 'Privada', hint: 'Como por convite, e o nome some para quem não tem acesso.' },
];

/** Rooms that must stay open to everybody (the server refuses to close them). */
const ALWAYS_OPEN = ['office', 'reception'];

const EXPIRY: Array<{ hours: number; label: string }> = [
  { hours: 1, label: '1 hora' },
  { hours: 8, label: '8 horas' },
  { hours: 24, label: '1 dia' },
  { hours: 72, label: '3 dias' },
  { hours: 168, label: '7 dias' },
  { hours: 720, label: '30 dias' },
  { hours: 0, label: 'Sem validade' },
];

function when(at: number | null): string {
  if (at === null) return 'sem validade';
  const left = at - Date.now();
  if (left <= 0) return 'expirado';
  const h = left / 3_600_000;
  return h < 1 ? `expira em ${Math.max(1, Math.round(left / 60_000))} min` : h < 48 ? `expira em ${Math.round(h)} h` : `expira em ${Math.round(h / 24)} dias`;
}

/** Access policy of a room and its guest list. People without `room.access.set` never get here; the server asks again. */
export function AccessTab() {
  const s = useFurnish();
  const [roomId, setRoomId] = useState(s.def?.id ?? '');
  const [who, setWho] = useState('');
  const [hours, setHours] = useState(72);
  const [teamId, setTeamId] = useState('');

  // follow the room the person is in
  useEffect(() => {
    if (s.def?.id) setRoomId(s.def.id);
  }, [s.def?.id]);
  useEffect(() => {
    if (roomId) furnishStore.loadAccess(roomId);
  }, [roomId]);

  const view = s.access[roomId];
  const entry = s.rooms.find((r) => r.id === roomId);
  const access = view?.access ?? entry?.access ?? 'org';
  const restricted = access === 'invited' || access === 'private';
  const locked = ALWAYS_OPEN.includes(roomId);

  useEffect(() => {
    if (view?.teamId) setTeamId(view.teamId);
    else if (view?.teams[0]) setTeamId((cur) => cur || view.teams[0]!.id);
  }, [view?.teamId, view?.teams]);

  const add = (e: FormEvent) => {
    e.preventDefault();
    const name = who.trim();
    if (!name) return;
    furnishStore.invite(roomId, name, hours);
    setWho('');
  };

  return (
    <div className="fz-access" data-testid="furnish-access">
      <label className="fz-field">
        Sala
        <select value={roomId} onChange={(e) => setRoomId(e.target.value)} aria-label="Sala" data-testid="access-room">
          {s.rooms.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </label>

      <div className="fz-radios" role="radiogroup" aria-label="Quem pode entrar">
        {OPTIONS.map((o) => (
          <label key={o.id} className={`fz-radio ${access === o.id ? 'on' : ''} ${locked && o.id !== 'org' ? 'off' : ''}`} title={o.hint}>
            <input
              type="radio"
              name="room-access"
              checked={access === o.id}
              disabled={locked && o.id !== 'org'}
              onChange={() => furnishStore.setAccess(roomId, o.id, o.id === 'team' ? teamId || view?.teams[0]?.id : null)}
              data-testid={`access-${o.id}`}
            />
            <span>
              <b>{o.label}</b>
              <small>{o.hint}</small>
            </span>
          </label>
        ))}
      </div>
      {locked && <div className="fz-hint">Esta sala é o ponto de chegada e precisa ficar aberta a todos.</div>}

      {access === 'team' && (
        <label className="fz-field">
          Equipe
          <select
            value={view?.teamId ?? teamId}
            onChange={(e) => {
              setTeamId(e.target.value);
              furnishStore.setAccess(roomId, 'team', e.target.value);
            }}
            aria-label="Equipe"
            data-testid="access-team"
          >
            {(view?.teams ?? []).map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
      )}

      {restricted && (
        <div className="fz-guests" data-testid="access-guests">
          <div className="fz-sub">Convidados ({view?.invites.length ?? 0})</div>
          <form className="fz-invite" onSubmit={add}>
            <input value={who} onChange={(e) => setWho(e.target.value)} placeholder="Nome ou e-mail" maxLength={120} aria-label="Nome ou e-mail da pessoa" data-testid="access-who" autoComplete="off" />
            <select value={hours} onChange={(e) => setHours(Number(e.target.value))} aria-label="Validade do convite" data-testid="access-hours">
              {EXPIRY.map((x) => (
                <option key={x.hours} value={x.hours}>
                  {x.label}
                </option>
              ))}
            </select>
            <button className="mini gold" disabled={!who.trim()} data-testid="access-add">
              Convidar
            </button>
          </form>
          <ul className="fz-list">
            {(view?.invites ?? []).map((i) => (
              <li key={i.accountId} data-testid={`access-guest-${i.name}`}>
                <span className="fz-who">
                  <b>{i.name}</b>
                  <small>
                    {when(i.expiresAt)} · por {i.invitedBy}
                  </small>
                </span>
                <button type="button" className="mini danger" onClick={() => furnishStore.uninvite(roomId, i.accountId)} title="Remover o convite (a pessoa é retirada da sala)">
                  Remover
                </button>
              </li>
            ))}
            {(view?.invites.length ?? 0) === 0 && <li className="fz-empty">Ninguém convidado ainda. Donos e administradores sempre entram.</li>}
          </ul>
        </div>
      )}
      {s.accessNotice && (
        <div className={`fz-notice ${s.accessNotice.kind}`} role="status" data-testid="access-notice">
          {s.accessNotice.text}
        </div>
      )}
    </div>
  );
}
