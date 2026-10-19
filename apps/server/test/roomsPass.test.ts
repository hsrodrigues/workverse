import { beforeEach, describe, expect, it } from 'vitest';
import type { ClientMessage, Role, RoomAccess, ServerMessage } from '@workverse/shared';
import { createApp } from '../src/app';
import { canUse } from '../src/wardrobe';
import { FURNI_KINDS, ROOM_DEFS, WORKSTATION_KINDS, footprintTiles, getItem } from '@workverse/shared';
import { World, type Connection } from '../src/world';
import { MemoryAccountStore, type Account } from '../src/store';

/**
 * "Equipes que passam mesmo com a sala trancada": a Sala da TI deixa a equipe chamada "TI" entrar quando o acesso e restrito
 * ou quando a staff tranca a sala. Role x equipe x acesso, isolamento entre organizacoes, expulsao, lista de salas e midia.
 */
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
  get room() {
    return this.player?.roomId ?? null;
  }
}

let now = 1_000_000;
let store: MemoryAccountStore;
let world: World;
let rid = 0;

function account(name: string): Account {
  const a = store.create({ email: `${name.toLowerCase()}@x.com`, displayName: name, passwordHash: 'scrypt$x' });
  a.orgsInit = true;
  store.save(a);
  return a;
}

function org(id: string, tiName = 'TI') {
  store.orgs.putOrg({ id, slug: id.toLowerCase(), name: `Org ${id}`, settings: {}, createdAt: 0 });
  store.orgs.putTeam({ id: `${id}-ti`, orgId: id, name: tiName, color: '#ff0000' });
  store.orgs.putTeam({ id: `${id}-alfa`, orgId: id, name: 'Alfa', color: '#00ff00' });
}

function member(orgId: string, acc: Account, role: Role, team: 'ti' | 'alfa' | null = null) {
  store.orgs.putMember({ orgId, accountId: acc.id, role, teamId: team ? `${orgId}-${team}` : null, status: 'active', createdAt: 0 });
}

function connect(acc: Account, orgId: string, roomId?: string): FakeConn {
  const c = new FakeConn();
  c.accountId = acc.id;
  world.handle(c, { t: 'hello', orgId });
  world.handle(c, { t: 'join', roomId });
  return c;
}

const send = (c: FakeConn, msg: Record<string, unknown>) => world.handle(c, msg as unknown as ClientMessage);
const setAccess = (c: FakeConn, roomId: string, access: RoomAccess, extra: Record<string, unknown> = {}) => send(c, { t: 'room_access_set', rid: ++rid, roomId, access, ...extra });

function boss(orgId = 'orgA') {
  const b = account(`Chefe${orgId}`);
  member(orgId, b, 'owner');
  return connect(b, orgId, 'reception');
}

beforeEach(() => {
  now = 1_000_000;
  rid = 0;
  store = new MemoryAccountStore();
  world = new World({ store, clock: () => now });
  org('orgA');
  org('orgB');
});

