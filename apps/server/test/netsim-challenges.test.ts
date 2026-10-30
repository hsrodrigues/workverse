import { beforeEach, describe, expect, it } from 'vitest';
import { CHALLENGES, evaluateObjectives, getChallenge, type ClientMessage, type NetOp, type Role, type ServerMessage } from '@workverse/shared';
import { SOLUTIONS } from '../../../packages/shared/src/netsim/challengeSolutions';
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
const call = (c: FakeConn, msg: Record<string, unknown>) => {
  const r = ++rid;
  send(c, { ...msg, rid: r });
  return r;
};
const session = (c: FakeConn) => c.last('netsim_challenge_session')!.session;
const start = (c: FakeConn, id: string) => {
  call(c, { t: 'netsim_challenge_start', id });
  return session(c);
};
const solve = (c: FakeConn, id: string) => {
  const s = session(c);
  const ops = SOLUTIONS[id]!(s.topology) as NetOp[];
  call(c, { t: 'netsim_challenge_edit', base: s.version, ops });
};
const check = (c: FakeConn) => {
  call(c, { t: 'netsim_challenge_check' });
  return c.last('netsim_challenge_result')!;
};
const list = (c: FakeConn) => {
  send(c, { t: 'netsim_challenges' });
  return c.last('netsim_challenges_state')!;
};

let ti: FakeConn;
let mem: FakeConn;
let outro: FakeConn;

beforeEach(() => {
  now = 1_000_000;
  rid = 0;
  store = new MemoryAccountStore();
  world = new World({ store, clock: () => now, idleAwayMs: 3_600_000 });
  org('orgA');
  org('orgB');
  const a = account('Tecnico');
  const b = account('Curioso');
  const c = account('Forasteiro');
  member('orgA', a, 'member', 'ti');
  member('orgA', b, 'member', 'geral');
  member('orgB', c, 'member', 'ti');
  ti = connect(a, 'orgA');
  mem = connect(b, 'orgA');
  outro = connect(c, 'orgB');
});

describe('desafios de rede: lista e permissões', () => {
  it('qualquer membro lista os desafios (progresso vazio); visitante é barrado', () => {
    const s = list(mem);
    expect(s.progress).toEqual([]);
    expect(s.board).toEqual([]);
    expect(s.activeId).toBeNull();
    const g = account('Visita');
    member('orgA', g, 'guest', 'ti');
    const c = connect(g, 'orgA', 'reception');
    send(c, { t: 'netsim_challenges' });
    send(c, { t: 'netsim_challenge_start', rid: 1, id: 'gateway-errado' });
    expect(c.last('netsim_challenges_state')).toBeUndefined();
    expect(c.last('netsim_challenge_session')).toBeUndefined();
  });

  it('mensagens malformadas viram strike e nada é criado', () => {
    const before = mem.strikes;
    const bad = [
      { t: 'netsim_challenge_start', rid: 'x', id: 'gateway-errado' },
      { t: 'netsim_challenge_start', rid: 1, id: 'GATEWAY' },
      { t: 'netsim_challenge_start', rid: 1, id: { a: 1 } },
      { t: 'netsim_challenge_edit', rid: 1, base: 0, ops: [] },
      { t: 'netsim_challenge_edit', rid: 1, base: -1, ops: [{ op: 'moveDevice' }] },
      { t: 'netsim_challenge_edit', rid: 1, base: 0, ops: [1] },
      { t: 'netsim_challenge_check', rid: 1.5 },
      { t: 'netsim_challenge_hint' },
    ];
    for (const m of bad) send(mem, m);
    expect(mem.strikes - before).toBe(bad.length);
    expect(mem.all('netsim_challenge_session')).toHaveLength(0);
    expect(store.netsim.progressOfOrg('orgA')).toEqual([]);
  });

  it('desafio desconhecido e ações sem sessão', () => {
    call(mem, { t: 'netsim_challenge_start', id: 'nao-existe' });
    expect(mem.errs('not_found')).toHaveLength(1);
    call(mem, { t: 'netsim_challenge_check' });
    call(mem, { t: 'netsim_challenge_hint' });
    call(mem, { t: 'netsim_challenge_edit', base: 1, ops: [{ op: 'moveDevice', id: 'd1', x: 1, y: 1 }] });
    expect(mem.errs('no_session')).toHaveLength(3);
  });
});

