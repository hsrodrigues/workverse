import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { localDate, type ServerMessage } from '@workverse/shared';
import { createApp } from '../src/app';
import { SESSION_COOKIE, SESSION_TTL_MS, hashToken } from '../src/auth';
import { MemoryAccountStore, type Account } from '../src/store';
import type { Connection } from '../src/world';
import { nameHistoryOf } from '../src/profileService';

const H = 3600_000;
// O World do createApp usa o relogio real: o aniversario "de hoje" vem da data real no fuso padrao.
const TODAY = localDate(Date.now(), 'America/Sao_Paulo');
const apps: FastifyInstance[] = [];
afterEach(async () => {
  for (const a of apps.splice(0)) await a.close();
});

class FakeConn implements Connection {
  strikes = 0;
  accountId?: string;
  player?: Connection['player'];
  sessionHash?: string;
  inbox: ServerMessage[] = [];
  send(msg: ServerMessage) {
    this.inbox.push(msg);
  }
  close() {}
  all<T extends ServerMessage['t']>(t: T) {
    return this.inbox.filter((m) => m.t === t) as Extract<ServerMessage, { t: T }>[];
  }
}

async function setup() {
  const store = new MemoryAccountStore();
  let now = Date.UTC(2026, 5, 10, 15, 0, 0);
  const { app, world } = await createApp({ store, clock: () => now, tickMs: 50, allowDevLogin: true, authLimits: { failDelayMs: 0 } });
  apps.push(app);
  let n = 0;
  /** Entra pelo caminho de desenvolvimento e cria uma sessao de cookie para a conta. */
  const join = (name: string): { conn: FakeConn; account: Account; cookie: string } => {
    const conn = new FakeConn();
    world.handle(conn, { t: 'hello', name });
    world.handle(conn, { t: 'join' });
    const account = store.getByName(name)!;
    const token = `tok-${n++}`;
    store.createSession({ tokenHash: hashToken(token), accountId: account.id, createdAt: now, expiresAt: now + SESSION_TTL_MS });
    return { conn, account, cookie: `${SESSION_COOKIE}=${token}` };
  };
  const call = (method: 'GET' | 'PATCH', cookie: string | undefined, payload?: unknown) =>
    app.inject({ method, url: '/api/profile', payload: payload as object, headers: cookie ? { cookie } : {} });
  return { app, world, store, join, call, advance: (ms: number) => (now += ms), clock: () => now };
}

