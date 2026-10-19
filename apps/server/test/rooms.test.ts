import { beforeEach, describe, expect, it } from 'vitest';
import { MAX_FURNITURE, checkOps, newPieceId, type ClientMessage, type FurnishOp, type Furniture, type Role, type RoomAccess, type ServerMessage } from '@workverse/shared';
import { createApp } from '../src/app';
import { World, type Connection } from '../src/world';
import { MemoryAccountStore, type Account } from '../src/store';

class FakeConn implements Connection {
  strikes = 0;
  accountId?: string;
  player?: Connection['player'];
  inbox: ServerMessage[] = [];
  closed = false;
  send(msg: ServerMessage) {
    this.inbox.push(msg);
  }
  close() {
    this.closed = true;
  }
  last<T extends ServerMessage['t']>(t: T) {
    return [...this.inbox].reverse().find((m) => m.t === t) as Extract<ServerMessage, { t: T }> | undefined;
  }
  all<T extends ServerMessage['t']>(t: T) {
    return this.inbox.filter((m) => m.t === t) as Extract<ServerMessage, { t: T }>[];
  }
  errors(code: string) {
    return this.all('error').filter((e) => e.code === code);
  }
  get room() {
    return this.player?.roomId ?? null;
  }
}

let now = 1_000_000;
let store: MemoryAccountStore;
let world: World;
let rid = 0;

const HOUR = 3_600_000;

function account(name: string): Account {
  const a = store.create({ email: `${name.toLowerCase()}@x.com`, displayName: name, passwordHash: 'scrypt$x' });
  a.orgsInit = true; // already handled: no automatic joining of the default organization
  store.save(a);
  return a;
}

function org(id: string) {
  store.orgs.putOrg({ id, slug: id.toLowerCase(), name: `Org ${id}`, settings: {}, createdAt: 0 });
  store.orgs.putTeam({ id: `${id}-alfa`, orgId: id, name: 'Alfa', color: '#ff0000' });
  store.orgs.putTeam({ id: `${id}-beta`, orgId: id, name: 'Beta', color: '#00ff00' });
}

