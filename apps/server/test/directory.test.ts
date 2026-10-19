import { beforeEach, describe, expect, it } from 'vitest';
import { DIR_MAX_RESULTS, type ClientMessage, type Role, type ServerMessage } from '@workverse/shared';
import { World, type Connection } from '../src/world';
import { MemoryAccountStore, type Account } from '../src/store';
import { saveDept, setMemberProfile, type AdminCtx } from '../src/staffAdmin';

class FakeConn implements Connection {
  strikes = 0;
  accountId?: string;
  player?: Connection['player'];
  inbox: ServerMessage[] = [];
  send(msg: ServerMessage) {
    this.inbox.push(msg);
  }
  close() {}
  last<T extends ServerMessage['t']>(t: T) {
    return [...this.inbox].reverse().find((m) => m.t === t) as Extract<ServerMessage, { t: T }> | undefined;
  }
  all<T extends ServerMessage['t']>(t: T) {
    return this.inbox.filter((m) => m.t === t) as Extract<ServerMessage, { t: T }>[];
  }
  errors(code: string) {
    return this.all('error').filter((e) => e.code === code);
  }
}

let now = 1_000_000;
let store: MemoryAccountStore;
let world: World;

function account(name: string): Account {
  const a = store.create({ email: `${name.toLowerCase().replace(/\s/g, '')}@x.com`, displayName: name, passwordHash: 'scrypt$x' });
  a.orgsInit = true;
  store.save(a);
  return a;
}

function org(id: string) {
  store.orgs.putOrg({ id, slug: id.toLowerCase(), name: `Org ${id}`, settings: {}, createdAt: 0 });
  store.orgs.putTeam({ id: `${id}-geral`, orgId: id, name: 'Geral', color: '#6c8cff' });
  store.orgs.putTeam({ id: `${id}-ti`, orgId: id, name: 'TI', color: '#3fb67a' });
  store.orgs.putTeam({ id: `${id}-fin`, orgId: id, name: 'Financeiro', color: '#f0883e' });
}

function member(orgId: string, acc: Account, role: Role = 'member', team: 'geral' | 'ti' | 'fin' = 'geral', title?: string) {
  store.orgs.putMember({ orgId, accountId: acc.id, role, teamId: `${orgId}-${team}`, status: 'active', createdAt: 0, ...(title ? { title } : {}) });
}

function connect(acc: Account, orgId: string, roomId?: string): FakeConn {
  const c = new FakeConn();
  c.accountId = acc.id;
  world.handle(c, { t: 'hello', orgId });
  world.handle(c, { t: 'join', roomId });
  return c;
}

const send = (c: FakeConn, msg: Record<string, unknown>) => world.handle(c, msg as unknown as ClientMessage);
const search = (c: FakeConn, body: { dept?: string; q?: string } = {}) => {
  send(c, { t: 'dir_search', ...body });
  return c.last('dir_result')!;
};

beforeEach(() => {
  now = 1_000_000;
  store = new MemoryAccountStore();
  world = new World({ store, clock: () => now });
  org('orgA');
  org('orgB');
});

