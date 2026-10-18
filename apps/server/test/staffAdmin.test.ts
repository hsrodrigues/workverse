import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { ClientMessage, ServerMessage, StaffLevel } from '@workverse/shared';
import { createApp } from '../src/app';
import { hashPassword, hashToken, verifyPassword } from '../src/auth';
import { generateProvisionalPassword } from '../src/provisional';
import { JsonFileAccountStore, MemoryAccountStore, type Account } from '../src/store';
import type { Connection, World } from '../src/world';
import { auditCsv, csvCell } from '../src/staffRoutes';

const PASSWORD = 'correct horse battery';

class FakeConn implements Connection {
  strikes = 0;
  accountId?: string;
  sessionHash?: string;
  player?: Connection['player'];
  inbox: ServerMessage[] = [];
  closed: { code: number; reason?: string } | undefined;
  send(msg: ServerMessage) {
    this.inbox.push(msg);
  }
  close(code?: number, reason?: string) {
    this.closed = { code: code ?? 1000, reason };
  }
  all<T extends ServerMessage['t']>(t: T) {
    return this.inbox.filter((m) => m.t === t) as Extract<ServerMessage, { t: T }>[];
  }
  errors() {
    return this.all('error').map((m) => m.code);
  }
}

let app: FastifyInstance;
let world: World;
let store: MemoryAccountStore;
const conns: FakeConn[] = [];

const mk = async (opts: { env?: string } = {}) => {
  store = new MemoryAccountStore();
  const prev = process.env.BOOTSTRAP_STAFF_EMAILS;
  if (opts.env !== undefined) process.env.BOOTSTRAP_STAFF_EMAILS = opts.env;
  else delete process.env.BOOTSTRAP_STAFF_EMAILS;
  const r = await createApp({ store, tickMs: 50, authLimits: { failDelayMs: 0 }, registrationMode: 'closed' });
  if (prev === undefined) delete process.env.BOOTSTRAP_STAFF_EMAILS;
  else process.env.BOOTSTRAP_STAFF_EMAILS = prev;
  app = r.app;
  world = r.world;
};

beforeEach(async () => {
  conns.length = 0;
  await mk();
});
afterEach(async () => {
  await app.close();
});

/** Cria uma conta com senha, opcionalmente staff, direto no store (como o CLI faria). */
async function account(name: string, level?: StaffLevel, extra: Partial<Account> = {}): Promise<Account> {
  const a = store.create({ email: `${name.toLowerCase()}@x.com`, displayName: name, passwordHash: await hashPassword(PASSWORD) });
  if (level) a.staff = level;
  Object.assign(a, extra);
  store.save(a);
  return a;
}

interface Session {
  account: Account;
  cookie: string;
  conn: FakeConn;
}

const cookieOf = (res: { headers: Record<string, unknown> }) => {
  const raw = res.headers['set-cookie'];
  return (Array.isArray(raw) ? raw[0] : String(raw)).split(';')[0]!;
};

/** Login HTTP + WebSocket simulado (entra na sala e, se for staff, ja esta em servico). */
async function session(name: string, level?: StaffLevel): Promise<Session> {
  const a = store.getByName(name) ?? (await account(name, level));
  const res = await app.inject({ method: 'POST', url: '/api/login', payload: { email: a.email, password: PASSWORD } });
  expect(res.statusCode).toBe(200);
  const cookie = cookieOf(res);
  const conn = new FakeConn();
  conn.accountId = a.id;
  conn.sessionHash = hashToken(cookie.split('=')[1]!);
  conns.push(conn);
  world.handle(conn, { t: 'hello' });
  world.handle(conn, { t: 'join', roomId: 'office' });
  return { account: a, cookie, conn };
}

const call = (s: Pick<Session, 'cookie'> | null, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: unknown) =>
  app.inject({ method, url, payload: payload as object | undefined, headers: s ? { cookie: s.cookie } : {} });

const ws = (s: Session, msg: Record<string, unknown>) => world.handle(s.conn, msg as ClientMessage);

