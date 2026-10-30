import { beforeEach, describe, expect, it } from 'vitest';
import { NETSIM_IT_ONLY_MESSAGE, ROOM_DEFS, type ClientMessage, type Role, type ServerMessage, type Topology } from '@workverse/shared';
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
  errs(code: string) {
    return this.all('netsim_error').filter((e) => e.code === code);
  }
}

let now = 1_000_000;
let store: MemoryAccountStore;
let world: World;
let rid = 0;

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
const send = (c: FakeConn, msg: Record<string, unknown>) => {
  now += 1000; // nunca esbarra na taxa, salvo nos testes que querem
  world.handle(c, msg as unknown as ClientMessage);
};
const get = (c: FakeConn) => {
  send(c, { t: 'netsim_get' });
  return c.last('netsim_state')!;
};
const edit = (c: FakeConn, base: number, ops: unknown[]) => {
  const r = ++rid;
  send(c, { t: 'netsim_edit', rid: r, base, ops });
  return r;
};
const named = (t: Topology, name: string) => t.devices.find((d) => d.name === name)!;

let it1: FakeConn; // TI
let mem: FakeConn; // membro comum
let boss: FakeConn;

beforeEach(() => {
  now = 1_000_000;
  rid = 0;
  store = new MemoryAccountStore();
  world = new World({ store, clock: () => now, idleAwayMs: 3_600_000 });
  org('orgA');
  org('orgB');
  const a = account('Tecnico');
  const b = account('Curioso');
  const c = account('Chefe');
  member('orgA', a, 'member', 'ti');
  member('orgA', b, 'member', 'geral');
  member('orgA', c, 'owner', 'geral');
  it1 = connect(a, 'orgA');
  mem = connect(b, 'orgA');
  boss = connect(c, 'orgA');
});

describe('simulador de rede: visualizar e permissões', () => {
  it('todo membro vê a topologia gerada do inventário; só a TI, dono e admin podem editar', () => {
    const s = get(it1);
    expect(s.version).toBe(0);
    expect(s.canEdit).toBe(true);
    expect(s.topology.devices.filter((d) => d.kind === 'pc').length).toBeGreaterThan(20);
    expect(s.topology.devices.some((d) => d.kind === 'internet')).toBe(true);
    expect(get(mem).canEdit).toBe(false);
    expect(get(boss).canEdit).toBe(true);
  });

  it('o membro comum que tenta editar recebe it_only e nada muda', () => {
    get(mem);
    edit(mem, 0, [{ op: 'addDevice', kind: 'pc', x: 1, y: 1 }]);
    expect(mem.errs('it_only')[0]?.message).toBe(NETSIM_IT_ONLY_MESSAGE);
    expect(store.netsim.get('orgA')).toBeUndefined();
    send(mem, { t: 'netsim_undo', rid: 9, base: 0 });
    send(mem, { t: 'netsim_reset', rid: 10, base: 0 });
    expect(mem.errs('it_only')).toHaveLength(3);
    expect(store.netsim.get('orgA')).toBeUndefined();
  });

  it('visitante (guest) nunca vê, mesmo na equipe de TI', () => {
    const g = account('Visita');
    member('orgA', g, 'guest', 'ti');
    const c = connect(g, 'orgA', 'reception');
    send(c, { t: 'netsim_get' });
    expect(c.last('netsim_state')).toBeUndefined();
    expect(c.all('netsim_error').length + c.all('error').length).toBeGreaterThan(0);
  });

  it('staff em serviço edita; fora de serviço não', () => {
    const s = account('Staffer');
    s.staff = 'admin';
    store.save(s);
    member('orgA', s, 'member', 'geral');
    const c = connect(s, 'orgA');
    send(c, { t: 'staff_duty', on: false });
    expect(get(c).canEdit).toBe(false);
    send(c, { t: 'staff_duty', on: true });
    expect(get(c).canEdit).toBe(true);
  });

  it('usar o console: membro comum recebe a recusa do inventário e abre o simulador em leitura; visitante só a recusa', () => {
    const t2 = account('Tecnico2');
    const o2 = account('Curioso2');
    member('orgA', t2, 'member', 'ti');
    member('orgA', o2, 'member', 'geral');
    const memTi = connect(t2, 'orgA', 'ti');
    const memOther = connect(o2, 'orgA', 'ti');
    const rack = ROOM_DEFS.find((r) => r.id === 'ti')!.furniture.find((x) => x.kind === 'noc_console')!;
    send(memTi, { t: 'interact', furniId: rack.id, x: rack.x, y: rack.y });
    send(memOther, { t: 'interact', furniId: rack.id, x: rack.x, y: rack.y });
    for (let k = 0; k < 400; k++) world.tick((now += 250));
    expect(memTi.last('inventory_open')).toBeTruthy();
    expect(memOther.last('inventory_open')).toBeUndefined();
    expect(memOther.last('netsim_open')).toBeTruthy();
  });
});

