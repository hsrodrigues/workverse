import { afterEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { ROOM_DEFS, type ServerMessage } from '@workverse/shared';
import { createApp, type AppOptions } from '../src/app';
import { MemoryAccountStore } from '../src/store';
import { World, type Connection } from '../src/world';
import { livekitRoomName, registerMediaRoutes, resolveMediaConfig } from '../src/media';

const apps: FastifyInstance[] = [];
afterEach(async () => {
  for (const a of apps.splice(0)) await a.close();
});

class FakeConn implements Connection {
  strikes = 0;
  accountId?: string;
  player?: Connection['player'];
  inbox: ServerMessage[] = [];
  send(msg: ServerMessage) {
    this.inbox.push(msg);
  }
  close() {}
}

async function setup(opts: Partial<AppOptions> = {}) {
  let now = 1_700_000_000_000;
  const { app, world } = await createApp({ store: new MemoryAccountStore(), allowDevLogin: true, tickMs: 50, clock: () => now, ...opts });
  apps.push(app);
  return { app, world, advance: (ms: number) => (now += ms) };
}

function enter(world: World, name: string, roomId?: string) {
  const c = new FakeConn();
  world.handle(c, { t: 'hello', name });
  world.handle(c, { t: 'join', roomId });
  return c.player!;
}

const token = (app: FastifyInstance, payload: object, cookie?: string) =>
  app.inject({ method: 'POST', url: '/api/media/token', payload, headers: cookie ? { cookie } : {} });

function claims(jwt: string) {
  return JSON.parse(Buffer.from(jwt.split('.')[1]!, 'base64url').toString('utf8')) as {
    sub: string;
    name: string;
    iss: string;
    nbf: number;
    exp: number;
    video: { room: string; roomJoin: boolean; canPublish: boolean; canSubscribe: boolean; canPublishData?: boolean; canPublishSources?: string[] };
  };
}

const OTHER_ROOM = ROOM_DEFS.find((r) => r.id !== 'office')!.id;

describe('POST /api/media/token', () => {
  it('rejects requests with no session (401)', async () => {
    const { app } = await setup();
    expect((await token(app, { roomId: 'office' })).statusCode).toBe(401);
    expect((await token(app, { roomId: 'office', devName: 'Ghost' })).statusCode).toBe(401);
  });

  it('issues a token only for the room the player is in now', async () => {
    const { app, world } = await setup();
    const p = enter(world, 'Ana', 'office');
    expect((await token(app, { roomId: 'office', devName: 'Ana' })).statusCode).toBe(200);
    const denied = await token(app, { roomId: OTHER_ROOM, devName: 'Ana' });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error.code).toBe('not_in_room');
    expect(denied.json().token).toBeUndefined();

    world.enterRoom(p, OTHER_ROOM);
    expect((await token(app, { roomId: 'office', devName: 'Ana' })).statusCode).toBe(403);
    const moved = await token(app, { roomId: OTHER_ROOM, devName: 'Ana' });
    expect(moved.statusCode).toBe(200);
    expect(moved.json().roomName).toBe(livekitRoomName(OTHER_ROOM, 'default'));
  });

  it('denies a known account that is not in any room', async () => {
    const { app, world } = await setup();
    world.handle(new FakeConn(), { t: 'hello', name: 'Lurker' });
    expect((await token(app, { roomId: 'office', devName: 'Lurker' })).statusCode).toBe(403);
  });

  it('answers 404 for unknown rooms and 400 for malformed input', async () => {
    const { app, world } = await setup();
    enter(world, 'Ana');
    const missing = await token(app, { roomId: 'nope', devName: 'Ana' });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe('room_not_found');
    expect((await token(app, { roomId: 42, devName: 'Ana' })).statusCode).toBe(400);
    expect((await token(app, { devName: 'Ana' })).statusCode).toBe(400);
    expect((await token(app, { roomId: 'office', kind: 'x', devName: 'Ana' })).statusCode).toBe(400);
  });

  it('puts the right claims in the JWT', async () => {
    const { app, world } = await setup();
    const p = enter(world, 'Ana', 'office');
    const body = (await token(app, { roomId: 'office', devName: 'Ana' })).json();
    expect(body.identity).toBe(p.id);
    expect(body.canPublish).toBe(true);
    const c = claims(body.token);
    expect(c.sub).toBe(p.id);
    expect(c.name).toBe('Ana');
    expect(c.iss).toBe('devkey');
    expect(c.exp - c.nbf).toBeGreaterThan(0);
    expect(c.exp - c.nbf).toBeLessThanOrEqual(600);
    expect(c.video).toMatchObject({ room: 'wv:default:office', roomJoin: true, canSubscribe: true, canPublish: true, canPublishData: false });
    expect(c.video.canPublishSources).toEqual(expect.arrayContaining(['microphone', 'camera', 'screen_share']));
  });

  it('lets the client ask for less, never more', async () => {
    const { app, world } = await setup();
    enter(world, 'Ana', 'office');
    const viewer = (await token(app, { roomId: 'office', devName: 'Ana', canPublish: false })).json();
    expect(viewer.canPublish).toBe(false);
    expect(claims(viewer.token).video.canPublish).toBe(false);
  });

  it('applies a restrictive canPublishIn policy decided by the server (auditorium hook)', async () => {
    const store = new MemoryAccountStore();
    const world = new World({ store, allowDevLogin: true });
    const app = Fastify();
    apps.push(app);
    app.decorateRequest('auth', null);
    registerMediaRoutes(
      app,
      { store, world, guard: undefined as never, clock: Date.now, secureCookies: false, allowDevLogin: true, allowedOrigins: [] },
      { canPublishIn: (_room, _p, kind) => kind !== 'stage' },
    );
    enter(world, 'Ana', 'office');
    const stage = (await token(app, { roomId: 'office', devName: 'Ana', kind: 'stage', canPublish: true })).json();
    expect(stage.canPublish).toBe(false);
    expect(claims(stage.token).video.canPublish).toBe(false);
    expect((await token(app, { roomId: 'office', devName: 'Ana' })).json().canPublish).toBe(true);
  });

  it('works with a real session cookie and refuses name-only access to password accounts', async () => {
    const { app, world } = await setup();
    const reg = await app.inject({ method: 'POST', url: '/api/register', payload: { email: 'bia@example.com', password: 'correct horse battery', displayName: 'Bia' } });
    const cookie = String(reg.headers['set-cookie']).split(';')[0]!;
    const c = new FakeConn();
    c.accountId = reg.json().account.id;
    world.handle(c, { t: 'hello' });
    world.handle(c, { t: 'join', roomId: 'office' });
    const ok = await token(app, { roomId: 'office' }, cookie);
    expect(ok.statusCode).toBe(200);
    expect(claims(ok.json().token).sub).toBe(c.player!.id);
    expect((await token(app, { roomId: 'office', devName: 'Bia' })).statusCode).toBe(401);
  });

  it('does not accept devName when dev login is off', async () => {
    const { app } = await setup({ allowDevLogin: false });
    expect((await token(app, { roomId: 'office', devName: 'Ana' })).statusCode).toBe(401);
  });

  it('rate limits per account (429 + Retry-After) and recovers over time', async () => {
    const { app, world, advance } = await setup();
    enter(world, 'Ana', 'office');
    const codes: number[] = [];
    for (let i = 0; i < 14; i++) codes.push((await token(app, { roomId: 'office', devName: 'Ana' })).statusCode);
    expect(codes.slice(0, 12).every((c) => c === 200)).toBe(true);
    expect(codes[12]).toBe(429);
    const limited = await token(app, { roomId: 'office', devName: 'Ana' });
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    advance(30_000);
    expect((await token(app, { roomId: 'office', devName: 'Ana' })).statusCode).toBe(200);
  });
});