describe('desafios de rede: sandbox', () => {
  it('começa em uma cópia: a rede real da organização não é lida nem alterada; qualquer membro edita o sandbox', () => {
    const s = start(mem, 'gateway-errado');
    expect(s.id).toBe('gateway-errado');
    expect(s.version).toBe(1);
    expect(s.hints).toEqual([]);
    expect(s.nextHintCost).toBe(5);
    expect(s.topology).toEqual(getChallenge('gateway-errado')!.build());
    const pc = s.topology.devices.find((d) => d.name === 'PC-FIN-01')!;
    call(mem, { t: 'netsim_challenge_edit', base: 1, ops: [{ op: 'setDevice', id: pc.id, patch: { gateway: '192.168.1.1' } }] });
    expect(session(mem).version).toBe(2);
    expect(session(mem).topology.devices.find((d) => d.name === 'PC-FIN-01')!.gateway).toBe('192.168.1.1');
    // nada na rede real
    expect(store.netsim.get('orgA')).toBeUndefined();
    send(ti, { t: 'netsim_get' });
    const real = ti.last('netsim_state')!;
    expect(real.version).toBe(0);
    expect(real.topology.devices.some((d) => d.name === 'PC-FIN-01')).toBe(false);
    // o sandbox de outra pessoa é independente
    expect(start(ti, 'gateway-errado').topology.devices.find((d) => d.name === 'PC-FIN-01')!.gateway).toBe('192.168.1.254');
    expect(session(mem).version).toBe(2);
  });

  it('versão antiga dá conflito e devolve o estado; operação inválida não grava; limite de operações', () => {
    const s = start(mem, 'rota-padrao');
    const r1 = s.topology.devices.find((d) => d.name === 'R1')!;
    call(mem, { t: 'netsim_challenge_edit', base: 0, ops: [{ op: 'moveDevice', id: r1.id, x: 5, y: 5 }] });
    expect(mem.errs('conflict')).toHaveLength(1);
    expect(session(mem).version).toBe(1);
    call(mem, { t: 'netsim_challenge_edit', base: 1, ops: [{ op: 'addRoute', id: r1.id, route: { net: 'x', mask: 'y', via: 'z' } }] });
    expect(mem.errs('invalid')).toHaveLength(1);
    expect(session(mem).version).toBe(1);
    const before = mem.strikes;
    send(mem, { t: 'netsim_challenge_edit', rid: 99, base: 1, ops: Array.from({ length: 9 }, () => ({ op: 'moveDevice', id: r1.id, x: 1, y: 1 })) });
    expect(mem.strikes).toBe(before + 1);
  });

  it('rate limit nas edições do sandbox', () => {
    const s = start(mem, 'rota-padrao');
    const r1 = s.topology.devices.find((d) => d.name === 'R1')!;
    let v = 1;
    for (let k = 0; k < 40 && !mem.errs('rate_limited').length; k++) {
      world.handle(mem, { t: 'netsim_challenge_edit', rid: ++rid, base: v, ops: [{ op: 'moveDevice', id: r1.id, x: k, y: k }] } as unknown as ClientMessage);
      v++;
    }
    expect(mem.errs('rate_limited').length).toBeGreaterThan(0);
    expect(v).toBeLessThan(20);
  });

  it('continuar devolve o mesmo sandbox (com as edições) sem recomeçar nem contar tentativa', () => {
    const s = start(mem, 'rota-padrao');
    const r1 = s.topology.devices.find((d) => d.name === 'R1')!;
    call(mem, { t: 'netsim_challenge_edit', base: 1, ops: [{ op: 'moveDevice', id: r1.id, x: 7, y: 7 }] });
    call(mem, { t: 'netsim_challenge_start', id: 'rota-padrao', resume: true });
    expect(session(mem).version).toBe(2);
    expect(store.netsim.getProgress('orgA', mem.accountId!, 'rota-padrao')!.attempts).toBe(1);
    call(mem, { t: 'netsim_challenge_start', id: 'rota-padrao' });
    expect(session(mem).version).toBe(1);
    expect(store.netsim.getProgress('orgA', mem.accountId!, 'rota-padrao')!.attempts).toBe(2);
    const before = mem.strikes;
    send(mem, { t: 'netsim_challenge_start', rid: 1, id: 'rota-padrao', resume: 'sim' });
    expect(mem.strikes).toBe(before + 1);
  });

  it('desistir apaga o sandbox', () => {
    start(mem, 'rota-padrao');
    expect(list(mem).activeId).toBe('rota-padrao');
    call(mem, { t: 'netsim_challenge_quit' });
    expect(mem.last('netsim_challenges_state')!.activeId).toBeNull();
    call(mem, { t: 'netsim_challenge_check' });
    expect(mem.errs('no_session')).toHaveLength(1);
  });
});

