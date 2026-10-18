import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import type { FastifyInstance } from 'fastify';
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH, type ServerMessage } from '@workverse/shared';
import { createApp, type AppOptions } from '../src/app';
import { SESSION_COOKIE, SESSION_TTL_MS } from '../src/auth';
import { MemoryAccountStore } from '../src/store';

const PASSWORD = 'correct horse battery';
const apps: FastifyInstance[] = [];
const sockets: WebSocket[] = [];

afterEach(async () => {
  for (const s of sockets.splice(0)) {
    s.on('error', () => undefined);
    s.terminate();
  }
  for (const a of apps.splice(0)) await a.close();
});

async function setup(opts: Partial<AppOptions> = {}) {
  const store = new MemoryAccountStore();
  let now = 1_700_000_000_000;
  const clock = () => now;
  const { app } = await createApp({
    store,
    clock,
    tickMs: 50,
    authLimits: { failDelayMs: 0 },
    ...opts,
  });
  apps.push(app);
  return { app, store, advance: (ms: number) => (now += ms) };
}

async function post(app: FastifyInstance, path: string, payload: unknown, cookie?: string) {
  return app.inject({ method: 'POST', url: path, payload: payload as object, headers: cookie ? { cookie } : {} });
}

const register = (app: FastifyInstance, email = 'ana@example.com', displayName = 'Ana', password = PASSWORD) =>
  post(app, '/api/register', { email, password, displayName });

/** `wv_session=<token>` taken from a Set-Cookie header. */
function cookieOf(res: { headers: Record<string, unknown> }): string {
  const raw = res.headers['set-cookie'];
  const header = Array.isArray(raw) ? raw[0] : String(raw);
  return header!.split(';')[0]!;
}

async function listen(app: FastifyInstance): Promise<string> {
  await app.listen({ port: 0, host: '127.0.0.1' });
  const addr = app.server.address();
  return `ws://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}/ws`;
}

function openSocket(url: string, cookie?: string) {
  const ws = new WebSocket(url, { headers: cookie ? { cookie } : {} });
  sockets.push(ws);
  const inbox: ServerMessage[] = [];
  ws.on('message', (raw) => inbox.push(JSON.parse(raw.toString()) as ServerMessage));
  const opened = new Promise<void>((res, rej) => {
    ws.once('open', () => res());
    ws.once('error', rej);
  });
  const closed = new Promise<number>((res) => ws.once('close', (code) => res(code)));
  const waitFor = async <T extends ServerMessage['t']>(t: T) => {
    const deadline = Date.now() + 4000;
    while (Date.now() < deadline) {
      const m = inbox.find((x) => x.t === t);
      if (m) return m as Extract<ServerMessage, { t: T }>;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error(`timeout waiting for ${t}`);
  };
  return { ws, inbox, opened, closed, waitFor };
}

/** Resolves with the HTTP status when the WebSocket upgrade is refused. */
function refusedStatus(url: string, cookie?: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { headers: cookie ? { cookie } : {} });
    sockets.push(ws);
    ws.once('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0));
    ws.once('open', () => reject(new Error('upgrade should have been refused')));
    ws.once('error', () => undefined);
  });
}

