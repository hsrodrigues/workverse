import { useEffect, useRef, useState, type FormEvent } from 'react';
import { MAX_CHAT_LENGTH, PRESENCE_STATUSES, STATUS_LABELS, isPresenceStatus, type PresenceStatus } from '@workverse/shared';
import { net } from '../net';
import { useNetStatus, useWorld, worldStore } from '../worldStore';
import { Window } from './Window';
import './social.css';

export function StatusDot({ status }: { status: PresenceStatus }) {
  return <span className={`sdot sdot-${status}`} title={STATUS_LABELS[status]} aria-label={STATUS_LABELS[status]} />;
}

/** Status picker for the HUD bar. The value shown is the one confirmed by the server. */
export function StatusSelect() {
  const { myStatus } = useWorld();
  const [conn] = useNetStatus();
  return (
    <select
      className="status-select"
      value={myStatus}
      disabled={conn !== 'online'}
      title="Seu status"
      aria-label="Seu status"
      onChange={(e) => isPresenceStatus(e.target.value) && net.send({ t: 'status', status: e.target.value })}
    >
      {PRESENCE_STATUSES.map((s) => (
        <option key={s} value={s}>
          {STATUS_LABELS[s]}
        </option>
      ))}
    </select>
  );
}

export function useTotalUnread(): number {
  const w = useWorld();
  return w.teamUnread + Object.values(w.conversations).reduce((n, c) => n + c.unread, 0);
}

/** Blinks document.title while there are unread messages. No sound. */
function useTitleAlert(unread: number) {
  useEffect(() => {
    if (unread <= 0) return;
    const base = document.title;
    let on = false;
    const id = setInterval(() => {
      on = !on;
      document.title = on ? `(${unread}) Nova mensagem` : base;
    }, 1000);
    return () => {
      clearInterval(id);
      document.title = base;
    };
  }, [unread]);
}

/** Chat window with the "Equipe" tab and one tab per private conversation. */
export function ChatWindow() {
  const w = useWorld();
  const [conn] = useNetStatus();
  const unread = useTotalUnread();
  const [text, setText] = useState('');
  const thread = useRef<HTMLDivElement>(null);
  useTitleAlert(unread);

  const convs = Object.values(w.conversations).sort((a, b) => (b.lines.at(-1)?.at ?? 0) - (a.lines.at(-1)?.at ?? 0));
  const tab = w.chatTab;
  const conv = tab === 'team' ? undefined : w.conversations[tab];
  const lines = tab === 'team' ? w.teamLines : (conv?.lines ?? []);

  useEffect(() => {
    const el = thread.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines.length, tab, w.chatOpen]);

  // Returning to the browser tab counts as reading the open conversation.
  useEffect(() => {
    const onVisible = () => {
      if (!document.hidden && worldStore.get().chatOpen) worldStore.selectChatTab(worldStore.get().chatTab);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  if (!w.chatOpen) return null;

  const canSend = conn === 'online' && (tab === 'team' || !!conv);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    if (tab === 'team') net.send({ t: 'team', text: t });
    else if (conv) net.send({ t: 'dm', to: conv.peer, text: t });
    setText('');
  };

  return (
    <Window id="chat" className="win panel panel-chat" role="dialog" aria-label="Conversas" title="Conversas" onClose={() => worldStore.setChatOpen(false)}>
      <>
        <div className="chat-tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'team'} className={tab === 'team' ? 'on' : ''} onClick={() => worldStore.selectChatTab('team')}>
            Equipe ({w.team})
            {w.teamUnread > 0 && <span className="badge">{w.teamUnread}</span>}
          </button>
          {convs.map((c) => (
            <button key={c.key} role="tab" aria-selected={tab === c.key} className={tab === c.key ? 'on' : ''} onClick={() => worldStore.selectChatTab(c.key)}>
              {c.peer}
              {c.unread > 0 && <span className="badge">{c.unread}</span>}
            </button>
          ))}
        </div>
        <div className="chat-thread" ref={thread} aria-live="polite">
          {lines.length === 0 && <div className="empty">{tab === 'team' ? 'Ninguém falou na equipe ainda.' : 'Escreva a primeira mensagem privada.'}</div>}
          {lines.map((l) => (
            <div key={l.key} className={l.self ? 'mine' : ''}>
              <b>{l.self ? 'Você' : l.from}:</b> {l.text}
            </div>
          ))}
        </div>
        {w.socialNotice && tab !== 'team' && (
          <div className="chat-notice" role="alert">
            {w.socialNotice}
          </div>
        )}
        <form className="chat-form" onSubmit={submit}>
          <input
            value={text}
            maxLength={MAX_CHAT_LENGTH}
            onChange={(e) => setText(e.target.value)}
            placeholder={tab === 'team' ? 'Mensagem para a equipe…' : conv ? `Mensagem para ${conv.peer}…` : 'Escolha uma conversa'}
            autoComplete="off"
            disabled={!canSend}
          />
          <button className="tool tool-send" disabled={!canSend}>
            Enviar
          </button>
        </form>
      </>
    </Window>
  );
}
