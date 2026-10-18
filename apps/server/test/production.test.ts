import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { createApp, type AppOptions } from '../src/app';
import { hashPassword } from '../src/auth';
import { resolveBootConfig } from '../src/bootConfig';
import { resolveMediaConfig } from '../src/media';
import { makeOriginList } from '../src/origins';
import { MemoryAccountStore } from '../src/store';

const PASSWORD = 'Zebra-lanterna-4417-sol';
const SECURE_ENV = {
  NODE_ENV: 'production',
  PUBLIC_URL: 'https://escritorio.example.com',
  DATABASE_URL: 'postgres://u:p@h/db',
  LIVEKIT_URL: 'wss://x.livekit.cloud',
  LIVEKIT_API_KEY: 'k',
  LIVEKIT_API_SECRET: 's',
  METRICS_TOKEN: 't',
};

describe('resolveBootConfig (fail-fast de producao)', () => {
  it('config segura: sem erros nem avisos; origem derivada de PUBLIC_URL; registro padrao = closed; trust proxy 1', () => {
    const c = resolveBootConfig({ ...SECURE_ENV, HOST: '127.0.0.1' });
    expect(c.errors).toEqual([]);
    expect(c.warnings).toEqual([]);
    expect(c.allowedOrigins).toEqual(['https://escritorio.example.com']);
    expect(c.registration).toBe('closed');
    expect(c.trustProxy).toBe(1);
    expect(c.port).toBe(8080);
  });

  it('ALLOW_DEV_LOGIN em producao e erro', () => {
    expect(resolveBootConfig({ ...SECURE_ENV, ALLOW_DEV_LOGIN: '1' }).errors.join()).toMatch(/ALLOW_DEV_LOGIN/);
  });

  it('sem ALLOWED_ORIGINS/PUBLIC_URL e erro', () => {
    const { PUBLIC_URL: _omit, ...env } = SECURE_ENV;
    expect(resolveBootConfig(env).errors.join()).toMatch(/ALLOWED_ORIGINS/);
  });

  it('aceita curinga https://*.trycloudflare.com e rejeita curingas perigosos', () => {
    expect(resolveBootConfig({ ...SECURE_ENV, ALLOWED_ORIGINS: 'https://*.trycloudflare.com' }).errors).toEqual([]);
    expect(resolveBootConfig({ ...SECURE_ENV, ALLOWED_ORIGINS: 'https://*.com' }).errors.join()).toMatch(/invalido/);
    expect(resolveBootConfig({ ...SECURE_ENV, ALLOWED_ORIGINS: 'http://*.example.com' }).errors.join()).toMatch(/invalido/);
    expect(resolveBootConfig({ ...SECURE_ENV, ALLOWED_ORIGINS: '*' }).errors.join()).toMatch(/invalido/);
  });

  it('PUBLIC_URL em http (fora de localhost) e erro', () => {
    expect(resolveBootConfig({ ...SECURE_ENV, PUBLIC_URL: 'http://meusite.com' }).errors.join()).toMatch(/https/);
    expect(resolveBootConfig({ ...SECURE_ENV, PUBLIC_URL: 'http://localhost:8080' }).errors).toEqual([]);
  });

  it('sem DATABASE_URL: erro, a menos que ALLOW_JSON_STORE=1 (aviso)', () => {
    const { DATABASE_URL: _omit, ...env } = SECURE_ENV;
    expect(resolveBootConfig(env).errors.join()).toMatch(/DATABASE_URL/);
    const ok = resolveBootConfig({ ...env, ALLOW_JSON_STORE: '1' });
    expect(ok.errors).toEqual([]);
    expect(ok.warnings.join()).toMatch(/JSON/);
  });

  it('LiveKit ausente: so aviso; ws:// remoto: erro; METRICS_TOKEN ausente: aviso', () => {
    const { LIVEKIT_URL: _a, LIVEKIT_API_KEY: _b, LIVEKIT_API_SECRET: _c, METRICS_TOKEN: _d, ...env } = SECURE_ENV;
    const c = resolveBootConfig(env);
    expect(c.errors).toEqual([]);
    expect(c.mediaEnabled).toBe(false);
    expect(c.metricsEnabled).toBe(false);
    expect(c.warnings.join('|')).toMatch(/LiveKit[^|]*DESLIGADOS/);
    expect(c.warnings.join('|')).toMatch(/METRICS_TOKEN/);
    expect(resolveBootConfig({ ...SECURE_ENV, LIVEKIT_URL: 'ws://livekit.example.com' }).errors.join()).toMatch(/wss/);
  });

  it('REGISTRATION_MODE invalido e erro; fora de producao nada e exigido', () => {
    expect(resolveBootConfig({ ...SECURE_ENV, REGISTRATION_MODE: 'abc' }).errors.join()).toMatch(/REGISTRATION_MODE/);
    const dev = resolveBootConfig({});
    expect(dev.errors).toEqual([]);
    expect(dev.registration).toBe('closed');
    expect(dev.trustProxy).toBe(0);
  });

  it('TRUST_PROXY: numero de saltos, 0 desliga, lixo e erro', () => {
    expect(resolveBootConfig({ ...SECURE_ENV, TRUST_PROXY: '2' }).trustProxy).toBe(2);
    expect(resolveBootConfig({ ...SECURE_ENV, TRUST_PROXY: '0' }).trustProxy).toBe(0);
    expect(resolveBootConfig({ ...SECURE_ENV, TRUST_PROXY: 'x' }).errors.join()).toMatch(/TRUST_PROXY/);
  });

  it('o token do LiveKit usa a URL publica (PUBLIC_LIVEKIT_URL tem prioridade)', () => {
    const m = resolveMediaConfig({ LIVEKIT_URL: 'ws://interno:7880', PUBLIC_LIVEKIT_URL: 'wss://p.livekit.cloud', LIVEKIT_API_KEY: 'k', LIVEKIT_API_SECRET: 's' }, true);
    expect(m.enabled).toBe(true);
    expect(m.url).toBe('wss://p.livekit.cloud');
  });
});