describe('criacao de contas por staff', () => {
  it('moderador cria conta com senha provisoria forte: hash no store, troca obrigatoria, auditoria', async () => {
    const mod = await session('Moda', 'moderator');
    const res = await call(mod, 'POST', '/api/staff/accounts', { email: 'Nova@Empresa.com', displayName: 'Nova Pessoa' });
    expect(res.statusCode).toBe(201);
    const { account: row, provisionalPassword } = res.json();
    expect(provisionalPassword).toMatch(/^[A-HJ-NP-Za-km-z2-9]{4}(-[A-HJ-NP-Za-km-z2-9]{4}){3}$/);
    expect(row.mustChangePassword).toBe(true);
    expect(row.emailMasked).toBe(true);
    expect(row.email).not.toContain('Empresa');
    const stored = store.getByEmail('nova@empresa.com')!;
    expect(stored.mustChangePassword).toBe(true);
    expect(stored.createdBy).toBe('Moda');
    expect(stored.passwordHash).not.toContain(provisionalPassword);
    expect(await verifyPassword(provisionalPassword, stored.passwordHash)).toBe(true);
    // entra na org padrao como membro da equipe geral
    const m = store.orgs.getMember('default', stored.id)!;
    expect(m.role).toBe('member');
    expect(m.status).toBe('active');
    const rec = store.queryAudit({ action: 'account.create' })[0]!;
    expect(rec.actor).toBe('Moda');
    expect(rec.target).toBe('Nova Pessoa');
    expect(JSON.stringify(rec)).not.toContain(provisionalPassword);
  });

  it('negada para quem nao e staff, helper, sem sessao, fora de servico e origem estranha', async () => {
    const body = { email: 'a@b.com', displayName: 'Alguem' };
    const user = await session('Comum');
    const helper = await session('Ajuda', 'helper');
    expect((await call(null, 'POST', '/api/staff/accounts', body)).statusCode).toBe(401);
    expect((await call(user, 'POST', '/api/staff/accounts', body)).statusCode).toBe(403);
    expect((await call(helper, 'POST', '/api/staff/accounts', body)).statusCode).toBe(403);
    const mod = await session('Moda', 'moderator');
    ws(mod, { t: 'staff_duty', on: false });
    const off = await call(mod, 'POST', '/api/staff/accounts', body);
    expect(off.statusCode).toBe(403);
    expect(off.json().error.code).toBe('off_duty');
    ws(mod, { t: 'staff_duty', on: true });
    expect(store.getByEmail('a@b.com')).toBeUndefined();
    // negativa de nivel/conta comum fica registrada
    const denied = await call(user, 'POST', '/api/staff/accounts', body);
    expect(denied.json().error.code).toBe('forbidden');

    await app.close();
    const prev = process.env.BOOTSTRAP_STAFF_EMAILS;
    delete process.env.BOOTSTRAP_STAFF_EMAILS;
    store = new MemoryAccountStore();
    const r = await createApp({ store, tickMs: 50, authLimits: { failDelayMs: 0 }, registrationMode: 'closed', allowedOrigins: ['https://app.example.com'] });
    process.env.BOOTSTRAP_STAFF_EMAILS = prev;
    app = r.app;
    world = r.world;
    const forged = await app.inject({ method: 'POST', url: '/api/staff/accounts', payload: body, headers: { origin: 'https://evil.example.com' } });
    expect(forged.statusCode).toBe(403);
    expect(forged.json().error.code).toBe('forbidden_origin');
  });

  it('validacao estrita: campo desconhecido, e-mail ruim, nome reservado, senha fraca, duplicados', async () => {
    const mod = await session('Moda', 'moderator');
    const post = (p: Record<string, unknown>) => call(mod, 'POST', '/api/staff/accounts', p);
    expect((await post({ email: 'a@b.com', displayName: 'Ana', isAdmin: true })).statusCode).toBe(400);
    expect((await post({ email: 'nao-e-email', displayName: 'Ana' })).json().error.code).toBe('invalid_email');
    expect((await post({ email: 'a@b.com', displayName: 'Admin' })).json().error.code).toBe('bad_name');
    expect((await post({ email: 'a@b.com', displayName: 'Ana', password: 'curta' })).json().error.code).toBe('weak_password');
    expect((await post({ email: 'a@b.com', displayName: 'Ana', password: '1234567890' })).json().error.code).toBe('weak_password');
    expect((await post({ email: 'moda@x.com', displayName: 'Outra' })).json().error.code).toBe('email_taken');
    expect((await post({ email: 'novo@x.com', displayName: 'moda' })).json().error.code).toBe('name_taken');
    expect((await post({ email: 'a@b.com', displayName: 'Ana', orgId: 'nao-existe' })).json().error.code).toBe('org_not_found');
    expect((await post({ email: 'a@b.com', displayName: 'Ana', role: 'rei' })).json().error.code).toBe('bad_role');
    const ok = await post({ email: 'a@b.com', displayName: 'Ana', password: 'Uma frase longa e boa' });
    expect(ok.statusCode).toBe(201);
    expect(ok.json().provisionalPassword).toBe('Uma frase longa e boa');
  });

  it('papel atribuivel depende do nivel: moderador ate membro, administrador ate dono', async () => {
    const mod = await session('Moda', 'moderator');
    const adm = await session('Chefe', 'admin');
    const body = (n: string, role: string) => ({ email: `${n}@x.com`, displayName: n, role });
    expect((await call(mod, 'POST', '/api/staff/accounts', body('Gui', 'admin'))).json().error.code).toBe('role_too_high');
    expect((await call(mod, 'POST', '/api/staff/accounts', body('Gui', 'guest'))).statusCode).toBe(201);
    const r = await call(adm, 'POST', '/api/staff/accounts', body('Dona', 'owner'));
    expect(r.statusCode).toBe(201);
    expect(r.json().account.emailMasked).toBe(false);
    expect(store.orgs.getMember('default', store.getByName('Dona')!.id)!.role).toBe('owner');
  });

  it('gerador de senha provisoria: forte, unico e aceito pela politica', () => {
    const set = new Set(Array.from({ length: 200 }, () => generateProvisionalPassword()));
    expect(set.size).toBe(200);
    for (const pw of set) expect(pw.length).toBe(19);
  });

  it('cadastro publico segue fechado (REGISTRATION_MODE=closed)', async () => {
    const r = await call(null, 'POST', '/api/register', { email: 'x@y.com', password: PASSWORD, displayName: 'Xis' });
    expect(r.statusCode).toBe(403);
    expect(r.json().error.code).toBe('registration_closed');
  });
});

