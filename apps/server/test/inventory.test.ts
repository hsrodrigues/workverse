import { beforeEach, describe, expect, it } from 'vitest';
import { IT_ONLY_MESSAGE, ROOM_DEFS, STEP_MS, type ClientMessage, type Role, type ServerMessage } from '@workverse/shared';
import { World, type Connection } from '../src/world';
import { MemoryAccountStore, type Account } from '../src/store';

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
  systemText() {
    return this.all('chat').filter((m) => m.kind === 'system').map((m) => m.text);
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
  store.orgs.putTeam({ id: `${id}-ti`, orgId: id, name: 'Tecnologia da Informação', color: '#3fb67a' });
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
const wait = (ms: number) => {
  const end = now + ms;
  while (now < end) {
    now = Math.min(end, now + 250);
    world.tick(now);
  }
};
/** Next call after a second, so the per-player rate limit never gets in the way of a matrix test. */
const query = (c: FakeConn) => {
  now += 2000;
  send(c, { t: 'inventory_query' });
  return c.last('inventory_result');
};

const officeChair = ROOM_DEFS.find((r) => r.id === 'office')!.furniture.find((f) => f.kind === 'chair' && f.x === 2 && f.y === 2)!;
const officePc = ROOM_DEFS.find((r) => r.id === 'office')!.furniture.find((f) => f.kind === 'computer' && f.x === 2 && f.y === 3)!;
/** Sits the connection at the office PC (2,3) and waits until it is working. */
function startWorking(c: FakeConn) {
  send(c, { t: 'interact', furniId: officeChair.id, x: officeChair.x, y: officeChair.y });
  wait(STEP_MS * 30);
  expect(c.player!.activity).toBe('working');
}

beforeEach(() => {
  now = 1_000_000;
  store = new MemoryAccountStore();
  world = new World({ store, clock: () => now, idleAwayMs: 3_600_000 });
  org('orgA');
  org('orgB');
});

describe('inventário de PCs: quem pode ver', () => {
  it('só equipe de TI, admin, dono e staff em serviço; os demais recebem "Acesso restrito à equipe de TI"', () => {
    const roles: Array<[string, Role, 'geral' | 'ti' | 'fin', boolean]> = [
      ['Membro', 'member', 'geral', false],
      ['Financa', 'member', 'fin', false],
      ['Tecnico', 'member', 'ti', true],
      ['Gerente', 'admin', 'geral', true],
      ['Chefe', 'owner', 'fin', true],
    ];
    for (const [name, role, team, allowed] of roles) {
      const a = account(name);
      member('orgA', a, role, team);
      const c = connect(a, 'orgA');
      const res = query(c);
      if (allowed) expect(res?.total, name).toBeGreaterThan(20);
      else {
        expect(res, name).toBeUndefined();
        expect(c.errors('it_only')[0]?.message, name).toBe(IT_ONLY_MESSAGE);
      }
    }
  });

  it('visitante (guest) nunca vê, mesmo na equipe de TI', () => {
    const g = account('Visita');
    member('orgA', g, 'guest', 'ti');
    const c = connect(g, 'orgA', 'reception');
    send(c, { t: 'inventory_query' });
    expect(c.last('inventory_result')).toBeUndefined();
    expect(c.errors('forbidden').length + c.errors('it_only').length).toBeGreaterThan(0);
  });

  it('staff da plataforma em serviço vê; fora de serviço não', () => {
    const s = account('Staffer');
    s.staff = 'admin';
    store.save(s);
    member('orgA', s, 'member', 'geral');
    const c = connect(s, 'orgA');
    send(c, { t: 'staff_duty', on: false });
    c.inbox.length = 0;
    expect(query(c)).toBeUndefined();
    send(c, { t: 'staff_duty', on: true });
    expect(query(c)?.total).toBeGreaterThan(20);
  });

  it('usar o rack ou o console: TI abre o painel, os outros recebem a recusa simpática no chat', () => {
    const ti = account('Tecnico');
    const other = account('Curioso');
    member('orgA', ti, 'member', 'ti');
    member('orgA', other, 'member', 'geral');
    const a = connect(ti, 'orgA', 'ti');
    const b = connect(other, 'orgA', 'ti');
    const tiRoom = ROOM_DEFS.find((r) => r.id === 'ti')!;
    for (const kind of ['server_rack', 'noc_console'] as const) {
      const f = tiRoom.furniture.find((x) => x.kind === kind)!;
      a.inbox.length = 0;
      b.inbox.length = 0;
      send(a, { t: 'interact', furniId: f.id, x: f.x, y: f.y });
      send(b, { t: 'interact', furniId: f.id, x: f.x, y: f.y });
      wait(STEP_MS * 40);
      expect(a.last('inventory_open'), kind).toBeTruthy();
      expect(b.last('inventory_open'), kind).toBeUndefined();
      expect(b.systemText(), kind).toContain(IT_ONLY_MESSAGE);
    }
  });
});

describe('inventário de PCs: conteúdo derivado do mundo real', () => {
  it('cada estação vira um host com hostname e IP estáveis; quem trabalha aparece ONLINE com usuário e tempo', () => {
    const boss = account('Chefe');
    const dev = account('Dev');
    member('orgA', boss, 'owner');
    member('orgA', dev, 'member', 'ti', 'Dev Sênior');
    const bossConn = connect(boss, 'orgA', 'reception');
    const devConn = connect(dev, 'orgA', 'office');
    const before = query(bossConn)!;
    expect(before.busy).toBe(0);
    startWorking(devConn);
    wait(120_000);
    const res = query(bossConn)!;
    expect(res.busy).toBe(1);
    expect(res.powered).toBe(1);
    const host = res.hosts.find((h) => h.users.length)!;
    expect(host).toMatchObject({ status: 'online', roomId: 'office', kind: 'computer', x: officePc.x, y: officePc.y });
    expect(host.hostname).toMatch(/^PC-ESC-\d\d$/);
    expect(host.ip).toMatch(/^10\.\d+\.\d+\.\d+$/);
    expect(host.users[0]).toMatchObject({ name: 'Dev', title: 'Dev Sênior', dept: 'Tecnologia da Informação' });
    expect(host.users[0]!.upMs).toBeGreaterThanOrEqual(110_000);
    expect(host.cpu).toBeGreaterThan(10);
    // estável: o mesmo host tem o mesmo nome e IP numa consulta posterior
    const again = query(bossConn)!.hosts.find((h) => h.id === host.id)!;
    expect(again.hostname).toBe(host.hostname);
    expect(again.ip).toBe(host.ip);
    // sem e-mail nem id de conta em lugar nenhum
    const raw = JSON.stringify(res);
    expect(raw).not.toContain('@x.com');
    expect(raw).not.toContain(dev.id);
    // quem levantou deixa o PC ocioso ou desligado (o monitor apaga)
    send(devConn, { t: 'move', x: 7, y: 7 });
    wait(STEP_MS * 10);
    expect(query(bossConn)!.busy).toBe(0);
  });

  it('staff invisível e conta desativada não aparecem trabalhando', () => {
    const boss = account('Chefe');
    const inv = account('Invisivel');
    const gone = account('Desativado');
    member('orgA', boss, 'owner');
    member('orgA', inv);
    member('orgA', gone);
    const bossConn = connect(boss, 'orgA', 'reception');
    const invConn = connect(inv, 'orgA', 'office');
    startWorking(invConn);
    expect(query(bossConn)!.busy).toBe(1);
    invConn.player!.invisible = true;
    expect(query(bossConn)!.busy).toBe(0);
    invConn.player!.invisible = false;
    inv.disabled = { at: 1, by: 'x', reason: 'x' };
    expect(query(bossConn)!.hosts.every((h) => h.users.length === 0)).toBe(true);
    void gone;
  });

  it('isolamento por organização: só os PCs e as pessoas da própria org', () => {
    const bossA = account('ChefeA');
    const bossB = account('ChefeB');
    const workerB = account('TrabB');
    member('orgA', bossA, 'owner');
    member('orgB', bossB, 'owner');
    member('orgB', workerB);
    const a = connect(bossA, 'orgA', 'reception');
    connect(bossB, 'orgB', 'reception');
    startWorking(connect(workerB, 'orgB', 'office'));
    expect(query(a)!.busy).toBe(0);
    expect(JSON.stringify(query(a)!)).not.toContain('TrabB');
    expect(query(a)!.depts.every((d) => d.id.startsWith('orgA-'))).toBe(true);
  });

  it('sala privada: o host aparece "oculto", sem sala, posição nem hostname real, e sem ações', () => {
    const boss = account('Chefe');
    const tech = account('Tecnico');
    const priv = account('Reservado');
    member('orgA', boss, 'owner');
    member('orgA', tech, 'member', 'ti');
    member('orgA', priv);
    const bossConn = connect(boss, 'orgA', 'reception');
    const techConn = connect(tech, 'orgA', 'reception');
    // a Sala Privada (padrão privada) tem 2 PCs; convida quem vai trabalhar lá
    send(bossConn, { t: 'room_invite_add', rid: 1, roomId: 'private', who: 'Reservado' });
    const privConn = connect(priv, 'orgA', 'private');
    const privateDef = ROOM_DEFS.find((r) => r.id === 'private')!;
    const chair = privateDef.furniture.find((f) => f.kind === 'chair')!;
    send(privConn, { t: 'interact', furniId: chair.id, x: chair.x, y: chair.y });
    wait(STEP_MS * 30);
    expect(privConn.player!.activity).toBe('working');
    const asTech = query(techConn)!;
    const hidden = asTech.hosts.filter((h) => h.hidden);
    expect(hidden.length).toBe(2);
    for (const h of hidden) {
      expect(h.roomId).toBeUndefined();
      expect(h.roomName).toBeUndefined();
      expect(h.x).toBeUndefined();
      expect(h.id.startsWith('oculto-')).toBe(true);
      expect(h.hostname).toMatch(/-RES-/);
    }
    expect(asTech.rooms.some((r) => r.id === 'private')).toBe(false);
    expect(JSON.stringify(asTech)).not.toContain('Sala Privada');
    // o dono entra na sala privada: vê a sala
    const asBoss = query(bossConn)!;
    expect(asBoss.hosts.filter((h) => h.hidden).length).toBe(0);
    expect(asBoss.hosts.some((h) => h.roomId === 'private' && h.status === 'online')).toBe(true);
    // ação sobre PC de sala privada para quem não entra: "não encontrado"
    const real = asBoss.hosts.find((h) => h.roomId === 'private')!;
    now += 2000;
    send(techConn, { t: 'inventory_action', host: real.id, action: 'ping' });
    expect(techConn.last('inventory_action_result')).toMatchObject({ ok: false, message: 'Host não encontrado.' });
  });
});

describe('inventário de PCs: ações e limites', () => {
  function setup() {
    const boss = account('Chefe');
    const dev = account('Dev');
    member('orgA', boss, 'owner');
    member('orgA', dev);
    const bossConn = connect(boss, 'orgA', 'reception');
    const devConn = connect(dev, 'orgA', 'office');
    startWorking(devConn);
    const host = query(bossConn)!.hosts.find((h) => h.users.length)!;
    return { bossConn, devConn, host };
  }

  it('ping devolve latência fictícia; host desligado não responde', () => {
    const { bossConn, host } = setup();
    now += 2000;
    send(bossConn, { t: 'inventory_action', host: host.id, action: 'ping' });
    const ok = bossConn.last('inventory_action_result')!;
    expect(ok.ok).toBe(true);
    expect(ok.ms).toBeGreaterThanOrEqual(1);
    expect(ok.ms).toBeLessThanOrEqual(9);
    const off = query(bossConn)!.hosts.find((h) => h.status === 'off')!;
    now += 2000;
    send(bossConn, { t: 'inventory_action', host: off.id, action: 'ping' });
    expect(bossConn.last('inventory_action_result')).toMatchObject({ ok: false });
  });

  it('reiniciar só avisa a pessoa sentada (ninguém é derrubado) e tem intervalo por alvo', () => {
    const { bossConn, devConn, host } = setup();
    now += 2000;
    send(bossConn, { t: 'inventory_action', host: host.id, action: 'reboot' });
    expect(bossConn.last('inventory_action_result')).toMatchObject({ ok: true });
    expect(devConn.systemText().length).toBeGreaterThan(0);
    expect(devConn.player!.activity).toBe('working');
    expect(devConn.player!.sitting).toBe(true);
    const lines = devConn.systemText().length;
    now += 2000;
    send(bossConn, { t: 'inventory_action', host: host.id, action: 'reboot' });
    expect(bossConn.last('inventory_action_result')).toMatchObject({ ok: false });
    expect(devConn.systemText().length).toBe(lines);
  });

  it('quem não é da TI não executa ações', () => {
    const { devConn, host } = setup();
    send(devConn, { t: 'inventory_action', host: host.id, action: 'reboot' });
    expect(devConn.errors('it_only').length).toBe(1);
  });

  it('valida a mensagem e limita a taxa', () => {
    const { bossConn, host } = setup();
    const strikes = bossConn.strikes;
    for (const bad of [{ host: 42, action: 'ping' }, { host: host.id, action: 'format' }, { host: 'x'.repeat(200), action: 'ping' }, { host: '', action: 'ping' }]) {
      send(bossConn, { t: 'inventory_action', ...bad });
    }
    expect(bossConn.strikes).toBe(strikes + 4);
    // rajada: a partir de certo ponto, "rate_limited"
    for (let i = 0; i < 12; i++) send(bossConn, { t: 'inventory_query' });
    expect(bossConn.errors('rate_limited').length).toBeGreaterThan(0);
    // host inexistente
    now += 5000;
    send(bossConn, { t: 'inventory_action', host: 'office/naoexiste', action: 'ping' });
    expect(bossConn.last('inventory_action_result')).toMatchObject({ ok: false, message: 'Host não encontrado.' });
  });
});