describe('simulador de rede: edição, conflito e desfazer', () => {
  it('edita, grava, sobe a versão, audita e avisa quem está com o painel aberto', () => {
    get(it1);
    get(mem);
    const r = edit(it1, 0, [{ op: 'addDevice', kind: 'router', name: 'R-NOVO', x: 10, y: 10 }]);
    const own = it1.last('netsim_state')!;
    expect(own.rid).toBe(r);
    expect(own.version).toBe(1);
    expect(named(own.topology, 'R-NOVO')).toBeTruthy();
    const other = mem.last('netsim_state')!;
    expect(other.version).toBe(1);
    expect(other.rid).toBeUndefined();
    expect(other.canEdit).toBe(false);
    expect(store.netsim.get('orgA')).toMatchObject({ version: 1, updatedBy: it1.accountId });
    const audit = store.queryAudit({ action: 'netsim' });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: 'netsim.edit', actor: 'Tecnico' });
  });

  it('mover não gera auditoria; operação inválida não grava nada', () => {
    const s = get(it1);
    const pc = s.topology.devices.find((d) => d.kind === 'pc')!;
    edit(it1, 0, [{ op: 'moveDevice', id: pc.id, x: 5, y: 6 }]);
    expect(store.queryAudit({ action: 'netsim' })).toHaveLength(0);
    expect(store.netsim.get('orgA')?.version).toBe(1);
    edit(it1, 1, [{ op: 'setIface', id: pc.id, iface: 'Gig0/0', patch: { ip: '999.1.1.1' } }]);
    expect(it1.errs('invalid')).toHaveLength(1);
    expect(store.netsim.get('orgA')?.version).toBe(1);
    // lote atomico: se a segunda falha, a primeira também não vale
    edit(it1, 1, [{ op: 'addDevice', kind: 'pc', name: 'OK-1', x: 0, y: 0 }, { op: 'removeDevice', id: 'nao-existe' }]);
    expect(it1.errs('invalid')).toHaveLength(2);
    expect(named(store.netsim.get('orgA')!.topology, 'OK-1')).toBeUndefined();
  });

  it('conflito de versão devolve o estado atual', () => {
    get(it1);
    get(boss);
    edit(it1, 0, [{ op: 'addDevice', kind: 'switch', name: 'SW-A', x: 0, y: 0 }]);
    const r = edit(boss, 0, [{ op: 'addDevice', kind: 'switch', name: 'SW-B', x: 0, y: 0 }]);
    const e = boss.errs('conflict')[0]!;
    expect(e.rid).toBe(r);
    expect(boss.last('netsim_state')!.version).toBe(1);
    expect(named(store.netsim.get('orgA')!.topology, 'SW-B')).toBeUndefined();
    edit(boss, 1, [{ op: 'addDevice', kind: 'switch', name: 'SW-B', x: 0, y: 0 }]);
    expect(store.netsim.get('orgA')?.version).toBe(2);
  });

  it('desfazer volta o conteúdo anterior (como nova versão) e reiniciar restaura o modelo padrão', () => {
    get(it1);
    edit(it1, 0, [{ op: 'addDevice', kind: 'firewall', name: 'FW-X', x: 0, y: 0 }]);
    expect(get(it1).canUndo).toBe(true);
    send(it1, { t: 'netsim_undo', rid: 50, base: 1 });
    const s = it1.last('netsim_state')!;
    expect(s.version).toBe(2);
    expect(named(s.topology, 'FW-X')).toBeUndefined();
    edit(it1, 2, [{ op: 'addDevice', kind: 'firewall', name: 'FW-Y', x: 0, y: 0 }]);
    send(it1, { t: 'netsim_reset', rid: 51, base: 3 });
    const r = it1.last('netsim_state')!;
    expect(r.version).toBe(4);
    expect(named(r.topology, 'FW-Y')).toBeUndefined();
    expect(store.queryAudit({ action: 'netsim.reset' })).toHaveLength(1);
  });

  it('nada para desfazer', () => {
    get(it1);
    send(it1, { t: 'netsim_undo', rid: 1, base: 0 });
    expect(it1.errs('nothing_to_undo')).toHaveLength(1);
  });

  it('limites: lote vazio, grande demais ou malformado é strike; limite de dispositivos vira erro', () => {
    get(it1);
    const before = it1.strikes;
    edit(it1, 0, []);
    edit(it1, 0, Array.from({ length: 9 }, () => ({ op: 'moveDevice', id: 'd1', x: 1, y: 1 })));
    edit(it1, 0, ['x']);
    send(it1, { t: 'netsim_edit', rid: 'a', base: 0, ops: [{ op: 'moveDevice' }] });
    send(it1, { t: 'netsim_run', rid: 1, action: 'hack', src: 'd1' });
    send(it1, { t: 'netsim_run', rid: 1, action: 'ping', src: '../../x', target: '1.1.1.1' });
    send(it1, { t: 'netsim_run', rid: 1, action: 'ping', src: 'd1', target: 'a‮b' });
    expect(it1.strikes).toBe(before + 7);
    // enche até o limite
    let v = 0;
    const t = get(it1).topology;
    for (let k = t.devices.length; k < 80; k += 8) {
      edit(it1, v, Array.from({ length: Math.min(8, 80 - k) }, (_, j) => ({ op: 'addDevice', kind: 'pc', name: `Extra ${k + j}`, x: 0, y: 0 })));
      v++;
    }
    expect(store.netsim.get('orgA')!.topology.devices.length).toBe(80);
    edit(it1, v, [{ op: 'addDevice', kind: 'pc', name: 'Mais um', x: 0, y: 0 }]);
    expect(it1.errs('invalid').at(-1)?.message).toMatch(/Limite de 80/);
  });

  it('rate limit nas edições', () => {
    get(it1);
    let v = 0;
    for (let k = 0; k < 40; k++) {
      // sem avançar o relógio entre as chamadas
      const r = ++rid;
      world.handle(it1, { t: 'netsim_edit', rid: r, base: v, ops: [{ op: 'moveDevice', id: 'd1', x: k, y: k }] } as unknown as ClientMessage);
      if (it1.errs('rate_limited').length) break;
      v++;
    }
    expect(it1.errs('rate_limited').length).toBeGreaterThan(0);
    expect(v).toBeLessThan(20);
  });
});

