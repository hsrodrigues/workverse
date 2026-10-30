import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createApp } from '../src/app';
import { hashPassword, hashToken, verifyPassword } from '../src/auth';
import { createMailer, type MailMessage, type Mailer } from '../src/mailer';
import { MemoryAccountStore, JsonFileAccountStore, type Account } from '../src/store';
import { RESET_TTL_MS } from '../src/passwordReset';

const OLD = 'old password phrase';
const NEW = 'brand new password phrase';
const PUBLIC = 'https://wv.example';
const ORIGIN = { origin: PUBLIC };

let app: FastifyInstance;
let store: MemoryAccountStore;
let now = 1_800_000_000_000;
let sent: MailMessage[] = [];
let mailer: Mailer;

const recordingMailer = (): Mailer => ({
  provider: 'log',
  enabled: true,
  async send(m) {
    sent.push(m);
  },
});

async function boot(opts: { mailer?: Mailer; publicUrl?: string; store?: MemoryAccountStore; authLimits?: Record<string, unknown> } = {}) {
  store = opts.store ?? new MemoryAccountStore();
  const r = await createApp({
    store,
    mailer: opts.mailer ?? mailer,
    publicUrl: 'publicUrl' in opts ? opts.publicUrl : PUBLIC,
    forgotMinMs: 0,
    clock: () => now,
    allowedOrigins: [PUBLIC],
    authLimits: { failDelayMs: 0, ...opts.authLimits },
    registrationMode: 'closed',
  });
  app = r.app;
}

async function makeAccount(name = 'ana', extra: Partial<Account> = {}): Promise<Account> {
  const a = store.create({ email: `${name}@example.com`, displayName: `Pessoa ${name}`, passwordHash: await hashPassword(OLD) });
  Object.assign(a, extra);
  store.save(a);
  return a;
}

const post = (url: string, body: unknown, headers: Record<string, string> = ORIGIN, ip = '10.0.0.1') =>
  app.inject({ method: 'POST', url, payload: body as object, headers: { ...headers, 'content-type': 'application/json' }, remoteAddress: ip });

const forgot = (email: string, ip?: string) => post('/api/password/forgot', { email }, ORIGIN, ip);
const reset = (token: string, password: string, ip?: string) => post('/api/password/reset', { token, password }, ORIGIN, ip);

/** Espera o envio em segundo plano e devolve o token do ultimo e-mail. */
async function lastToken(): Promise<string> {
  for (let i = 0; i < 50 && sent.length === 0; i++) await new Promise((r) => setTimeout(r, 5));
  const m = sent[sent.length - 1];
  expect(m).toBeDefined();
  const t = /\/\?reset=([\w-]+)/.exec(m!.text)?.[1];
  expect(t).toBeDefined();
  return t!;
}
const settle = () => new Promise((r) => setTimeout(r, 30));

beforeEach(async () => {
  now = 1_800_000_000_000;
  sent = [];
  mailer = recordingMailer();
  await boot();
});
afterEach(async () => {
  await app.close();
});

describe('/api/config e recurso desligado', () => {
  it('informa passwordReset conforme provedor + PUBLIC_URL', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/config' })).json().passwordReset).toBe(true);
    await app.close();
    await boot({ mailer: createMailer({}, true) });
    expect((await app.inject({ method: 'GET', url: '/api/config' })).json().passwordReset).toBe(false);
    await app.close();
    await boot({ publicUrl: undefined });
    expect((await app.inject({ method: 'GET', url: '/api/config' })).json().passwordReset).toBe(false);
  });

  it('desligado: as duas rotas respondem 503 e nada e enviado', async () => {
    await app.close();
    await boot({ mailer: createMailer({}, true) });
    await makeAccount();
    const r1 = await forgot('ana@example.com');
    expect(r1.statusCode).toBe(503);
    expect(r1.json().error.code).toBe('reset_disabled');
    expect(r1.json().error.message).toMatch(/staff/);
    expect((await reset('x'.repeat(43), NEW)).statusCode).toBe(503);
    expect(sent).toHaveLength(0);
  });
});