describe('diretorio da recepcao (dir_search)', () => {
  it('lista setores (sem o Geral) e acha pessoas por pedaco do nome, sem acento nem caixa', () => {
    const me = account('Rita');
    const joao = account('João Évora');
    member('orgA', me);
    member('orgA', joao, 'member', 'ti', 'Dev Sênior');
    const c = connect(me, 'orgA');
    const r = search(c, { q: 'joao ev' });
    expect(r.depts.map((d) => d.name)).toEqual(['Financeiro', 'TI']);
    expect(r.results).toHaveLength(1);
    expect(r.results[0]).toMatchObject({ name: 'João Évora', title: 'Dev Sênior', dept: 'TI', deptColor: '#3fb67a', online: false });
    // filtro por setor
    expect(search(c, { dept: 'orgA-ti' }).results.map((e) => e.name)).toEqual(['João Évora']);
    expect(search(c, { dept: 'orgA-fin' }).results).toEqual([]);
  });

  it('nao expoe e-mail nem ids de conta', () => {
    const me = account('Rita');
    const ana = account('Ana');
    member('orgA', me);
    member('orgA', ana, 'member', 'ti');
    const c = connect(me, 'orgA');
    const json = JSON.stringify(search(c).results);
    expect(json).not.toContain('@x.com');
    expect(json).not.toContain(ana.id);
  });

  it('isola as organizacoes: nunca lista membros nem setores de outra org', () => {
    const me = account('Rita');
    const spy = account('Beto');
    member('orgA', me);
    member('orgB', spy, 'member', 'ti', 'Dev');
    const c = connect(me, 'orgA');
    expect(search(c, { q: 'beto' }).results).toEqual([]);
    // um setor de outra org e tratado como inexistente (sem resultados, sem pista)
    const r = search(c, { dept: 'orgB-ti' });
    expect(r.results).toEqual([]);
    expect(r.dept).toBeNull();
    // e o setor id de outra org nao aparece nos botoes
    expect(r.depts.every((d) => d.id.startsWith('orgA-'))).toBe(true);
  });

  it('mostra online e a sala; sala restrita vira "em uma sala privada" sem o nome', () => {
    const me = account('Rita');
    const ana = account('Ana');
    member('orgA', me);
    member('orgA', ana);
    connect(ana, 'orgA', 'lounge');
    const c = connect(me, 'orgA', 'reception');
    // reuniao 1 vira privada (so convidados e o dono entram) e o dono esta la dentro
    const boss = account('Chefe');
    member('orgA', boss, 'owner');
    const bossConn = connect(boss, 'orgA', 'reception');
    send(bossConn, { t: 'room_access_set', rid: 1, roomId: 'meeting1', access: 'private' });
    send(bossConn, { t: 'join', roomId: 'meeting1' });
    expect(world.findPlayerByAccount(boss.id)!.roomId).toBe('meeting1');
    const byName = Object.fromEntries(search(c).results.map((e) => [e.name, e]));
    expect(byName.Ana).toMatchObject({ online: true, roomId: 'lounge' });
    expect(byName.Ana?.roomName).toBeTruthy();
    expect(byName.Chefe).toMatchObject({ online: true, roomHidden: true });
    expect(byName.Chefe?.roomId).toBeUndefined();
    expect(byName.Chefe?.roomName).toBeUndefined();
  });

  it('staff invisivel aparece como offline, sem sala', () => {
    const me = account('Rita');
    const mod = account('Moda');
    member('orgA', me);
    member('orgA', mod);
    const c = connect(me, 'orgA');
    connect(mod, 'orgA', 'lounge');
    const p = world.findPlayerByAccount(mod.id)!;
    expect(search(c, { q: 'moda' }).results[0]).toMatchObject({ online: true, roomId: 'lounge' });
    p.invisible = true;
    const e = search(c, { q: 'moda' }).results[0]!;
    expect(e.online).toBe(false);
    expect(e.roomId).toBeUndefined();
    expect(e.roomHidden).toBeUndefined();
    expect(e.staff).toBeUndefined();
  });

  it('nao lista contas desativadas, banidas nem membros suspensos', () => {
    const me = account('Rita');
    const a = account('Dani');
    const b = account('Duda');
    const d = account('Dario');
    for (const x of [me, a, b, d]) member('orgA', x);
    a.disabled = { at: 1, by: 'x', reason: 'x' };
    b.ban = { at: 1, by: 'x', reason: 'x', until: null };
    store.save(a);
    store.save(b);
    store.orgs.putMember({ ...store.orgs.getMember('orgA', d.id)!, status: 'suspended' });
    const c = connect(me, 'orgA');
    expect(search(c, { q: 'd' }).results).toEqual([]);
  });

  it(`limita a ${DIR_MAX_RESULTS} resultados e avisa que ha mais`, () => {
    const me = account('Rita');
    member('orgA', me);
    for (let i = 0; i < 25; i++) member('orgA', account(`Colega ${String.fromCharCode(65 + i)}`));
    const c = connect(me, 'orgA');
    const r = search(c, { q: 'colega' });
    expect(r.results).toHaveLength(DIR_MAX_RESULTS);
    expect(r.truncated).toBe(true);
  });

  it('tem limite de pedidos (rate limit) e valida o formato (mensagem malformada = strike)', () => {
    const me = account('Rita');
    member('orgA', me);
    const c = connect(me, 'orgA');
    for (let i = 0; i < 12; i++) send(c, { t: 'dir_search', q: 'a' });
    expect(c.errors('rate_limited').length).toBeGreaterThan(0);
    const outra = account('Outra');
    member('orgA', outra);
    const c2 = connect(outra, 'orgA');
    send(c2, { t: 'dir_search', q: 42 });
    send(c2, { t: 'dir_search', dept: { $ne: 1 } });
    expect(c2.errors('bad_message')).toHaveLength(2);
    expect(c2.all('dir_result')).toHaveLength(0);
  });

  it('visitantes (guest) nao podem listar a organizacao', () => {
    const g = account('Visita');
    member('orgA', g, 'guest');
    const c = connect(g, 'orgA', 'reception');
    send(c, { t: 'dir_search' });
    expect(c.all('dir_result')).toHaveLength(0);
    expect(c.errors('forbidden')).toHaveLength(1);
  });

  it('a atendente nao e jogador: nao entra na populacao nem na lista da sala', () => {
    const me = account('Rita');
    member('orgA', me);
    const c = connect(me, 'orgA', 'reception');
    expect(c.last('room')!.room.players.map((p) => p.name)).toEqual(['Rita']);
    expect(world.population('orgA').reception).toBe(1);
  });
});

