import { useEffect, useState } from 'react';
import type { RoomAdminEntry, RoomOp } from '@workverse/shared';
import { net } from '../../net';
import { useWorld } from '../../worldStore';
import { Chip, usePanel } from './staffUi';

const STATE_LABEL = { open: 'aberta', locked: 'trancada', closed: 'fechada' } as const;

export function RoomsTab() {
  const w = useWorld();
  const p = usePanel();
  // População em tempo real: pede ao abrir e a cada 4 s enquanto a aba estiver à vista.
  useEffect(() => {
    if (!p.online) return;
    net.send({ t: 'staff_rooms' });
    const id = setInterval(() => net.send({ t: 'staff_rooms' }), 4000);
    return () => clearInterval(id);
  }, [p.online]);

  const orgs = new Map<string, RoomAdminEntry[]>();
  for (const r of w.staffRooms) orgs.set(r.orgName, [...(orgs.get(r.orgName) ?? []), r]);
  const total = w.staffRooms.reduce((n, r) => n + r.count, 0);

  return (
    <div data-testid="staff-tab-rooms">
      <div className="sf-count">
        <strong>{total}</strong> pessoas em {w.staffRooms.filter((r) => r.count > 0).length} sala(s) com gente
      </div>
      {[...orgs.entries()].map(([orgName, rooms]) => (
        <section key={orgName} className="sf-org" aria-label={`Salas de ${orgName}`}>
          <h3 className="sf-h">{orgName}</h3>
          <ul className="sf-list">
            {rooms.map((r) => (
              <RoomRow key={`${r.orgId}/${r.roomId}`} r={r} />
            ))}
          </ul>
        </section>
      ))}
      {w.staffRooms.length === 0 && <p className="sf-empty">Carregando salas…</p>}
    </div>
  );
}

function RoomRow({ r }: { r: RoomAdminEntry }) {
  const p = usePanel();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [noting, setNoting] = useState(false);
  const op = (o: RoomOp, ok: string) => p.cmd({ t: 'staff_room', orgId: r.orgId, roomId: r.roomId, op: o }, ok);
  const control = p.can('rooms.control') && !r.landing;
  const tip = r.landing ? 'A sala inicial não pode ser trancada, fechada nem esvaziada.' : undefined;

  const empty = async () => {
    const ok = await p.confirm({
      title: `Esvaziar ${r.name}?`,
      message: (
        <>
          Todas as pessoas de <b>{r.name}</b> ({r.count}) serão mandadas para a sala inicial.
        </>
      ),
      confirmLabel: 'Esvaziar',
      danger: true,
    });
    if (ok) op('empty', `${r.name} esvaziada.`);
  };
  const close = async () => {
    const ok = await p.confirm({
      title: `Fechar ${r.name}?`,
      message: (
        <>
          A sala fica fechada para todos (exceto staff em serviço) e as {r.count} pessoas que estão nela vão para a sala inicial. O estado volta a “aberta” se o servidor reiniciar.
        </>
      ),
      confirmLabel: 'Fechar sala',
      danger: true,
    });
    if (ok) op('close', `${r.name} fechada.`);
  };

  return (
    <li className="sf-roomrow" data-testid={`staff-room-${r.roomId}`}>
      <div className="sf-roomhead">
        <b>{r.name}</b>
        <Chip tone={r.state === 'open' ? 'ok' : 'bad'}>{STATE_LABEL[r.state]}</Chip>
        <span className="sf-pop" title="Pessoas na sala">
          {r.count}/{r.max}
        </span>
        <button type="button" className="mini" onClick={() => setOpen(!open)} aria-expanded={open} disabled={r.count === 0} data-testid={`staff-room-who-${r.roomId}`}>
          {open ? 'Ocultar quem está' : 'Ver quem está'}
        </button>
      </div>
      {open && (
        <ul className="sf-who" aria-label={`Quem está em ${r.name}`}>
          {r.players.map((pl) => (
            <li key={pl.id}>{pl.name}</li>
          ))}
        </ul>
      )}
      <div className="sf-group" role="group" aria-label={`Ações em ${r.name}`}>
        <button type="button" className={`mini ${noting ? 'on' : ''}`} disabled={!p.can('announce.room')} onClick={() => setNoting(!noting)} aria-expanded={noting} data-testid={`staff-room-notice-${r.roomId}`}>
          Avisar sala…
        </button>
        {r.state === 'locked' ? (
          <button type="button" className="mini" disabled={!control} title={tip} onClick={() => op('unlock', `${r.name} destrancada.`)} data-testid={`staff-room-unlock-${r.roomId}`}>
            Destrancar
          </button>
        ) : (
          <button type="button" className="mini" disabled={!control || r.state === 'closed'} title={tip} onClick={() => op('lock', `${r.name} trancada: ninguém novo entra.`)} data-testid={`staff-room-lock-${r.roomId}`}>
            Trancar
          </button>
        )}
        {r.state === 'closed' ? (
          <button type="button" className="mini gold" disabled={!control} title={tip} onClick={() => op('open', `${r.name} reaberta.`)} data-testid={`staff-room-open-${r.roomId}`}>
            Reabrir
          </button>
        ) : (
          <button type="button" className="mini danger" disabled={!control} title={tip} onClick={() => void close()} data-testid={`staff-room-close-${r.roomId}`}>
            Fechar
          </button>
        )}
        <button type="button" className="mini danger" disabled={!control || r.count === 0} title={tip} onClick={() => void empty()} data-testid={`staff-room-empty-${r.roomId}`}>
          Esvaziar
        </button>
      </div>
      {noting && (
        <form
          className="sf-sub sf-inline"
          onSubmit={(e) => {
            e.preventDefault();
            if (!note.trim()) return;
            p.cmd({ t: 'staff_announce', scope: 'room', orgId: r.orgId, roomId: r.roomId, text: note.trim() }, `Aviso enviado à sala ${r.name}.`);
            setNote('');
            setNoting(false);
          }}
        >
          <input className="sf-input" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} placeholder={`Aviso para ${r.name}`} aria-label={`Aviso para ${r.name}`} autoFocus data-testid={`staff-room-notice-text-${r.roomId}`} />
          <button className="mini gold" disabled={!note.trim()} data-testid={`staff-room-notice-send-${r.roomId}`}>
            Enviar
          </button>
        </form>
      )}
    </li>
  );
}