describe('Sala da TI: a equipe TI passa mesmo trancada (papel x equipe x acesso)', () => {
  const cases: Array<{ access: RoomAccess; role: Role; team: 'ti' | 'alfa' | null; expected: boolean }> = [];
  for (const access of ['org', 'team', 'invited', 'private'] as const) {
    for (const [role, team] of [
      ['owner', null],
      ['admin', 'alfa'],
      ['member', 'ti'],
      ['member', 'alfa'],
      ['member', null],
      ['guest', 'ti'], // a Sala da TI nao admite visitantes: a regra da equipe nunca vence a do visitante
    ] as const) {
      const bossRole = role === 'owner' || role === 'admin';
      // `team` restringe a Alfa; a TI passa mesmo assim
      const expected = access === 'org' ? role !== 'guest' : bossRole || (role === 'member' && team === 'ti') || (access === 'team' && role === 'member' && team === 'alfa');
      cases.push({ access, role, team, expected });
    }
  }
  it.each(cases)('$access, $role/$team -> $expected', ({ access, role, team, expected }) => {
    const b = boss();
    setAccess(b, 'ti', access, access === 'team' ? { teamId: 'orgA-alfa' } : {});
    expect(b.last('room_access_result')?.ok).toBe(true);
    const p = account('Pessoa');
    member('orgA', p, role, team);
    const c = connect(p, 'orgA', 'reception');
    send(c, { t: 'join', roomId: 'ti' });
    expect(c.room === 'ti').toBe(expected);
    if (!expected) expect(c.room).toBe('reception');
    // o navegador de salas e a mesma decisao
    const entry = world.roomListFor(c.player!).find((r) => r.id === 'ti')!;
    expect(entry.locked).toBe(!expected);
    expect(entry.population === undefined).toBe(!expected);
  });

  it('casa o nome da equipe sem acento nem caixa, e so o nome exato', () => {
    let n = 0;
    for (const [name, ok] of [['ti', true], [' Ti ', true], ['Tecnologia da Informação', true], ['TIME', false], ['T.I.', false], ['Alfa', false]] as const) {
      const id = `org${++n}`;
      org(id, name);
      const bb = account(`Boss${id}`);
      member(id, bb, 'owner');
      const bc = connect(bb, id, 'reception');
      setAccess(bc, 'ti', 'invited');
      const p = account(`Pessoa${id}`);
      member(id, p, 'member', 'ti');
      const c = connect(p, id, 'reception');
      send(c, { t: 'join', roomId: 'ti' });
      expect(c.room === 'ti', name).toBe(ok);
    }
  });

  it('as outras salas nao tem equipe padrao: a TI nao passa numa sala por convite qualquer', () => {
    const b = boss();
    setAccess(b, 'meeting1', 'invited');
    const p = account('Tia');
    member('orgA', p, 'member', 'ti');
    const c = connect(p, 'orgA', 'reception');
    send(c, { t: 'join', roomId: 'meeting1' });
    expect(c.room).toBe('reception');
  });

  it('a organizacao escolhe outras equipes (inclusive nenhuma) e isso persiste', () => {
    const b = boss();
    setAccess(b, 'ti', 'invited', { passTeamIds: ['orgA-alfa'] });
    expect(b.last('room_access')).toMatchObject({ passTeamIds: ['orgA-alfa'], passIsDefault: false });
    const tia = account('Tia');
    member('orgA', tia, 'member', 'ti');
    const alf = account('Alf');
    member('orgA', alf, 'member', 'alfa');
    const t = connect(tia, 'orgA', 'reception');
    const a = connect(alf, 'orgA', 'reception');
    send(t, { t: 'join', roomId: 'ti' });
    send(a, { t: 'join', roomId: 'ti' });
    expect(t.room).toBe('reception');
    expect(a.room).toBe('ti');
    // mudar so o acesso mantem a lista escolhida; lista vazia = ninguem passa
    setAccess(b, 'ti', 'private');
    expect(world.roomConfig.passTeamIds('orgA', 'ti')).toEqual(['orgA-alfa']);
    setAccess(b, 'ti', 'private', { passTeamIds: [] });
    expect(a.room).toBe('reception');
    expect(world.roomConfig.passTeamIds('orgA', 'ti')).toEqual([]);
    expect(store.orgs.getRoomSetting('orgA', 'ti')?.passTeamIds).toEqual([]);
  });

  it('isolamento: equipe de outra organizacao e recusada, e a escolha de uma org nao toca a outra', () => {
    const b = boss('orgA');
    setAccess(b, 'ti', 'invited', { passTeamIds: ['orgB-ti'] });
    expect(b.last('room_access_result')).toMatchObject({ ok: false, code: 'bad_team' });
    expect(store.orgs.getRoomSetting('orgA', 'ti')).toBeUndefined();
    // um id de outra org gravado a mao (ex.: dado antigo) nunca conta
    store.orgs.putRoomSetting({ orgId: 'orgA', roomId: 'ti', access: 'invited', teamId: null, passTeamIds: ['orgB-ti'], updatedBy: '', updatedAt: 0 });
    expect(world.roomConfig.passTeamIds('orgA', 'ti')).toEqual([]);
    const bb = boss('orgB');
    setAccess(bb, 'ti', 'invited', { passTeamIds: ['orgB-alfa'] });
    expect(world.roomConfig.passTeamIds('orgB', 'ti')).toEqual(['orgB-alfa']);
    expect(world.roomConfig.passTeamIds('orgA', 'ti')).toEqual([]);
    // quem e TI da orgB nao entra na sala da orgA
    const p = account('Intruso');
    member('orgB', p, 'member', 'ti');
    expect(world.canEnter(connect(p, 'orgB', 'reception').player!, 'ti').allow).toBe(false);
  });

  it('trancar com gente de fora dentro tira os de fora e a TI fica; so quem administra consegue', () => {
    const b = boss();
    const tia = account('Tia');
    member('orgA', tia, 'member', 'ti');
    const alf = account('Alf');
    member('orgA', alf, 'member', 'alfa');
    const t = connect(tia, 'orgA', 'ti');
    const a = connect(alf, 'orgA', 'ti');
    expect(t.room).toBe('ti');
    expect(a.room).toBe('ti');
    // um membro comum nao muda o acesso
    setAccess(a, 'ti', 'invited');
    expect(a.errors('forbidden').length).toBeGreaterThan(0);
    expect(a.room).toBe('ti');
    setAccess(b, 'ti', 'invited');
    expect(a.room).toBe('reception');
    expect(a.errors('kicked_room')).toHaveLength(1);
    expect(t.room).toBe('ti');
    expect(t.errors('kicked_room')).toHaveLength(0);
  });

  it('trancada pela staff: so a TI (e a staff em servico) entra; fechada nao deixa ninguem', () => {
    const tia = account('Tia');
    member('orgA', tia, 'member', 'ti');
    const alf = account('Alf');
    member('orgA', alf, 'member', 'alfa');
    const t = connect(tia, 'orgA', 'ti');
    const a = connect(alf, 'orgA', 'ti');
    expect(world.roomControl('orgA', 'ti', 'lock')).toMatchObject({ ok: true, moved: 1 });
    expect(a.room).toBe('office');
    expect(t.room).toBe('ti');
    send(a, { t: 'join', roomId: 'ti' });
    expect(a.room).toBe('office');
    expect(a.errors('room_locked').length).toBeGreaterThan(0);
    // a TI sai e volta
    send(t, { t: 'join', roomId: 'reception' });
    send(t, { t: 'join', roomId: 'ti' });
    expect(t.room).toBe('ti');
    // fechada: nem a TI
    world.roomControl('orgA', 'ti', 'close');
    expect(t.room).toBe('office');
    send(t, { t: 'join', roomId: 'ti' });
    expect(t.room).toBe('office');
    // staff admin em servico continua passando
    world.roomControl('orgA', 'ti', 'unlock');
    world.roomControl('orgA', 'ti', 'lock');
    a.player!.staff = 'admin';
    a.player!.onDuty = true;
    expect(world.canEnter(a.player!, 'ti').allow).toBe(true);
    send(a, { t: 'join', roomId: 'ti' });
    expect(a.room).toBe('ti');
  });

  it('uma sala sem equipes que passam continua se comportando como antes quando e trancada pela staff', () => {
    const alf = account('Alf');
    member('orgA', alf, 'member', 'alfa');
    const a = connect(alf, 'orgA', 'lounge');
    expect(world.roomControl('orgA', 'lounge', 'lock')).toMatchObject({ ok: true, moved: 0 });
    expect(a.room).toBe('lounge');
  });
});

