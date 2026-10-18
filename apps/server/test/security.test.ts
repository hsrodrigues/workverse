import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import type { FastifyInstance } from 'fastify';
import { createApp, redactUrl, type AppOptions } from '../src/app';
import { SESSION_COOKIE, checkPassword, hashPassword, needsRehash, MAX_SESSIONS_PER_ACCOUNT } from '../src/auth';
import { MemoryAccountStore } from '../src/store';
import { OrgService, MAX_OWNED_ORGS } from '../src/org';
import { isReservedName, normalizeName } from '../src/world';

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

const RELAXED = {
  failDelayMs: 0,
  registerPerIp: { burst: 1000, perMinute: 1000 },
  registerPerEmail: { burst: 1000, perMinute: 1000 },
  loginPerIp: { burst: 1000, perMinute: 1000 },
  loginPerEmail: { burst: 1000, perMinute: 1000 },
};

async function setup(opts: Partial<AppOptions> = {}) {
  const store = new MemoryAccountStore();
  const { app, world } = await createApp({ store, tickMs: 50, ...opts, authLimits: { ...RELAXED, ...opts.authLimits } });
  apps.push(app);
  return { app, store, world };
}

const post = (app: FastifyInstance, url: string, payload: unknown, headers: Record<string, string> = {}, remoteAddress?: string) =>
  app.inject({ method: 'POST', url, payload: payload as object, headers, remoteAddress });
const register = (app: FastifyInstance, email: string, displayName: string, password = PASSWORD, headers: Record<string, string> = {}) =>
  post(app, '/api/register', { email, displayName, password }, headers);
const cookieOf = (res: { headers: Record<string, unknown> }) => String(([] as unknown[]).concat(res.headers['set-cookie'])[0]).split(';')[0]!;

async function listen(app: FastifyInstance) {
  await app.listen({ port: 0, host: '127.0.0.1' });
  const a = app.server.address();
  return `ws://127.0.0.1:${typeof a === 'object' && a ? a.port : 0}/ws`;
}
function refused(url: string, headers: Record<string, string>): Promise<number> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { headers });
    sockets.push(ws);
    ws.once('unexpected-response', (_r, res) => resolve(res.statusCode ?? 0));
    ws.once('open', () => reject(new Error('upgrade should have been refused')));
    ws.once('error', () => undefined);
  });
}
function open(url: string, headers: Record<string, string> = {}) {
  const ws = new WebSocket(url, { headers });
  sockets.push(ws);
  const closed = new Promise<number>((res) => ws.once('close', (c) => res(c)));
  const opened = new Promise<void>((res, rej) => {
    ws.once('open', () => res());
    ws.once('error', rej);
  });
  return { ws, closed, opened };
}

describe('CSRF / Origin on every mutating /api route', () => {
  const PROD = { production: true, allowedOrigins: [] as string[] };
  const evil = { origin: 'https://evil.example', host: 'office.example' };

  it('production without allow-list: refuses a foreign Origin on all state-changing routes, accepts same-origin', async () => {
    const { app } = await setup(PROD);
    for (const [method, url] of [
      ['POST', '/api/login'],
      ['POST', '/api/logout'],
      ['POST', '/api/orgs'],
      ['POST', '/api/media/token'],
      ['POST', '/api/admin/unlocks'],
      ['POST', '/api/stage/image'],
      ['POST', '/api/orgs/x/invites'],
      ['PATCH', '/api/orgs/x/members/y'],
      ['DELETE', '/api/orgs/x/invites/y'],
      ['POST', '/api/invites/abcdefghijklmnopqrstuv/accept'],
    ] as const) {
      const res = await app.inject({ method, url, payload: {}, headers: evil });
      expect(res.statusCode, `${method} ${url}`).toBe(403);
      expect(res.json().error.code).toBe('forbidden_origin');
    }
    const same = await post(app, '/api/login', { email: 'a@b.co', password: 'x' }, { origin: 'https://office.example', host: 'office.example' });
    expect(same.statusCode).toBe(401); // passed the origin gate, failed the credentials
    // GET is not state-changing
    expect((await app.inject({ method: 'GET', url: '/api/config', headers: evil })).statusCode).toBe(200);
  });

  it('with an allow-list: missing and foreign Origins are refused, listed ones pass', async () => {
    const { app } = await setup({ production: true, allowedOrigins: ['https://office.example'] });
    expect((await post(app, '/api/login', { email: 'a@b.co', password: 'x' })).statusCode).toBe(403);
    expect((await post(app, '/api/login', { email: 'a@b.co', password: 'x' }, { origin: 'https://evil.example' })).statusCode).toBe(403);
    expect((await post(app, '/api/login', { email: 'a@b.co', password: 'x' }, { origin: 'https://office.example' })).statusCode).toBe(401);
  });

  it('refuses a WebSocket upgrade from a foreign origin even with a valid cookie', async () => {
    const { app } = await setup(PROD);
    const cookie = cookieOf(await register(app, 'ana@example.com', 'Ana'));
    const url = await listen(app);
    expect(await refused(url, { cookie, origin: 'https://evil.example' })).toBe(403);
  });
});