describe('POST /api/password/forgot', () => {
  it('mesma resposta para conta existente e inexistente; so a existente recebe e-mail', async () => {
    await makeAccount();
    const a = await forgot('ana@example.com');
    const b = await forgot('ninguem@example.com');
    expect(a.statusCode).toBe(200);
    expect(b.statusCode).toBe(200);
    expect(a.json()).toEqual(b.json());
    expect(a.headers['cache-control']).toBe('no-store');
    await settle();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe('ana@example.com');
    expect(sent[0]!.text).toContain(`${PUBLIC}/?reset=`);
  });

  it('e-mail malformado tambem responde 200 igual, sem envio; corpo sem e-mail da 400', async () => {
    const r = await forgot('isto nao e e-mail');
    expect(r.statusCode).toBe(200);
    expect((await post('/api/password/forgot', {})).statusCode).toBe(400);
    expect(sent).toHaveLength(0);
  });

  it('o tempo de resposta tem piso (igual com ou sem conta)', async () => {
    await app.close();
    store = new MemoryAccountStore();
    const r = await createApp({ store, mailer, publicUrl: PUBLIC, forgotMinMs: 80, allowedOrigins: [PUBLIC], registrationMode: 'closed' });
    app = r.app;
    await makeAccount();
    for (const email of ['ana@example.com', 'ninguem@example.com']) {
      const t0 = Date.now();
      await forgot(email);
      expect(Date.now() - t0).toBeGreaterThanOrEqual(75);
    }
  });

  it('o store guarda so o hash SHA-256; o token em claro nao esta em lugar nenhum', async () => {
    const a = await makeAccount();
    await forgot('ana@example.com');
    const token = await lastToken();
    expect(token).toHaveLength(43); // 32 bytes em base64url
    expect(store.getResetToken(hashToken(token), now)?.accountId).toBe(a.id);
    expect(JSON.stringify([...(store as unknown as { resets: Map<string, unknown> }).resets.entries()])).not.toContain(token);
    expect(store.getResetToken(token, now)).toBeUndefined();
  });

  it('conta banida, desativada ou sem senha nao recebe e-mail (resposta igual)', async () => {
    await makeAccount('banida', { ban: { at: now, by: 'x', reason: 'r', until: null } });
    await makeAccount('desativada', { disabled: { at: now, by: 'x', reason: 'r' } });
    store.create({ email: 'dev@example.com', displayName: 'Dev', passwordHash: '' });
    for (const e of ['banida', 'desativada', 'dev']) expect((await forgot(`${e}@example.com`)).statusCode).toBe(200);
    await settle();
    expect(sent).toHaveLength(0);
  });

  it('ban temporario expirado volta a receber', async () => {
    await makeAccount('temp', { ban: { at: now - 5000, by: 'x', reason: 'r', until: now - 1 } });
    await forgot('temp@example.com');
    await lastToken();
  });

  it('limites por e-mail e por IP (429 com Retry-After)', async () => {
    await makeAccount();
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) codes.push((await forgot('ana@example.com', `10.0.1.${i}`)).statusCode);
    expect(codes.slice(0, 3)).toEqual([200, 200, 200]);
    expect(codes[3]).toBe(429); // por e-mail, mesmo trocando de IP
    const limited = await forgot('ana@example.com', '10.0.1.9');
    expect(limited.headers['retry-after']).toBeDefined();
    // por IP: 5 e-mails diferentes e o sexto cai
    const ipCodes: number[] = [];
    for (let i = 0; i < 7; i++) ipCodes.push((await forgot(`x${i}@example.com`, '10.0.2.1')).statusCode);
    expect(ipCodes.filter((c) => c === 429).length).toBeGreaterThanOrEqual(2);
    await settle();
    expect(sent.length).toBe(3);
  });

  it('exige origem permitida', async () => {
    const r = await post('/api/password/forgot', { email: 'ana@example.com' }, { origin: 'https://evil.example' });
    expect(r.statusCode).toBe(403);
    expect(sent).toHaveLength(0);
  });

  it('corpo grande demais e recusado', async () => {
    const r = await post('/api/password/forgot', { email: 'a'.repeat(3000) + '@x.com' });
    expect(r.statusCode).toBe(413);
  });

  it('falha do provedor nao muda a resposta nem derruba o servidor', async () => {
    await app.close();
    await boot({
      mailer: {
        provider: 'resend',
        enabled: true,
        async send() {
          throw new Error('boom');
        },
      },
    });
    await makeAccount();
    const r = await forgot('ana@example.com');
    expect(r.statusCode).toBe(200);
    await settle();
  });

  it('no maximo 3 pendentes: o quarto pedido derruba o primeiro', async () => {
    const a = await makeAccount();
    const tokens: string[] = [];
    for (let i = 0; i < 4; i++) {
      now += 1000;
      sent = [];
      await app.close();
      await boot({ store, authLimits: { forgotPerEmail: { burst: 100, perMinute: 100 }, forgotPerIp: { burst: 100, perMinute: 100 } } });
      await forgot('ana@example.com');
      tokens.push(await lastToken());
    }
    expect(store.countResetTokens(a.id, now)).toBe(3);
    expect((await reset(tokens[0]!, NEW)).statusCode).toBe(400);
    expect((await reset(tokens[3]!, NEW)).statusCode).toBe(200);
  });
});

