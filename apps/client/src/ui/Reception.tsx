import { useEffect, useRef, useState } from 'react';
import { MAX_DIR_QUERY, RECEPTIONIST, badgeTextColor, receptionistSay, safeDeptColor, type DirEntry } from '@workverse/shared';
import { net } from '../net';
import { useWorld, worldStore } from '../worldStore';
import { Window } from './Window';
import { BadgeCard, paintBadgePhoto } from './BadgeCard';
import { furnishStore } from './furnish/furnishStore';

function Face() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (ref.current) paintBadgePhoto(ref.current, RECEPTIONIST.avatar, '#6c8cff');
  }, []);
  return <canvas ref={ref} width={40} height={40} className="rc-face" role="img" aria-label="Atendente" />;
}

function where(e: DirEntry, here: string | undefined): string {
  if (!e.online) return 'Offline';
  if (e.roomHidden) return 'Online, em uma sala privada';
  if (e.roomId && e.roomId === here) return `Online, aqui na sala (${e.roomName})`;
  return e.roomName ? `Online em ${e.roomName}` : 'Online';
}

/** Painel "Atendimento": a atendente da recepção pergunta o setor, depois o nome, e mostra o crachá de quem foi encontrado. */
export function ReceptionPanel({ onWalkNear }: { onWalkNear(id: string): void }) {
  const w = useWorld();
  const { dir } = w;
  const [picked, setPicked] = useState(false);
  const [dept, setDept] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const first = useRef(true);

  // Busca (com pequena espera ao digitar). A primeira montagem não busca: o painel já pediu a lista de setores.
  useEffect(() => {
    if (!picked) return;
    if (first.current) first.current = false;
    const id = setTimeout(() => worldStore.dirSearch(dept, q), 250);
    return () => clearTimeout(id);
  }, [picked, dept, q]);

  if (!dir.open) return null;
  const depts = dir.result?.depts ?? [];
  const results = picked ? (dir.result?.results ?? []) : [];
  const say = receptionistSay({ picked, busy: dir.busy, count: results.length, truncated: dir.result?.truncated === true, deptChosen: dept !== null, notice: dir.notice });
  const pick = (id: string | null) => {
    setDept(id);
    setPicked(true);
  };

  const go = (e: DirEntry) => {
    if (!e.roomId) return;
    if (e.roomId === w.room?.id) {
      const p = w.roster.find((r) => r.name === e.name);
      if (p) onWalkNear(p.id);
    } else net.send({ t: 'join', roomId: e.roomId });
    worldStore.closeReception();
  };

  return (
    <Window id="reception" className="win panel panel-reception" title="Atendimento" onClose={() => worldStore.closeReception()} role="dialog" aria-label="Atendimento da recepção">
      <div className="rc" data-testid="reception-panel">
        <div className="rc-says">
          <Face />
          <p className="rc-bubble" data-testid="reception-say" aria-live="polite">
            {say}
          </p>
        </div>

        <div className="rc-depts" role="group" aria-label="Setores">
          <button type="button" className={`rc-dept all ${picked && dept === null ? 'on' : ''}`} onClick={() => pick(null)} data-testid="reception-dept-all">
            Todos
          </button>
          {depts.map((d) => (
            <button
              key={d.id}
              type="button"
              className={`rc-dept ${dept === d.id ? 'on' : ''}`}
              style={{ background: safeDeptColor(d.color), color: badgeTextColor(d.color) }}
              onClick={() => pick(d.id)}
              aria-pressed={dept === d.id}
              data-testid={`reception-dept-${d.name}`}
            >
              {d.name}
            </button>
          ))}
        </div>

        {picked && (
          <input
            className="rc-input"
            type="search"
            value={q}
            maxLength={MAX_DIR_QUERY}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Nome da pessoa (pode ser só um pedaço)"
            aria-label="Nome da pessoa"
            autoFocus
            data-testid="reception-name"
          />
        )}

        <ul className="rc-results" data-testid="reception-results">
          {results.map((e) => (
            <li key={e.name} data-testid={`reception-result-${e.name}`}>
              {e.avatar ? <BadgeCard compact name={e.name} avatar={e.avatar} title={e.title} dept={e.dept} deptColor={e.deptColor} staff={e.staff} about={e.about} /> : <strong>{e.name}</strong>}
              <div className="rc-where">
                <span className={`rc-dot ${e.online ? 'on' : ''}`} aria-hidden="true" />
                <span data-testid="reception-where">{where(e, w.room?.id)}</span>
              </div>
              {!e.you && e.online && (
                <div className="rc-actions">
                  {e.roomId && (
                    <button type="button" className="mini" onClick={() => go(e)} data-testid="reception-go">
                      Ir até a sala
                    </button>
                  )}
                  <button type="button" className="mini" onClick={() => furnishStore.inviteToMeeting(e.name)} data-testid="reception-call">
                    Chamar
                  </button>
                  <button type="button" className="mini" onClick={() => worldStore.openConversation(e.name)}>
                    Mensagem
                  </button>
                </div>
              )}
              {!e.you && !e.online && (
                <div className="rc-actions">
                  <button type="button" className="mini" onClick={() => worldStore.openConversation(e.name)}>
                    Mensagem
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
        {dir.result?.truncated && picked && <p className="rc-more">Mostrando só as primeiras pessoas: digite parte do nome para refinar.</p>}
      </div>
    </Window>
  );
}