describe('main.ts aborta em producao insegura (processo real)', () => {
  const serverDir = fileURLToPath(new URL('..', import.meta.url));
  const run = (env: Record<string, string>) => {
    const clean: NodeJS.ProcessEnv = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, ...env };
    return spawnSync(process.execPath, ['--import', 'tsx', 'src/main.ts'], { cwd: serverDir, env: clean, encoding: 'utf8', timeout: 30_000 });
  };

  it('ALLOW_DEV_LOGIN=1 + NODE_ENV=production: sai com codigo 1 e mensagem em portugues', () => {
    const r = run({ NODE_ENV: 'production', ALLOW_DEV_LOGIN: '1', PUBLIC_URL: 'https://a.example.com', ALLOW_JSON_STORE: '1' });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/NAO vai iniciar/);
    expect(r.stderr).toMatch(/ALLOW_DEV_LOGIN/);
  });

  it('sem origem e sem banco: lista os dois problemas', () => {
    const r = run({ NODE_ENV: 'production' });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/ALLOWED_ORIGINS/);
    expect(r.stderr).toMatch(/DATABASE_URL/);
  });
});

describe('lista de origens com curinga', () => {
  it('casa um rotulo, nao o dominio nu nem outros dominios', () => {
    const l = makeOriginList(['https://app.example.com', 'https://*.trycloudflare.com']);
    expect(l.includes('https://app.example.com')).toBe(true);
    expect(l.includes('https://abc-def-ghi.trycloudflare.com')).toBe(true);
    expect(l.includes('https://trycloudflare.com')).toBe(false);
    expect(l.includes('https://a.b.trycloudflare.com')).toBe(false);
    expect(l.includes('http://abc.trycloudflare.com')).toBe(false);
    expect(l.includes('https://abc.trycloudflare.com.evil.com')).toBe(false);
    expect(l.includes('https://evil.com')).toBe(false);
    expect(l.length).toBe(2);
  });
});