describe('troca obrigatoria de senha', () => {
  async function provisional(name = 'Nova') {
    const mod = await session('Moda', 'moderator');
    const res = await call(mod, 'POST', '/api/staff/accounts', { email: `${name.toLowerCase()}@x.com`, displayName: name });
    return { mod, pw: res.json().provisionalPassword as string, email: `${name.toLowerCase()}@x.com` };
  }
  const login = (email: string, password: string) => app.inject({ method: 'POST', url: '/api/login', payload: { email, password } });

  it('login devolve a flag, a API fica travada e o WebSocket recusa ate trocar', async () => {
    const { pw, email } = await provisional();
    const res = await login(email, pw);
    expect(res.statusCode).toBe(200);
    expect(res.json().account.mustChangePassword).toBe(true);
    const cookie = cookieOf(res);
    expect((await call({ cookie }, 'GET', '/api/me')).json().account.mustChangePassword).toBe(true);
    const locked = await call({ cookie }, 'GET', '/api/orgs/me');
    expect(locked.statusCode).toBe(403);
    expect(locked.json().error.code).toBe('password_change_required');
    expect((await call({ cookie }, 'GET', '/api/staff/accounts')).json().error.code).toBe('password_change_required');
    const c = new FakeConn();
    c.accountId = store.getByEmail(email)!.id;
    world.handle(c, { t: 'hello' });
    expect(c.errors()).toEqual(['password_change_required']);
    expect(c.closed?.code).toBe(4001);
    expect(c.player).toBeUndefined();
  });

  it('troca: valida senha atual, politica e igualdade; limpa a flag e revoga as outras sessoes', async () => {
    const { pw, email } = await provisional();
    const a = cookieOf(await login(email, pw));
    const b = cookieOf(await login(email, pw));
    const change = (cookie: string, current: string, next: string) => call({ cookie }, 'POST', '/api/account/password', { current, next });
    expect((await change(a, 'senha errada errada', 'Outra frase muito boa')).json().error.code).toBe('invalid_credentials');
    expect((await change(a, pw, 'curta')).json().error.code).toBe('weak_password');
    expect((await change(a, pw, '1234567890')).json().error.code).toBe('weak_password');
    expect((await change(a, pw, pw)).json().error.code).toBe('same_password');
    expect((await call({ cookie: a }, 'POST', '/api/account/password', { current: pw, next: 'Outra frase muito boa', extra: 1 })).statusCode).toBe(400);
    expect((await call(null, 'POST', '/api/account/password', { current: pw, next: 'Outra frase muito boa' })).statusCode).toBe(401);

    const ok = await change(a, pw, 'Minha frase nova e longa');
    expect(ok.statusCode).toBe(200);
    expect(ok.json().account.mustChangePassword).toBeUndefined();
    expect(store.getByEmail(email)!.mustChangePassword).toBeUndefined();
    expect(store.getByEmail(email)!.passwordChangedAt).toBeGreaterThan(0);
    expect((await call({ cookie: a }, 'GET', '/api/me')).statusCode).toBe(200);
    expect((await call({ cookie: b }, 'GET', '/api/me')).statusCode).toBe(401); // outra sessao revogada
    expect((await call({ cookie: a }, 'GET', '/api/orgs/me')).statusCode).toBe(200); // API liberada
    expect((await login(email, pw)).statusCode).toBe(401);
    const again = await login(email, 'Minha frase nova e longa');
    expect(again.statusCode).toBe(200);
    expect(again.json().account.mustChangePassword).toBeUndefined();
    // WebSocket agora entra
    const c = new FakeConn();
    c.accountId = store.getByEmail(email)!.id;
    world.handle(c, { t: 'hello' });
    expect(c.all('session')).toHaveLength(1);
  });

  it('"Alterar senha" do menu: conta comum troca a propria senha e derruba o outro dispositivo conectado', async () => {
    const s = await session('Ana');
    const other = cookieOf(await login(s.account.email, PASSWORD));
    const otherConn = new FakeConn();
    otherConn.accountId = s.account.id;
    otherConn.sessionHash = hashToken(other.split('=')[1]!);
    world.handle(otherConn, { t: 'hello' }); // substitui a sessao ao vivo (um jogador por conta)
    const r = await call({ cookie: other }, 'POST', '/api/account/password', { current: PASSWORD, next: 'Senha nova bem longa' });
    expect(r.statusCode).toBe(200);
    expect(await verifyPassword('Senha nova bem longa', store.getById(s.account.id)!.passwordHash)).toBe(true);
    expect((await call(s, 'GET', '/api/me')).statusCode).toBe(401); // cookie antigo morreu
  });

  it('tentativas erradas da senha atual sao limitadas', async () => {
    const s = await session('Ana');
    let last = 0;
    for (let i = 0; i < 8; i++) last = (await call(s, 'POST', '/api/account/password', { current: 'errada errada errada', next: 'Outra frase muito boa' })).statusCode;
    expect(last).toBe(429);
  });
});

