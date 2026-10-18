import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import type { FastifyInstance } from 'fastify';
import { createApp } from '../src/app';
import { MemoryAccountStore } from '../src/store';

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

const make = async (o: { production?: boolean; metricsToken?: string; allowDevLogin?: boolean } = {}) => {
  ({ app } = await createApp({ store: new MemoryAccountStore(), tickMs: 20, allowDevLogin: true, ...o }));
  return app;
};

describe('GET /metrics', () => {
  it('serves Prometheus text with counters fed by the socket layer', async () => {
    const a = await make();
    await a.listen({ port: 0, host: '127.0.0.1' });
    const addr = a.server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); });
    const ready = new Promise<void>((res) => ws.on('message', (raw) => JSON.parse(raw.toString()).t === 'room' && res()));
    ws.send(JSON.stringify({ t: 'hello', name: 'Metrica' }));
    ws.send(JSON.stringify({ t: 'join', roomId: 'office' }));
    await ready;
    await new Promise((r) => setTimeout(r, 80));
    const res = await a.inject({ method: 'GET', url: '/metrics' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
    expect(res.body).toContain('workverse_ws_connections_active 1');
    expect(res.body).toContain('workverse_ws_messages_received_total{type="hello"} 1');
    expect(res.body).toContain('workverse_ws_messages_sent_total{type="room"} 1');
    expect(res.body).toContain('workverse_room_players{room="office"} 1');
    expect(res.body).toContain('workverse_sessions_total{event="start"} 1');
    expect(res.body).toMatch(/workverse_tick_duration_ms_count \d+/);
    ws.close();
  });

  it('requires the bearer token when METRICS_TOKEN is set', async () => {
    const a = await make({ metricsToken: 's3cret' });
    expect((await a.inject({ method: 'GET', url: '/metrics' })).statusCode).toBe(401);
    expect((await a.inject({ method: 'GET', url: '/metrics', headers: { authorization: 'Bearer errado' } })).statusCode).toBe(401);
    expect((await a.inject({ method: 'GET', url: '/metrics', headers: { authorization: 'Bearer s3cret' } })).statusCode).toBe(200);
  });

  it('does not exist in production without a token', async () => {
    const off = await make({ production: true, allowDevLogin: false });
    expect((await off.inject({ method: 'GET', url: '/metrics' })).statusCode).toBe(404);
    await off.close();
    const on = await make({ production: true, allowDevLogin: false, metricsToken: 'abc' });
    expect((await on.inject({ method: 'GET', url: '/metrics', headers: { authorization: 'Bearer abc' } })).statusCode).toBe(200);
  });
});