// ---- servidor com site, cabecalhos e modos de registro -----------------------------------------------------------
const apps: FastifyInstance[] = [];
const tmp: string[] = [];
afterEach(async () => {
  for (const a of apps.splice(0)) await a.close();
});

function fakeWeb() {
  const dir = mkdtempSync(resolve(tmpdir(), 'wv-web-'));
  tmp.push(dir);
  mkdirSync(resolve(dir, 'assets'));
  writeFileSync(resolve(dir, 'index.html'), '<!doctype html><title>WV</title><div id="root"></div>');
  writeFileSync(resolve(dir, 'assets', 'app-abc123.js'), 'console.log("x");'.repeat(200));
  return dir;
}

async function setup(opts: Partial<AppOptions> = {}) {
  const store = new MemoryAccountStore();
  const { app, world } = await createApp({ store, tickMs: 50, authLimits: { failDelayMs: 0 }, ...opts });
  apps.push(app);
  return { app, store, world };
}

describe('site estatico + cabecalhos', () => {
  let web: string;
  beforeAll(() => {
    web = fakeWeb();
    return () => {
      for (const d of tmp.splice(0)) rmSync(d, { recursive: true, force: true });
    };
  });

  const make = () => setup({ production: true, web: { webRoot: web, production: true, livekitUrl: 'wss://x.livekit.cloud' } });

  it('serve index.html em / e em rotas do SPA, com no-cache', async () => {
    const { app } = await make();
    for (const url of ['/', '/invite/abcdefghijklmnopqrstuv', '/qualquer/rota']) {
      const r = await app.inject({ method: 'GET', url });
      expect(r.statusCode, url).toBe(200);
      expect(r.body).toContain('id="root"');
      expect(r.headers['cache-control']).toBe('no-cache');
    }
  });

  it('assets com cache longo e imutavel; arquivo inexistente e 404 (nao vira SPA)', async () => {
    const { app } = await make();
    const r = await app.inject({ method: 'GET', url: '/assets/app-abc123.js' });
    expect(r.statusCode).toBe(200);
    expect(r.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect((await app.inject({ method: 'GET', url: '/assets/nao-existe.js' })).statusCode).toBe(404);
  });

  it('/api, /health e /metrics nunca caem no fallback', async () => {
    const { app } = await make();
    const unknown = await app.inject({ method: 'GET', url: '/api/nao-existe' });
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json().error.code).toBe('not_found');
    expect((await app.inject({ method: 'GET', url: '/health' })).json().ok).toBe(true);
    expect((await app.inject({ method: 'GET', url: '/metrics' })).body).not.toContain('id="root"');
  });

  it('cabecalhos de seguranca em paginas e na API; HSTS em producao', async () => {
    const { app } = await make();
    for (const url of ['/', '/health', '/api/config']) {
      const h = (await app.inject({ method: 'GET', url })).headers;
      const csp = String(h['content-security-policy']);
      expect(csp, url).toContain("script-src 'self'");
      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).toContain("img-src 'self' data: blob:");
      expect(csp).toContain("media-src 'self' blob:");
      expect(csp).toContain('wss://x.livekit.cloud');
      expect(csp).toContain('https://fonts.googleapis.com');
      expect(h['x-content-type-options']).toBe('nosniff');
      expect(h['referrer-policy']).toBe('strict-origin-when-cross-origin');
      expect(h['permissions-policy']).toContain('microphone=(self)');
      expect(h['permissions-policy']).toContain('display-capture=(self)');
      expect(h['strict-transport-security']).toMatch(/max-age=\d+/);
    }
  });

  it('sem HSTS fora de producao', async () => {
    const { app } = await setup({ web: { webRoot: web, production: false } });
    expect((await app.inject({ method: 'GET', url: '/' })).headers['strict-transport-security']).toBeUndefined();
  });
});