describe('GET/PATCH /api/profile', () => {
  it('exige sessao e nao aceita parametro de id (so o proprio perfil)', async () => {
    const { call, join } = await setup();
    expect((await call('GET', undefined)).statusCode).toBe(401);
    expect((await call('PATCH', undefined, { about: 'oi' })).statusCode).toBe(401);
    const a = join('Ana');
    const r = await call('GET', a.cookie);
    expect(r.statusCode).toBe(200);
    expect(r.json().profile).toMatchObject({ displayName: 'Ana', birthdayVisible: false, prefs: { tz: 'America/Sao_Paulo', showWorking: true } });
    expect(r.json().profile.about).toBeUndefined();
    expect((await call('PATCH', a.cookie, { id: 'outra-conta', about: 'x' })).statusCode).toBe(400);
  });

  it('nunca altera e-mail, cargo, setor, nivel de staff ou papel', async () => {
    const { call, join, store } = await setup();
    const a = join('Ana');
    for (const body of [{ email: 'x@y.com' }, { title: 'CEO' }, { dept: 'TI' }, { staff: 'admin' }, { role: 'owner' }, { teamId: 'ti' }, { about: 'ok', email: 'x@y.com' }]) {
      const r = await call('PATCH', a.cookie, body);
      expect(r.statusCode, JSON.stringify(body)).toBe(400);
    }
    expect(store.getById(a.account.id)!.staff).toBeUndefined();
    expect(store.getById(a.account.id)!.profile).toBeUndefined(); // o PATCH recusado nao gravou nada
  });

  it('salva sobre mim, pronomes, aniversario e preferencias; limpa com null', async () => {
    const { call, join, store } = await setup();
    const a = join('Ana');
    const r = await call('PATCH', a.cookie, {
      about: '  Cafe e   codigo ',
      pronouns: 'ela',
      birthday: { m: 6, d: 10 },
      birthdayVisible: true,
      prefs: { tz: 'America/Manaus', sound: false, eventDecor: false, dataSaver: true, showWorking: false },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().profile).toMatchObject({ about: 'Cafe e codigo', pronouns: 'ela', birthday: { m: 6, d: 10 }, birthdayVisible: true, prefs: { tz: 'America/Manaus', sound: false, eventDecor: false, dataSaver: true, showWorking: false, mentions: true } });
    expect(store.getById(a.account.id)!.profile!.about).toBe('Cafe e codigo');
    const c = await call('PATCH', a.cookie, { about: null, pronouns: null, birthday: null });
    expect(c.json().profile.about).toBeUndefined();
    expect(c.json().profile.birthday).toBeUndefined();
    expect(c.json().profile.birthdayVisible).toBe(false);
    expect(c.json().profile.prefs.tz).toBe('America/Manaus'); // preferencias parciais mesclam
  });

  it('valida no servidor (texto longo, controle, fuso falso, aniversario impossivel)', async () => {
    const { call, join } = await setup();
    const a = join('Ana');
    expect((await call('PATCH', a.cookie, { about: 'a'.repeat(81) })).json().error.code).toBe('bad_about');
    expect((await call('PATCH', a.cookie, { about: 'oi​x' })).json().error.code).toBe('bad_about');
    expect((await call('PATCH', a.cookie, { prefs: { tz: 'Mars/Base' } })).json().error.code).toBe('bad_prefs');
    expect((await call('PATCH', a.cookie, { birthday: { m: 2, d: 30 } })).json().error.code).toBe('bad_birthday');
    expect((await call('PATCH', a.cookie, { pronouns: 'ciborgue' })).json().error.code).toBe('bad_pronouns');
    expect((await call('PATCH', a.cookie, { displayName: '<script>' })).json().error.code).toBe('bad_name');
  });

  it('troca de nome: unicidade, reservado, cooldown e auditoria', async () => {
    const { call, join, store, advance, clock } = await setup();
    const a = join('Ana');
    join('Bia');
    expect((await call('PATCH', a.cookie, { displayName: 'bia' })).json().error.code).toBe('name_taken');
    expect((await call('PATCH', a.cookie, { displayName: 'Admin' })).json().error.code).toBe('bad_name');
    const t0 = clock();
    const ok = await call('PATCH', a.cookie, { displayName: 'Ana Lima' });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().profile.displayName).toBe('Ana Lima');
    expect(ok.json().profile.nameChangeAt).toBe(t0 + 24 * H);
    expect(store.getByName('Ana Lima')?.id).toBe(a.account.id);
    expect(store.getByName('Ana')).toBeUndefined();
    const cd = await call('PATCH', a.cookie, { displayName: 'Ana L' });
    expect(cd.statusCode).toBe(429);
    expect(cd.json().error.code).toBe('name_cooldown');
    expect(cd.json().error.retryAfterSeconds).toBeGreaterThan(80_000);
    // reenviar o mesmo nome nao exige cooldown
    expect((await call('PATCH', a.cookie, { displayName: 'Ana Lima', about: 'oi' })).statusCode).toBe(200);
    advance(25 * H);
    expect((await call('PATCH', a.cookie, { displayName: 'Ana L' })).statusCode).toBe(200);
    expect(nameHistoryOf(store, a.account.id).map((r) => ({ from: r.from, to: r.to }))).toEqual([
      { from: 'Ana Lima', to: 'Ana L' },
      { from: 'Ana', to: 'Ana Lima' },
    ]);
  });

  it('limite de trocas na janela', async () => {
    const { call, join, advance } = await setup();
    const a = join('Ana');
    for (let i = 0; i < 5; i++) {
      expect((await call('PATCH', a.cookie, { displayName: `Ana ${i}` })).statusCode).toBe(200);
      advance(25 * H);
    }
    const r = await call('PATCH', a.cookie, { displayName: 'Ana 9' });
    expect(r.statusCode).toBe(429);
    expect(r.json().error.code).toBe('name_cooldown');
  });

  it('rate limit de gravacoes', async () => {
    const { call, join } = await setup();
    const a = join('Ana');
    let limited = 0;
    for (let i = 0; i < 20; i++) if ((await call('PATCH', a.cookie, { about: `v${i}` })).statusCode === 429) limited++;
    expect(limited).toBeGreaterThan(0);
  });

  it('recusa origem estranha (CSRF) quando ha lista de origens', async () => {
    const store = new MemoryAccountStore();
    const { app, world } = await createApp({ store, tickMs: 50, allowDevLogin: true, allowedOrigins: ['https://ok.example'] });
    apps.push(app);
    world.handle(new FakeConn(), { t: 'hello', name: 'Ana' });
    const acc = store.getByName('Ana')!;
    store.createSession({ tokenHash: hashToken('t1'), accountId: acc.id, createdAt: Date.now(), expiresAt: Date.now() + 60_000 });
    const headers = (origin: string) => ({ cookie: `${SESSION_COOKIE}=t1`, origin });
    expect((await app.inject({ method: 'PATCH', url: '/api/profile', payload: { about: 'x' }, headers: headers('https://evil.example') })).statusCode).toBe(403);
    expect((await app.inject({ method: 'PATCH', url: '/api/profile', payload: { about: 'x' }, headers: headers('https://ok.example') })).statusCode).toBe(200);
  });

  it('silenciado nao troca nome nem sobre mim, mas ajusta preferencias', async () => {
    const { call, join, store, clock } = await setup();
    const a = join('Ana');
    store.getById(a.account.id)!.mute = { until: clock() + H, by: 'mod', reason: 'x' };
    expect((await call('PATCH', a.cookie, { about: 'x' })).json().error.code).toBe('muted');
    expect((await call('PATCH', a.cookie, { displayName: 'Nova' })).json().error.code).toBe('muted');
    expect((await call('PATCH', a.cookie, { prefs: { sound: false } })).statusCode).toBe(200);
  });
});