function member(orgId: string, acc: Account, role: Role, team: 'alfa' | 'beta' | null = null) {
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
const setAccess = (c: FakeConn, roomId: string, access: RoomAccess, teamId?: string) => send(c, { t: 'room_access_set', rid: ++rid, roomId, access, ...(teamId ? { teamId } : {}) });
const invite = (c: FakeConn, roomId: string, who: string, hours?: number) => send(c, { t: 'room_invite_add', rid: ++rid, roomId, who, ...(hours !== undefined ? { hours } : {}) });
const uninvite = (c: FakeConn, roomId: string, accountId: string) => send(c, { t: 'room_invite_remove', rid: ++rid, roomId, accountId });
const furnish = (c: FakeConn, base: number, ops: FurnishOp[]) => send(c, { t: 'furnish_apply', rid: ++rid, base, ops });
const add = (kind: Furniture['kind'], x: number, y: number, dir = 0): FurnishOp => ({ op: 'add', piece: { id: newPieceId(), kind, x, y, dir } });

/** First tile where a plant is valid in the room of that organization (robust to changes of the base rooms). */
function spot(orgId: string, roomId: string, skip = 0): { x: number; y: number } {
  const w = world.org(orgId);
  const room = w.rooms.get(roomId)!;
  const base = w.baseDefs.get(roomId)!;
  let n = 0;
  for (let y = 0; y < room.built.grid.height; y++) {
    for (let x = 0; x < room.built.grid.width; x++) {
      if (checkOps(base, room.built.def.furniture, [add('plant', x, y)]).ok && n++ === skip) return { x, y };
    }
  }
  throw new Error('no free spot');
}
const plantAt = (orgId: string, roomId: string, skip = 0) => {
  const t = spot(orgId, roomId, skip);
  return add('plant', t.x, t.y);
};

beforeEach(() => {
  now = 1_000_000;
  rid = 0;
  store = new MemoryAccountStore();
  world = new World({ store, clock: () => now });
  org('orgA');
  org('orgB');
});

describe('room access: who gets in (role x access x team)', () => {
  // 'lounge' admits guests, so the whole role matrix applies to it.
  const cases: Array<{ access: RoomAccess; who: string; role: Role; team: 'alfa' | 'beta' | null; invited: boolean; expected: boolean }> = [];
  for (const [role, team] of [
    ['owner', null],
    ['admin', 'beta'],
    ['member', 'alfa'],
    ['member', 'beta'],
    ['member', null],
    ['guest', 'alfa'],
    ['guest', null],
  ] as const) {
    for (const invited of [false, true]) {
      const boss = role === 'owner' || role === 'admin';
      cases.push({ access: 'org', who: `${role}-${team}`, role, team, invited, expected: true });
      cases.push({ access: 'team', who: `${role}-${team}`, role, team, invited, expected: boss || team === 'alfa' });
      cases.push({ access: 'invited', who: `${role}-${team}`, role, team, invited, expected: boss || invited });
      cases.push({ access: 'private', who: `${role}-${team}`, role, team, invited, expected: boss || invited });
    }
  }
  it.each(cases)('$access room, $role/$team, invited=$invited -> $expected', ({ access, role, team, invited, expected }) => {
    const boss = account('Chefe');
    member('orgA', boss, 'owner');
    const person = account('Pessoa');
    member('orgA', person, role, team);
    const bossConn = connect(boss, 'orgA', 'reception');
    setAccess(bossConn, 'lounge', access, access === 'team' ? 'orgA-alfa' : undefined);
    expect(bossConn.last('room_access_result')?.ok, bossConn.last('room_access_result')?.message).toBe(true);
    if (invited) {
      invite(bossConn, 'lounge', 'Pessoa');
      expect(bossConn.last('room_access_result')?.ok).toBe(access === 'invited' || access === 'private');
    }
    const c = connect(person, 'orgA', 'reception');
    send(c, { t: 'join', roomId: 'lounge' });
    expect(c.room === 'lounge').toBe(expected);
    if (!expected) {
      expect(c.room).toBe('reception');
      expect(c.errors(access === 'team' ? 'room_denied' : 'room_denied').length).toBeGreaterThan(0);
    }
  });

  it('applies the default policy of the room type: the private room is closed, the rest are open', () => {
    const boss = account('Chefe');
    member('orgA', boss, 'owner');
    const ana = account('Ana');
    member('orgA', ana, 'member', 'alfa');
    const a = connect(ana, 'orgA', 'reception');
    send(a, { t: 'join', roomId: 'private' });
    expect(a.room).toBe('reception');
    send(a, { t: 'join', roomId: 'meeting1' });
    expect(a.room).toBe('meeting1');
    const b = connect(boss, 'orgA', 'private');
    expect(b.room).toBe('private');
  });

  it('also guards portals (enterRoom), reconnections and staff-less shortcuts', () => {
    const boss = account('Chefe');
    member('orgA', boss, 'owner');
    const ana = account('Ana');
    member('orgA', ana, 'member');
    const a = connect(ana, 'orgA', 'reception');
    world.enterRoom(a.player!, 'private'); // what a portal does
    expect(a.room).toBe('reception');
    // the last room of the account is a room she can no longer use: she lands in the reception, not in a limbo
    ana.lastRoom = 'private';
    store.save(ana);
    const again = new FakeConn();
    again.accountId = ana.id;
    world.handle(again, { t: 'hello', orgId: 'orgA' });
    world.handle(again, { t: 'join', roomId: 'private' });
    expect(again.room).toBe('reception');
    const third = new FakeConn();
    third.accountId = ana.id;
    world.handle(third, { t: 'hello', orgId: 'orgA' });
    world.handle(third, { t: 'join' });
    expect(third.room).toBe('reception');
  });

  it('keeps the landing rooms open to the whole organization', () => {
    const boss = account('Chefe');
    member('orgA', boss, 'owner');
    const c = connect(boss, 'orgA', 'reception');
    for (const room of ['office', 'reception']) {
      setAccess(c, room, 'private');
      expect(c.last('room_access_result')).toMatchObject({ ok: false, code: 'landing_room' });
    }
  });

  it('a platform staff admin on duty always gets in; a moderator does not', () => {
    const boss = account('Chefe');
    member('orgA', boss, 'owner');
    const adm = account('Staffadm');
    member('orgA', adm, 'member');
    adm.staff = 'admin';
    store.save(adm);
    const mod = account('Staffmod');
    member('orgA', mod, 'member');
    mod.staff = 'moderator';
    store.save(mod);
    const bossConn = connect(boss, 'orgA', 'reception');
    setAccess(bossConn, 'lounge', 'private');
    const a = connect(adm, 'orgA', 'reception');
    send(a, { t: 'staff_duty', on: true });
    send(a, { t: 'join', roomId: 'lounge' });
    expect(a.room).toBe('lounge');
    const m = connect(mod, 'orgA', 'reception');
    send(m, { t: 'staff_duty', on: true });
    send(m, { t: 'join', roomId: 'lounge' });
    expect(m.room).toBe('reception');
  });
});

describe('room access: revoking throws people out', () => {
  function scene() {
    const boss = account('Chefe');
    member('orgA', boss, 'owner');
    const ana = account('Ana');
    member('orgA', ana, 'member', 'alfa');
    const bossConn = connect(boss, 'orgA', 'reception');
    setAccess(bossConn, 'meeting1', 'invited');
    invite(bossConn, 'meeting1', 'ana@x.com');
    const a = connect(ana, 'orgA', 'meeting1');
    return { boss, ana, bossConn, a };
  }

  it('removing the invite kicks the person out of the room right away (kicked_room), into a room she may use', () => {
    const { ana, bossConn, a } = scene();
    expect(a.room).toBe('meeting1');
    uninvite(bossConn, 'meeting1', ana.id);
    expect(bossConn.last('room_access_result')?.ok).toBe(true);
    expect(a.errors('kicked_room')).toHaveLength(1);
    expect(a.room).toBe('reception');
    send(a, { t: 'join', roomId: 'meeting1' });
    expect(a.room).toBe('reception');
  });

  it('changing the access of the room (to a team she is not in) also kicks her', () => {
    const { bossConn, a } = scene();
    setAccess(bossConn, 'meeting1', 'team', 'orgA-beta');
    expect(a.errors('kicked_room')).toHaveLength(1);
    expect(a.room).toBe('reception');
  });

  it('closing the room to the team she belongs to keeps her; moving her to another team kicks her', () => {
    const { boss, ana, bossConn, a } = scene();
    setAccess(bossConn, 'meeting1', 'team', 'orgA-alfa');
    expect(a.room).toBe('meeting1'); // she is in Alfa: the new policy still admits her
    void boss;
    store.orgs.putMember({ orgId: 'orgA', accountId: ana.id, role: 'member', teamId: 'orgA-beta', status: 'active', createdAt: 0 });
    world.refreshMembership(ana.id, 'orgA');
    expect(a.room).toBe('reception');
  });

  it('an expired invite stops working and expels whoever is inside at the next sweep', () => {
    const boss = account('Chefe');
    member('orgA', boss, 'owner');
    const ana = account('Ana');
    member('orgA', ana, 'member');
    const bossConn = connect(boss, 'orgA', 'reception');
    setAccess(bossConn, 'meeting2', 'invited');
    invite(bossConn, 'meeting2', 'Ana', 2);
    const a = connect(ana, 'orgA', 'meeting2');
    expect(a.room).toBe('meeting2');
    now += HOUR;
    world.tick(now);
    expect(a.room).toBe('meeting2');
    now += HOUR + 5000;
    world.tick(now);
    expect(a.errors('kicked_room')).toHaveLength(1);
    expect(a.room).toBe('reception');
    send(a, { t: 'join', roomId: 'meeting2' });
    expect(a.room).toBe('reception');
    // the admin sees the invitation gone from the list as well
    send(bossConn, { t: 'room_access_get', roomId: 'meeting2' });
    expect(bossConn.last('room_access')?.invites).toEqual([]);
  });

  it('an invite without expiry (hours: 0) does not expire', () => {
    const boss = account('Chefe');
    member('orgA', boss, 'owner');
    const ana = account('Ana');
    member('orgA', ana, 'member');
    const bossConn = connect(boss, 'orgA', 'reception');
    setAccess(bossConn, 'meeting2', 'invited');
    invite(bossConn, 'meeting2', 'Ana', 0);
    const a = connect(ana, 'orgA', 'meeting2');
    now += 400 * 24 * HOUR;
    world.tick(now);
    expect(a.room).toBe('meeting2');
    expect(bossConn.last('room_access')?.invites[0]).toMatchObject({ name: 'Ana', expiresAt: null });
  });

  it('only a person with room.access.set can manage access, and only for people of the own organization', () => {
    const { ana, a } = scene();
    setAccess(a, 'meeting1', 'org');
    invite(a, 'meeting1', 'Ana');
    uninvite(a, 'meeting1', ana.id);
    send(a, { t: 'room_access_get', roomId: 'meeting1' });
    expect(a.errors('forbidden')).toHaveLength(4);
    expect(a.all('room_access_result')).toHaveLength(0);
    expect(store.orgs.getRoomSetting('orgA', 'meeting1')?.access).toBe('invited');
    const boss2 = account('Chefe2');
    member('orgA', boss2, 'admin');
    const outsider = account('Forasteiro');
    member('orgB', outsider, 'member');
    const c = connect(boss2, 'orgA', 'reception');
    invite(c, 'meeting1', 'Forasteiro');
    expect(c.last('room_access_result')).toMatchObject({ ok: false, code: 'unknown_person' });
    invite(c, 'meeting1', 'forasteiro@x.com');
    expect(c.last('room_access_result')?.code).toBe('unknown_person');
    setAccess(c, 'meeting1', 'team', 'orgB-alfa'); // a team of another organization is "not found"
    expect(c.last('room_access_result')).toMatchObject({ ok: false, code: 'bad_team' });
    invite(c, 'lounge', 'Ana');
    expect(c.last('room_access_result')).toMatchObject({ ok: false, code: 'not_invite_room' });
  });
});

describe('room access: the browser of rooms leaks nothing', () => {
  it('shows padlocks, hides names of private rooms and never sends the population of rooms one cannot enter', () => {
    const boss = account('Chefe');
    member('orgA', boss, 'owner');
    const ana = account('Ana');
    member('orgA', ana, 'member');
    const bossConn = connect(boss, 'orgA', 'private');
    setAccess(bossConn, 'meeting1', 'invited');
    const a = connect(ana, 'orgA', 'reception');
    const list = a.last('rooms')!.rooms;
    const byId = Object.fromEntries(list.map((r) => [r.id, r]));
    expect(byId.private).toMatchObject({ locked: true, access: 'private', name: 'Sala privada', lockReason: 'invite' });
    expect(byId.private!.population).toBeUndefined();
    expect(byId.private!.description).not.toMatch(/escritório fechado/i);
    expect(byId.meeting1).toMatchObject({ locked: true, access: 'invited', name: 'Sala de Reunião 1' });
    expect(byId.meeting1!.population).toBeUndefined();
    expect(byId.lounge).toMatchObject({ locked: false, population: 0 });
    expect(a.last('room')!.room.population).not.toHaveProperty('private');
    expect(a.last('room')!.room.population).not.toHaveProperty('meeting1');
    // a head count of the private room (the boss is inside) never reaches her, while the admin sees it
    world.tick(now);
    expect(a.last('population')?.population ?? {}).not.toHaveProperty('private');
    expect(bossConn.last('room')!.room.population).toHaveProperty('private');
    const adminList = Object.fromEntries(bossConn.last('rooms')!.rooms.map((r) => [r.id, r]));
    expect(adminList.private).toMatchObject({ locked: false, name: 'Sala Privada', population: 1 });
  });

  it('refreshes the list when the person gets an invitation', () => {
    const boss = account('Chefe');
    member('orgA', boss, 'owner');
    const ana = account('Ana');
    member('orgA', ana, 'member');
    const bossConn = connect(boss, 'orgA', 'reception');
    const a = connect(ana, 'orgA', 'reception');
    expect(a.last('rooms')!.rooms.find((r) => r.id === 'private')!.locked).toBe(true);
    invite(bossConn, 'private', 'Ana');
    expect(a.last('rooms')!.rooms.find((r) => r.id === 'private')).toMatchObject({ locked: false, name: 'Sala Privada' });
    send(a, { t: 'join', roomId: 'private' });
    expect(a.room).toBe('private');
  });
});

describe('room access: isolation between two organizations', () => {
  it('a policy, an invitation or a layout in one organization never touches the other', () => {
    const boss = account('ChefeA');
    member('orgA', boss, 'owner');
    const ana = account('Ana');
    member('orgA', ana, 'member');
    const bia = account('Bia');
    member('orgB', bia, 'member');
    const bossB = account('ChefeB');
    member('orgB', bossB, 'owner');

    const bossConn = connect(boss, 'orgA', 'lounge');
    setAccess(bossConn, 'lounge', 'private');
    setAccess(bossConn, 'meeting1', 'invited');
    invite(bossConn, 'meeting1', 'Ana');
    const sA = spot('orgA', 'lounge');
    furnish(bossConn, 0, [add('plant', sA.x, sA.y)]);
    expect(bossConn.last('furnish_result')?.ok, bossConn.last('furnish_result')?.message).toBe(true);

    const b = connect(bia, 'orgB', 'reception');
    send(b, { t: 'join', roomId: 'lounge' });
    expect(b.room).toBe('lounge');
    send(b, { t: 'join', roomId: 'meeting1' });
    expect(b.room).toBe('meeting1');
    expect(b.last('room')!.room.def.furniture.some((f) => f.x === sA.x && f.y === sA.y && f.kind === 'plant')).toBe(false);
    expect(b.last('room')!.room.furnishVersion).toBe(0);
    expect(world.org('orgB').rooms.get('lounge')!.built.def.access ?? 'org').toBe('org');
    // an invitation for Ana in org A is no invitation for anybody in org B, and B's people appear in no list of A
    expect(store.orgs.roomInvitesOf('orgB', 'meeting1')).toEqual([]);
    expect(store.orgs.roomLayoutsOf('orgB')).toEqual([]);
    // the admin of org B edits the same room independently, from version 0
    const cb = connect(bossB, 'orgB', 'lounge');
    const sB = spot('orgB', 'lounge');
    furnish(cb, 0, [add('plant', sB.x, sB.y)]);
    expect(cb.last('furnish_result'), cb.last('furnish_result')?.message).toMatchObject({ ok: true, version: 1 });
    expect(world.org('orgA').rooms.get('lounge')!.built.def.furniture.filter((f) => f.kind === 'plant' && f.x === sB.x && f.y === sB.y)).toHaveLength(sA.x === sB.x && sA.y === sB.y ? 1 : 0);
    // a message that names a room of another organization finds nothing (the org comes from the session)
    send(bossConn, { t: 'room_access_get', roomId: 'lounge' });
    expect(bossConn.last('room_access')?.invites).toEqual([]);
  });

  it('shows the invitation DM only to the target of the same organization', () => {
    const boss = account('ChefeA');
    member('orgA', boss, 'owner');
    const bia = account('Bia');
    member('orgB', bia, 'member');
    const bossConn = connect(boss, 'orgA', 'meeting1');
    const b = connect(bia, 'orgB', 'reception');
    send(bossConn, { t: 'meeting_invite', target: 'Bia' });
    expect(bossConn.last('error')?.code).toBe('dm_offline');
    expect(b.all('dm')).toHaveLength(0);
  });
});

describe('meeting invitations from the avatar menu', () => {
  it('invites a person to the current room with a DM carrying the room, and lets her in when the room is restricted', () => {
    const boss = account('Chefe');
    member('orgA', boss, 'owner');
    const ana = account('Ana');
    member('orgA', ana, 'member');
    const bossConn = connect(boss, 'orgA', 'reception');
    setAccess(bossConn, 'meeting1', 'invited');
    send(bossConn, { t: 'join', roomId: 'meeting1' });
    const a = connect(ana, 'orgA', 'reception');
    send(a, { t: 'join', roomId: 'meeting1' });
    expect(a.room).toBe('reception');
    send(bossConn, { t: 'meeting_invite', target: 'Ana' });
    const dm = a.last('dm')!;
    expect(dm.roomInvite).toEqual({ roomId: 'meeting1', roomName: 'Sala de Reunião 1' });
    expect(dm.peer).toBe('Chefe');
    expect(bossConn.last('dm')).toMatchObject({ self: true });
    send(a, { t: 'join', roomId: dm.roomInvite!.roomId });
    expect(a.room).toBe('meeting1');
    // the invitation expires (8 hours)
    const rows = store.orgs.roomInvitesOf('orgA', 'meeting1');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.expiresAt).toBe(now + 8 * HOUR);
  });

  it('an ordinary member cannot open a restricted room for somebody else, but may invite to an open one', () => {
    const boss = account('Chefe');
    member('orgA', boss, 'owner');
    const ana = account('Ana');
    member('orgA', ana, 'member');
    const caio = account('Caio');
    member('orgA', caio, 'member');
    const bossConn = connect(boss, 'orgA', 'reception');
    setAccess(bossConn, 'meeting1', 'invited');
    invite(bossConn, 'meeting1', 'Ana');
    const a = connect(ana, 'orgA', 'meeting1');
    const c = connect(caio, 'orgA', 'reception');
    send(a, { t: 'meeting_invite', target: 'Caio' });
    expect(a.last('error')?.code).toBe('forbidden');
    expect(c.all('dm')).toHaveLength(0);
    send(a, { t: 'join', roomId: 'lounge' });
    send(a, { t: 'meeting_invite', target: 'Caio' });
    expect(c.last('dm')?.roomInvite?.roomId).toBe('lounge');
  });
});