describe('redefinir senha, desativar e banir', () => {
  const login = (email: string, password: string) => app.inject({ method: 'POST', url: '/api/login', payload: { email, password } });

  it('reset: nova senha provisoria, antiga deixa de valer, sessoes e socket caem, tudo auditado', async () => {
    const mod = await session('Moda', 'moderator');
    const user = await session('Ana');
    const r = await call(mod, 'POST', `/api/staff/accounts/${user.account.id}/reset-password`, {});
    expect(r.statusCode).toBe(200);
    const pw = r.json().provisionalPassword as string;
    expect((await login(user.account.email, PASSWORD)).statusCode).toBe(401);
    const again = await login(user.account.email, pw);
    expect(again.statusCode).toBe(200);
    expect(again.json().account.mustChangePassword).toBe(true);
    expect((await call(user, 'GET', '/api/me')).statusCode).toBe(401);
    expect(user.conn.errors()).toContain('kicked');
    expect(store.queryAudit({ action: 'account.reset_password' })[0]!.target).toBe('Ana');
  });

  it('reset respeita hierarquia, auto-alvo e nivel', async () => {
    const mod = await session('Moda', 'moderator');
    const adm = await session('Chefe', 'admin');
    const helper = await session('Ajuda', 'helper');
    const mod2 = await session('Moda2', 'moderator');
    expect((await call(mod, 'POST', `/api/staff/accounts/${adm.account.id}/reset-password`, {})).json().error.code).toBe('hierarchy');
    expect((await call(mod, 'POST', `/api/staff/accounts/${mod2.account.id}/reset-password`, {})).json().error.code).toBe('hierarchy');
    expect((await call(mod, 'POST', `/api/staff/accounts/${mod.account.id}/reset-password`, {})).json().error.code).toBe('self');
    expect((await call(helper, 'POST', `/api/staff/accounts/${mod.account.id}/reset-password`, {})).statusCode).toBe(403);
    expect((await call(adm, 'POST', `/api/staff/accounts/${mod.account.id}/reset-password`, {})).statusCode).toBe(200);
    expect((await call(adm, 'POST', '/api/staff/accounts/inexistente/reset-password', {})).statusCode).toBe(404);
  });

  it('desativar impede login e derruba sessao; reativar restaura', async () => {
    const mod = await session('Moda', 'moderator');
    const user = await session('Ana');
    const off = await call(mod, 'PATCH', `/api/staff/accounts/${user.account.id}`, { disabled: true, reason: 'saiu da empresa' });
    expect(off.statusCode).toBe(200);
    expect(off.json().account.disabled).toBe(true);
    expect((await login(user.account.email, PASSWORD)).json().error.code).toBe('account_disabled');
    expect((await call(user, 'GET', '/api/me')).statusCode).toBe(401);
    expect(user.conn.errors()).toContain('kicked');
    expect((await call(mod, 'PATCH', `/api/staff/accounts/${user.account.id}`, { disabled: true })).json().error.code).toBe('no_change');
    expect((await call(mod, 'PATCH', `/api/staff/accounts/${mod.account.id}`, { disabled: true })).json().error.code).toBe('self');
    expect((await call(mod, 'PATCH', `/api/staff/accounts/${user.account.id}`, { disabled: 'sim' })).statusCode).toBe(400);
    const on = await call(mod, 'PATCH', `/api/staff/accounts/${user.account.id}`, { disabled: false });
    expect(on.json().account.disabled).toBe(false);
    expect((await login(user.account.email, PASSWORD)).statusCode).toBe(200);
    expect(store.queryAudit({ action: 'account.disable' })[0]!.detail).toBe('saiu da empresa');
    expect(store.queryAudit({ action: 'account.enable' })).toHaveLength(1);
  });

  it('ban: bloqueia login, derruba a sessao, exige motivo, limites por nivel, expira e pode ser removido', async () => {
    const mod = await session('Moda', 'moderator');
    const adm = await session('Chefe', 'admin');
    const helper = await session('Ajuda', 'helper');
    const user = await session('Ana');
    const ban = (s: Session, minutes: number | null, reason = 'spam') => call(s, 'POST', `/api/staff/accounts/${user.account.id}/ban`, { minutes, reason });
    expect((await ban(helper, 60)).statusCode).toBe(403);
    expect((await ban(mod, 60, '')).statusCode).toBe(400);
    expect((await ban(mod, null)).json().error.code).toBe('ban_too_long');
    expect((await ban(mod, 31 * 1440)).json().error.code).toBe('ban_too_long');
    expect((await call(mod, 'POST', `/api/staff/accounts/${user.account.id}/ban`, { minutes: 'x', reason: 'a' })).statusCode).toBe(400);

    expect((await ban(mod, 60)).statusCode).toBe(200);
    expect((await login(user.account.email, PASSWORD)).json().error.code).toBe('account_banned');
    expect((await call(user, 'GET', '/api/me')).statusCode).toBe(401);
    expect(user.conn.all('error').find((e) => e.code === 'kicked')!.message).toMatch(/banida/);
    const wsTry = new FakeConn();
    wsTry.accountId = user.account.id;
    world.handle(wsTry, { t: 'hello' });
    expect(wsTry.errors()).toEqual(['kicked']);
    expect(wsTry.player).toBeUndefined();

    // administrador: permanente; moderador nao remove? (moderador pode desbanir: nivel minimo moderator)
    expect((await ban(adm, null, 'abuso grave')).statusCode).toBe(200);
    expect(store.getById(user.account.id)!.ban).toMatchObject({ until: null, reason: 'abuso grave', by: 'Chefe' });
    expect((await call(helper, 'POST', `/api/staff/accounts/${user.account.id}/unban`, {})).statusCode).toBe(403);
    expect((await call(mod, 'POST', `/api/staff/accounts/${user.account.id}/unban`, {})).statusCode).toBe(200);
    expect((await login(user.account.email, PASSWORD)).statusCode).toBe(200);
    expect((await call(mod, 'POST', `/api/staff/accounts/${user.account.id}/unban`, {})).json().error.code).toBe('no_change');

    // ban temporario vencido deixa entrar
    expect((await ban(mod, 5)).statusCode).toBe(200);
    store.getById(user.account.id)!.ban!.until = Date.now() - 1000;
    expect((await login(user.account.email, PASSWORD)).statusCode).toBe(200);
    // nao banir a si mesmo nem staff de nivel igual/maior
    expect((await call(mod, 'POST', `/api/staff/accounts/${mod.account.id}/ban`, { minutes: 5, reason: 'x' })).json().error.code).toBe('self');
    expect((await call(mod, 'POST', `/api/staff/accounts/${adm.account.id}/ban`, { minutes: 5, reason: 'x' })).json().error.code).toBe('hierarchy');
    expect(store.queryAudit({ action: 'account.ban' }).length).toBeGreaterThanOrEqual(3);
  });

  it('ban sobrevive a reinicio do servidor (arquivo JSON) e o silenciamento tambem', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wv-ban-'));
    try {
      const file = join(dir, 'a.json');
      const js = new JsonFileAccountStore(file);
      const a = js.create({ email: 'b@x.com', displayName: 'Bani', passwordHash: 'h' });
      a.ban = { at: 1, by: 'Moda', reason: 'spam', until: null };
      a.mute = { until: Date.now() + 3_600_000, by: 'Moda', reason: 'flood' };
      a.mustChangePassword = true;
      a.disabled = { at: 2, by: 'Moda', reason: '' };
      a.lastLoginAt = 99;
      js.save(a);
      js.appendAudit({ id: 'x1', at: 5, actorId: 'm', actor: 'Moda', level: 'moderator', action: 'account.ban', targetId: a.id, target: 'Bani', detail: 'permanente; spam' });
      js.flush();
      const re = new JsonFileAccountStore(file);
      const b = re.getByEmail('b@x.com')!;
      expect(b.ban).toEqual(a.ban);
      expect(b.mute).toEqual(a.mute);
      expect(b.mustChangePassword).toBe(true);
      expect(b.disabled).toBeDefined();
      expect(b.lastLoginAt).toBe(99);
      expect(re.queryAudit({ target: 'bani' })).toHaveLength(1);
      // o mundo novo enxerga o silenciamento persistido
      const w2 = (await createApp({ store: re, tickMs: 50 })).world;
      expect(w2.staff.mutedFor(b.id, Date.now())).toBeGreaterThan(3_000_000);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('equipe de staff', () => {
  it('administrador adiciona, promove, rebaixa e remove; online muda na hora (sem reiniciar)', async () => {
    const adm = await session('Chefe', 'admin');
    const ana = await session('Ana');
    expect(ana.conn.all('session')[0]!.staff).toBeUndefined();
    ana.conn.inbox = [];

    const add = await call(adm, 'POST', '/api/staff/team', { identifier: 'ANA@x.com', level: 'helper' });
    expect(add.statusCode).toBe(201);
    expect(store.getByName('Ana')!.staff).toBe('helper');
    expect(ana.conn.all('staff_self')[0]).toMatchObject({ level: 'helper', duty: true });
    expect(ana.conn.all('staff_online')).toHaveLength(1);
    // poderes de helper valem na hora
    const other = await session('Beto');
    ws(ana, { t: 'staff_mute', target: other.account.id, minutes: 5 });
    expect(world.staff.mutedFor(other.account.id, Date.now())).toBeGreaterThan(0);
    expect((await call(ana, 'POST', '/api/staff/accounts', { email: 'z@z.com', displayName: 'Zed' })).statusCode).toBe(403);

    // promove: agora cria contas
    expect((await call(adm, 'PATCH', `/api/staff/team/${ana.account.id}`, { level: 'moderator' })).statusCode).toBe(200);
    expect((await call(ana, 'POST', '/api/staff/accounts', { email: 'z@z.com', displayName: 'Zed' })).statusCode).toBe(201);
    expect(ana.conn.all('staff_self').at(-1)!.level).toBe('moderator');
    // rebaixa: perde na hora
    expect((await call(adm, 'PATCH', `/api/staff/team/${ana.account.id}`, { level: 'helper' })).statusCode).toBe(200);
    expect((await call(ana, 'POST', '/api/staff/accounts', { email: 'y@z.com', displayName: 'Yan' })).statusCode).toBe(403);
    expect((await call(adm, 'PATCH', `/api/staff/team/${ana.account.id}`, { level: 'helper' })).json().error.code).toBe('no_change');
    // remove
    expect((await call(adm, 'DELETE', `/api/staff/team/${ana.account.id}`)).statusCode).toBe(200);
    expect(store.getByName('Ana')!.staff).toBeUndefined();
    expect(ana.conn.all('staff_revoked')).toHaveLength(1);
    expect(world.findPlayerByAccount(ana.account.id)!.staff).toBeNull();
    ws(ana, { t: 'staff_mute', target: other.account.id, minutes: 0 });
    expect(ana.conn.errors()).toContain('forbidden');
    expect((await call(adm, 'DELETE', `/api/staff/team/${ana.account.id}`)).json().error.code).toBe('not_staff');

    const actions = store.queryAudit({ action: 'staff' }).map((r) => r.action);
    expect(actions).toEqual(expect.arrayContaining(['staff.add', 'staff.set_level', 'staff.remove']));
  });

  it('so administrador gerencia: helper e moderador recebem 403 em cada rota', async () => {
    const helper = await session('Ajuda', 'helper');
    const mod = await session('Moda', 'moderator');
    await session('Chefe', 'admin');
    const ana = await account('Ana');
    for (const s of [helper, mod]) {
      expect((await call(s, 'POST', '/api/staff/team', { identifier: 'ana@x.com', level: 'helper' })).statusCode).toBe(403);
      expect((await call(s, 'PATCH', `/api/staff/team/${helper.account.id}`, { level: 'admin' })).statusCode).toBe(403);
      expect((await call(s, 'DELETE', `/api/staff/team/${mod.account.id}`)).statusCode).toBe(403);
    }
    expect(store.getById(ana.id)!.staff).toBeUndefined();
    expect(store.getById(helper.account.id)!.staff).toBe('helper');
    // lista (somente leitura) e permitida; e-mail mascarado para nao-admin
    const list = await call(mod, 'GET', '/api/staff/team');
    expect(list.statusCode).toBe(200);
    expect(list.json().staff.every((m: { emailMasked: boolean }) => m.emailMasked)).toBe(true);
  });

  it('nao rebaixa nem remove o ultimo administrador; com outro administrador pode', async () => {
    const adm = await session('Chefe', 'admin');
    expect((await call(adm, 'PATCH', `/api/staff/team/${adm.account.id}`, { level: 'moderator' })).json().error.code).toBe('last_admin');
    expect((await call(adm, 'DELETE', `/api/staff/team/${adm.account.id}`)).json().error.code).toBe('last_admin');
    expect(store.getById(adm.account.id)!.staff).toBe('admin');

    const second = await account('Segundo');
    expect((await call(adm, 'POST', '/api/staff/team', { identifier: 'Segundo', level: 'admin' })).statusCode).toBe(201);
    // agora o primeiro pode se rebaixar...
    expect((await call(adm, 'PATCH', `/api/staff/team/${adm.account.id}`, { level: 'moderator' })).statusCode).toBe(200);
    // ...e o segundo, ja sozinho, esta protegido (inclusive contra outro admin inexistente)
    const secondSession = await session('Segundo');
    expect((await call(secondSession, 'DELETE', `/api/staff/team/${second.id}`)).json().error.code).toBe('last_admin');
    // admin desativado/banido nao conta como administrador ativo
    store.getById(second.id)!.ban = { at: 1, by: 'x', reason: 'x', until: null };
    expect(store.getById(adm.account.id)!.staff).toBe('moderator');
  });

  it('conta definida por BOOTSTRAP_STAFF_EMAILS nao muda pelo painel; conta de teste e bloqueada nao viram staff', async () => {
    await app.close();
    await mk({ env: 'env@x.com:admin' });
    await account('Env');
    const adm = await session('Chefe', 'admin');
    await account('Outro', 'admin');
    const env = await session('Env');
    expect(env.account.staff).toBe('admin');
    expect((await call(adm, 'PATCH', `/api/staff/team/${env.account.id}`, { level: 'helper' })).json().error.code).toBe('env_managed');
    expect((await call(adm, 'DELETE', `/api/staff/team/${env.account.id}`)).json().error.code).toBe('env_managed');
    const dev = store.create({ email: 'dev@dev.invalid', displayName: 'Dev', passwordHash: '' });
    expect((await call(adm, 'POST', '/api/staff/team', { identifier: dev.displayName, level: 'helper' })).json().error.code).toBe('dev_account');
    const blocked = await account('Banida', undefined, { ban: { at: 1, by: 'x', reason: 'x', until: null } });
    expect((await call(adm, 'POST', '/api/staff/team', { identifier: blocked.email, level: 'helper' })).json().error.code).toBe('account_blocked');
    expect((await call(adm, 'POST', '/api/staff/team', { identifier: 'ninguem@x.com', level: 'helper' })).statusCode).toBe(404);
    expect((await call(adm, 'POST', '/api/staff/team', { identifier: 'Outro', level: 'admin' })).json().error.code).toBe('already_staff');
    expect((await call(adm, 'POST', '/api/staff/team', { identifier: 'Banida', level: 'dono' })).statusCode).toBe(400);
  });
});

describe('contas: listagem e ficha', () => {
  it('e-mail mascarado para helper e moderador, completo para administrador; busca por e-mail so para admin', async () => {
    const helper = await session('Ajuda', 'helper');
    const adm = await session('Chefe', 'admin');
    await account('Maria');
    const h = await call(helper, 'GET', '/api/staff/accounts?q=maria');
    expect(h.statusCode).toBe(200);
    const hm = h.json().accounts[0];
    expect(hm.email).toBe('m***@x***.com');
    expect(hm.emailMasked).toBe(true);
    const a = (await call(adm, 'GET', '/api/staff/accounts?q=maria')).json().accounts[0];
    expect(a.email).toBe('maria@x.com');
    // helper nao descobre e-mail por tentativa
    expect((await call(helper, 'GET', '/api/staff/accounts?q=maria@x.com')).json().accounts).toHaveLength(0);
    expect((await call(adm, 'GET', '/api/staff/accounts?q=maria@x')).json().accounts).toHaveLength(1);

    const sheetH = (await call(helper, 'GET', `/api/staff/accounts/${hm.id}`)).json().account;
    expect(sheetH.email).toBe('m***@x***.com');
    expect(sheetH.memberships.length).toBeGreaterThanOrEqual(0);
    const sheetA = (await call(adm, 'GET', `/api/staff/accounts/${hm.id}`)).json().account;
    expect(sheetA.email).toBe('maria@x.com');
    // a ficha nunca carrega hash de senha, sessoes nem DMs
    const raw = JSON.stringify(sheetA);
    expect(raw).not.toMatch(/scrypt|passwordHash|tokenHash|dm|conversa/i);
    expect((await call(adm, 'GET', '/api/staff/accounts/nao-existe')).statusCode).toBe(404);
    // filtros invalidos
    expect((await call(adm, 'GET', '/api/staff/accounts?filter=xx')).statusCode).toBe(400);
    expect((await call(null, 'GET', '/api/staff/accounts')).statusCode).toBe(401);
    expect((await call(await session('Comum'), 'GET', '/api/staff/accounts')).statusCode).toBe(403);
    // abrir a ficha e auditado
    expect(store.queryAudit({ action: 'account.view' }).length).toBe(2);
  });

  it('login registra ultimo acesso', async () => {
    const adm = await session('Chefe', 'admin');
    const u = await account('Maria');
    expect(u.lastLoginAt).toBeUndefined();
    await app.inject({ method: 'POST', url: '/api/login', payload: { email: u.email, password: PASSWORD } });
    const row = (await call(adm, 'GET', '/api/staff/accounts?q=maria')).json().accounts[0];
    expect(row.lastLoginAt).toBeGreaterThan(0);
    expect((await call(adm, 'GET', '/api/staff/orgs')).json().orgs[0].id).toBeDefined();
  });
});

describe('poderes por nivel no WebSocket (botoes do painel)', () => {
  it('mensagem de staff, aviso por organizacao, salas: helper so o basico, moderador completo', async () => {
    const helper = await session('Ajuda', 'helper');
    const mod = await session('Moda', 'moderator');
    const ana = await session('Ana');
    ana.conn.inbox = [];

    ws(helper, { t: 'staff_dm', target: ana.account.id, text: 'Oi, tudo bem?' });
    const dm = ana.conn.all('announce')[0]!;
    expect(dm).toMatchObject({ scope: 'private', from: 'Ajuda', text: 'Oi, tudo bem?' });
    expect(store.queryAudit({ action: 'dm' })[0]).toMatchObject({ actor: 'Ajuda', target: 'Ana' });
    // comum nao envia
    ws(ana, { t: 'staff_dm', target: helper.account.id, text: 'x' });
    expect(ana.conn.errors()).toContain('forbidden');

    // aviso de organizacao: moderador
    ws(helper, { t: 'staff_announce', scope: 'org', orgId: 'default', text: 'reuniao' });
    expect(helper.conn.errors()).toContain('forbidden');
    ana.conn.inbox = [];
    ws(mod, { t: 'staff_announce', scope: 'org', orgId: 'default', text: 'reuniao as 15h', highlight: true });
    expect(ana.conn.all('announce')[0]).toMatchObject({ scope: 'org', highlight: true, text: 'reuniao as 15h' });
    ws(mod, { t: 'staff_announce', scope: 'room', orgId: 'default', roomId: 'office', text: 'sala' });
    expect(ana.conn.all('announce').at(-1)).toMatchObject({ scope: 'room' });

    // salas: helper ve; so moderador controla
    ws(helper, { t: 'staff_rooms' });
    const rooms = helper.conn.all('staff_rooms')[0]!.rooms;
    expect(rooms.find((r) => r.roomId === 'office')).toMatchObject({ landing: true, state: 'open' });
    expect(rooms.find((r) => r.roomId === 'office')!.count).toBeGreaterThanOrEqual(3);
    ws(helper, { t: 'staff_room', orgId: 'default', roomId: 'lounge', op: 'lock' });
    expect(helper.conn.errors()).toContain('forbidden');
  });

  it('trancar, fechar, esvaziar e reabrir sala; sala inicial protegida; staff em servico continua', async () => {
    const mod = await session('Moda', 'moderator');
    const ana = await session('Ana');
    const roomOf = (s: Session) => world.findPlayerByAccount(s.account.id)!.roomId;
    ws(ana, { t: 'join', roomId: 'lounge' });
    expect(roomOf(ana)).toBe('lounge');

    ws(mod, { t: 'staff_room', orgId: 'default', roomId: 'lounge', op: 'lock' });
    expect(world.roomState('default', 'lounge')).toBe('locked');
    expect(roomOf(ana)).toBe('lounge'); // quem estava continua
    const beto = await session('Beto');
    ws(beto, { t: 'join', roomId: 'lounge' });
    expect(beto.conn.errors()).toContain('room_locked');
    expect(roomOf(beto)).toBe('office');
    ws(mod, { t: 'join', roomId: 'lounge' }); // staff em servico entra
    expect(roomOf(mod)).toBe('lounge');

    ws(mod, { t: 'staff_room', orgId: 'default', roomId: 'lounge', op: 'close' });
    expect(world.roomState('default', 'lounge')).toBe('closed');
    expect(roomOf(ana)).toBe('office');
    expect(ana.conn.all('error').some((e) => e.code === 'kicked_room')).toBe(true);
    expect(roomOf(mod)).toBe('lounge');

    ws(mod, { t: 'staff_room', orgId: 'default', roomId: 'lounge', op: 'open' });
    expect(world.roomState('default', 'lounge')).toBe('open');
    ws(ana, { t: 'join', roomId: 'lounge' });
    expect(roomOf(ana)).toBe('lounge');
    ws(mod, { t: 'staff_room', orgId: 'default', roomId: 'lounge', op: 'empty' });
    expect(roomOf(ana)).toBe('office');

    // sala inicial nunca
    ws(mod, { t: 'staff_room', orgId: 'default', roomId: 'office', op: 'close' });
    expect(world.roomState('default', 'office')).toBe('open');
    expect(mod.conn.all('chat').some((c) => /sala inicial/.test(c.text))).toBe(true);
    // sala/org inexistente e op invalida
    ws(mod, { t: 'staff_room', orgId: 'default', roomId: 'nao-existe', op: 'lock' });
    expect(mod.conn.all('chat').some((c) => /não encontrada/.test(c.text))).toBe(true);
    const actions = store.queryAudit({ action: 'room' }).map((r) => r.action);
    expect(actions).toEqual(expect.arrayContaining(['room.lock', 'room.close', 'room.open', 'room.empty']));
  });

  it('silenciar fica na conta: persiste e o mudo vale em outra sessao', async () => {
    const helper = await session('Ajuda', 'helper');
    const ana = await session('Ana');
    ws(helper, { t: 'staff_mute', target: ana.account.id, minutes: 10, reason: 'flood' });
    expect(store.getById(ana.account.id)!.mute).toMatchObject({ by: 'Ajuda', reason: 'flood' });
    ws(ana, { t: 'chat', text: 'oi' });
    expect(ana.conn.errors()).toContain('muted');
    ws(helper, { t: 'staff_mute', target: ana.account.id, minutes: 0 });
    expect(store.getById(ana.account.id)!.mute).toBeUndefined();
  });
});

describe('auditoria', () => {
  it('filtros por staff, alvo, acao e data; negado para helper; exportacao CSV segura e auditada', async () => {
    const mod = await session('Moda', 'moderator');
    const helper = await session('Ajuda', 'helper');
    const adm = await session('Chefe', 'admin');
    const ana = await session('Ana');
    ws(helper, { t: 'staff_mute', target: ana.account.id, minutes: 5, reason: 'x' });
    await call(mod, 'POST', `/api/staff/accounts/${ana.account.id}/ban`, { minutes: 60, reason: '=SOMA(A1)' });
    await call(adm, 'POST', '/api/staff/accounts', { email: 'n@x.com', displayName: 'Nova' });

    expect((await call(helper, 'GET', '/api/staff/audit')).statusCode).toBe(403);
    expect((await call(null, 'GET', '/api/staff/audit')).statusCode).toBe(401);
    const all = (await call(mod, 'GET', '/api/staff/audit')).json().records as { actor: string; action: string; target?: string; at: number }[];
    expect(all.length).toBeGreaterThanOrEqual(3);
    expect(all[0]!.at).toBeGreaterThanOrEqual(all.at(-1)!.at); // mais recentes primeiro
    const byActor = (await call(mod, 'GET', '/api/staff/audit?actor=ajud')).json().records;
    expect(byActor.every((r: { actor: string }) => r.actor === 'Ajuda')).toBe(true);
    expect(byActor.length).toBe(1);
    expect((await call(mod, 'GET', '/api/staff/audit?target=ana')).json().records.length).toBe(2);
    expect((await call(mod, 'GET', '/api/staff/audit?action=account')).json().records.every((r: { action: string }) => r.action.startsWith('account.'))).toBe(true);
    expect((await call(mod, 'GET', `/api/staff/audit?to=${Date.now() + 10_000}&from=${Date.now() - 60_000}`)).json().records.length).toBeGreaterThan(0);
    expect((await call(mod, 'GET', `/api/staff/audit?from=${Date.now() + 99_999}`)).json().records).toHaveLength(0);
    expect((await call(mod, 'GET', '/api/staff/audit?from=abc')).statusCode).toBe(400);
    expect((await call(mod, 'GET', '/api/staff/audit?actor=' + 'x'.repeat(100))).statusCode).toBe(400);

    const csv = await call(mod, 'GET', '/api/staff/audit.csv?action=account');
    expect(csv.statusCode).toBe(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(String(csv.headers['content-disposition'])).toContain('attachment');
    expect(csv.body.startsWith('﻿"data_hora_utc"')).toBe(true);
    expect(csv.body).toContain('account.ban');
    expect(csv.body).toContain(`"'=SOMA(A1)`.slice(0, 1)); // celula entre aspas
    expect(csv.body).not.toMatch(/,"=SOMA/); // formula neutralizada
    expect(store.queryAudit({ action: 'audit.export' })).toHaveLength(1);
    expect((await call(helper, 'GET', '/api/staff/audit.csv')).statusCode).toBe(403);

    // historico de avisos (qualquer staff)
    ws(helper, { t: 'staff_announce', scope: 'room', text: 'ola sala' });
    const hist = (await call(helper, 'GET', '/api/staff/announcements')).json().records;
    expect(hist[0].action).toBe('announce.room');
  });

  it('csvCell e auditCsv escapam aspas, quebras e formulas', () => {
    expect(csvCell('a"b')).toBe('"a""b"');
    expect(csvCell('=1+1')).toBe(`"'=1+1"`);
    expect(csvCell('+55')).toBe(`"'+55"`);
    expect(csvCell('-x')).toBe(`"'-x"`);
    expect(csvCell('@u')).toBe(`"'@u"`);
    expect(csvCell(undefined)).toBe('""');
    const csv = auditCsv([{ id: '1', at: 0, actorId: 'a', actor: 'A', level: 'admin', action: 'x', detail: 'l1\nl2, "q"' }]);
    expect(csv.split('\r\n')).toHaveLength(3);
    expect(csv).toContain('"l1\nl2, ""q"""');
  });

  it('nao grava conteudo de DMs de usuarios na auditoria', async () => {
    const a = await session('Ana');
    const b = await session('Beto');
    ws(a, { t: 'dm', to: b.account.id, text: 'segredo-absoluto-123' });
    expect(b.conn.all('dm')).toHaveLength(1);
    expect(JSON.stringify(store.queryAudit({ limit: 1000 }))).not.toContain('segredo-absoluto-123');
  });
});