describe('client IP behind a proxy', () => {
  it('rotating the leftmost X-Forwarded-For value does not evade the per-IP login limit', async () => {
    const { app } = await setup({ trustProxy: 1, authLimits: { loginPerIp: { burst: 3, perMinute: 0.001 } } });
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) {
      const res = await post(app, '/api/login', { email: `u${i}@example.com`, password: 'wrong password!' }, { 'x-forwarded-for': `${i}.1.1.1, 8.8.8.8` }, '10.0.0.1');
      codes.push(res.statusCode);
    }
    expect(codes.slice(0, 3)).toEqual([401, 401, 401]);
    expect(codes.slice(3)).toEqual([429, 429, 429]);
    // a genuinely different client (different rightmost hop) is not affected
    const other = await post(app, '/api/login', { email: 'z@example.com', password: 'wrong password!' }, { 'x-forwarded-for': '1.1.1.1, 7.7.7.7' }, '10.0.0.1');
    expect(other.statusCode).toBe(401);
  });

  it('brute force on ONE account from many IPs is stopped by the per-account limit', async () => {
    const { app } = await setup({ authLimits: { loginPerEmail: { burst: 4, perMinute: 0.001 } } });
    await register(app, 'ana@example.com', 'Ana');
    const codes: number[] = [];
    for (let i = 0; i < 10; i++) codes.push((await post(app, '/api/login', { email: 'ana@example.com', password: `guess number ${i}` }, {}, `10.1.0.${i + 1}`)).statusCode);
    expect(codes.filter((c) => c === 401).length).toBeLessThanOrEqual(4);
    expect(codes.at(-1)).toBe(429);
    // even the right password is refused while the account is throttled
    expect((await post(app, '/api/login', { email: 'ana@example.com', password: PASSWORD }, {}, '10.1.0.99')).statusCode).toBe(429);
  });

  it('lockout per IP + account after repeated failures', async () => {
    const { app } = await setup();
    await register(app, 'ana@example.com', 'Ana');
    for (let i = 0; i < 5; i++) await post(app, '/api/login', { email: 'ana@example.com', password: `wrong ${i} password` });
    const res = await post(app, '/api/login', { email: 'ana@example.com', password: PASSWORD });
    expect(res.statusCode).toBe(429);
    expect(res.headers['retry-after']).toBeDefined();
  });
});