describe('cargo e setor: quem define e propagacao ao vivo', () => {
  it('a pessoa comum nao muda o proprio cargo; admin e dono mudam; texto invalido e recusado', () => {
    const boss = account('Chefe');
    const ana = account('Ana');
    member('orgA', boss, 'admin');
    member('orgA', ana);
    const svc = world.orgService;
    const anaActor = svc.actorFor(ana.id, 'orgA')!;
    const r1 = svc.updateMember(anaActor, ana.id, { title: 'Diretora' });
    expect(r1.ok).toBe(false);
    expect(store.orgs.getMember('orgA', ana.id)!.title).toBeUndefined();
    const bossActor = svc.actorFor(boss.id, 'orgA')!;
    expect(svc.updateMember(bossActor, ana.id, { title: 'Dev Sênior' }).ok).toBe(true);
    expect(store.orgs.getMember('orgA', ana.id)!.title).toBe('Dev Sênior');
    for (const bad of ['a​b', 'x'.repeat(33), 'Dev ‮evil', '<b>x</b>', 42, 'Dev 😀']) {
      expect(svc.updateMember(bossActor, ana.id, { title: bad }).ok).toBe(false);
    }
    // remover o cargo
    expect(svc.updateMember(bossActor, ana.id, { title: '' }).ok).toBe(true);
    expect(store.orgs.getMember('orgA', ana.id)!.title).toBeUndefined();
  });

  it('um admin de outra organizacao nao consegue mudar cargo nem setor aqui', () => {
    const boss = account('ChefeB');
    const ana = account('Ana');
    member('orgB', boss, 'owner');
    member('orgA', ana);
    const svc = world.orgService;
    const actor = svc.actorFor(boss.id, 'orgB')!;
    expect(svc.updateMember(actor, ana.id, { title: 'X' }).ok).toBe(false);
    expect(svc.updateTeam(actor, 'orgA-ti', { name: 'Hack' }).ok).toBe(false);
  });

  it('setores: nome e cor da paleta; cor fora da paleta e recusada; mudar o setor avisa quem esta online', () => {
    const boss = account('Chefe');
    const ana = account('Ana');
    const viewer = account('Vera');
    member('orgA', boss, 'owner');
    member('orgA', ana, 'member', 'ti', 'Dev');
    member('orgA', viewer);
    const svc = world.orgService;
    const actor = svc.actorFor(boss.id, 'orgA')!;
    expect(svc.createTeam(actor, 'RH', '#123456').ok).toBe(false);
    expect(svc.createTeam(actor, 'RH', '#9b72e0').ok).toBe(true);
    expect(svc.createTeam(actor, 'rh').ok).toBe(false); // duplicado
    expect(svc.createTeam(actor, 'a​b').ok).toBe(false);

    const cv = connect(viewer, 'orgA', 'lounge');
    connect(ana, 'orgA', 'lounge');
    const joined = cv.all('joined').find((m) => m.player.name === 'Ana')!;
    expect(joined.player).toMatchObject({ title: 'Dev', dept: 'TI', deptColor: '#3fb67a' });

    // recolore o setor TI: quem esta na sala recebe `profile` na hora
    const r = svc.updateTeam(actor, 'orgA-ti', { color: '#9b72e0', name: 'Tecnologia' });
    expect(r.ok).toBe(true);
    world.refreshTeam('orgA', 'orgA-ti');
    expect(cv.last('profile')).toMatchObject({ title: 'Dev', dept: 'Tecnologia', deptColor: '#9b72e0' });

    // mudar o cargo: tambem
    svc.updateMember(actor, ana.id, { title: 'Dev Sênior' });
    world.refreshProfile(ana.id, 'orgA');
    expect(cv.last('profile')).toMatchObject({ title: 'Dev Sênior' });
    // sem mudanca nao reenvia
    const n = cv.all('profile').length;
    world.refreshProfile(ana.id, 'orgA');
    expect(cv.all('profile')).toHaveLength(n);
  });

  it('contas sem cargo/setor continuam funcionando: sem campos no PlayerView', () => {
    const ana = account('Ana');
    member('orgA', ana);
    const c = connect(ana, 'orgA', 'lounge');
    const me = c.last('room')!.room.players[0]!;
    expect(me.title).toBeUndefined();
    expect(me.dept).toBeUndefined();
  });
});