describe('GET /api/media/config and disabled mode', () => {
  it('reports enabled with dev defaults outside production', async () => {
    const saved = { ...process.env };
    for (const k of ['LIVEKIT_URL', 'PUBLIC_LIVEKIT_URL', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET']) delete process.env[k];
    try {
      const { app } = await setup();
      expect((await app.inject({ url: '/api/media/config' })).json()).toEqual({ enabled: true, url: 'ws://localhost:7880' });
    } finally {
      process.env = saved;
    }
  });

  it('is disabled in production without LIVEKIT_* and refuses tokens', async () => {
    const saved = { ...process.env };
    for (const k of ['LIVEKIT_URL', 'PUBLIC_LIVEKIT_URL', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET']) delete process.env[k];
    try {
      const { app, world } = await setup({ production: true, allowDevLogin: false });
      expect((await app.inject({ url: '/api/media/config' })).json()).toEqual({ enabled: false, url: '' });
      const reg = await app.inject({ method: 'POST', url: '/api/register', payload: { email: 'c@example.com', password: 'correct horse battery', displayName: 'Cris' } });
      const cookie = String(reg.headers['set-cookie']).split(';')[0]!;
      const c = new FakeConn();
      c.accountId = reg.json().account.id;
      world.handle(c, { t: 'hello' });
      world.handle(c, { t: 'join' });
      const res = await token(app, { roomId: 'office' }, cookie);
      expect(res.statusCode).toBe(503);
      expect(res.json().error.code).toBe('media_disabled');
    } finally {
      process.env = saved;
    }
  });

  it('resolveMediaConfig reads the environment', () => {
    expect(resolveMediaConfig({}, true).enabled).toBe(false);
    expect(resolveMediaConfig({}, false)).toMatchObject({ enabled: true, apiKey: 'devkey', apiSecret: 'secret', url: 'ws://localhost:7880' });
    const c = resolveMediaConfig({ LIVEKIT_URL: 'ws://lk:7880', PUBLIC_LIVEKIT_URL: 'wss://lk.example.com', LIVEKIT_API_KEY: 'k', LIVEKIT_API_SECRET: 's' }, true);
    expect(c).toMatchObject({ enabled: true, url: 'wss://lk.example.com', apiKey: 'k', apiSecret: 's' });
  });
});