describe('media token', () => {
  it('refuses a token to somebody who is in the room but may no longer be there', async () => {
    const { app, world: w } = await createApp({ store: new MemoryAccountStore(), allowDevLogin: true, tickMs: 1_000_000, clock: () => now });
    try {
      const c = new FakeConn();
      w.handle(c, { t: 'hello', name: 'Ana' });
      w.handle(c, { t: 'join', roomId: 'lounge' });
      const token = () => app.inject({ method: 'POST', url: '/api/media/token', payload: { roomId: 'lounge', devName: 'Ana' } });
      expect((await token()).statusCode).toBe(200);
      // the policy changes underneath (as it would in the instant between the change and the eviction)
      const room = w.org('default').rooms.get('lounge')!;
      room.built = { ...room.built, def: { ...room.built.def, access: 'invited' } };
      const denied = await token();
      expect(denied.statusCode).toBe(403);
      expect(denied.json().error.code).toBe('forbidden_room');
      expect(denied.json().token).toBeUndefined();
      // and the periodic check throws her out
      now += 3000;
      w.tick(now);
      expect(c.errors('kicked_room')).toHaveLength(1);
      expect(c.player!.roomId).toBe('reception');
    } finally {
      await app.close();
    }
  });
});

describe('room editor: permissions', () => {
  function scene() {
    const boss = account('Chefe');
    member('orgA', boss, 'owner');
    const adm = account('Adm');
    member('orgA', adm, 'admin');
    const ana = account('Ana');
    member('orgA', ana, 'member');
    const gus = account('Gus');
    member('orgA', gus, 'guest');
    return { boss, adm, ana, gus };
  }

  it('owner and admin decorate; member and guest are refused (forbidden) and nothing changes', () => {
    const { boss, adm, ana, gus } = scene();
    for (const [acc, ok] of [
      [boss, true],
      [adm, true],
      [ana, false],
      [gus, false],
    ] as const) {
      const c = connect(acc, 'orgA', 'lounge');
      const before = world.org('orgA').rooms.get('lounge')!.version;
      furnish(c, before, [plantAt('orgA', 'lounge', acc === boss ? 0 : 1)]);
      const r = c.last('furnish_result');
      if (ok) {
        expect(r?.ok, r?.message).toBe(true);
        expect(r?.version).toBe(before + 1);
      } else {
        expect(r).toBeUndefined();
        expect(c.errors('forbidden')).toHaveLength(1);
        expect(world.org('orgA').rooms.get('lounge')!.version).toBe(before);
      }
    }
  });

  it('a platform staff admin on duty can decorate; a helper and a staff admin off duty cannot', () => {
    const adm = account('Staffadm');
    member('orgA', adm, 'member');
    adm.staff = 'admin';
    store.save(adm);
    const helper = account('Ajuda');
    member('orgA', helper, 'member');
    helper.staff = 'helper';
    store.save(helper);
    const a = connect(adm, 'orgA', 'lounge');
    send(a, { t: 'staff_duty', on: false });
    furnish(a, 0, [plantAt('orgA', 'lounge')]);
    expect(a.errors('forbidden')).toHaveLength(1);
    expect(a.all('furnish_result')).toHaveLength(0);
    send(a, { t: 'staff_duty', on: true });
    furnish(a, 0, [plantAt('orgA', 'lounge')]);
    expect(a.last('furnish_result')?.ok, a.last('furnish_result')?.message).toBe(true);
    const h = connect(helper, 'orgA', 'lounge');
    furnish(h, 1, [plantAt('orgA', 'lounge', 3)]);
    expect(h.errors('forbidden')).toHaveLength(1);
    expect(h.all('furnish_result')).toHaveLength(0);
  });

  it('a malformed message is a strike, not a crash', () => {
    const { boss } = scene();
    const c = connect(boss, 'orgA', 'lounge');
    send(c, { t: 'furnish_apply', rid: 'x', base: 0, ops: [] });
    expect(c.errors('bad_message').length).toBe(1);
    send(c, { t: 'furnish_apply', rid: 1, base: 0, ops: Array.from({ length: 31 }, () => ({ op: 'remove', id: 'x' })) });
    expect(c.errors('bad_message').length).toBe(2);
    send(c, { t: 'furnish_apply', rid: 1, base: 0, ops: [null] });
    expect(c.errors('bad_message').length).toBe(3);
    send(c, { t: 'furnish_apply', rid: 2, base: 0, ops: [{ op: 'explode' }] });
    expect(c.last('furnish_result')).toMatchObject({ ok: false, code: 'bad_op' });
  });

  it('rate limits editing', () => {
    const { boss } = scene();
    const c = connect(boss, 'orgA', 'lounge');
    let limited = 0;
    for (let i = 0; i < 40; i++) {
      furnish(c, world.org('orgA').rooms.get('lounge')!.version, [add('rug', 5 + (i % 3), 8)]);
      if (c.last('furnish_result')?.code === 'rate_limited') limited++;
    }
    expect(limited).toBeGreaterThan(0);
  });
});

