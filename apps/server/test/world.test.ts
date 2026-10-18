import { beforeEach, describe, expect, it } from 'vitest';
import { STEP_MS, ROOM_DEFS, type ServerMessage } from '@workverse/shared';
import { World, type Connection } from '../src/world';
import { MemoryAccountStore } from '../src/store';

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
}

let now = 1_000_000;
let world: World;
let store: MemoryAccountStore;

function login(name: string): FakeConn {
  const c = new FakeConn();
  world.handle(c, { t: 'hello', name });
  world.handle(c, { t: 'join' });
  return c;
}

beforeEach(() => {
  now = 1_000_000;
  store = new MemoryAccountStore();
  world = new World({ store, allowDevLogin: true, clock: () => now });
});

describe('sessions', () => {
  it('rejects invalid names and names owned by password accounts on the dev path', () => {
    const c = new FakeConn();
    world.handle(c, { t: 'hello', name: 'x' });
    expect(c.last('error')?.code).toBe('bad_name');
    store.create({ email: 'ana@example.com', displayName: 'Ana', passwordHash: 'scrypt$x' });
    const d = new FakeConn();
    world.handle(d, { t: 'hello', name: 'ana' });
    expect(d.last('error')?.code).toBe('name_taken');
  });

  it('refuses name-only hello when dev login is off, and closes the socket', () => {
    const strict = new World({ store: new MemoryAccountStore(), clock: () => now });
    const c = new FakeConn();
    strict.handle(c, { t: 'hello', name: 'Ana' });
    expect(c.last('error')?.code).toBe('unauthorized');
    expect(c.closed).toBe(true);
    expect(c.player).toBeUndefined();
  });

  it('uses the account display name for authenticated connections and ignores a spoofed name', () => {
    const acc = store.create({ email: 'bia@example.com', displayName: 'Bia', passwordHash: 'scrypt$x' });
    const c = new FakeConn();
    c.accountId = acc.id;
    world.handle(c, { t: 'hello', name: 'Impostor' });
    expect(c.last('session')).toMatchObject({ name: 'Bia', isNew: false });
  });

  it('requires a session before any action', () => {
    const c = new FakeConn();
    world.handle(c, { t: 'move', x: 1, y: 1 });
    expect(c.last('error')?.code).toBe('no_session');
  });

  it('restores the dev account by name and replaces the old connection', () => {
    const a = login('Ana');
    const a2 = new FakeConn();
    world.handle(a2, { t: 'hello', name: 'ana' });
    expect(a2.last('session')?.isNew).toBe(false);
    expect(a.closed).toBe(true);
    expect(a.last('error')?.code).toBe('replaced');
    world.disconnect(a); // late close of the replaced socket must not evict the new one
    world.handle(a2, { t: 'join' });
    expect(world.rooms.get('office')!.players.size).toBe(1);
  });

  it('counts malformed messages and drops abusive connections', () => {
    const c = login('Ana');
    for (let i = 0; i < 25; i++) world.handle(c, { nonsense: true });
    expect(c.closed).toBe(true);
  });
});

describe('rooms', () => {
  it('shows existing players to a newcomer and announces the newcomer', () => {
    const a = login('Ana');
    const b = login('Beto');
    expect(b.last('room')!.room.players.map((p) => p.name).sort()).toEqual(['Ana', 'Beto']);
    expect(a.last('joined')?.player.name).toBe('Beto');
  });

  it('never spawns two players on the same tile', () => {
    const a = login('Ana');
    const b = login('Beto');
    const pa = a.player!;
    const pb = b.player!;
    expect(`${pa.x},${pa.y}`).not.toBe(`${pb.x},${pb.y}`);
  });

  it('announces departures', () => {
    const a = login('Ana');
    const b = login('Beto');
    world.disconnect(b);
    expect(a.last('left')?.id).toBe(b.player!.id);
  });

  it('keeps the session when changing rooms through a portal', () => {
    const a = login('Ana');
    const portal = ROOM_DEFS[0].portals[0];
    world.handle(a, { t: 'move', x: portal.x, y: portal.y });
    const steps = a.last('path')!.path.length;
    now += steps * STEP_MS + 50;
    world.tick(now);
    expect(a.player!.roomId).toBe('lounge');
    expect(a.last('room')!.room.def.id).toBe('lounge');
    expect(a.closed).toBe(false);
    world.handle(a, { t: 'chat', text: 'oi' });
    expect(a.last('chat')?.text).toBe('oi');
  });
});

describe('movement', () => {
  it('sends a validated path and tracks the logical position over time', () => {
    const a = login('Ana');
    const b = login('Beto');
    const start = { x: a.player!.x, y: a.player!.y };
    world.handle(a, { t: 'move', x: start.x, y: start.y + 3 });
    const msg = b.last('path')!;
    expect(msg.id).toBe(a.player!.id);
    expect(msg.path[msg.path.length - 1]).toEqual({ x: start.x, y: start.y + 3 });
    now += STEP_MS * 10;
    world.tick(now);
    expect({ x: a.player!.x, y: a.player!.y }).toEqual({ x: start.x, y: start.y + 3 });
  });

  it('rejects out of range, void and furniture targets', () => {
    const a = login('Ana');
    for (const [x, y] of [[-1, 0], [99, 99], [2, 2] /* desk */]) {
      world.handle(a, { t: 'move', x, y });
      expect(a.last('error')?.code).toBe('blocked');
      a.inbox.length = 0;
    }
    world.handle(a, { t: 'move', x: 1.5, y: 2 } as never);
    expect(a.last('error')?.code).toBe('bad_message');
  });

  it('rejects movement spam beyond the rate limit', () => {
    const a = login('Ana');
    const b = login('Beto');
    b.inbox.length = 0;
    for (let i = 0; i < 40; i++) world.handle(a, { t: 'move', x: 7 + (i % 2), y: 7 });
    expect(b.all('path').length).toBeLessThan(15);
  });

  it('redirects mid-walk from the tile currently being entered', () => {
    const a = login('Ana');
    const s = { x: a.player!.x, y: a.player!.y };
    world.handle(a, { t: 'move', x: s.x, y: s.y + 4 });
    now += STEP_MS * 1.5;
    world.handle(a, { t: 'move', x: s.x - 3, y: s.y });
    const second = a.last('path')!;
    expect(second.from).toEqual({ x: s.x, y: s.y + 2 });
    expect(second.stepRemainingMs).toBeGreaterThan(0);
    expect(second.stepRemainingMs).toBeLessThanOrEqual(STEP_MS);
  });
});