describe('painel de staff: cargo e setor (staffAdmin)', () => {
  const ctx = (): AdminCtx => ({ store, world, clock: () => now });
  let staffN = 0;
  const actor = (level: 'moderator' | 'admin') => ({ account: account(`Staff ${level} ${++staffN}`), level }) as const;

  it('define cargo e setor, audita e propaga ao vivo', () => {
    const ana = account('Ana');
    member('orgA', ana);
    const viewer = account('Vera');
    member('orgA', viewer);
    const cv = connect(viewer, 'orgA', 'lounge');
    connect(ana, 'orgA', 'lounge');
    const r = setMemberProfile(ctx(), actor('moderator'), ana, { orgId: 'orgA', teamId: 'orgA-fin', title: 'Gerente Comercial' });
    expect(r.ok).toBe(true);
    expect(store.orgs.getMember('orgA', ana.id)).toMatchObject({ teamId: 'orgA-fin', title: 'Gerente Comercial' });
    expect(cv.last('profile')).toMatchObject({ title: 'Gerente Comercial', dept: 'Financeiro' });
    expect(store.queryAudit({ action: 'account.profile' })).toHaveLength(1);
    // setor de outra org / pessoa que nao e da org / texto invalido
    expect(setMemberProfile(ctx(), actor('moderator'), ana, { orgId: 'orgA', teamId: 'orgB-ti' }).ok).toBe(false);
    expect(setMemberProfile(ctx(), actor('moderator'), ana, { orgId: 'orgB', title: 'X' }).ok).toBe(false);
    expect(setMemberProfile(ctx(), actor('moderator'), ana, { orgId: 'orgA', title: 'a​b' }).ok).toBe(false);
  });

  it('cria e edita setores com cor da paleta e audita', () => {
    const c = ctx();
    const a = actor('moderator');
    const made = saveDept(c, a, 'orgA', null, { name: 'Comercial', color: '#e8608f' });
    expect(made.ok).toBe(true);
    expect(saveDept(c, a, 'orgA', null, { name: 'comercial' }).ok).toBe(false);
    expect(saveDept(c, a, 'orgA', null, { name: 'Marketing', color: '#000000' }).ok).toBe(false);
    if (made.ok) expect(saveDept(c, a, 'orgA', made.value.id, { color: '#2fb8c4' }).ok).toBe(true);
    expect(saveDept(c, a, 'orgA', 'orgB-ti', { name: 'Hack' }).ok).toBe(false);
    expect(store.queryAudit({ action: 'dept' }).length).toBeGreaterThanOrEqual(2);
  });
});
