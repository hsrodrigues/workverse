import { useEffect, useRef, useState, type FormEvent } from 'react';
import { MAX_CHAT_LENGTH, ROOM_DEFS, STATUS_LABELS, badgeTextColor, deptShort, safeDeptColor, tempDigits } from '@workverse/shared';
import { InventoryPanel } from './inventory/InventoryPanel';
import { RemoteControl } from './climate/RemoteControl';
import './climate.css';
import { BadgeCard } from './BadgeCard';
import { ReceptionPanel } from './Reception';
import { PetMenu } from './PetMenu';
import { net } from '../net';
import { listen } from '../bus';
import { useNetStatus, useWorld, worldStore } from '../worldStore';
import { ChatWindow, StatusDot, StatusSelect, useTotalUnread } from './Social';
import { MediaBar } from '../media';
import { useMediaIndicators } from '../media/indicators';
import { Icon } from '../media/icons';
import { StageBarButton, StagePanel } from './StagePanel';
import { VideoDock } from './VideoDock';
import { AnnounceBanner, StaffBadge, StaffBarButton, StaffPanel } from './staff/StaffPanel';
import { Window } from './Window';
import { DayModeButton } from './DayModeButton';
import { FurnishBarButton, FurnishPanel } from './furnish/FurnishPanel';
import { InviteBanner } from './furnish/InviteBanner';
import { BookingsBarButton, BookingsPanel } from './bookings/BookingsPanel';
import { BookingToasts } from './bookings/BookingToasts';
import { furnishStore, useFurnish } from './furnish/furnishStore';
import { ProfileBarButton, ProfilePanel } from './profile/ProfilePanel';
import { profileStore } from './profile/profileStore';
import { pronounLabel, type PronounId } from '@workverse/shared';

interface Props {
  onEditAvatar(): void;
  onChangePassword(): void;
  onLeave(): void;
  onWalkNear(id: string): void;
  onReconnect(): void;
}

type Panel = 'rooms' | 'people' | null;

