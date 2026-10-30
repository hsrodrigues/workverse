import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { AccessToken } from 'livekit-server-sdk';
import { DEFAULT_ORG_ID, type ServerMessage } from '@workverse/shared';
import { livekitRoomName, registerMediaRoutes } from '../src/media';
import { MemoryAccountStore } from '../src/store';
import { World, type Connection } from '../src/world';
import { MemoryUsageStore, type EconomyConfig } from '../src/mediaEconomy';

const KEY = 'devkey';
const SECRET = 'secret-secret-secret-secret-123456';
const ROOM = livekitRoomName('office', DEFAULT_ORG_ID);

const apps: FastifyInstance[] = [];
afterEach(async () => {
  for (const a of apps.splice(0)) await a.close();
});

class Conn implements Connection {
  strikes = 0;
  player?: Connection['player'];
  inbox: ServerMessage[] = [];
  send(m: ServerMessage) {
    this.inbox.push(m);
  }
  close() {}
}

async function sign(body: string, secret = SECRET, key = KEY) {
  const at = new AccessToken(key, secret, { ttl: 300 });
  at.sha256 = createHash('sha256').update(body).digest('base64');
  return at.toJwt();
}

async function setup(economy: Partial<EconomyConfig> = {}) {
  let now = Date.UTC(2026, 9, 15, 15, 0, 0);
  const removed: string[] = [];
  const synced: Array<{ identity: string; rights: string }> = [];
  const store = new MemoryAccountStore();
  const world = new World({
    store,
    allowDevLogin: true,
    clock: () => now,
    mediaEconomy: economy,
    mediaUsageStore: new MemoryUsageStore(),
    removeMediaParticipant: (_o, _r, identity) => removed.push(identity),
    permissionSync: (_room, identity, rights) => synced.push({ identity, rights }),
  });
  const app = Fastify();
  apps.push(app);
  app.decorateRequest('auth', null);
  registerMediaRoutes(app, { store, world, guard: undefined as never, clock: () => now, secureCookies: false, allowDevLogin: true, allowedOrigins: [] } as never, {
    config: { enabled: true, url: 'ws://localhost:7880', apiKey: KEY, apiSecret: SECRET, ttlSeconds: 600 },
  });
  const enter = (name: string) => {
    const c = new Conn();
    world.handle(c, { t: 'hello', name });
    world.handle(c, { t: 'join', roomId: 'office' });
    return c;
  };
  const token = async (name: string) => {
    const r = await app.inject({ method: 'POST', url: '/api/media/token', payload: { roomId: 'office', devName: name } });
    expect(r.statusCode).toBe(200);
  };
  let seq = 0;
  const hook = async (event: string, extra: Record<string, unknown> = {}, o: { id?: string; at?: number; secret?: string; headers?: Record<string, string>; contentType?: string; raw?: string } = {}) => {
    const body = o.raw ?? JSON.stringify({ event, id: o.id ?? `EV_${++seq}`, createdAt: String(Math.floor((o.at ?? now) / 1000)), room: { name: ROOM }, ...extra });
    return app.inject({
      method: 'POST',
      url: '/api/media/webhook',
      payload: body,
      headers: { 'content-type': o.contentType ?? 'application/webhook+json', authorization: await sign(body, o.secret), ...o.headers },
    });
  };
  const joined = (identity: string, extra: Record<string, unknown> = {}, o = {}) => hook('participant_joined', { participant: { identity, joinedAt: String(Math.floor(now / 1000)) }, ...extra }, o);
  const pub = (identity: string, source: 'CAMERA' | 'MICROPHONE', sid: string) => hook('track_published', { participant: { identity }, track: { sid, source, type: source === 'CAMERA' ? 'VIDEO' : 'AUDIO' } });
  const sweep = () => world.media.sweep(now);
  return { app, world, sweep, enter, token, hook, joined, pub, removed, synced, advance: (ms: number) => (now += ms), now: () => now };
}