describe('perfil ao vivo', () => {
  it('nome e sobre mim chegam na hora a quem esta na sala', async () => {
    const { call, join } = await setup();
    const a = join('Ana');
    const b = join('Bia');
    const res = await call('PATCH', a.cookie, { displayName: 'Ana Nova', about: 'Cafe', pronouns: 'ela' });
    expect(res.statusCode).toBe(200);
    expect(b.conn.all('profile').at(-1)).toMatchObject({ id: a.conn.player!.id, name: 'Ana Nova', about: 'Cafe', pronouns: 'ela' });
    expect(a.conn.all('profile').at(-1)).toMatchObject({ name: 'Ana Nova' });
    expect(a.conn.player!.name).toBe('Ana Nova');
  });

  it('quem entra depois ve o perfil no snapshot', async () => {
    const { call, join } = await setup();
    const a = join('Ana');
    await call('PATCH', a.cookie, { about: 'Cafe', pronouns: 'elu' });
    const c = join('Caio');
    expect(c.conn.all('room').at(-1)!.room.players.find((p) => p.name === 'Ana')).toMatchObject({ about: 'Cafe', pronouns: 'elu' });
  });

  it('visitantes (guest) nao recebem campos opcionais; membros sim', async () => {
    const { call, join, world } = await setup();
    const a = join('Ana');
    const g = join('Visitante');
    g.conn.player!.role = 'guest';
    await call('PATCH', a.cookie, { about: 'Segredo', pronouns: 'ela', birthday: { m: TODAY.m, d: TODAY.d }, birthdayVisible: true });
    const m = g.conn.all('profile').at(-1)!;
    expect(m.name).toBe('Ana');
    expect(m.about).toBeUndefined();
    expect(m.pronouns).toBeUndefined();
    expect(m.bday).toBeUndefined();
    // entrando de novo na sala, o snapshot do visitante tambem vem sem os campos
    world.handle(g.conn, { t: 'join', roomId: 'lounge' });
    world.handle(g.conn, { t: 'join', roomId: 'reception' });
    expect(JSON.stringify(g.conn.inbox)).not.toContain('Segredo');
    const member = join('Membro');
    expect(member.conn.all('room').at(-1)!.room.players.find((p) => p.name === 'Ana')).toMatchObject({ about: 'Segredo', pronouns: 'ela', bday: true });
  });

  it('aniversario hoje (no fuso da pessoa) liga o icone; parabens so com opt-in e uma vez por dia', async () => {
    const { call, join, world } = await setup();
    const a = join('Ana');
    const b = join('Bia');
    const parabens = () => a.conn.inbox.filter((m) => m.t === 'chat' && m.kind === 'system' && /Parabéns/.test(m.text)).length;
    await call('PATCH', a.cookie, { birthday: { m: TODAY.m, d: TODAY.d } }); // hoje, mas sem permissao
    expect(b.conn.all('profile').at(-1)!.bday).toBeUndefined();
    await call('PATCH', a.cookie, { birthdayVisible: true });
    expect(b.conn.all('profile').at(-1)!.bday).toBe(true);
    // sem birthdayChat nao ha parabens (a vai ao lounge e volta para a recepcao, onde b esta)
    world.handle(a.conn, { t: 'join', roomId: 'lounge' });
    world.handle(a.conn, { t: 'join', roomId: 'reception' });
    expect(parabens()).toBe(0);
    await call('PATCH', a.cookie, { birthdayChat: true });
    world.handle(a.conn, { t: 'join', roomId: 'lounge' });
    world.handle(a.conn, { t: 'join', roomId: 'reception' });
    expect(parabens()).toBe(1); // dado ao entrar na sala, com opt-in
    world.handle(a.conn, { t: 'join', roomId: 'lounge' });
    world.handle(a.conn, { t: 'join', roomId: 'reception' });
    expect(parabens()).toBe(1); // uma vez por dia
  });

  it('showWorking desligado: colegas veem a atividade "working" como parada', async () => {
    const { call, join } = await setup();
    const a = join('Ana');
    const b = join('Bia');
    a.conn.player!.activity = 'working';
    await call('PATCH', a.cookie, { prefs: { showWorking: false } });
    expect(b.conn.all('activity').at(-1)).toMatchObject({ id: a.conn.player!.id, activity: 'idle' });
  });
});