describe('registration', () => {
  it('creates the account, starts a session in an httpOnly cookie and never returns secrets', async () => {
    const { app } = await setup();
    const res = await register(app);
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.account).toMatchObject({ email: 'ana@example.com', displayName: 'Ana' });
    expect(JSON.stringify(body)).not.toMatch(/password|scrypt|token/i);

    const setCookie = String(res.headers['set-cookie']);
    expect(setCookie).toContain(`${SESSION_COOKIE}=`);
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Strict');
    expect(setCookie).not.toContain('Secure'); // not production

    const me = await app.inject({ method: 'GET', url: '/api/me', headers: { cookie: cookieOf(res) } });
    expect(me.statusCode).toBe(200);
    expect(me.json().account.displayName).toBe('Ana');
  });

  it('marks the cookie Secure in production', async () => {
    const { app } = await setup({ production: true });
    const res = await register(app);
    expect(String(res.headers['set-cookie'])).toContain('Secure');
  });

  it('stores only a hash of the password', async () => {
    const { app, store } = await setup();
    await register(app);
    const hash = store.getByEmail('ana@example.com')!.passwordHash;
    expect(hash.startsWith('scrypt$')).toBe(true);
    expect(hash).not.toContain(PASSWORD);
  });

  it('rejects a duplicate e-mail (case-insensitive) and a duplicate display name', async () => {
    const { app } = await setup();
    expect((await register(app)).statusCode).toBe(201);

    const sameEmail = await register(app, 'ANA@Example.com', 'Outra');
    expect(sameEmail.statusCode).toBe(409);
    expect(sameEmail.json().error.code).toBe('email_taken');

    const sameName = await register(app, 'beto@example.com', 'ana');
    expect(sameName.statusCode).toBe(409);
    expect(sameName.json().error.code).toBe('name_taken');
  });

  it('rejects short and overlong passwords, bad e-mails and bad names', async () => {
    const { app } = await setup();
    const short = await register(app, 'a@example.com', 'Ana', 'x'.repeat(MIN_PASSWORD_LENGTH - 1));
    expect(short.statusCode).toBe(400);
    expect(short.json().error.code).toBe('weak_password');

    const long = await register(app, 'a@example.com', 'Ana', 'x'.repeat(MAX_PASSWORD_LENGTH + 1));
    expect(long.statusCode).toBe(400);
    expect(long.json().error.code).toBe('weak_password');

    const edgeOk = await register(app, 'a@example.com', 'Ana', 'xk2'.repeat(4).slice(0, MIN_PASSWORD_LENGTH));
    expect(edgeOk.statusCode).toBe(201);

    const badEmail = await register(app, 'not-an-email', 'Bia');
    expect(badEmail.json().error.code).toBe('invalid_email');

    const badName = await register(app, 'b@example.com', '<script>');
    expect(badName.json().error.code).toBe('bad_name');

    const noBody = await app.inject({ method: 'POST', url: '/api/register', payload: 'not json', headers: { 'content-type': 'application/json' } });
    expect(noBody.statusCode).toBe(400);
    expect(noBody.json().error.code).toBe('bad_request');
  });
});