describe('POST /api/media/webhook: assinatura e entrada', () => {
  it('recusa assinatura invalida, corpo adulterado, sem cabecalho, tipo errado e navegador (Origin)', async () => {
    const { hook, world, app } = await setup();
    expect((await hook('participant_joined', { participant: { identity: 'x' } }, { secret: 'outro-segredo-outro-segredo-outro-1' })).statusCode).toBe(401);
    // corpo mudado depois de assinado
    const body = JSON.stringify({ event: 'room_finished', id: 'EV_T', createdAt: String(Math.floor(Date.now() / 1000)), room: { name: ROOM } });
    const jwt = await sign(body);
    const tampered = await app.inject({ method: 'POST', url: '/api/media/webhook', payload: body.replace('room_finished', 'room_finishes'), headers: { 'content-type': 'application/webhook+json', authorization: jwt } });
    expect(tampered.statusCode).toBe(401);
    const noAuth = await app.inject({ method: 'POST', url: '/api/media/webhook', payload: body, headers: { 'content-type': 'application/webhook+json' } });
    expect(noAuth.statusCode).toBe(401);
    expect((await hook('room_finished', {}, { contentType: 'application/json' })).statusCode).toBe(401);
    expect((await hook('room_finished', {}, { headers: { origin: 'https://evil.example' } })).statusCode).toBe(403);
    expect((await hook('room_finished', {}, { raw: 'nao-e-json' })).statusCode).toBe(401);
    expect(world.media.webhookActive()).toBe(false);
  });

  it('corpo grande demais (413) e sem CORS', async () => {
    const { hook } = await setup();
    const big = JSON.stringify({ event: 'room_finished', pad: 'x'.repeat(40_000) });
    expect((await hook('room_finished', {}, { raw: big })).statusCode).toBe(413);
    const ok = await hook('room_finished');
    expect(ok.statusCode).toBe(200);
    expect(ok.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('limita a taxa e penaliza assinatura invalida', async () => {
    const { hook } = await setup();
    const codes: number[] = [];
    for (let i = 0; i < 40; i++) codes.push((await hook('room_finished', {}, { secret: 'errado-errado-errado-errado-1234' })).statusCode);
    expect(codes).toContain(429);
    expect(codes[0]).toBe(401);
  });
});

describe('webhook: minutos, replay e idempotencia', () => {
  it('conta minutos de participante pelos eventos (fonte de verdade) e nao pelo relato do cliente', async () => {
    const { enter, token, joined, hook, world, advance, sweep } = await setup();
    const a = enter('Ana');
    await token('Ana');
    expect(world.media.usage().estimate).toBe(true);
    const id = a.player!.id;
    expect((await joined(id)).json().result).toBe('applied');
    expect(world.media.usage()).toMatchObject({ webhook: true, estimate: false });
    // o cliente jura que desconectou: nao muda a contagem do LiveKit; os minutos seguem ate o participant_left
    world.handle(a, { t: 'media_report', connected: false, mic: false, cam: false, screen: false });
    advance(5 * 60_000);
    sweep();
    expect((await hook('participant_left', { participant: { identity: id } })).statusCode).toBe(200);
    expect(world.media.usage().usedMinutes).toBeCloseTo(5, 1);
    // duas vezes o mesmo left (id novo): nada muda
    await hook('participant_left', { participant: { identity: id } });
    advance(10 * 60_000);
    sweep();
    expect(world.media.usage().usedMinutes).toBeCloseTo(5, 1);
  });

  it('replay do mesmo evento assinado e idempotente; evento velho e descartado', async () => {
    const { enter, token, joined, hook, world, advance, now, sweep } = await setup();
    const a = enter('Ana');
    await token('Ana');
    const id = a.player!.id;
    expect((await joined(id, {}, { id: 'EV_DUP' })).json().result).toBe('applied');
    advance(60_000);
    // mesmo id reenviado (retentativa/replay): ignorado, nao reabre nem soma
    expect((await joined(id, {}, { id: 'EV_DUP' })).json().result).toBe('duplicate');
    expect((await hook('participant_left', { participant: { identity: id } }, { id: 'EV_LEFT' })).json().result).toBe('applied');
    expect((await hook('participant_left', { participant: { identity: id } }, { id: 'EV_LEFT' })).json().result).toBe('duplicate');
    expect(world.media.usage().usedMinutes).toBeCloseTo(1, 1);
    // um joined antigo (assinado de verdade, mas de 30 min atras) nao reabre a sessao
    const old = await joined(id, {}, { id: 'EV_OLD', at: now() - 30 * 60_000 });
    expect(old.json().result).toBe('stale');
    advance(5 * 60_000);
    sweep();
    expect(world.media.usage().usedMinutes).toBeCloseTo(1, 1);
  });

  it('room_finished encerra todos da sala', async () => {
    const { enter, token, joined, hook, world, advance, sweep } = await setup();
    const a = enter('Ana');
    const b = enter('Beto');
    await token('Ana');
    await token('Beto');
    await joined(a.player!.id);
    await joined(b.player!.id);
    advance(2 * 60_000);
    await hook('room_finished');
    expect(world.media.usage().usedMinutes).toBeCloseTo(4, 1);
    advance(5 * 60_000);
    sweep();
    expect(world.media.usage().usedMinutes).toBeCloseTo(4, 1);
  });
});

describe('webhook: limites e conexoes que nao passaram pelo servidor', () => {
  it('identidade sem sessao registrada e expulsa e nao conta minutos', async () => {
    const { joined, pub, removed, world, advance, sweep } = await setup();
    expect((await joined('intruso-123')).statusCode).toBe(200);
    expect(removed).toEqual(['intruso-123']);
    await pub('intruso-123', 'MICROPHONE', 'TR_1');
    expect(removed).toEqual(['intruso-123', 'intruso-123']);
    advance(10 * 60_000);
    sweep();
    expect(world.media.usage().usedMinutes).toBe(0);
  });

  it('pessoas acima do limite da sala: o excedente e removido e avisado', async () => {
    const { enter, token, joined, removed, world } = await setup({ maxPeoplePerRoom: 2 });
    const a = enter('Ana');
    const b = enter('Beto');
    const c = enter('Caio');
    await token('Ana');
    await token('Beto');
    // Caio recebe token por uma corrida (limite baixado depois da emissao): o webhook e a trava de verdade
    world.media.config.maxPeoplePerRoom = 3;
    await token('Caio');
    world.media.config.maxPeoplePerRoom = 2;
    await joined(a.player!.id);
    await joined(b.player!.id);
    await joined(c.player!.id);
    expect(removed).toEqual([c.player!.id]);
    expect(c.inbox.some((m) => m.t === 'error' && m.code === 'media_room_full')).toBe(true);
    expect(world.media.usage().rooms[0]).toBeDefined();
  });

  it('video acima do limite: a faixa e negada, o publicador cai para so audio e o contador de video nao a conta', async () => {
    const { enter, token, joined, pub, synced, world } = await setup({ maxVideoPublishers: 1 });
    const a = enter('Ana');
    const b = enter('Beto');
    await token('Ana');
    await token('Beto');
    await joined(a.player!.id);
    await joined(b.player!.id);
    await pub(a.player!.id, 'CAMERA', 'TR_A');
    expect(synced.filter((s) => s.identity === a.player!.id && s.rights === 'audio')).toHaveLength(0);
    await pub(b.player!.id, 'CAMERA', 'TR_B');
    expect(synced.some((s) => s.identity === b.player!.id && s.rights === 'audio')).toBe(true);
    expect(b.inbox.some((m) => m.t === 'error' && m.code === 'media_video_limit')).toBe(true);
    expect(world.media.activeOf(DEFAULT_ORG_ID, 'office').video).toEqual([a.player!.id]);
    // microfone de quem ficou so com audio e normal
    await pub(b.player!.id, 'MICROPHONE', 'TR_M');
    expect(world.media.activeOf(DEFAULT_ORG_ID, 'office').publishers.sort()).toEqual([a.player!.id, b.player!.id].sort());
  });

  it('participante cujo jogo acabou some do LiveKit depois da tolerancia (orfao)', async () => {
    const { enter, token, joined, removed, world, advance, sweep } = await setup();
    const a = enter('Ana');
    await token('Ana');
    await joined(a.player!.id);
    world.media.leave(a.player!, { evict: true });
    expect(removed).toContain(a.player!.id);
    removed.length = 0;
    advance(30_000);
    sweep();
    advance(70_000);
    sweep();
    expect(removed).toContain(a.player!.id);
  });
});
