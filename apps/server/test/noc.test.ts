import { beforeEach, describe, expect, it } from 'vitest';
import { IT_ONLY_MESSAGE, NOC_CAPACITY, NOC_MAX_EVENTS, NOC_MAX_ORGS, NOC_MAX_ROOMS, ROOM_DEFS, STEP_MS, nocStation, type ClientMessage, type Role, type ServerMessage } from '@workverse/shared';
import { World, type Connection } from '../src/world';
import { NocCollector, type NocHost, type NocMediaSample, type NocSampleOrg } from '../src/noc';
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
  errors(code: string) {
    return this.inbox.filter((m) => m.t === 'error' && m.code === code);
  }
  systemText() {
    return this.inbox.filter((m): m is Extract<ServerMessage, { t: 'chat' }> => m.t === 'chat' && m.kind === 'system').map((m) => m.text);
  }
}

// ---- coletor isolado, com relogio injetavel ----------------------------------------------------------------------------
describe('NocCollector: amostragem, aneis e limites', () => {
  let now = 1_000_000;
  let orgs: NocSampleOrg[];
  let media: NocMediaSample | null;
  let heap = 100;
  const host: NocHost = { clock: () => now, sample: () => orgs, media: () => media, heapMb: () => heap };
  const room = (id: string, count: number, extra: Partial<NocSampleOrg['rooms'][number]> = {}) => ({ id, name: `Sala ${id}`, count, capacity: 20, ...extra });
  const all = () => true;

  beforeEach(() => {
    now = 1_000_000;
    heap = 100;
    media = null;
    orgs = [{ orgId: 'A', rooms: [room('office', 3), room('ti', 2, { it: true, climate: { temp: 24, target: 22, on: true, overheat: false } })] }];
  });

  it('so amostra quando o intervalo passou (relogio injetavel)', () => {
    const c = new NocCollector(host, { sampleMs: 30_000 });
    c.tick(now);
    c.tick(now + 10_000);
    c.tick(now + 29_999);
    expect(c.view('A', 15, { full: false, canSee: all }, now).online.values.length).toBe(1);
    c.tick(now + 30_000);
    c.tick(now + 60_000);
    const v = c.view('A', 15, { full: false, canSee: all }, now + 60_000);
    expect(v.online.values).toEqual([5, 5, 5]);
    expect(v.online.now).toBe(5);
    expect(v.sampleMs).toBe(30_000);
  });

  it('anel com limite fixo: depois de muito tempo guarda so ~6 h e a memoria nao cresce', () => {
    const c = new NocCollector(host, { sampleMs: 30_000 });
    for (let i = 0; i < NOC_CAPACITY + 500; i++) {
      now += 30_000;
      orgs[0]!.rooms[0]!.count = i % 7;
      c.tick(now);
    }
    const before = c.stats();
    for (let i = 0; i < 2000; i++) {
      now += 30_000;
      c.tick(now);
    }
    expect(c.stats()).toEqual(before);
    const v = c.view('A', 360, { full: false, canSee: all }, now);
    // 720 amostras brutas reduzidas a no maximo 120 pontos; a janela de 15 min tem 30
    expect(v.online.values.length).toBeLessThanOrEqual(120);
    expect(c.view('A', 15, { full: false, canSee: all }, now).online.values.length).toBe(30);
    expect(v.stepMs).toBe(180_000);
    expect(c.view('A', 60, { full: false, canSee: all }, now).stepMs).toBe(30_000);
  });

  it('janelas: 15 min mostram so os ultimos pontos; pico e atual vem da janela', () => {
    const c = new NocCollector(host, { sampleMs: 30_000 });
    for (let i = 0; i < 100; i++) {
      now += 30_000;
      orgs[0]!.rooms[0]!.count = i === 10 ? 15 : 1;
      c.tick(now);
    }
    const w15 = c.view('A', 15, { full: false, canSee: all }, now);
    const w60 = c.view('A', 60, { full: false, canSee: all }, now);
    expect(w15.online.peak).toBe(3); // 1 + 2 da sala da TI
    expect(w60.online.peak).toBe(17); // 50 min de historico: o pico de 40 min atras entra
    expect(c.view('A', 360, { full: false, canSee: all }, now).online.peak).toBe(17);
  });

  it('temperatura e meta/estado do ar da Sala da TI; meta some (null) com o ar desligado', () => {
    const c = new NocCollector(host, { sampleMs: 30_000 });
    c.tick(now);
    now += 30_000;
    orgs[0]!.rooms[1]!.climate = { temp: 26.5, target: 22, on: false, overheat: false };
    c.tick(now);
    const v = c.view('A', 15, { full: false, canSee: all }, now);
    expect(v.climate).toHaveLength(1);
    expect(v.climate[0]).toMatchObject({ id: 'ti', it: true, temp: 26.5, on: false, temps: [24, 26.5], targets: [22, null] });
  });

  it('eventos: entrada/saida em massa, superaquecimento (e fim) e cota de midia 70/90 %, sempre limitados', () => {
    media = { usedMinutes: 10, limitMinutes: 100, percent: 10, level: 'ok', connections: new Map([['A', 2]]) };
    const c = new NocCollector(host, { sampleMs: 30_000 });
    c.tick(now);
    now += 30_000;
    orgs[0]!.rooms[0]!.count = 12;
    c.tick(now);
    now += 30_000;
    orgs[0]!.rooms[0]!.count = 1;
    orgs[0]!.rooms[1]!.climate = { temp: 31, target: 22, on: false, overheat: true };
    media = { ...media, usedMinutes: 75, percent: 75, level: 'warn70' };
    c.tick(now);
    now += 30_000;
    orgs[0]!.rooms[1]!.climate = { temp: 28, target: 22, on: true, overheat: false };
    media = { ...media, usedMinutes: 92, percent: 92, level: 'warn90' };
    c.tick(now);
    const kinds = c.view('A', 15, { full: false, canSee: all }, now).events.map((e) => e.kind);
    expect(kinds).toEqual(expect.arrayContaining(['mass_join', 'mass_leave', 'overheat', 'overheat_clear', 'quota']));
    expect(kinds.filter((k) => k === 'quota')).toHaveLength(2);
    // eventos mais novos primeiro e nunca passam do limite
    const ev = c.view('A', 15, { full: false, canSee: all }, now).events;
    expect(ev[0]!.at).toBeGreaterThanOrEqual(ev[ev.length - 1]!.at);
    for (let i = 0; i < 200; i++) {
      now += 30_000;
      orgs[0]!.rooms[0]!.count = i % 2 === 0 ? 30 : 0;
      c.tick(now);
    }
    expect(c.view('A', 15, { full: false, canSee: all }, now).events.length).toBeLessThanOrEqual(NOC_MAX_EVENTS);
  });

  it('isolamento por organizacao: cada uma so ve a propria serie, sala e evento', () => {
    orgs.push({ orgId: 'B', rooms: [room('secret', 9)] });
    const c = new NocCollector(host, { sampleMs: 30_000 });
    c.tick(now);
    const a = c.view('A', 15, { full: true, canSee: all }, now);
    const b = c.view('B', 15, { full: true, canSee: all }, now);
    expect(a.online.now).toBe(5);
    expect(b.online.now).toBe(9);
    expect(JSON.stringify(a)).not.toContain('secret');
    expect(JSON.stringify(b)).not.toContain('office');
    expect(c.view('C', 15, { full: true, canSee: all }, now).online.values).toEqual([]);
  });

  it('o filtro canSee esconde salas restritas da pessoa que pergunta', () => {
    const c = new NocCollector(host, { sampleMs: 30_000 });
    c.tick(now);
    const v = c.view('A', 15, { full: false, canSee: (id) => id !== 'office' }, now);
    expect(v.rooms.map((r) => r.id)).toEqual(['ti']);
    expect(v.online.now).toBe(5); // o total da organizacao continua o mesmo
  });

  it('processo: escopo org so recebe uptime e carga; full recebe memoria, tick e mensagens/s', () => {
    const c = new NocCollector(host, { sampleMs: 30_000, tickBudgetMs: 100 });
    c.tick(now);
    for (let i = 0; i < 10; i++) c.recordTick(2);
    c.recordTick(20);
    for (let i = 0; i < 300; i++) c.countMessage();
    heap = 123.4;
    now += 30_000;
    c.tick(now);
    const org = c.view('A', 15, { full: false, canSee: all }, now);
    expect(org.scope).toBe('org');
    expect(org.server.detail).toBeUndefined();
    expect(org.server.uptimeSec).toBe(30);
    expect(org.server.load).toBeGreaterThan(0);
    expect(org.server.load).toBeLessThanOrEqual(1);
    expect(org.media).toBeNull();
    const full = c.view('A', 15, { full: true, canSee: all }, now);
    expect(full.scope).toBe('full');
    expect(full.server.detail).toMatchObject({ heapMb: 123.4, tickMaxMs: 20, msgsPerSec: 10 });
    expect(full.server.detail!.heap).toEqual([100, 123.4]);
  });

  it('midia: org ve so as proprias conexoes e o nivel; os minutos da plataforma so no escopo full', () => {
    media = { usedMinutes: 40, limitMinutes: 100, percent: 40, level: 'ok', connections: new Map([['A', 4], ['B', 7]]) };
    const c = new NocCollector(host, { sampleMs: 30_000 });
    c.tick(now);
    const org = c.view('A', 15, { full: false, canSee: all }, now);
    expect(org.media).toEqual({ connections: { now: 4, values: [4] }, level: 'ok' });
    expect(JSON.stringify(org)).not.toContain('"minutes"');
    const full = c.view('A', 15, { full: true, canSee: all }, now);
    expect(full.media?.minutes).toMatchObject({ used: 40, limit: 100, percent: 40 });
  });

  it('limites de memoria: organizacoes e salas alem do teto sao ignoradas; org que some e esquecida', () => {
    orgs = Array.from({ length: NOC_MAX_ORGS + 20 }, (_, i) => ({ orgId: `o${i}`, rooms: Array.from({ length: NOC_MAX_ROOMS + 10 }, (_, j) => room(`r${j}`, 1)) }));
    const c = new NocCollector(host, { sampleMs: 30_000 });
    c.tick(now);
    expect(c.stats().orgs).toBe(NOC_MAX_ORGS);
    expect(c.view('o0', 15, { full: false, canSee: all }, now).rooms).toHaveLength(NOC_MAX_ROOMS);
    orgs = [orgs[0]!];
    now += 30_000;
    c.tick(now);
    expect(c.stats().orgs).toBe(1);
  });
});