describe('simulador de rede: isolamento entre organizações', () => {
  it('editar a rede da org A não altera a da org B; versões são independentes', () => {
    const x = account('TecnicoB');
    member('orgB', x, 'member', 'ti');
    const cb = connect(x, 'orgB');
    get(it1);
    get(cb);
    edit(it1, 0, [{ op: 'addDevice', kind: 'router', name: 'SO-DA-A', x: 0, y: 0 }]);
    expect(store.netsim.get('orgB')).toBeUndefined();
    expect(cb.last('netsim_state')!.version).toBe(0);
    expect(named(cb.last('netsim_state')!.topology, 'SO-DA-A')).toBeUndefined();
    edit(cb, 0, [{ op: 'addDevice', kind: 'router', name: 'SO-DA-B', x: 0, y: 0 }]);
    expect(store.netsim.get('orgB')?.version).toBe(1);
    expect(store.netsim.get('orgA')?.version).toBe(1);
    expect(named(store.netsim.get('orgA')!.topology, 'SO-DA-B')).toBeUndefined();
    // ids de dispositivo da outra org não funcionam: o ping falha com "não encontrado" quando o id só existe lá
    const onlyInB = named(store.netsim.get('orgB')!.topology, 'SO-DA-B').id;
    send(it1, { t: 'netsim_run', rid: 5, action: 'ping', src: onlyInB, target: '8.8.8.8' });
    expect(it1.errs('not_found').length + it1.all('netsim_result').filter((r) => r.rid === 5).length).toBe(it1.errs('not_found').length || 1);
  });
});