describe('furniture', () => {
  const chair = ROOM_DEFS[0].furniture.find((f) => f.kind === 'chair')!;

  it('seats a player after walking and refuses a taken chair', () => {
    const a = login('Ana');
    const b = login('Beto');
    world.handle(a, { t: 'interact', furniId: chair.id, x: chair.x, y: chair.y });
    now += STEP_MS * 30;
    world.tick(now);
    expect(a.player!.sitting).toBe(true);
    expect(b.last('sit')?.id).toBe(a.player!.id);
    world.handle(b, { t: 'interact', furniId: chair.id, x: chair.x, y: chair.y });
    now += STEP_MS * 30;
    world.tick(now);
    expect(b.player!.sitting).toBe(false);
  });

  it('only one of two simultaneous requests wins the seat', () => {
    const a = login('Ana');
    const b = login('Beto');
    world.handle(a, { t: 'interact', furniId: chair.id, x: chair.x, y: chair.y });
    world.handle(b, { t: 'interact', furniId: chair.id, x: chair.x, y: chair.y });
    now += STEP_MS * 40;
    world.tick(now);
    expect([a.player!.sitting, b.player!.sitting].filter(Boolean)).toHaveLength(1);
  });

  it('stands up when told to move', () => {
    const a = login('Ana');
    world.handle(a, { t: 'interact', furniId: chair.id, x: chair.x, y: chair.y });
    now += STEP_MS * 30;
    world.tick(now);
    world.handle(a, { t: 'move', x: 7, y: 7 });
    expect(a.player!.sitting).toBe(false);
    expect(a.last('path')!.from).toEqual({ x: chair.x, y: chair.y });
  });

  it('toggles a computer for everyone once the player is next to it', () => {
    const a = login('Ana');
    const b = login('Beto');
    const pc = ROOM_DEFS[0].furniture.find((f) => f.kind === 'computer')!;
    world.handle(a, { t: 'interact', furniId: pc.id, x: pc.x, y: pc.y });
    now += STEP_MS * 30;
    world.tick(now);
    expect(b.last('furni')).toEqual({ t: 'furni', id: pc.id, on: true });
  });

  it('ignores interactions with furniture that does not exist or a wrong tile', () => {
    const a = login('Ana');
    world.handle(a, { t: 'interact', furniId: 'nope', x: 1, y: 1 });
    world.handle(a, { t: 'interact', furniId: chair.id, x: 0, y: 0 });
    expect(a.all('path')).toHaveLength(0);
  });
});

describe('chat', () => {
  it('broadcasts sanitised text to the whole room and not to other rooms', () => {
    const a = login('Ana');
    const b = login('Beto');
    const c = login('Caio');
    c.player && world.enterRoom(c.player, 'lounge');
    world.handle(a, { t: 'chat', text: '  Olá\u0000   mundo ‮ ' });
    expect(b.last('chat')).toMatchObject({ name: 'Ana', text: 'Olá mundo', kind: 'say' });
    expect(c.all('chat')).toHaveLength(0);
  });

  it('truncates long messages and ignores empty ones', () => {
    const a = login('Ana');
    world.handle(a, { t: 'chat', text: 'x'.repeat(500) });
    expect(a.last('chat')!.text.length).toBe(120);
    const before = a.all('chat').length;
    world.handle(a, { t: 'chat', text: '   ' });
    expect(a.all('chat').length).toBe(before);
  });

  it('rate limits floods but recovers with time', () => {
    const a = login('Ana');
    for (let i = 0; i < 10; i++) world.handle(a, { t: 'chat', text: `m${i}` });
    expect(a.all('chat').length).toBeLessThan(10);
    expect(a.last('error')?.code).toBe('rate_limited');
    now += 5000;
    world.handle(a, { t: 'chat', text: 'de volta' });
    expect(a.last('chat')?.text).toBe('de volta');
  });

  it('turns /acenar into an emote and does not leak commands as chat', () => {
    const a = login('Ana');
    const b = login('Beto');
    world.handle(a, { t: 'chat', text: '/acenar' });
    expect(b.last('emote')).toMatchObject({ id: a.player!.id, emote: 'wave' });
    expect(b.all('chat')).toHaveLength(0);
  });
});

describe('avatar', () => {
  it('sanitises (legacy and v2), persists and broadcasts avatar changes', () => {
    const a = login('Ana');
    const b = login('Beto');
    world.handle(a, { t: 'avatar', avatar: { skin: 4, hairStyle: 99 } as never });
    expect(b.last('avatar')!.avatar.skin).toBe('brown'); // legacy skin 4
    expect(b.last('avatar')!.avatar.hair.id).toBe('hair.short'); // invalid style falls back
    world.disconnect(a);
    const a2 = new FakeConn();
    world.handle(a2, { t: 'hello', name: 'Ana' });
    expect(a2.last('session')!.avatar.skin).toBe('brown');
  });
});