describe('POST /api/password/reset', () => {
  const login = (email: string, password: string) => post('/api/login', { email, password });

  it('troca a senha, limpa mustChangePassword, derruba sessoes e outros tokens, audita sem o token', async () => {
    const a = await makeAccount('ana', { mustChangePassword: true });
    const lg = await login('ana@example.com', OLD);
    expect(lg.statusCode).toBe(200);
    const cookie = String(lg.headers['set-cookie']).split(';')[0]!;
    expect((await app.inject({ method: 'GET', url: '/api/me', headers: { cookie } })).statusCode).toBe(200);

    await forgot('ana@example.com');
    const t1 = await lastToken();
    sent = [];
    now += 1000;
    await app.close();
    await boot({ store, authLimits: { forgotPerEmail: { burst: 100, perMinute: 100 } } });
    await forgot('ana@example.com');
    const t2 = await lastToken();

    const r = await reset(t1, NEW);
    expect(r.statusCode).toBe(200);
    expect(await verifyPassword(NEW, store.getById(a.id)!.passwordHash)).toBe(true);
    expect(store.getById(a.id)!.mustChangePassword).toBeUndefined();
    expect(store.getById(a.id)!.passwordChangedAt).toBe(now);
    // sessao antiga morreu
    expect((await app.inject({ method: 'GET', url: '/api/me', headers: { cookie } })).statusCode).toBe(401);
    // o outro token tambem
    expect((await reset(t2, 'another good password!')).statusCode).toBe(400);
    expect(store.countResetTokens(a.id, now)).toBe(0);
    // login: senha antiga falha, nova entra e ja sem troca obrigatoria
    expect((await login('ana@example.com', OLD)).statusCode).toBe(401);
    const ok = await login('ana@example.com', NEW);
    expect(ok.statusCode).toBe(200);
    expect(ok.json().account.mustChangePassword).toBeUndefined();
    // auditoria sem token
    const audit = store.queryAudit({ action: 'account.password_reset_email' });
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit)).not.toContain(t1);
    expect(JSON.stringify(audit)).not.toContain(t2);
  });

  it('uso unico: o mesmo token nao funciona duas vezes', async () => {
    await makeAccount();
    await forgot('ana@example.com');
    const t = await lastToken();
    expect((await reset(t, NEW)).statusCode).toBe(200);
    const again = await reset(t, 'yet another good phrase');
    expect(again.statusCode).toBe(400);
    expect(again.json().error.code).toBe('invalid_token');
    expect(again.json().error.message).toMatch(/inválido ou expirado/);
  });

  it('duas requisicoes simultaneas: so uma vence', async () => {
    const a = await makeAccount();
    await forgot('ana@example.com');
    const t = await lastToken();
    const [r1, r2] = await Promise.all([reset(t, NEW), reset(t, 'second good password phrase')]);
    expect([r1.statusCode, r2.statusCode].sort()).toEqual([200, 400]);
    expect(store.countResetTokens(a.id, now)).toBe(0);
  });

  it('expira em 30 minutos', async () => {
    await makeAccount();
    await forgot('ana@example.com');
    const t = await lastToken();
    now += RESET_TTL_MS - 1;
    expect(store.getResetToken(hashToken(t), now)).toBeDefined();
    now += 1;
    const r = await reset(t, NEW);
    expect(r.statusCode).toBe(400);
    expect(r.json().error.code).toBe('invalid_token');
  });

  it('senha fraca e recusada SEM gastar o token', async () => {
    const a = await makeAccount();
    await forgot('ana@example.com');
    const t = await lastToken();
    for (const weak of ['curta', '1234567890', 'x'.repeat(200)]) {
      const r = await reset(t, weak);
      expect(r.statusCode).toBe(400);
      expect(r.json().error.code).toBe('weak_password');
    }
    expect(store.countResetTokens(a.id, now)).toBe(1);
    expect((await reset(t, NEW)).statusCode).toBe(200);
  });

  it('token inexistente, curto ou malformado: 400 generico', async () => {
    expect((await reset('a'.repeat(43), NEW)).json().error.code).toBe('invalid_token');
    expect((await reset('curto', NEW)).statusCode).toBe(400);
    expect((await post('/api/password/reset', { token: 123, password: NEW })).statusCode).toBe(400);
    expect((await post('/api/password/reset', { token: 'a'.repeat(43), password: NEW, extra: 1 })).statusCode).toBe(400);
  });

  it('conta banida/desativada depois do pedido: o token nao vale', async () => {
    const a = await makeAccount();
    await forgot('ana@example.com');
    const t = await lastToken();
    a.disabled = { at: now, by: 'x', reason: 'r' };
    store.save(a);
    expect((await reset(t, NEW)).statusCode).toBe(400);
    expect(await verifyPassword(OLD, store.getById(a.id)!.passwordHash)).toBe(true);
  });

  it('exige origem permitida e limita tentativas por IP', async () => {
    expect((await post('/api/password/reset', { token: 'a'.repeat(43), password: NEW }, { origin: 'https://evil.example' })).statusCode).toBe(403);
    const codes: number[] = [];
    for (let i = 0; i < 14; i++) codes.push((await reset('a'.repeat(43), NEW, '10.9.9.9')).statusCode);
    expect(codes).toContain(429);
  });

  it('a trava de senha provisoria nao bloqueia o fluxo (cookie com mustChangePassword)', async () => {
    await makeAccount('ana', { mustChangePassword: true });
    const lg = await post('/api/login', { email: 'ana@example.com', password: OLD });
    const cookie = String(lg.headers['set-cookie']).split(';')[0]!;
    const r = await app.inject({ method: 'POST', url: '/api/password/forgot', payload: { email: 'ana@example.com' }, headers: { ...ORIGIN, cookie } });
    expect(r.statusCode).toBe(200);
  });
});

describe('persistencia em arquivo JSON', () => {
  it('o token pendente sobrevive a reinicio (so o hash vai ao arquivo)', async () => {
    const { mkdtempSync, readFileSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = mkdtempSync(join(tmpdir(), 'wv-reset-'));
    try {
      const file = join(dir, 'accounts.json');
      const js = new JsonFileAccountStore(file);
      await app.close();
      await boot({ store: js });
      await makeAccount();
      await forgot('ana@example.com');
      const t = await lastToken();
      js.flush();
      expect(readFileSync(file, 'utf8')).not.toContain(t);
      expect(new JsonFileAccountStore(file).getResetToken(hashToken(t), now)).toBeDefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