describe('desafios de rede: verificar, pontuar e salvar', () => {
  it('verificação errada conta; resolver grava progresso, auditoria e placar; o sandbox fecha', () => {
    start(mem, 'gateway-errado');
    const bad = check(mem);
    expect(bad.solved).toBe(false);
    expect(bad.results.some((r) => !r.ok)).toBe(true);
    expect(session(mem).failedChecks).toBe(1);
    solve(mem, 'gateway-errado');
    const ok = check(mem);
    expect(ok.solved).toBe(true);
    expect(ok.breakdown).toMatchObject({ base: 40, failPenalty: 2, hintPenalty: 0, timeBonus: 20, score: 58 });
    expect(ok.newBest).toBe(true);
    expect(ok.best).toBe(58);
    expect(session(mem).solved).toBe(true);
    const row = store.netsim.getProgress('orgA', mem.accountId!, 'gateway-errado')!;
    expect(row).toMatchObject({ best: 58, attempts: 1, hints: 0 });
    expect(row.solvedAt).not.toBeNull();
    expect(store.queryAudit({ action: 'netsim.challenge' })).toHaveLength(1);
    // depois de resolver o sandbox é só consulta
    call(mem, { t: 'netsim_challenge_check' });
    call(mem, { t: 'netsim_challenge_hint' });
    call(mem, { t: 'netsim_challenge_edit', base: 99, ops: [{ op: 'moveDevice', id: 'd1', x: 1, y: 1 }] });
    expect(mem.errs('invalid').length).toBe(3);
    const l = list(mem);
    expect(l.progress).toEqual([{ id: 'gateway-errado', best: 58, attempts: 1, solved: true, hints: 0 }]);
    expect(l.totalPoints).toBe(58);
    expect(l.board).toEqual([{ rank: 1, name: 'Curioso', solved: 1, points: 58, me: true }]);
  });

  it('dicas são progressivas, custam pontos e acabam em 3; a melhor pontuação nunca piora ao repetir', () => {
    const s0 = start(mem, 'vlan-trocada');
    expect(s0.nextHintCost).toBe(5);
    const ch = getChallenge('vlan-trocada')!;
    for (let k = 1; k <= 3; k++) {
      call(mem, { t: 'netsim_challenge_hint' });
      expect(session(mem).hints).toEqual(ch.hints.slice(0, k));
    }
    expect(session(mem).nextHintCost).toBeNull();
    call(mem, { t: 'netsim_challenge_hint' });
    expect(mem.errs('invalid')).toHaveLength(1);
    solve(mem, 'vlan-trocada');
    const first = check(mem);
    expect(first.breakdown).toMatchObject({ hintPenalty: 30, timeBonus: 20, score: 50 });
    expect(store.netsim.getProgress('orgA', mem.accountId!, 'vlan-trocada')!.hints).toBe(3);
    // repete sem dicas: melhora
    start(mem, 'vlan-trocada');
    solve(mem, 'vlan-trocada');
    const second = check(mem);
    expect(second.breakdown!.score).toBe(80);
    expect(second.newBest).toBe(true);
    expect(store.netsim.getProgress('orgA', mem.accountId!, 'vlan-trocada')).toMatchObject({ best: 80, hints: 0, attempts: 2 });
    // repete lento e com dica: não piora
    start(mem, 'vlan-trocada');
    call(mem, { t: 'netsim_challenge_hint' });
    solve(mem, 'vlan-trocada');
    now += 3_000_000;
    const third = check(mem);
    expect(third.breakdown!.score).toBeLessThan(80);
    expect(third.newBest).toBe(false);
    expect(third.best).toBe(80);
    expect(store.netsim.getProgress('orgA', mem.accountId!, 'vlan-trocada')).toMatchObject({ best: 80, hints: 0, attempts: 3 });
  });

  it('o servidor decide: sem consertar, a verificação não resolve nada', () => {
    start(mem, 'acl-financeiro');
    const r = check(mem);
    expect(r.solved).toBe(false);
    expect(store.netsim.getProgress('orgA', mem.accountId!, 'acl-financeiro')).toMatchObject({ best: 0, solvedAt: null });
  });

  it('todos os desafios do catálogo são resolvíveis de ponta a ponta pelo servidor', () => {
    for (const c of CHALLENGES) {
      now += 10_000_000; // esvazia os baldes de taxa
      start(mem, c.id);
      expect(check(mem).solved, `${c.id} ja resolvido`).toBe(false);
      now += 10_000_000;
      solve(mem, c.id);
      const ok = check(mem);
      expect(ok.solved, c.id).toBe(true);
      expect(evaluateObjectives(session(mem).topology, c).every((x) => x.ok)).toBe(true);
    }
    expect(list(mem).progress).toHaveLength(CHALLENGES.length);
  });
});

describe('desafios de rede: placar da organização', () => {
  it('ordena por pontos, mostra só nomes, isola organizações e não mostra quem saiu', () => {
    start(ti, 'gateway-errado');
    solve(ti, 'gateway-errado');
    check(ti);
    start(mem, 'gateway-errado');
    call(mem, { t: 'netsim_challenge_hint' });
    solve(mem, 'gateway-errado');
    check(mem);
    start(mem, 'mascara-errada');
    solve(mem, 'mascara-errada');
    check(mem);
    start(outro, 'gateway-errado');
    solve(outro, 'gateway-errado');
    check(outro);
    const b = list(ti).board;
    expect(b.map((r) => r.name)).toEqual(['Curioso', 'Tecnico']);
    expect(b[0]).toMatchObject({ rank: 1, solved: 2, me: false });
    expect(b[1]).toMatchObject({ rank: 2, solved: 1, me: true });
    expect(Object.keys(b[0]!).sort()).toEqual(['me', 'name', 'points', 'rank', 'solved']);
    expect(list(outro).board.map((r) => r.name)).toEqual(['Forasteiro']);
    store.orgs.deleteMember('orgA', mem.accountId!);
    expect(list(ti).board.map((r) => r.name)).toEqual(['Tecnico']);
  });
});