describe('login', () => {
  it('accepts the right password and normalises the e-mail', async () => {
    const { app } = await setup();
    await register(app);
    const res = await post(app, '/api/login', { email: '  Ana@Example.com ', password: PASSWORD });
    expect(res.statusCode).toBe(200);
    expect(res.json().account.displayName).toBe('Ana');
    expect(String(res.headers['set-cookie'])).toContain(`${SESSION_COOKIE}=`);
  });

  it('gives the same generic answer for a wrong password and an unknown e-mail', async () => {
    const { app } = await setup();
    await register(app);
    const wrong = await post(app, '/api/login', { email: 'ana@example.com', password: 'wrong password!' });
    const unknown = await post(app, '/api/login', { email: 'ghost@example.com', password: 'wrong password!' });
    expect(wrong.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(wrong.json()).toEqual(unknown.json());
    expect(wrong.json().error.code).toBe('invalid_credentials');
    expect(wrong.headers['set-cookie']).toBeUndefined();
  });

  it('refuses dev (passwordless) accounts through the password route', async () => {
    const { app, store } = await setup();
    store.create({ email: 'dev-x@dev.invalid', displayName: 'Dev', passwordHash: '' });
    const res = await post(app, '/api/login', { email: 'dev-x@dev.invalid', password: '' });
    expect(res.statusCode).toBe(401);
  });
});

describe('sessions', () => {
  it('rejects /api/me without a cookie or with a forged one', async () => {
    const { app } = await setup();
    expect((await app.inject({ method: 'GET', url: '/api/me' })).statusCode).toBe(401);
    const forged = await app.inject({ method: 'GET', url: '/api/me', headers: { cookie: `${SESSION_COOKIE}=forged` } });
    expect(forged.statusCode).toBe(401);
  });

  it('expires after the TTL', async () => {
    const { app, advance } = await setup();
    const cookie = cookieOf(await register(app));
    const ok = () => app.inject({ method: 'GET', url: '/api/me', headers: { cookie } });

    advance(SESSION_TTL_MS - 1000);
    expect((await ok()).statusCode).toBe(200);
    advance(2000);
    expect((await ok()).statusCode).toBe(401);
  });

  it('is revoked by logout, which also clears the cookie', async () => {
    const { app } = await setup();
    const cookie = cookieOf(await register(app));
    const out = await post(app, '/api/logout', {}, cookie);
    expect(out.statusCode).toBe(204);
    expect(String(out.headers['set-cookie'])).toContain('Max-Age=0');
    const me = await app.inject({ method: 'GET', url: '/api/me', headers: { cookie } });
    expect(me.statusCode).toBe(401);
  });

  it('logout without a session is harmless', async () => {
    const { app } = await setup();
    expect((await post(app, '/api/logout', {})).statusCode).toBe(204);
  });

  it('logout kicks the live WebSocket of that session', async () => {
    const { app } = await setup();
    const url = await listen(app);
    const cookie = cookieOf(await register(app));
    const c = openSocket(url, cookie);
    await c.opened;
    c.ws.send(JSON.stringify({ t: 'hello' }));
    await c.waitFor('session');

    await post(app, '/api/logout', {}, cookie);
    expect(await c.closed).toBe(4001);
  });

  it('exposes /api/config with devLogin off by default', async () => {
    const { app } = await setup();
    const res = await app.inject({ method: 'GET', url: '/api/config' });
    expect(res.json()).toMatchObject({ devLogin: false });
    const dev = await setup({ allowDevLogin: true });
    expect((await dev.app.inject({ method: 'GET', url: '/api/config' })).json()).toMatchObject({ devLogin: true });
  });
});

describe('rate limiting', () => {
  it('answers 429 with retryAfterSeconds once the login burst is spent', async () => {
    const { app } = await setup({ authLimits: { failDelayMs: 0, loginPerIp: { burst: 3, perMinute: 1 } } });
    await register(app);
    for (let i = 0; i < 3; i++) {
      expect((await post(app, '/api/login', { email: 'ana@example.com', password: 'wrong password!' })).statusCode).toBe(401);
    }
    const limited = await post(app, '/api/login', { email: 'ana@example.com', password: PASSWORD });
    expect(limited.statusCode).toBe(429);
    const { error } = limited.json();
    expect(error.code).toBe('rate_limited');
    expect(error.retryAfterSeconds).toBeGreaterThan(0);
    expect(limited.headers['retry-after']).toBe(String(error.retryAfterSeconds));
  });

  it('recovers after time passes', async () => {
    const { app, advance } = await setup({ authLimits: { failDelayMs: 0, loginPerIp: { burst: 1, perMinute: 60 } } });
    await register(app);
    expect((await post(app, '/api/login', { email: 'ana@example.com', password: PASSWORD })).statusCode).toBe(200);
    expect((await post(app, '/api/login', { email: 'ana@example.com', password: PASSWORD })).statusCode).toBe(429);
    advance(2000);
    expect((await post(app, '/api/login', { email: 'ana@example.com', password: PASSWORD })).statusCode).toBe(200);
  });

  it('locks out repeated failures even with the right password, until the lockout ends', async () => {
    const { app, advance } = await setup({ authLimits: { failDelayMs: 0, lockoutAfter: 3, lockoutBaseMs: 30_000 } });
    await register(app);
    for (let i = 0; i < 3; i++) await post(app, '/api/login', { email: 'ana@example.com', password: 'wrong password!' });
    const locked = await post(app, '/api/login', { email: 'ana@example.com', password: PASSWORD });
    expect(locked.statusCode).toBe(429);
    expect(locked.json().error.retryAfterSeconds).toBeLessThanOrEqual(30);
    advance(31_000);
    expect((await post(app, '/api/login', { email: 'ana@example.com', password: PASSWORD })).statusCode).toBe(200);
  });

  it('limits registrations per IP', async () => {
    const { app } = await setup({ authLimits: { failDelayMs: 0, registerPerIp: { burst: 2, perMinute: 0.1 } } });
    expect((await register(app, 'a1@example.com', 'Um')).statusCode).toBe(201);
    expect((await register(app, 'a2@example.com', 'Dois')).statusCode).toBe(201);
    const third = await register(app, 'a3@example.com', 'Tres');
    expect(third.statusCode).toBe(429);
    expect(third.json().error.retryAfterSeconds).toBeGreaterThan(0);
  });
});

describe('WebSocket authentication', () => {
  it('refuses the upgrade with 401 without a session cookie', async () => {
    const { app } = await setup();
    const url = await listen(app);
    expect(await refusedStatus(url)).toBe(401);
    expect(await refusedStatus(url, `${SESSION_COOKIE}=forged`)).toBe(401);
  });

  it('refuses the upgrade once the session has expired or was revoked', async () => {
    const { app, advance } = await setup();
    const url = await listen(app);
    const cookie = cookieOf(await register(app));
    advance(SESSION_TTL_MS + 1);
    expect(await refusedStatus(url, cookie)).toBe(401);

    const fresh = cookieOf(await post(app, '/api/login', { email: 'ana@example.com', password: PASSWORD }));
    await post(app, '/api/logout', {}, fresh);
    expect(await refusedStatus(url, fresh)).toBe(401);
  });

  it('accepts a valid cookie and ignores any name sent in hello', async () => {
    const { app } = await setup();
    const url = await listen(app);
    const cookie = cookieOf(await register(app));
    const c = openSocket(url, cookie);
    await c.opened;
    c.ws.send(JSON.stringify({ t: 'hello', name: 'Impostor' }));
    const session = await c.waitFor('session');
    expect(session.name).toBe('Ana');
    expect(session.isNew).toBe(false);
    expect(JSON.stringify(session)).not.toContain('token');
  });

  it('keeps one live session per account: the newer connection replaces the older', async () => {
    const { app } = await setup();
    const url = await listen(app);
    const cookie = cookieOf(await register(app));

    const first = openSocket(url, cookie);
    await first.opened;
    first.ws.send(JSON.stringify({ t: 'hello' }));
    await first.waitFor('session');

    const second = openSocket(url, cookie);
    await second.opened;
    second.ws.send(JSON.stringify({ t: 'hello' }));
    await second.waitFor('session');

    const err = await first.waitFor('error');
    expect(err.code).toBe('replaced');
    expect(await first.closed).toBe(4000);
    expect((await app.inject({ method: 'GET', url: '/health' })).json().online).toBe(1);
  });

  it('refuses name-only hello when dev login is off, even with a session-less socket', async () => {
    const { app } = await setup();
    const url = await listen(app);
    expect(await refusedStatus(url)).toBe(401);
  });

  it('accepts name-only hello when dev login is on', async () => {
    const { app } = await setup({ allowDevLogin: true });
    const url = await listen(app);
    const c = openSocket(url);
    await c.opened;
    c.ws.send(JSON.stringify({ t: 'hello', name: 'Bot' }));
    expect((await c.waitFor('session')).name).toBe('Bot');
  });

  it('does not let dev login take over a password account', async () => {
    const { app } = await setup({ allowDevLogin: true });
    const url = await listen(app);
    await register(app);
    const c = openSocket(url);
    await c.opened;
    c.ws.send(JSON.stringify({ t: 'hello', name: 'Ana' }));
    expect((await c.waitFor('error')).code).toBe('name_taken');
  });
});

describe('ALLOW_DEV_LOGIN safety', () => {
  it('refuses to start in production', async () => {
    await expect(createApp({ store: new MemoryAccountStore(), allowDevLogin: true, production: true })).rejects.toThrow(/ALLOW_DEV_LOGIN/);
  });
});

describe('Origin allow-list', () => {
  it('blocks API writes and the WebSocket from other origins', async () => {
    const { app } = await setup({ allowedOrigins: ['https://app.example.com'] });
    const url = await listen(app);
    const bad = await app.inject({
      method: 'POST',
      url: '/api/register',
      payload: { email: 'a@example.com', password: PASSWORD, displayName: 'Ana' },
      headers: { origin: 'https://evil.example.com' },
    });
    expect(bad.statusCode).toBe(403);
    const good = await app.inject({
      method: 'POST',
      url: '/api/register',
      payload: { email: 'a@example.com', password: PASSWORD, displayName: 'Ana' },
      headers: { origin: 'https://app.example.com' },
    });
    expect(good.statusCode).toBe(201);
    const cookie = cookieOf(good);
    const status = await new Promise<number>((resolve) => {
      const ws = new WebSocket(url, { headers: { cookie, origin: 'https://evil.example.com' } });
      sockets.push(ws);
      ws.once('unexpected-response', (_r, res) => resolve(res.statusCode ?? 0));
    });
    expect(status).toBe(403);
  });
});