describe('Sala da TI: token de midia', () => {
  it('a equipe TI recebe o token de uma sala restrita; quem e de fora recebe forbidden_room', async () => {
    const st = new MemoryAccountStore();
    const { app, world: w } = await createApp({ store: st, allowDevLogin: true, tickMs: 1_000_000, clock: () => now });
    try {
      const mk = (name: string) => {
        const c = new FakeConn();
        w.handle(c, { t: 'hello', name });
        w.handle(c, { t: 'join', roomId: 'ti' });
        return c;
      };
      const tia = mk('Tia');
      const out = mk('Fora');
      expect(tia.room).toBe('ti');
      st.orgs.putTeam({ id: 'default-ti', orgId: 'default', name: 'TI', color: '#123456' });
      tia.player!.teamId = 'default-ti';
      const room = w.org('default').rooms.get('ti')!;
      room.built = { ...room.built, def: { ...room.built.def, access: 'invited' } };
      const token = (name: string) => app.inject({ method: 'POST', url: '/api/media/token', payload: { roomId: 'ti', devName: name } });
      expect((await token('Tia')).statusCode).toBe(200);
      const denied = await token('Fora');
      expect(denied.statusCode).toBe(403);
      expect(denied.json().error.code).toBe('forbidden_room');
      expect(out.player).toBeDefined();
    } finally {
      await app.close();
    }
  });
});

