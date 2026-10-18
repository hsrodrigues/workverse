import { useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent } from 'react';
import { STAFF_LABELS, staffCan, type StaffLevel } from '@workverse/shared';
import { net } from '../../net';
import { useNetStatus, useWorld, worldStore } from '../../worldStore';
import { Window } from '../Window';
import { AccountsTab } from './AccountsTab';
import { LogTab } from './LogTab';
import { ModeTab } from './ModeTab';
import { NoticesTab } from './NoticesTab';
import { OnlineTab } from './OnlineTab';
import { RoomsTab } from './RoomsTab';
import { StaffPanelProvider } from './staffUi';
import { TeamTab } from './TeamTab';
import './staff.css';

/**
 * Painel de staff da plataforma. So aparece para quem o SERVIDOR marcou como staff (`session.staff`); esconder a UI nao e
 * seguranca: cada acao e validada de novo no servidor (nivel, servico, alvo, taxa) e fica registrada na auditoria.
 * Todas as acoes tambem existem como botoes: os comandos de chat (/goto, /mute...) continuam funcionando.
 */

let open = false;
const listeners = new Set<() => void>();
const setOpen = (v: boolean) => {
  open = v;
  listeners.forEach((l) => l());
};
const useOpen = () =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => open,
  );

/** Selo dourado para listas (mesma identidade visual do selo sobre o avatar). */
export function StaffBadge({ level }: { level: StaffLevel }) {
  return (
    <span className="staff-badge" title={STAFF_LABELS[level]}>
      STAFF
    </span>
  );
}

export function StaffBarButton() {
  const { staff } = useWorld();
  const isOpen = useOpen();
  if (!staff) return null;
  return (
    <button type="button" className={`tool tool-staff ${isOpen ? 'on' : ''}`} onClick={() => setOpen(!isOpen)} title="Painel de staff" aria-pressed={isOpen} data-testid="staff-button">
      <span className="ico">★</span> Staff
    </button>
  );
}

type TabId = 'online' | 'rooms' | 'notices' | 'accounts' | 'team' | 'mode' | 'log';
const TABS: { id: TabId; label: string }[] = [
  { id: 'online', label: 'Online' },
  { id: 'rooms', label: 'Salas' },
  { id: 'notices', label: 'Avisos' },
  { id: 'accounts', label: 'Contas' },
  { id: 'team', label: 'Equipe staff' },
  { id: 'mode', label: 'Modo' },
  { id: 'log', label: 'Log' },
];

export function StaffPanel() {
  const w = useWorld();
  const isOpen = useOpen();
  const [conn] = useNetStatus();
  const [tab, setTab] = useState<TabId>('online');
  const tabRefs = useRef<Partial<Record<TabId, HTMLButtonElement | null>>>({});

  const level = w.staff?.level ?? null;
  const duty = w.staff?.duty === true;
  const online = conn === 'online';

  // Lista de online (so presenca): pede ao abrir e a cada 5 s enquanto o painel estiver aberto.
  useEffect(() => {
    if (!isOpen || !level || !online) return;
    net.send({ t: 'staff_list' });
    const id = setInterval(() => net.send({ t: 'staff_list' }), 5000);
    return () => clearInterval(id);
  }, [isOpen, level, online]);

  // Perdeu o acesso de staff (removido por um administrador): fecha o painel.
  useEffect(() => {
    if (!level && open) setOpen(false);
  }, [level]);

  if (!level || !isOpen) return null;

  const onKeys = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = TABS.findIndex((t) => t.id === tab);
    let n = i;
    if (e.key === 'ArrowRight') n = (i + 1) % TABS.length;
    else if (e.key === 'ArrowLeft') n = (i - 1 + TABS.length) % TABS.length;
    else if (e.key === 'Home') n = 0;
    else if (e.key === 'End') n = TABS.length - 1;
    else return;
    e.preventDefault();
    const next = TABS[n]!.id;
    setTab(next);
    tabRefs.current[next]?.focus();
  };

  return (
    <Window id="staff" className="win panel panel-staff" role="dialog" aria-label="Painel de staff" title={`Staff · ${STAFF_LABELS[level]}`} onClose={() => setOpen(false)}>
      <StaffPanelProvider level={level} duty={duty} online={online} selfId={w.youId}>
        <div className="staff-body" data-testid="staff-panel">
          <div className="sf-top">
            <span className="sf-top-count" data-testid="staff-total">
              <b>{w.staffOnline.length}</b> online
            </span>
            <span className={`sf-top-duty ${duty ? 'on' : ''}`}>{duty ? 'Em serviço' : 'Fora de serviço'}</span>
            {w.staff?.invisible && <span className="sf-top-duty">Invisível</span>}
            {!duty && (
              <button type="button" className="mini gold" disabled={!online} onClick={() => net.send({ t: 'staff_duty', on: true })} data-testid="staff-duty-on">
                Entrar em serviço
              </button>
            )}
          </div>

          <div className="sf-tabs" role="tablist" aria-label="Seções do painel de staff" onKeyDown={onKeys}>
            {TABS.map((t) => (
              <button
                key={t.id}
                ref={(el) => {
                  tabRefs.current[t.id] = el;
                }}
                type="button"
                role="tab"
                id={`sf-tab-${t.id}`}
                aria-selected={tab === t.id}
                aria-controls={`sf-panel-${t.id}`}
                tabIndex={tab === t.id ? 0 : -1}
                className={`sf-tab ${tab === t.id ? 'on' : ''}`}
                onClick={() => setTab(t.id)}
                data-testid={`staff-tab-${t.id}`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="sf-panel" role="tabpanel" id={`sf-panel-${tab}`} aria-labelledby={`sf-tab-${tab}`}>
            {tab === 'online' && <OnlineTab />}
            {tab === 'rooms' && <RoomsTab />}
            {tab === 'notices' && <NoticesTab />}
            {tab === 'accounts' && (staffCan(level, 'accounts.view') ? <AccountsTab /> : null)}
            {tab === 'team' && <TeamTab />}
            {tab === 'mode' && <ModeTab />}
            {tab === 'log' && <LogTab />}
          </div>
        </div>
      </StaffPanelProvider>
    </Window>
  );
}

const SCOPE_TAG = { all: 'AVISO GERAL', room: 'AVISO DA SALA', org: 'AVISO DA ORGANIZAÇÃO', private: 'MENSAGEM DA EQUIPE' } as const;

/** Faixa dourada de anúncio da staff (sala, organização, geral ou mensagem privada); some sozinha. */
export function AnnounceBanner() {
  const { announce } = useWorld();
  useEffect(() => {
    if (!announce) return;
    const id = setTimeout(() => worldStore.clearAnnounce(announce.key), announce.highlight ? 30000 : 14000);
    return () => clearTimeout(id);
  }, [announce]);
  if (!announce) return null;
  return (
    <div
      className={`announce announce-${announce.scope}${announce.highlight ? ' announce-highlight' : ''}`}
      role="alert"
      data-testid="announce"
      onClick={() => worldStore.clearAnnounce(announce.key)}
    >
      <span className="announce-tag">{SCOPE_TAG[announce.scope]}</span>
      <span className="announce-text">{announce.text}</span>
      <span className="announce-from">
        — {announce.from} ({STAFF_LABELS[announce.level]})
      </span>
    </div>
  );
}
