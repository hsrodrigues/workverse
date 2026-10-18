import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import type { FastifyInstance } from 'fastify';
import type { ClientMessage, ServerMessage } from '@workverse/shared';
import { createApp } from '../src/app';
import { MemoryAccountStore } from '../src/store';

let app: FastifyInstance;
let url: string;
const sockets: WebSocket[] = [];

class Client {
  inbox: ServerMessage[] = [];
  private waiters: { pred: (m: ServerMessage) => boolean; resolve: (m: ServerMessage) => void }[] = [];
  constructor(readonly ws: WebSocket) {
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString()) as ServerMessage;
      this.inbox.push(msg);
      this.waiters = this.waiters.filter((w) => {
        if (w.pred(msg)) {
          w.resolve(msg);
          return false;
        }
        return true;
      });
    });
  }
  send(m: ClientMessage) {
    this.ws.send(JSON.stringify(m));
  }
  waitFor<T extends ServerMessage['t']>(t: T, pred: (m: Extract<ServerMessage, { t: T }>) => boolean = () => true) {
    const p = (m: ServerMessage) => m.t === t && pred(m as Extract<ServerMessage, { t: T }>);
    const found = this.inbox.find(p);
    if (found) return Promise.resolve(found as Extract<ServerMessage, { t: T }>);
    return new Promise<Extract<ServerMessage, { t: T }>>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timeout waiting for ${t}`)), 4000);
      this.waiters.push({ pred: p, resolve: (m) => { clearTimeout(timer); resolve(m as never); } });
    });
  }
}

async function connect(name: string): Promise<Client> {
  const ws = new WebSocket(url);
  sockets.push(ws);
  await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); });
  const c = new Client(ws);
  c.send({ t: 'hello', name });
  await c.waitFor('session');
  c.send({ t: 'join' });
  await c.waitFor('room');
  return c;
}

beforeEach(async () => {
  ({ app } = await createApp({ store: new MemoryAccountStore(), allowDevLogin: true, tickMs: 50 }));
  await app.listen({ port: 0, host: '127.0.0.1' });
  const addr = app.server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  url = `ws://127.0.0.1:${port}/ws`;
});

afterEach(async () => {
  for (const s of sockets.splice(0)) s.terminate();
  await app.close();
});

describe('two browsers in the same office', () => {
  it('see each other, sync movement and talk in real time', async () => {
    const ana = await connect('Ana');
    const beto = await connect('Beto');

    const anaId = (await ana.waitFor('session')).id;
    const betoId = (await beto.waitFor('session')).id;
    const snapshot = await beto.waitFor('room');
    expect(snapshot.room.players.map((p) => p.id).sort()).toEqual([anaId, betoId].sort());
    await ana.waitFor('joined', (m) => m.player.id === betoId);

    const me = (await ana.waitFor('room')).room.players.find((p) => p.id === anaId)!;
    ana.send({ t: 'move', x: me.x, y: me.y + 2 });
    const path = await beto.waitFor('path', (m) => m.id === anaId);
    expect(path.path[path.path.length - 1]).toEqual({ x: me.x, y: me.y + 2 });

    ana.send({ t: 'chat', text: 'Bom dia, time!' });
    const chat = await beto.waitFor('chat', (m) => m.kind === 'say');
    expect(chat).toMatchObject({ id: anaId, name: 'Ana', text: 'Bom dia, time!' });

    beto.ws.close();
    await ana.waitFor('left', (m) => m.id === betoId);
  });

  it('keeps garbage input from crashing the server', async () => {
    const ana = await connect('Ana');
    ana.ws.send('{not json');
    ana.ws.send(JSON.stringify({ t: 'move', x: 'a', y: null }));
    ana.send({ t: 'ping', ts: 42 });
    const pong = await ana.waitFor('pong');
    expect(pong.ts).toBe(42);
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.json().online).toBe(1);
  });
});