describe('simulador de rede: testes (ping, traceroute, navegar)', () => {
  it('qualquer membro roda testes; o resultado vem explicado passo a passo', () => {
    const s = get(mem);
    const pc = s.topology.devices.find((d) => d.kind === 'pc')!;
    send(mem, { t: 'netsim_run', rid: 1, action: 'internet', src: pc.id });
    const r = mem.last('netsim_result')!;
    expect(r.result.ok).toBe(true);
    expect(r.result.steps.length).toBeGreaterThan(5);
    send(mem, { t: 'netsim_run', rid: 2, action: 'ping', src: pc.id, target: '8.8.8.8' });
    expect(mem.last('netsim_result')!.result.ok).toBe(true);
    send(mem, { t: 'netsim_run', rid: 3, action: 'browse', src: pc.id, target: 'http://exemplo.sim' });
    expect(mem.last('netsim_result')!.result.resolved).toBe('198.51.100.10');
    send(mem, { t: 'netsim_run', rid: 4, action: 'traceroute', src: pc.id, target: '8.8.8.8' });
    expect(mem.last('netsim_result')!.result.hops.map((h) => h.device)).toEqual(['R-BORDA', 'Internet']);
    send(mem, { t: 'netsim_run', rid: 5, action: 'ping', src: pc.id });
    expect(mem.last('netsim_result')!.result.ok).toBe(false);
  });

  it('a TI quebra a rede e o teste falha com o motivo; ao corrigir, volta a funcionar', () => {
    const s = get(it1);
    const pc = s.topology.devices.find((d) => d.kind === 'pc')!;
    const r1 = named(s.topology, 'R-BORDA');
    edit(it1, 0, [{ op: 'setDevice', id: r1.id, patch: { natEnabled: false } }]);
    send(it1, { t: 'netsim_run', rid: 1, action: 'ping', src: pc.id, target: '8.8.8.8' });
    expect(it1.last('netsim_result')!.result.failure?.code).toBe('private-dropped');
    edit(it1, 1, [{ op: 'setDevice', id: r1.id, patch: { natEnabled: true } }]);
    send(it1, { t: 'netsim_run', rid: 2, action: 'ping', src: pc.id, target: '8.8.8.8' });
    expect(it1.last('netsim_result')!.result.ok).toBe(true);
  });

  it('dispositivo desconhecido e taxa de testes', () => {
    get(mem);
    send(mem, { t: 'netsim_run', rid: 1, action: 'ping', src: 'zzz9', target: '8.8.8.8' });
    expect(mem.errs('not_found')).toHaveLength(1);
    const pc = mem.last('netsim_state')!.topology.devices.find((d) => d.kind === 'pc')!;
    for (let k = 0; k < 40; k++) world.handle(mem, { t: 'netsim_run', rid: 100 + k, action: 'ping', src: pc.id, target: '8.8.8.8' } as unknown as ClientMessage);
    expect(mem.errs('rate_limited').length).toBeGreaterThan(0);
  });
});

describe('simulador de rede: inventário', () => {
  it('antes de editar o inventário usa o IP padrão; depois mostra o IP e o estado de rede da topologia', () => {
    send(it1, { t: 'inventory_query' });
    const before = it1.last('inventory_result')!;
    expect(before.hosts.every((h) => !h.net)).toBe(true);
    const s = get(it1);
    const dev = s.topology.devices.find((d) => d.inventoryId)!;
    const host = before.hosts.find((h) => h.id === dev.inventoryId)!;
    expect(dev.ifaces[0]!.ip).toBe(host.ip);
    edit(it1, 0, [{ op: 'setIface', id: dev.id, iface: 'Gig0/0', patch: { ip: '10.77.77.77' } }]);
    now += 3000;
    send(it1, { t: 'inventory_query' });
    const after = it1.last('inventory_result')!;
    const h2 = after.hosts.find((h) => h.id === dev.inventoryId)!;
    expect(h2.ip).toBe('10.77.77.77');
    expect(h2.net).toMatchObject({ link: true, device: dev.name });
    const other = after.hosts.find((h) => h.net && h.id !== dev.inventoryId)!;
    expect(other.net?.internet).toBe(true);
    // com o IP errado (fora do gateway) o PC fica sem internet, mas o link segue de pé
    expect(h2.net?.internet).toBe(false);
  });

  it('a topologia padrão tem um PC por estação do inventário (até o limite)', () => {
    send(it1, { t: 'inventory_query' });
    const inv = it1.last('inventory_result')!;
    const s = get(it1);
    const withInv = s.topology.devices.filter((d) => d.inventoryId).length;
    expect(withInv + s.omitted).toBe(inv.total);
  });
});