export function Hud({ onEditAvatar, onChangePassword, onLeave, onWalkNear, onReconnect }: Props) {
  const world = useWorld();
  const fz = useFurnish();
  // The browser of rooms comes from the server: padlocks, and no head count for rooms this person cannot enter.
  const roomList = fz.rooms.length > 0 ? fz.rooms : ROOM_DEFS.map((r) => ({ id: r.id, name: r.name, description: r.description, maxPlayers: r.maxPlayers, access: 'org' as const, locked: false, lockReason: undefined, population: world.population[r.id] ?? 0 }));
  const [status, latency] = useNetStatus();
  const [panel, setPanel] = useState<Panel>(null);
  const [menu, setMenu] = useState<{ id: string; name: string; x: number; y: number } | null>(null);
  const unread = useTotalUnread();
  const indicators = useMediaIndicators();
  const [text, setText] = useState('');
  const input = useRef<HTMLInputElement>(null);
  // altura real da barra inferior (no celular ela quebra em linhas): o chat e o enquadramento da camera usam esse valor
  const barRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    const el = barRef.current;
    if (!el) return;
    const apply = () => document.documentElement.style.setProperty('--bar-h', `${Math.ceil(el.getBoundingClientRect().height)}px`);
    apply();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const log = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const off1 = listen('avatarClick', (d) => d && setMenu(d));
    const off2 = listen('closeMenus', () => setMenu(null));
    const off3 = listen('receptionistClick', () => worldStore.openReception());
    return () => {
      off1();
      off2();
      off3();
    };
  }, []);

  // clicar fora da ficha/menu fecha (o Esc ja fecha)
  useEffect(() => {
    if (!menu) return;
    const off = (e: PointerEvent) => {
      if (!(e.target as HTMLElement | null)?.closest?.('.ctx') && !(e.target as HTMLElement | null)?.closest?.('canvas')) setMenu(null);
    };
    document.addEventListener('pointerdown', off);
    return () => document.removeEventListener('pointerdown', off);
  }, [menu]);

  useEffect(() => {
    const el = log.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [world.chat]);

  // Enter focuses the chat box, like in classic social games.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = document.activeElement?.tagName;
      const typing = tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA';
      if (e.key === 'Enter' && !typing) {
        e.preventDefault();
        input.current?.focus();
      } else if (e.key === 'Escape') {
        input.current?.blur();
        setMenu(null);
        setPanel(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const send = (e: FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (t) net.send({ t: 'chat', text: t });
    setText('');
  };

  const enterRoom = (id: string) => {
    if (id !== world.room?.id) net.send({ t: 'join', roomId: id });
    setPanel(null);
  };

  const online = status === 'online';
  // Quedas curtas (reinicio do servidor, oscilacao de rede) nao devem cobrir a tela: o aviso so aparece apos 3 s.
  const [showReconnect, setShowReconnect] = useState(false);
  useEffect(() => {
    if (status !== 'reconnecting') {
      setShowReconnect(false);
      return;
    }
    const id = setTimeout(() => setShowReconnect(true), 3000);
    return () => clearTimeout(id);
  }, [status]);
  const menuPerson = menu ? world.roster.find((p) => p.id === menu.id) : undefined;
  const [cardId, setCardId] = useState<string | null>(null);

  return (
    <div className="hud">
      <div className="hud-top-left">
        <div className="room-card">
          <strong>{world.room?.name ?? 'Entrando…'}</strong>
          <span>{world.room?.description}</span>
        </div>
        <div className="hud-status-row">
        <div className={`conn conn-${status}`} title="Estado da conexão com o servidor">
          <i /> {online ? `Conectado · ${latency}ms` : status === 'connecting' ? 'Conectando…' : status === 'reconnecting' ? 'Reconectando…' : 'Desconectado'}
        </div>
        {world.climate && (
          <div
            className={`temp-chip ${world.climate.overheat ? 'hot' : world.climate.on ? 'cooling' : ''}`}
            title={`Temperatura da sala: ${tempDigits(world.climate.temp)} °C. ${world.climate.on ? `Ar-condicionado ligado (meta ${world.climate.target} °C).` : 'Ar-condicionado desligado.'}${world.climate.overheat ? ' Superaquecimento!' : ''}`}
            role="status"
            data-testid="temp-chip"
            data-overheat={world.climate.overheat}
          >
            <span aria-hidden="true">🌡</span> {tempDigits(world.climate.temp)}°C{world.climate.on && <span className="ac" aria-label="ar-condicionado ligado"> ❄ {world.climate.target}°</span>}
            {world.climate.overheat && <b> superaquecendo!</b>}
          </div>
        )}
        </div>
      </div>

      {panel === 'rooms' && (
        <Window id="rooms" className="win panel panel-rooms" title="Navegador de salas" onClose={() => setPanel(null)} role="dialog" aria-label="Navegador de salas">
          <>
            {roomList.map((r) => (
              <button
                key={r.id}
                className={`room-row ${r.id === world.room?.id ? 'here' : ''} ${r.locked ? 'locked' : ''}`}
                onClick={() => !r.locked && enterRoom(r.id)}
                disabled={r.locked}
                aria-disabled={r.locked}
                title={r.locked ? (r.lockReason === 'team' ? 'Sala restrita a uma equipe' : r.lockReason === 'guest' ? 'Visitantes não entram nesta sala' : 'Sala só para convidados') : undefined}
                data-testid={`room-row-${r.id}`}
                data-locked={r.locked}
              >
                <span className="room-name">
                  {r.locked && (
                    <span className="room-lock" aria-label="Sala restrita">
                      🔒
                    </span>
                  )}
                  {r.name}
                </span>
                <span className="room-desc">{r.description}</span>
                {r.locked ? (
                  <span className="room-pop" title="Acesso restrito">Acesso restrito</span>
                ) : (
                  <span className="room-pop" title="Pessoas na sala">👥 {world.population[r.id] ?? r.population ?? 0}/{r.maxPlayers}</span>
                )}
              </button>
            ))}
          </>
        </Window>
      )}

      {panel === 'people' && (
        <Window id="people" className="win panel panel-people" title={`Na sala (${world.roster.length})`} onClose={() => setPanel(null)} role="dialog" aria-label="Pessoas na sala">
          <>
            <ul className="people">
              {world.roster.map((p) => (
                <li key={p.id} className={p.id === world.youId ? 'me' : ''}>
                  <StatusDot status={p.status} />{' '}
                  <button type="button" className="link-name" onClick={() => setCardId(cardId === p.id ? null : p.id)} aria-expanded={cardId === p.id} title="Ver crachá" data-testid={`people-name-${p.name}`}>
                    {p.name}
                  </button>
                  {p.staff && <StaffBadge level={p.staff} />}
                  {deptShort(p.dept) && (
                    <span className="role-chip" style={{ background: safeDeptColor(p.deptColor), color: badgeTextColor(safeDeptColor(p.deptColor)) }} data-testid={`people-role-${p.name}`}>
                      {deptShort(p.dept, 14)}
                    </span>
                  )}
                  {p.id === world.youId && <em> (você)</em>}
                  {p.about && (
                    <span className="people-about" title={p.about} data-testid={`people-about-${p.name}`}>
                      {p.about}
                    </span>
                  )}
                  {world.stage?.speakerId === p.id && <em title="Está no palco"> 🎤</em>}
                  {indicators.get(p.id) && (indicators.get(p.id)!.micPublished || indicators.get(p.id)!.camPublished) && (
                    <span className="mi" data-testid={`people-media-${p.id}`}>
                      {indicators.get(p.id)!.micPublished && (
                        <i className={`${indicators.get(p.id)!.micOn ? '' : 'off'} ${indicators.get(p.id)!.speaking ? 'speaking' : ''}`} title={indicators.get(p.id)!.micOn ? 'Microfone ligado' : 'Microfone mudo'} data-testid={`people-mic-${p.id}`} data-on={indicators.get(p.id)!.micOn}>
                          <Icon name="mic" off={!indicators.get(p.id)!.micOn} size={11} />
                        </i>
                      )}
                      {indicators.get(p.id)!.camPublished && (
                        <i className={`cam ${indicators.get(p.id)!.camOn ? '' : 'off'}`} title={indicators.get(p.id)!.camOn ? 'Câmera ligada' : 'Câmera desligada'} data-testid={`people-cam-${p.id}`} data-on={indicators.get(p.id)!.camOn}>
                          <Icon name="cam" off={!indicators.get(p.id)!.camOn} size={11} />
                        </i>
                      )}
                    </span>
                  )}
                  <span className="slabel">{STATUS_LABELS[p.status]}</span>
                  {p.id !== world.youId && (
                    <>
                      <button className="mini" onClick={() => onWalkNear(p.id)}>
                        ir até
                      </button>
                      <button className="mini" onClick={() => worldStore.openConversation(p.name)}>
                        mensagem
                      </button>
                    </>
                  )}
                  {cardId === p.id && (
                    <div className="people-card">
                      <BadgeCard compact name={p.name} avatar={p.avatar} title={p.title} dept={p.dept} deptColor={p.deptColor} staff={p.staff} about={p.about} pronouns={pronounLabel(p.pronouns as PronounId | undefined)} birthday={p.bday} />
                      {p.id === world.youId && (
                        <button type="button" className="mini" onClick={() => profileStore.open()} data-testid="card-edit-profile">
                          Editar meu perfil
                        </button>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </>
        </Window>
      )}

      {menu && (
        <div className="ctx" style={{ left: Math.min(menu.x, window.innerWidth - 290), top: Math.min(menu.y, window.innerHeight - 190) }} role="menu">
          <div className="ctx-title">{menu.name}</div>
          {menuPerson && <BadgeCard compact onClose={() => setMenu(null)} name={menuPerson.name} avatar={menuPerson.avatar} title={menuPerson.title} dept={menuPerson.dept} deptColor={menuPerson.deptColor} staff={menuPerson.staff} about={menuPerson.about} pronouns={pronounLabel(menuPerson.pronouns as PronounId | undefined)} birthday={menuPerson.bday} />}
          {menu.id === world.youId && (
            <button
              role="menuitem"
              onClick={() => {
                profileStore.open();
                setMenu(null);
              }}
              data-testid="ctx-edit-profile"
            >
              Meu perfil
            </button>
          )}
          {menuPerson && (
            <div className="ctx-status">
              <StatusDot status={menuPerson.status} /> {STATUS_LABELS[menuPerson.status]}
            </div>
          )}
          <button
            role="menuitem"
            onClick={() => {
              onWalkNear(menu.id);
              setMenu(null);
            }}
          >
            Andar até lá
          </button>
          <button
            role="menuitem"
            onClick={() => {
              net.send({ t: 'chat', text: `Oi, ${menu.name}! 👋` });
              net.send({ t: 'emote', emote: 'wave' });
              setMenu(null);
            }}
          >
            Cumprimentar
          </button>
          {menu.id !== world.youId && (
            <button
              role="menuitem"
              onClick={() => {
                worldStore.openConversation(menu.name);
                setMenu(null);
              }}
            >
              Mensagem privada
            </button>
          )}
          {menu.id !== world.youId && (
            <button
              role="menuitem"
              onClick={() => {
                furnishStore.inviteToMeeting(menu.name);
                setMenu(null);
              }}
              data-testid="ctx-meeting-invite"
            >
              Convidar para reunião
            </button>
          )}
          <button role="menuitem" className="muted" onClick={() => setMenu(null)}>
            Fechar
          </button>
        </div>
      )}

      <ChatWindow />
      <ProfilePanel onEditAvatar={onEditAvatar} onChangePassword={onChangePassword} />
      <ReceptionPanel onWalkNear={onWalkNear} />
      <PetMenu />
      <InventoryPanel />
      <RemoteControl />
      <StaffPanel />
      <AnnounceBanner />
      <VideoDock />
      <StagePanel />
      <FurnishPanel />
      <InviteBanner />
      <BookingsPanel />
      <BookingToasts />

      <div className="chat-log" data-testid="chat-log" ref={log} aria-live="polite">
        {world.chat.slice(-40).map((l) => (
          <div key={l.key} className={`line line-${l.kind}`}>
            {l.kind === 'say' ? (
              <>
                <b>{l.name}:</b> {l.text}
              </>
            ) : (
              l.text
            )}
          </div>
        ))}
      </div>

      <form ref={barRef} className="bar" onSubmit={send}>
        <button type="button" className="tool" onClick={() => setPanel(panel === 'rooms' ? null : 'rooms')} title="Navegador de salas">
          <span className="ico"><Icon name="rooms" /></span> <span className="lbl">Salas</span>
        </button>
        <button type="button" className="tool" onClick={() => setPanel(panel === 'people' ? null : 'people')} title="Quem está na sala">
          <span className="ico"><Icon name="people" /></span> <span className="lbl">Pessoas</span>
        </button>
        <StatusSelect />
        <button type="button" className="tool" onClick={() => worldStore.setChatOpen(!world.chatOpen)} title="Mensagens privadas e chat de equipe">
          <span className="ico"><Icon name="chat" /></span> <span className="lbl">Conversas</span>{unread > 0 && <span className="badge">{unread}</span>}
        </button>
        <StageBarButton />
        <BookingsBarButton />
        <FurnishBarButton />
        <StaffBarButton />
        <MediaBar />
        <input data-testid="chat-input"
          ref={input}
          value={text}
          maxLength={MAX_CHAT_LENGTH}
          onChange={(e) => setText(e.target.value)}
          placeholder="Pressione Enter para conversar…  (/acenar)"
          autoComplete="off"
          disabled={!online}
        />
        <button className="tool tool-send" disabled={!online}>Falar</button>
        <button type="button" className="tool" onClick={() => net.send({ t: 'emote', emote: 'wave' })} title="Acenar" disabled={!online}>
          <span className="ico"><Icon name="hand" /></span>
        </button>
        <DayModeButton />
        <ProfileBarButton />
        <button type="button" className="tool" onClick={onEditAvatar} title="Mudar visual">
          <span className="ico"><Icon name="shirt" /></span>
        </button>
        <button type="button" className="tool" onClick={onChangePassword} title="Alterar senha" aria-label="Alterar senha" data-testid="change-password-button">
          <span className="ico"><Icon name="key" /></span>
        </button>
        <button type="button" className="tool" onClick={onLeave} title="Sair">
          <span className="ico"><Icon name="power" /></span>
        </button>
      </form>

      {showReconnect && status === 'reconnecting' && (
        <div className="overlay" role="status">
          <div className="win">
            <div className="win-title">Conexão perdida</div>
            <div className="win-body">
              <p>Tentando reconectar… sua sessão será restaurada automaticamente.</p>
            </div>
          </div>
        </div>
      )}
      {status === 'kicked' && (
        <div className="overlay" role="alert">
          <div className="win">
            <div className="win-title">Sessão encerrada pela equipe</div>
            <div className="win-body">
              <p className="kicked-reason">{net.kickMessage || 'A equipe encerrou a sua sessão.'}</p>
              <button className="btn btn-primary" onClick={onReconnect}>
                Entrar novamente
              </button>
            </div>
          </div>
        </div>
      )}
      {status === 'replaced' && (
        <div className="overlay" role="alert">
          <div className="win">
            <div className="win-title">Sessão encerrada</div>
            <div className="win-body">
              <p>Sua conta entrou em outro lugar.</p>
              <button className="btn btn-primary" onClick={onReconnect}>
                Entrar aqui
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