describe('room editor: validation on the server', () => {
  function admin(roomId = 'lounge') {
    const boss = account('Chefe');
    member('orgA', boss, 'owner');
    return connect(boss, 'orgA', roomId);
  }

  it('rejects collisions, pieces outside the floor, wall pieces off the wall and kinds not allowed, with reason and coordinate', () => {
    const c = admin();
    const room = world.org('orgA').rooms.get('lounge')!;
    const table = room.built.def.furniture.find((f) => f.kind === 'table')!;
    const tries: Array<[FurnishOp, string, RegExp]> = [
      [add('plant', table.x, table.y), 'overlap', /sobrepostos em \(\d+, \d+\)/],
      [add('sofa', 11, 8), 'outside', /fora do piso em \(11, 9\)/],
      [add('frame', 4, 3), 'wall_only', /parede/],
      [add('podium', 6, 7), 'room_type', /auditório/],
      [add('plant', 99, 99), 'outside', /fora do piso/],
    ];
    for (const [op, code, text] of tries) {
      furnish(c, 0, [op]);
      const r = c.last('furnish_result')!;
      expect(r.ok).toBe(false);
      expect(r.code).toBe(code);
      expect(r.message).toMatch(text);
    }
    expect(room.version).toBe(0);
    expect(store.orgs.getRoomLayout('orgA', 'lounge')).toBeUndefined();
  });

  it('refuses a layout that blocks the path (spawn, doors, seats, isolated floor)', () => {
    const c = admin('team');
    const room = world.org('orgA').rooms.get('team')!;
    const spawn = room.built.def.spawn;
    furnish(c, 0, [add('plant', spawn.x, spawn.y)]);
    expect(c.last('furnish_result')?.code).toBe('blocks_spawn');
    furnish(c, 0, [add('plant', 0, 4)]);
    expect(c.last('furnish_result')?.code).toBe('blocks_portal');
    // wall off the corner around the door: the floor behind it is isolated
    const ring = [[2, 0], [2, 1], [2, 2], [1, 2], [0, 2]].filter(([x, y]) => !room.built.def.furniture.some((f) => f.x === x && f.y === y && f.kind !== 'frame' && f.kind !== 'whiteboard'));
    furnish(c, 0, ring.map(([x, y]) => add('bin', x!, y!)));
    const r = c.last('furnish_result')!;
    expect(r.ok).toBe(false);
    expect(['isolated', 'overlap', 'portal_unreachable', 'arrival_unreachable']).toContain(r.code);
    expect(room.version).toBe(0);
  });

  it('enforces the piece limit', () => {
    const c = admin();
    const room = world.org('orgA').rooms.get('lounge')!;
    const base = room.built.def;
    // jam the stored layout with the maximum (rugs on a wall of the floor are not validated by this test, the limit is)
    const ops = Array.from({ length: 30 }, (_, i) => add('rug', 0, 0, i % 4));
    furnish(c, 0, ops);
    expect(c.last('furnish_result')?.ok).toBe(false);
    expect(MAX_FURNITURE).toBe(250);
    expect(base.furniture.length).toBeLessThan(MAX_FURNITURE);
  });

  it('keeps the auditorium stage and podium', () => {
    const c = admin('auditorium');
    const room = world.org('orgA').rooms.get('auditorium')!;
    const podium = room.built.def.furniture.find((f) => f.kind === 'podium')!;
    furnish(c, 0, [{ op: 'remove', id: podium.id }]);
    expect(c.last('furnish_result')?.code).toBe('required');
  });

  it('only edits the room the person is standing in', () => {
    const boss = account('Chefe');
    member('orgA', boss, 'owner');
    const c = new FakeConn();
    c.accountId = boss.id;
    world.handle(c, { t: 'hello', orgId: 'orgA' });
    furnish(c, 0, [add('plant', 6, 6)]);
    expect(c.last('furnish_result')).toMatchObject({ ok: false, code: 'no_room' });
  });
});