describe('sessions and cookie', () => {
  it('cookie flags in production: HttpOnly, SameSite=Strict, Secure, Path=/, finite lifetime', async () => {
    const { app } = await setup({ production: true });
    const res = await register(app, 'ana@example.com', 'Ana');
    const c = String(res.headers['set-cookie']);
    for (const f of ['HttpOnly', 'SameSite=Strict', 'Secure', 'Path=/', 'Max-Age=']) expect(c).toContain(f);
    expect(c).not.toMatch(/Domain=/i);
  });

  it('login always issues a NEW token (no fixation) and revokes the cookie the browser presented', async () => {
    const { app } = await setup();
    await register(app, 'ana@example.com', 'Ana');
    const first = cookieOf(await post(app, '/api/login', { email: 'ana@example.com', password: PASSWORD }));
    const fixed = `${SESSION_COOKIE}=attacker-chosen-value`;
    const second = await post(app, '/api/login', { email: 'ana@example.com', password: PASSWORD }, { cookie: `${first}; ${fixed}` });
    const secondCookie = cookieOf(second);
    expect(secondCookie).not.toBe(first);
    expect(secondCookie).not.toContain('attacker-chosen-value');
    expect((await app.inject({ method: 'GET', url: '/api/me', headers: { cookie: first } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/api/me', headers: { cookie: secondCookie } })).statusCode).toBe(200);
  });

  it('keeps at most N sessions per account (oldest revoked)', async () => {
    const { app, store } = await setup();
    await register(app, 'ana@example.com', 'Ana');
    const cookies: string[] = [];
    for (let i = 0; i < MAX_SESSIONS_PER_ACCOUNT + 3; i++) {
      cookies.push(cookieOf(await post(app, '/api/login', { email: 'ana@example.com', password: PASSWORD })));
      await new Promise((r) => setTimeout(r, 2)); // distinct createdAt
    }
    const me = (c: string) => app.inject({ method: 'GET', url: '/api/me', headers: { cookie: c } }).then((r) => r.statusCode);
    expect(await me(cookies[0]!)).toBe(401);
    expect(await me(cookies.at(-1)!)).toBe(200);
    const alive = (await Promise.all(cookies.map(me))).filter((c) => c === 200).length;
    expect(alive).toBeLessThanOrEqual(MAX_SESSIONS_PER_ACCOUNT);
    expect(store.listAccounts()).toHaveLength(1);
  });

  it('logout revokes the session on the server (a stolen copy of the cookie dies too)', async () => {
    const { app } = await setup();
    const cookie = cookieOf(await register(app, 'ana@example.com', 'Ana'));
    await post(app, '/api/logout', {}, { cookie });
    expect((await app.inject({ method: 'GET', url: '/api/me', headers: { cookie } })).statusCode).toBe(401);
  });
});

describe('passwords, names and hashing', () => {
  it('rejects common / predictable passwords and the account\'s own e-mail or name', async () => {
    for (const pw of ['1234567890', 'password123', 'aaaaaaaaaaaa', 'abababababab', 'abcdefghijkl', '9876543210']) {
      expect(checkPassword(pw), pw).toBe('too_common');
    }
    expect(checkPassword('ana.silva', {})).toBe('too_short');
    expect(checkPassword('ana.silva.x', { email: 'ana.silva.x@example.com' })).toBe('too_common');
    expect(checkPassword(PASSWORD)).toBeNull();
    const { app } = await setup();
    const res = await register(app, 'ana@example.com', 'Ana', 'password123');
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('weak_password');
  });

  it('blocks homoglyph and reserved names (impersonation)', async () => {
    expect(normalizeName('Аdmin')).toBeNull(); // Cyrillic A + Latin dmin
    expect(normalizeName('Ana')).toBe('Ana');
    expect(normalizeName('Анна')).toBe('Анна'); // fully Cyrillic is fine
    expect(isReservedName('Admin')).toBe(true);
    expect(isReservedName('S t a f f')).toBe(true);
    expect(isReservedName('staff')).toBe(true);
    const { app } = await setup();
    const res = await register(app, 'x@example.com', 'Admin');
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('bad_name');
  });

  it('upgrades a weaker scrypt hash on the next successful login', async () => {
    const { app, store } = await setup();
    await register(app, 'ana@example.com', 'Ana');
    const acc = store.getByEmail('ana@example.com')!;
    acc.passwordHash = await hashPassword(PASSWORD, { N: 1024, r: 8, p: 1 });
    expect(needsRehash(acc.passwordHash)).toBe(true);
    expect((await post(app, '/api/login', { email: 'ana@example.com', password: PASSWORD })).statusCode).toBe(200);
    expect(needsRehash(store.getByEmail('ana@example.com')!.passwordHash)).toBe(false);
    expect((await post(app, '/api/login', { email: 'ana@example.com', password: PASSWORD })).statusCode).toBe(200);
  });

  it('login does not reveal whether the e-mail exists (same status, code and message)', async () => {
    const { app } = await setup();
    await register(app, 'ana@example.com', 'Ana');
    const a = await post(app, '/api/login', { email: 'ana@example.com', password: 'wrong password!' });
    const b = await post(app, '/api/login', { email: 'ghost@example.com', password: 'wrong password!' });
    expect(a.statusCode).toBe(b.statusCode);
    expect(a.json()).toEqual(b.json());
  });
});

describe('WebSocket abuse limits', () => {
  it('closes a connection that floods messages (ping included)', async () => {
    const { app } = await setup({ allowDevLogin: true, socketLimits: { messageBurst: 5, messagesPerSecond: 1 } });
    const { ws, closed, opened } = open(await listen(app));
    await opened;
    for (let i = 0; i < 60; i++) ws.send(JSON.stringify({ t: 'ping', ts: i }));
    expect(await closed).toBe(1008);
  });

  it('closes sockets that never say hello', async () => {
    const { app } = await setup({ allowDevLogin: true, socketLimits: { helloTimeoutMs: 150 } });
    const { closed, opened } = open(await listen(app));
    await opened;
    expect(await closed).toBe(4008);
  });

  it('caps simultaneous sockets per IP and per account (429 before the upgrade)', async () => {
    const { app } = await setup({ allowDevLogin: true, socketLimits: { maxPerIp: 2 } });
    const url = await listen(app);
    await open(url).opened;
    await open(url).opened;
    expect(await refused(url, {})).toBe(429);

    const b = await setup({ socketLimits: { maxPerAccount: 2 } });
    const cookie = cookieOf(await register(b.app, 'ana@example.com', 'Ana'));
    const url2 = await listen(b.app);
    await open(url2, { cookie }).opened;
    await open(url2, { cookie }).opened;
    expect(await refused(url2, { cookie })).toBe(429);
  });
});

describe('uploads', () => {
  it('an anonymous upload is refused before the body is parsed (401, not 415/413)', async () => {
    const { app } = await setup();
    const res = await app.inject({ method: 'POST', url: '/api/stage/image', payload: Buffer.alloc(1_000_000), headers: { 'content-type': 'application/octet-stream' } });
    expect(res.statusCode).toBe(401);
  });
});

describe('organizations', () => {
  it('limits how many organizations one account may own', () => {
    const store = new MemoryAccountStore();
    const svc = new OrgService(store.orgs);
    const acc = store.create({ email: 'ana@example.com', displayName: 'Ana', passwordHash: 'x' });
    for (let i = 0; i < MAX_OWNED_ORGS; i++) expect(svc.createOrg(acc, `Org ${i}`).ok).toBe(true);
    const r = svc.createOrg(acc, 'One too many');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('org_limit');
  });

  it('IDOR: an owner of org A cannot touch invites, members or teams of org B through /api/orgs/:id', async () => {
    const { app } = await setup();
    const ca = cookieOf(await register(app, 'a@example.com', 'Alice'));
    const cb = cookieOf(await register(app, 'b@example.com', 'Bruno'));
    const orgA = (await post(app, '/api/orgs', { name: 'Org A' }, { cookie: ca })).json().org.id as string;
    const orgB = (await post(app, '/api/orgs', { name: 'Org B' }, { cookie: cb })).json().org.id as string;
    const inviteB = (await post(app, `/api/orgs/${orgB}/invites`, { role: 'member' }, { cookie: cb })).json();
    expect(inviteB.invite.id).toBeTruthy();
    const bruno = (await app.inject({ method: 'GET', url: '/api/me', headers: { cookie: cb } })).json().account.id as string;

    const attempts = [
      await post(app, `/api/orgs/${orgB}/invites`, { role: 'member' }, { cookie: ca }),
      await post(app, `/api/orgs/${orgB}/teams`, { name: 'Hack' }, { cookie: ca }),
      await app.inject({ method: 'PATCH', url: `/api/orgs/${orgB}/members/${bruno}`, payload: { role: 'guest' }, headers: { cookie: ca } }),
      await app.inject({ method: 'DELETE', url: `/api/orgs/${orgB}/members/${bruno}`, headers: { cookie: ca } }),
      await app.inject({ method: 'DELETE', url: `/api/orgs/${orgB}/invites/${inviteB.invite.id}`, headers: { cookie: ca } }),
      // B's invite id through MY org path: must look like it does not exist
      await app.inject({ method: 'DELETE', url: `/api/orgs/${orgA}/invites/${inviteB.invite.id}`, headers: { cookie: ca } }),
    ];
    expect(attempts.map((r) => r.statusCode)).toEqual([404, 404, 404, 404, 404, 404]);
    // Bruno is still an owner and the invite is still valid
    const meB = (await app.inject({ method: 'GET', url: `/api/orgs/me?orgId=${orgB}`, headers: { cookie: cb } })).json();
    expect(meB.active.members.find((m: { accountId: string }) => m.accountId === bruno).role).toBe('owner');
    expect(meB.active.invites.some((i: { id: string; revokedAt: number | null }) => i.id === inviteB.invite.id && i.revokedAt === null)).toBe(true);
    // asking for B's data with A's session reveals nothing about B
    const meA = (await app.inject({ method: 'GET', url: `/api/orgs/me?orgId=${orgB}`, headers: { cookie: ca } })).json();
    expect(JSON.stringify(meA)).not.toContain('Org B');
    expect(JSON.stringify(meA)).not.toContain('b@example.com');
  });

  it('chat, DM and media do not cross organizations', async () => {
    const media = { enabled: true, url: 'ws://localhost:7880', apiKey: 'devkey', apiSecret: 'secret-secret-secret-secret-1234', ttlSeconds: 600 };
    const { app } = await setup({ media });
    const ca = cookieOf(await register(app, 'a@example.com', 'Alice'));
    const cb = cookieOf(await register(app, 'b@example.com', 'Bruno'));
    const orgA = (await post(app, '/api/orgs', { name: 'Org A' }, { cookie: ca })).json().org.id as string;
    const orgB = (await post(app, '/api/orgs', { name: 'Org B' }, { cookie: cb })).json().org.id as string;
    const url = await listen(app);

    const join = async (cookie: string, orgId: string) => {
      const { ws, opened } = open(url, { cookie });
      await opened;
      const inbox: Array<Record<string, unknown>> = [];
      ws.on('message', (raw) => inbox.push(JSON.parse(raw.toString())));
      ws.send(JSON.stringify({ t: 'hello', orgId }));
      const until = async (pred: (m: Record<string, unknown>) => boolean) => {
        for (let i = 0; i < 100; i++) {
          const m = inbox.find(pred);
          if (m) return m;
          await new Promise((r) => setTimeout(r, 20));
        }
        throw new Error('timeout');
      };
      await until((m) => m.t === 'session');
      ws.send(JSON.stringify({ t: 'join', roomId: 'office' }));
      await until((m) => m.t === 'room');
      return { ws, inbox, until };
    };
    const a = await join(ca, orgA);
    const b = await join(cb, orgB);

    a.ws.send(JSON.stringify({ t: 'chat', text: 'segredo da org A' }));
    a.ws.send(JSON.stringify({ t: 'dm', to: 'Bruno', text: 'oi de outra org' }));
    await a.until((m) => m.t === 'chat' && m.kind === 'say' || (m.t === 'error' && m.code === 'dm_offline'));
    await a.until((m) => m.t === 'error' && m.code === 'dm_offline'); // the other org looks offline
    await new Promise((r) => setTimeout(r, 150));
    expect(b.inbox.some((m) => m.t === 'chat' && m.kind === 'say')).toBe(false);
    expect(b.inbox.some((m) => m.t === 'dm')).toBe(false);
    expect(b.inbox.some((m) => m.t === 'joined' && (m.player as { name: string }).name === 'Alice')).toBe(false);

    // the LiveKit room comes from the session, never from the request body
    const tokA = (await post(app, '/api/media/token', { roomId: 'office', orgId: orgB }, { cookie: ca })).json();
    const tokB = (await post(app, '/api/media/token', { roomId: 'office', orgId: orgA }, { cookie: cb })).json();
    expect(tokA.roomName).toBe(`wv:${orgA}:office`);
    expect(tokB.roomName).toBe(`wv:${orgB}:office`);
    const payload = JSON.parse(Buffer.from(String(tokA.token).split('.')[1]!, 'base64url').toString());
    expect(payload.video.canPublishData).toBe(false);
    expect(payload.exp - payload.nbf).toBeLessThanOrEqual(600);
    expect(JSON.stringify(tokA)).not.toContain('secret-secret');
  });
});

describe('infrastructure', () => {
  it('ALLOW_DEV_LOGIN refuses requests that came through a proxy/tunnel', async () => {
    const { app } = await setup({ allowDevLogin: true });
    expect((await app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
    for (const h of [{ 'x-forwarded-for': '1.2.3.4' }, { 'cf-connecting-ip': '1.2.3.4' }, { 'cf-ray': 'abc' }]) {
      const res = await app.inject({ method: 'GET', url: '/api/config', headers: h });
      expect(res.statusCode).toBe(403);
    }
  });

  it('/health exposes no organization or room data', async () => {
    const { app } = await setup();
    expect(Object.keys((await app.inject({ method: 'GET', url: '/health' })).json()).sort()).toEqual(['ok', 'online']);
  });

  it('invite tokens never reach the access log', () => {
    expect(redactUrl('/api/invites/SECRETtoken123456/accept')).toBe('/api/invites/[redacted]/accept');
    expect(redactUrl('/invite/SECRETtoken123456')).toBe('/invite/[redacted]');
  });
});