describe('REGISTRATION_MODE', () => {
  const reg = (app: FastifyInstance, body: Record<string, unknown>) =>
    app.inject({ method: 'POST', url: '/api/register', payload: { password: PASSWORD, ...body } });

  it('/api/config informa devLogin=false e o modo', async () => {
    const { app } = await setup({ production: true, registrationMode: 'invite' });
    expect((await app.inject({ method: 'GET', url: '/api/config' })).json()).toEqual({ devLogin: false, registration: 'invite' });
  });

  it('closed: ninguem se cadastra, mas quem ja tem conta entra', async () => {
    const { app, store } = await setup({ registrationMode: 'closed' });
    const r = await reg(app, { email: 'a@example.com', displayName: 'Ana', inviteToken: 'x'.repeat(22) });
    expect(r.statusCode).toBe(403);
    expect(r.json().error.code).toBe('registration_closed');
    store.create({ email: 'b@example.com', displayName: 'Beto', passwordHash: await hashPassword(PASSWORD) });
    const l = await app.inject({ method: 'POST', url: '/api/login', payload: { email: 'b@example.com', password: PASSWORD } });
    expect(l.statusCode).toBe(200);
  });

  it('invite: sem convite 403; convite invalido 404; convite valido cria a conta; uso unico', async () => {
    const { app, store } = await setup({ registrationMode: 'invite' });
    store.create({ email: 'dono@example.com', displayName: 'Dono', passwordHash: await hashPassword(PASSWORD) });
    const login = await app.inject({ method: 'POST', url: '/api/login', payload: { email: 'dono@example.com', password: PASSWORD } });
    expect(login.statusCode).toBe(200);
    const cookie = String(login.headers['set-cookie']).split(';')[0]!;

    expect((await reg(app, { email: 'a@example.com', displayName: 'Ana' })).json().error.code).toBe('invite_required');
    expect((await reg(app, { email: 'a@example.com', displayName: 'Ana', inviteToken: 'z'.repeat(22) })).json().error.code).toBe('invite_not_found');

    const me = await app.inject({ method: 'GET', url: '/api/orgs/me', headers: { cookie } });
    const orgId = me.json().orgs[0].id as string;
    const inv = await app.inject({ method: 'POST', url: `/api/orgs/${orgId}/invites`, payload: { role: 'member' }, headers: { cookie } });
    expect(inv.statusCode).toBe(201);
    const token = inv.json().token as string;

    expect((await reg(app, { email: 'a@example.com', displayName: 'Ana', inviteToken: token })).statusCode).toBe(201);
    expect((await reg(app, { email: 'b@example.com', displayName: 'Beto', inviteToken: token })).statusCode).toBe(410);
  });

  it('cookie de sessao so e Secure em producao (atras de HTTPS)', async () => {
    for (const production of [false, true]) {
      const { app } = await setup({ production, registrationMode: 'open' });
      const r = await reg(app, { email: `p${production}@example.com`, displayName: production ? 'Prod' : 'Dev' });
      expect(String(r.headers['set-cookie'])).toContain('SameSite=Strict');
      expect(/;\s*Secure/.test(String(r.headers['set-cookie']))).toBe(production);
    }
  });

  it('IP real atras do proxy: trustProxy=1 usa a ultima entrada do X-Forwarded-For (nao a forjada)', async () => {
    const { app } = await setup({ trustProxy: 1 });
    app.get('/ip', async (req) => ({ ip: req.ip }));
    const r = await app.inject({ method: 'GET', url: '/ip', headers: { 'x-forwarded-for': '6.6.6.6, 203.0.113.9' } });
    expect(r.json().ip).toBe('203.0.113.9');
  });
});