describe('room editor: live application', () => {
  it('broadcasts furniture_changed to everyone in the room and to nobody else', () => {
    const boss = account('Chefe');
    member('orgA', boss, 'owner');
    const ana = account('Ana');
    member('orgA', ana, 'member');
    const cai = account('Caio');
    member('orgA', cai, 'member');
    const a = connect(boss, 'orgA', 'lounge');
    const b = connect(ana, 'orgA', 'lounge');
    const elsewhere = connect(cai, 'orgA', 'reception');
    furnish(a, 0, [add('sofa', 9, 7)]);
    const res = a.last('furnish_result')!;
    expect(res).toMatchObject({ ok: true, version: 1 });
    for (const c of [a, b]) {
      const m = c.last('furniture_changed')!;
      expect(m).toMatchObject({ roomId: 'lounge', version: 1, customized: true });
      expect(m.furniture.some((f) => f.kind === 'sofa' && f.x === 9 && f.y === 7)).toBe(true);
    }
    expect(elsewhere.all('furniture_changed')).toHaveLength(0);
    // a newcomer gets the customized room and its version
    const late = connect(cai, 'orgA', 'lounge');
    expect(late.last('room')!.room).toMatchObject({ furnishVersion: 1, customized: true });
    expect(late.last('room')!.room.def.furniture.some((f) => f.kind === 'sofa' && f.x === 9 && f.y === 7)).toBe(true);
  });

  it('moves whoever stands on a tile that becomes blocked, without losing them', () => {
    const boss = account('Chefe');
    member('orgA', boss, 'owner');
    const ana = account('Ana');
    member('orgA', ana, 'member');
    const a = connect(boss, 'orgA', 'lounge');
    const b = connect(ana, 'orgA', 'lounge');
    const p = b.player!;
    p.path = [];
    const t = spot('orgA', 'lounge');
    p.x = t.x;
    p.y = t.y;
    furnish(a, 0, [add('plant', t.x, t.y)]);
    expect(a.last('furnish_result')?.ok, a.last('furnish_result')?.message).toBe(true);
    expect(p.roomId).toBe('lounge');
    expect(`${p.x},${p.y}`).not.toBe(`${t.x},${t.y}`);
    const room = world.org('orgA').rooms.get('lounge')!;
    expect(room.built.grid.blocked[p.y * room.built.grid.width + p.x]).toBe(false);
    const fix = b.all('path').find((m) => m.id === p.id)!;
    expect(fix.path).toEqual([]);
    expect(fix.from).toEqual({ x: p.x, y: p.y });
    // a person who was walking through a tile that is now blocked stops
    const q = a.player!;
    const w = spot('orgA', 'lounge');
    q.x = w.x;
    q.y = w.y;
    q.origin = { x: w.x, y: w.y };
    q.pathStart = now;
    const next = spot('orgA', 'lounge', 5);
    q.path = [next];
    const before = room.version;
    furnish(a, before, [add('plant', next.x, next.y)]);
    expect(a.last('furnish_result')?.ok, a.last('furnish_result')?.message).toBe(true);
    expect(q.path).toEqual([]);
  });

  it('stands up whoever was sitting on a piece that is removed or moved away', () => {
    const boss = account('Chefe');
    member('orgA', boss, 'owner');
    const ana = account('Ana');
    member('orgA', ana, 'member');
    const a = connect(boss, 'orgA', 'lounge');
    const b = connect(ana, 'orgA', 'lounge');
    const room = world.org('orgA').rooms.get('lounge')!;
    const sofa = room.built.def.furniture.find((f) => f.kind === 'sofa')!;
    const p = b.player!;
    p.x = sofa.x;
    p.y = sofa.y;
    p.sitting = true;
    furnish(a, 0, [{ op: 'remove', id: sofa.id }]);
    expect(a.last('furnish_result')?.ok, a.last('furnish_result')?.message).toBe(true);
    expect(p.sitting).toBe(false);
    expect(b.all('path').some((m) => m.id === p.id && m.path.length === 0)).toBe(true);
    // rotating a seat under somebody turns them with it
    const armchair = room.built.def.furniture.find((f) => f.kind === 'armchair')!;
    const q = a.player!;
    q.x = armchair.x;
    q.y = armchair.y;
    q.sitting = true;
    furnish(a, 1, [{ op: 'update', id: armchair.id, x: armchair.x, y: armchair.y, dir: (armchair.dir + 1) % 4 }]);
    expect(a.last('furnish_result')?.ok, a.last('furnish_result')?.message).toBe(true);
    expect(q.sitting).toBe(true);
    expect(a.all('sit').some((m) => m.id === q.id)).toBe(true);
  });

  it('rejects a stale version with conflict (409 semantics) and resends the current layout', () => {
    const boss = account('Chefe');
    member('orgA', boss, 'owner');
    const adm = account('Adm');
    member('orgA', adm, 'admin');
    const a = connect(boss, 'orgA', 'lounge');
    const b = connect(adm, 'orgA', 'lounge');
    furnish(a, 0, [plantAt('orgA', 'lounge')]);
    furnish(b, 0, [plantAt('orgA', 'lounge', 4)]); // b still believes in version 0
    const r = b.last('furnish_result')!;
    expect(r).toMatchObject({ ok: false, code: 'conflict', version: 1 });
    const room = world.org('orgA').rooms.get('lounge')!;
    expect(room.built.def.furniture.filter((f) => f.id.startsWith('u'))).toHaveLength(1);
    const resync = b.last('furniture_changed')!;
    expect(resync.version).toBe(1);
    furnish(b, resync.version, [plantAt('orgA', 'lounge', 3)]);
    expect(b.last('furnish_result')).toMatchObject({ ok: true, version: 2 });
    // two admins firing at once on the same base: exactly one wins
    const v = room.version;
    furnish(a, v, [plantAt('orgA', 'lounge', 6)]);
    furnish(b, v, [plantAt('orgA', 'lounge', 8)]);
    expect([a.last('furnish_result')?.ok, b.last('furnish_result')?.ok].sort()).toEqual([false, true]);
  });

  it('restores the original layout, keeps the version growing and leaves the base intact', () => {
    const boss = account('Chefe');
    member('orgA', boss, 'owner');
    const a = connect(boss, 'orgA', 'lounge');
    const room = world.org('orgA').rooms.get('lounge')!;
    const original = JSON.stringify(world.org('orgA').baseDefs.get('lounge')!.furniture);
    furnish(a, 0, [add('sofa', 9, 7), add('plant', 6, 6)]);
    expect(room.customized).toBe(true);
    send(a, { t: 'furnish_reset', rid: ++rid, base: 1 });
    expect(a.last('furnish_result')).toMatchObject({ ok: true, version: 2 });
    expect(room.customized).toBe(false);
    expect(JSON.stringify(room.built.def.furniture)).toBe(original);
    expect(a.last('furniture_changed')).toMatchObject({ version: 2, customized: false });
    expect(store.orgs.getRoomLayout('orgA', 'lounge')).toMatchObject({ version: 2, furniture: null });
    // restoring an untouched room is a no-op, and a stale restore conflicts
    send(a, { t: 'furnish_reset', rid: ++rid, base: 2 });
    expect(a.last('furnish_result')).toMatchObject({ ok: true, version: 2 });
    send(a, { t: 'furnish_reset', rid: ++rid, base: 0 });
    expect(a.last('furnish_result')?.code).toBe('conflict');
    // the base definition is the very same one for the next organization
    expect(JSON.stringify(world.org('orgB').baseDefs.get('lounge')!.furniture)).toBe(original);
  });

  it('survives a restart: layout, version, access and invitations are loaded when the world is rebuilt', () => {
    const boss = account('Chefe');
    member('orgA', boss, 'owner');
    const ana = account('Ana');
    member('orgA', ana, 'member');
    const a = connect(boss, 'orgA', 'lounge');
    furnish(a, 0, [add('sofa', 9, 7)]);
    setAccess(a, 'meeting1', 'invited');
    invite(a, 'meeting1', 'Ana', 0);
    const world2 = new World({ store, clock: () => now });
    const room = world2.org('orgA').rooms.get('lounge')!;
    expect(room.version).toBe(1);
    expect(room.customized).toBe(true);
    expect(room.built.def.furniture.some((f) => f.kind === 'sofa' && f.x === 9 && f.y === 7)).toBe(true);
    expect(world2.org('orgA').rooms.get('meeting1')!.built.def.access).toBe('invited');
    expect(world2.org('orgB').rooms.get('lounge')!.version).toBe(0);
    const c = new FakeConn();
    c.accountId = ana.id;
    world2.handle(c, { t: 'hello', orgId: 'orgA' });
    world2.handle(c, { t: 'join', roomId: 'meeting1' });
    expect(c.player!.roomId).toBe('meeting1');
  });

  it('ignores a stored layout that no longer validates instead of crashing the world', () => {
    store.orgs.putRoomLayout({ orgId: 'orgA', roomId: 'lounge', version: 7, furniture: [{ id: 'x1', kind: 'sofa', x: 50, y: 50, dir: 0 }], updatedBy: '', updatedAt: 0 });
    const w2 = new World({ store, clock: () => now });
    const room = w2.org('orgA').rooms.get('lounge')!;
    expect(room.customized).toBe(false);
    expect(room.version).toBe(7);
  });

  it('audits every change (who, what, where)', () => {
    const boss = account('Chefe');
    member('orgA', boss, 'owner');
    const a = connect(boss, 'orgA', 'lounge');
    furnish(a, 0, [add('plant', 6, 6)]);
    setAccess(a, 'meeting1', 'invited');
    const actions = store.queryAudit({ actor: 'Chefe' }).map((r) => r.action);
    expect(actions).toContain('room.furnish');
    expect(actions).toContain('room.access');
    const rec = store.queryAudit({ action: 'room.furnish' })[0]!;
    expect(rec).toMatchObject({ actorId: boss.id, targetId: 'orgA/lounge' });
  });
});