// ---- permissoes no mundo -------------------------------------------------------------------------------------------------
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
}
function member(orgId: string, acc: Account, role: Role = 'member', team: 'geral' | 'ti' = 'geral') {
  store.orgs.putMember({ orgId, accountId: acc.id, role, teamId: `${orgId}-${team}`, status: 'active', createdAt: 0 });
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
/** Passa 2 s antes de cada consulta para o limite de taxa nao atrapalhar a matriz de papeis. */
const query = (c: FakeConn, window: unknown = 15) => {
  now += 2500;
  c.inbox.length = 0;
  send(c, { t: 'noc_query', window });
  return c.last('noc_result');
};

beforeEach(() => {
  now = 1_000_000;
  store = new MemoryAccountStore();
  world = new World({ store, clock: () => now, idleAwayMs: 3_600_000, nocSampleMs: 1000 });
  org('orgA');
  org('orgB');
});

describe('noc_query: permissoes', () => {
  it('equipe de TI, admin, dono e staff em servico recebem; membros comuns recebem a recusa simpatica', () => {
    const roles: Array<[string, Role, 'geral' | 'ti', boolean]> = [
      ['Membro', 'member', 'geral', false],
      ['Tecnico', 'member', 'ti', true],
      ['Gerente', 'admin', 'geral', true],
      ['Chefe', 'owner', 'geral', true],
    ];
    for (const [name, role, team, allowed] of roles) {
      const a = account(name);
      member('orgA', a, role, team);
      const c = connect(a, 'orgA');
      const res = query(c);
      if (allowed) expect(res?.windowMin, name).toBe(15);
      else {
        expect(res, name).toBeUndefined();
        expect(c.errors('it_only')[0], name).toMatchObject({ message: IT_ONLY_MESSAGE });
      }
    }
  });

  it('visitante (guest) nunca recebe, mesmo marcado como TI; staff so em servico', () => {
    const g = account('Visita');
    member('orgA', g, 'guest', 'ti');
    const gc = connect(g, 'orgA', 'reception');
    expect(query(gc)).toBeUndefined();
    expect(gc.errors('forbidden').length + gc.errors('it_only').length).toBeGreaterThan(0);

    const s = account('Staffer');
    s.staff = 'admin';
    store.save(s);
    member('orgA', s, 'member', 'geral');
    const sc = connect(s, 'orgA');
    send(sc, { t: 'staff_duty', on: false });
    expect(query(sc)).toBeUndefined();
    send(sc, { t: 'staff_duty', on: true });
    expect(query(sc)?.scope).toBe('full');
  });

  it('escopo: TI recebe `org` (processo resumido); owner/admin recebem `full`', () => {
    const t = account('Tecnico');
    member('orgA', t, 'member', 'ti');
    const o = account('Chefe');
    member('orgA', o, 'owner', 'geral');
    const tc = connect(t, 'orgA');
    const oc = connect(o, 'orgA');
    wait(2000);
    const tv = query(tc)!;
    expect(tv.scope).toBe('org');
    expect(tv.server.detail).toBeUndefined();
    expect(query(oc)!.server.detail?.heapMb).toBeGreaterThan(0);
  });

  it('isolamento: a TI da orgA nunca ve gente ou salas da orgB', () => {
    const ta = account('TecnicoA');
    member('orgA', ta, 'member', 'ti');
    const bobs: FakeConn[] = [];
    for (let i = 0; i < 4; i++) {
      const b = account(`Bia${i}`);
      member('orgB', b, 'member', 'geral');
      bobs.push(connect(b, 'orgB', 'lounge'));
    }
    const tc = connect(ta, 'orgA', 'ti');
    wait(2500);
    const v = query(tc)!;
    expect(v.online.now).toBe(1);
    expect(v.rooms.find((r) => r.id === 'lounge')?.count).toBe(0);
    expect(v.rooms.reduce((n, r) => n + r.count, 0)).toBe(1);
  });

  it('o resultado traz dados reais: pessoas, ocupacao e clima da Sala da TI depois de alguns ciclos', () => {
    const ta = account('Tecnico');
    member('orgA', ta, 'member', 'ti');
    const tc = connect(ta, 'orgA', 'ti');
    for (let i = 0; i < 3; i++) {
      const o = account(`Colega${i}`);
      member('orgA', o, 'member', 'geral');
      connect(o, 'orgA', 'lounge');
    }
    wait(6000);
    const v = query(tc)!;
    expect(v.online.now).toBe(4);
    expect(v.online.values.length).toBeGreaterThanOrEqual(5);
    expect(v.rooms.find((r) => r.id === 'lounge')?.count).toBe(3);
    const ti = v.climate.find((c) => c.id === 'ti')!;
    expect(ti.it).toBe(true);
    expect(ti.on).toBe(true);
    expect(ti.temps.some((x) => typeof x === 'number')).toBe(true);
    expect(v.climate[0]!.id).toBe('ti');
    expect(v.stepMs).toBe(1000);
  });
});

describe('noc_query: validacao e taxa', () => {
  it('pedido malformado leva strike; limite de taxa responde rate_limited', () => {
    const ta = account('Tecnico');
    member('orgA', ta, 'member', 'ti');
    const c = connect(ta, 'orgA');
    for (const bad of [{ t: 'noc_query' }, { t: 'noc_query', window: 7 }, { t: 'noc_query', window: '15' }, { t: 'noc_query', window: 15, x: 1 }]) {
      const before = c.strikes;
      send(c, bad);
      expect(c.strikes, JSON.stringify(bad)).toBeGreaterThan(before);
    }
    c.inbox.length = 0;
    for (let i = 0; i < 30; i++) send(c, { t: 'noc_query', window: 60 });
    expect(c.errors('rate_limited').length).toBeGreaterThan(10);
    expect(c.inbox.filter((m) => m.t === 'noc_result').length).toBeLessThan(12);
  });
});

describe('mesa de comando de frente ao videowall', () => {
  const ti = ROOM_DEFS.find((r) => r.id === 'ti')!;
  const station = nocStation(ti.furniture)!;
  const other = ti.furniture.find((f) => f.kind === 'command_desk' && f.id !== station.id)!;

  it('TI abre o painel NOC (noc_open); as outras mesas de comando nao abrem nada', () => {
    const ta = account('Tecnico');
    member('orgA', ta, 'member', 'ti');
    const c = connect(ta, 'orgA', 'ti');
    send(c, { t: 'interact', furniId: other.id, x: other.x, y: other.y });
    wait(STEP_MS * 40);
    expect(c.last('noc_open')).toBeUndefined();
    send(c, { t: 'interact', furniId: station.id, x: station.x + 1, y: station.y });
    wait(STEP_MS * 40);
    expect(c.last('noc_open')).toBeTruthy();
    expect(c.last('inventory_open')).toBeUndefined();
  });

  it('quem nao e da TI ouve a recusa no chat e nada abre', () => {
    const m = account('Curioso');
    member('orgA', m, 'member', 'geral');
    const c = connect(m, 'orgA', 'ti');
    send(c, { t: 'interact', furniId: station.id, x: station.x + 1, y: station.y });
    wait(STEP_MS * 40);
    expect(c.last('noc_open')).toBeUndefined();
    expect(c.systemText()).toContain(IT_ONLY_MESSAGE);
  });
});