describe('diretorio e staff', () => {
  it('o diretorio mostra o sobre mim (e nao os pronomes) a membros da organizacao', async () => {
    const { call, join, world } = await setup();
    const a = join('Ana');
    const b = join('Bia');
    await call('PATCH', a.cookie, { about: 'Falem comigo', pronouns: 'ela' });
    world.handle(b.conn, { t: 'dir_search', q: 'ana' });
    const entry = b.conn.all('dir_result').at(-1)!.results.find((e) => e.name === 'Ana')!;
    expect(entry.about).toBe('Falem comigo');
    expect(JSON.stringify(entry)).not.toContain('pronouns');
  });

  it('o historico de nomes fica disponivel a staff via auditoria', async () => {
    const { call, join, store } = await setup();
    const a = join('Ana');
    await call('PATCH', a.cookie, { displayName: 'Ana Dois' });
    expect(nameHistoryOf(store, a.account.id)).toEqual([{ at: expect.any(Number), from: 'Ana', to: 'Ana Dois' }]);
  });
});

describe('atalho de desenvolvimento (X-Dev-Name)', () => {
  it('identifica a conta so-nome sem cookie, e nunca contas com senha', async () => {
    const { app, join, store } = await setup();
    join('Ana');
    const ok = await app.inject({ method: 'GET', url: '/api/profile', headers: { 'x-dev-name': 'Ana' } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().profile.displayName).toBe('Ana');
    const patched = await app.inject({ method: 'PATCH', url: '/api/profile', payload: { about: 'oi' }, headers: { 'x-dev-name': 'Ana' } });
    expect(patched.statusCode).toBe(200);
    // conta real (com senha) nao e alcancavel pelo cabecalho
    const real = store.create({ email: 'real@x.com', displayName: 'Real', passwordHash: 'scrypt$x' });
    expect(real.id).toBeTruthy();
    expect((await app.inject({ method: 'GET', url: '/api/profile', headers: { 'x-dev-name': 'Real' } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/api/profile', headers: { 'x-dev-name': 'Ninguem' } })).statusCode).toBe(401);
  });

  it('sem ALLOW_DEV_LOGIN o cabecalho e ignorado', async () => {
    const store = new MemoryAccountStore();
    const { app, world } = await createApp({ store, tickMs: 50, allowDevLogin: false });
    apps.push(app);
    store.create({ email: 'a@x.com', displayName: 'Ana', passwordHash: '' });
    void world;
    expect((await app.inject({ method: 'GET', url: '/api/profile', headers: { 'x-dev-name': 'Ana' } })).statusCode).toBe(401);
  });
});