describe('uniforme da TI: desbloqueio por setor (dept:ti)', () => {
  it('libera so quem e membro ativo (nao visitante) da equipe TI, em qualquer organizacao, e mantem para quem ja veste', () => {
    const polo = getItem('ti.polo')!;
    const badge = getItem('ti.badge')!;
    const tia = account('Tia');
    member('orgA', tia, 'member', 'ti');
    const alf = account('Alf');
    member('orgA', alf, 'member', 'alfa');
    const gus = account('Gus');
    member('orgA', gus, 'guest', 'ti');
    const sem = account('Sem');
    connect(tia, 'orgA'); // garante o provedor ligado a este mundo
    expect(canUse(tia, polo)).toBe(true);
    expect(canUse(tia, badge)).toBe(true);
    expect(canUse(alf, polo)).toBe(false);
    expect(canUse(gus, polo)).toBe(false);
    expect(canUse(sem, polo)).toBe(false);
    // outra organizacao da mesma conta tambem vale
    member('orgB', alf, 'member', 'ti');
    expect(canUse(alf, polo)).toBe(true);
    // sair do setor tira a liberacao; quem ja veste mantem
    member('orgB', alf, 'member', null);
    expect(canUse(alf, polo)).toBe(false);
    alf.avatar = { ...alf.avatar, top: { id: 'ti.polo', color: 'navy' } };
    expect(canUse(alf, polo)).toBe(true);
  });
});

describe('Sala da TI: sentar numa estacao de PC = working (digitando)', () => {
  it('toda cadeira virada para um PC, mesa de comando ou bancada resulta em activity working, vista pelos outros', () => {
    const def = ROOM_DEFS.find((r) => r.id === 'ti')!;
    const at = (x: number, y: number) => def.furniture.filter((f) => footprintTiles(f).some((t) => t.x === x && t.y === y));
    const seats = def.furniture.filter((f) => FURNI_KINDS[f.kind].seat && WORKSTATION_KINDS.some((k) => at(f.x + [1, 0, -1, 0][f.dir % 4]!, f.y + [0, 1, 0, -1][f.dir % 4]!).some((g) => g.kind === k)));
    // 3 chairs at the command desk and the stool at the bench
    expect(seats.length).toBeGreaterThanOrEqual(4);
    for (const seat of seats) {
      const p = account(`Dig${seat.id}`);
      member('orgA', p, 'member');
      const c = connect(p, 'orgA', 'ti');
      const watcher = account(`Obs${seat.id}`);
      member('orgA', watcher, 'member');
      const w = connect(watcher, 'orgA', 'ti');
      send(c, { t: 'interact', furniId: seat.id, x: seat.x, y: seat.y });
      for (let i = 0; i < 40; i++) world.tick((now += 400));
      expect(c.player!.sitting, seat.id).toBe(true);
      expect(c.player!.activity, seat.id).toBe('working');
      expect(w.inbox.some((m) => m.t === 'activity' && m.id === c.player!.id && m.activity === 'working'), seat.id).toBe(true);
      send(c, { t: 'join', roomId: 'reception' });
    }
  });
});
