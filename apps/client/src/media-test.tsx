// Development-only page: /media-test.html?name=Ana&room=office
// Needs the server with ALLOW_DEV_LOGIN=1. Joins the world over the real WebSocket (so the media token endpoint
// sees the player inside the room) and mounts the media components, plus a minimal chat to show that chat works
// with or without camera/microphone access. It is not part of the production build.
import { StrictMode, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { ServerMessage } from '@workverse/shared';
import { net } from './net';
import { MediaBar, MediaProvider, VideoTiles, useMedia, type TilePosition } from './media';

const params = new URLSearchParams(location.search);
const NAME = params.get('name') ?? 'Teste';
const ROOMS = ['office', 'lounge'];

declare global {
  interface Window {
    /** Test hooks: set a participant's tile position, inspect the media client. */
    __wv?: { setPos: (identity: string, x: number, y: number) => void; media: ReturnType<typeof useMedia>['client'] | null; positions: Map<string, TilePosition> };
  }
}

const positions = new Map<string, TilePosition>();
window.__wv = { setPos: (id, x, y) => positions.set(id, { x, y }), media: null, positions };

function Probe() {
  const { client } = useMedia();
  useEffect(() => {
    window.__wv!.media = client;
  }, [client]);
  return null;
}

function Page() {
  const [roomId, setRoomId] = useState<string | null>(null);
  const [youId, setYouId] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const off = net.on((m: ServerMessage) => {
      if (m.t === 'room') {
        positions.clear();
        for (const p of m.room.players) positions.set(p.id, { x: p.x, y: p.y });
        setYouId(m.room.youId);
        setRoomId(m.room.def.id);
      } else if (m.t === 'joined') positions.set(m.player.id, { x: m.player.x, y: m.player.y });
      else if (m.t === 'left') positions.delete(m.id);
      else if (m.t === 'chat') setLog((l) => [...l.slice(-30), `${m.name}: ${m.text}`]);
    });
    net
      .connect(NAME)
      .then(() => net.send({ t: 'join', roomId: params.get('room') ?? 'office' }))
      .catch((e: Error) => (e.message === 'Conexão cancelada.' ? undefined : setError(e.message)));
    return () => {
      off();
      net.disconnect();
    };
  }, []);

  const getTilePosition = useMemo(() => (id: string) => positions.get(id), []);

  return (
    <MediaProvider roomId={roomId} getTilePosition={getTilePosition} devName={NAME}>
      <Probe />
      <main style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12, color: '#eef', fontFamily: 'system-ui' }}>
        <h1 style={{ fontSize: 16, margin: 0 }}>
          Teste de mídia: <b data-testid="who">{NAME}</b> na sala <b data-testid="room">{roomId ?? '...'}</b> (id <span data-testid="you">{youId ?? '-'}</span>)
        </h1>
        {error && <p role="alert" style={{ color: '#f99' }}>{error}</p>}
        <div style={{ display: 'flex', gap: 8 }}>
          {ROOMS.map((r) => (
            <button key={r} type="button" data-testid={`go-${r}`} onClick={() => net.send({ t: 'join', roomId: r })}>
              Ir para {r}
            </button>
          ))}
        </div>
        <MediaBar panelPlacement="below" />
        <VideoTiles />
        <section aria-label="Chat">
          <ul data-testid="chat-log" style={{ listStyle: 'none', padding: 0, margin: '0 0 8px', fontSize: 13 }}>
            {log.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (text.trim()) net.send({ t: 'chat', text });
              setText('');
            }}
          >
            <input data-testid="chat-input" value={text} onChange={(e) => setText(e.target.value)} placeholder="Chat da sala" />
            <button type="submit">Enviar</button>
          </form>
        </section>
      </main>
    </MediaProvider>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Page />
  </StrictMode>,
);
