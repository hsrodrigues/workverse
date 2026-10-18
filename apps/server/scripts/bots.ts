/**
 * Dev / load-test bots: `npm run bots -w @workverse/server -- --count 10 --room office`
 * Each bot logs in, joins a room, wanders to random walkable tiles and chats now and then.
 *
 * Bots use the name-only dev login, so the server must run with ALLOW_DEV_LOGIN=1
 * (never possible in production), e.g. `ALLOW_DEV_LOGIN=1 npm run dev:server`.
 */
import WebSocket from 'ws';
import { ROOM_DEFS, buildRoom, isWalkable, type ClientMessage, type ServerMessage } from '@workverse/shared';

const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
};

const url = arg('url', 'ws://localhost:3001/ws');
const count = Number(arg('count', '3'));
const roomId = arg('room', 'office');
const prefix = arg('prefix', 'Bot');
const talkEvery = Number(arg('talk', '9000'));
const room = buildRoom(ROOM_DEFS.find((r) => r.id === roomId) ?? ROOM_DEFS[0]);
const phrases = ['Bom dia, time!', 'Alguém viu o relatório?', 'Café na copa ☕', 'Daily em 5 minutos', 'Boa ideia!', 'Já volto'];

let messagesIn = 0;
let connected = 0;

function spawn(i: number) {
  const name = `${prefix}${i + 1}`;
  const ws = new WebSocket(url);
  const send = (m: ClientMessage) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(m));
  let timers: NodeJS.Timeout[] = [];

  ws.on('open', () => send({ t: 'hello', name }));
  ws.on('message', (raw) => {
    messagesIn++;
    const msg = JSON.parse(raw.toString()) as ServerMessage;
    if (msg.t === 'session') {
      send({ t: 'join', roomId });
    } else if (msg.t === 'room') {
      connected++;
      const wander = () => {
        const x = Math.floor(Math.random() * room.grid.width);
        const y = Math.floor(Math.random() * room.grid.height);
        if (isWalkable(room.grid, x, y) && !room.portalAt.has(y * room.grid.width + x)) send({ t: 'move', x, y });
      };
      timers.push(setInterval(wander, 2500 + Math.random() * 3000));
      timers.push(setInterval(() => send({ t: 'chat', text: phrases[Math.floor(Math.random() * phrases.length)] }), talkEvery + Math.random() * talkEvery));
    }
  });
  ws.on('close', () => {
    timers.forEach(clearInterval);
    timers = [];
  });
  ws.on('unexpected-response', (_req, res) => {
    if (i === 0) console.error(`[bots] server refused the WebSocket (HTTP ${res.statusCode}). Is it running with ALLOW_DEV_LOGIN=1?`);
  });
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString()) as ServerMessage;
    if (msg.t === 'error' && i === 0 && (msg.code === 'unauthorized' || msg.code === 'name_taken')) {
      console.error(`[bots] ${msg.code}: ${msg.message} (start the server with ALLOW_DEV_LOGIN=1 and a prefix that is not a real account name)`);
    }
  });
  ws.on('error', () => undefined);
}

for (let i = 0; i < count; i++) setTimeout(() => spawn(i), i * 60);

setInterval(() => {
  console.log(`[bots] connected=${connected}/${count} messagesIn=${messagesIn}`);
}, 5000);
