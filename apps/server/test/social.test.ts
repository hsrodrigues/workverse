import { beforeEach, describe, expect, it } from 'vitest';
import { AUTO_AWAY_MS, type ServerMessage } from '@workverse/shared';
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

/** Logs in through the dev path; with `team`, uses a pre-created account carrying that team. */
function login(name: string, team?: string): FakeConn {
  const c = new FakeConn();
  if (team) {
    const acc = store.create({ email: `${name}@example.com`, displayName: name, passwordHash: 'scrypt$x' });
    acc.team = team;
    store.save(acc);
    c.accountId = acc.id;
  }
  world.handle(c, { t: 'hello', name });
  world.handle(c, { t: 'join' });
  return c;
}

beforeEach(() => {
  now = 1_000_000;
  store = new MemoryAccountStore();
  world = new World({ store, allowDevLogin: true, clock: () => now });
});

describe('status', () => {
  it('starts available and reports it in the session and the room snapshot', () => {
    const a = login('Ana');
    expect(a.last('session')).toMatchObject({ status: 'available', team: 'Geral' });
    expect(a.last('room')!.room.players[0].status).toBe('available');
  });

  it('accepts a valid status, broadcasts it to the room and shows it to newcomers', () => {
    const a = login('Ana');
    const b = login('Beto');
    world.handle(a, { t: 'status', status: 'focus' });
    expect(b.last('status')).toEqual({ t: 'status', id: a.player!.id, status: 'focus' });
    expect(a.last('status')?.status).toBe('focus');
    const c = login('Caio');
    expect(c.last('room')!.room.players.find((p) => p.name === 'Ana')!.status).toBe('focus');
  });

  it('rejects statuses outside the closed list', () => {
    const a = login('Ana');
    const b = login('Beto');
    b.inbox.length = 0;
    for (const bad of ['dormindo', '', 42, null, { x: 1 }]) {
      world.handle(a, { t: 'status', status: bad as never });
      expect(a.last('error')?.code).toBe('bad_message');
    }
    expect(a.player!.status).toBe('available');
    expect(b.all('status')).toHaveLength(0);
  });

  it('persists the last choice on the account and restores it on the next login', () => {
    const a = login('Ana');
    world.handle(a, { t: 'status', status: 'meeting' });
    expect(store.getByName('Ana')!.status).toBe('meeting');
    world.disconnect(a);
    const a2 = login('Ana');
    expect(a2.last('session')?.status).toBe('meeting');
    expect(a2.player!.status).toBe('meeting');
  });

  it('turns away automatically after the idle time, only for the idle player', () => {
    const a = login('Ana');
    const b = login('Beto');
    now += AUTO_AWAY_MS - 1000;
    world.handle(b, { t: 'chat', text: 'oi' }); // Beto stays active
    world.tick(now);
    expect(a.player!.status).toBe('available');
    now += 2000;
    world.tick(now);
    expect(a.player!.status).toBe('away');
    expect(b.last('status')).toEqual({ t: 'status', id: a.player!.id, status: 'away' });
    expect(b.player!.status).toBe('available');
  });

  it('returns from automatic away to the previous status on activity, without persisting away', () => {
    const a = login('Ana');
    const b = login('Beto');
    world.handle(a, { t: 'status', status: 'busy' });
    now += AUTO_AWAY_MS + 1;
    world.tick(now);
    expect(a.player!.status).toBe('away');
    expect(store.getByName('Ana')!.status).toBe('busy');
    world.handle(a, { t: 'move', x: 7, y: 7 });
    expect(a.player!.status).toBe('busy');
    expect(b.last('status')?.status).toBe('busy');
  });

  it('does not count pings as activity and respects a custom idle time', () => {
    const quick = new World({ store: new MemoryAccountStore(), allowDevLogin: true, clock: () => now, idleAwayMs: 1000 });
    const a = new FakeConn();
    quick.handle(a, { t: 'hello', name: 'Ana' });
    quick.handle(a, { t: 'join' });
    now += 1500;
    quick.handle(a, { t: 'ping', ts: 1 });
    quick.tick(now);
    expect(a.player!.status).toBe('away');
  });

  it('keeps a manual away until the player picks something else', () => {
    const a = login('Ana');
    world.handle(a, { t: 'status', status: 'away' });
    world.handle(a, { t: 'chat', text: 'oi' });
    expect(a.player!.status).toBe('away');
  });
});

describe('direct messages', () => {
  it('delivers only to the recipient and echoes to the sender, never to the room', () => {
    const a = login('Ana');
    const b = login('Beto');
    const c = login('Caio');
    world.handle(a, { t: 'dm', to: 'beto', text: '  segredo\u0000  aqui ' });
    expect(b.last('dm')).toMatchObject({ peer: 'Ana', self: false, text: 'segredo aqui' });
    expect(a.last('dm')).toMatchObject({ peer: 'Beto', self: true, text: 'segredo aqui' });
    expect(c.all('dm')).toHaveLength(0);
    for (const conn of [a, b, c]) expect(conn.all('chat')).toHaveLength(0);
  });

  it('works by account id and across rooms', () => {
    const a = login('Ana');
    const b = login('Beto');
    world.enterRoom(b.player!, 'lounge');
    world.handle(a, { t: 'dm', to: b.player!.accountId, text: 'oi' });
    expect(b.last('dm')).toMatchObject({ peerId: a.player!.accountId, text: 'oi' });
  });

  it('errors clearly when the recipient is offline or unknown', () => {
    const a = login('Ana');
    const b = login('Beto');
    world.disconnect(b);
    world.handle(a, { t: 'dm', to: 'Beto', text: 'oi' });
    expect(a.last('error')?.code).toBe('dm_offline');
    world.handle(a, { t: 'dm', to: 'Fantasma', text: 'oi' });
    expect(a.last('error')?.code).toBe('dm_offline');
    expect(a.all('dm')).toHaveLength(0);
  });

  it('refuses messages to oneself', () => {
    const a = login('Ana');
    world.handle(a, { t: 'dm', to: 'Ana', text: 'oi' });
    expect(a.last('error')?.code).toBe('dm_self');
  });

  it('shares the chat rate limit and recovers with time', () => {
    const a = login('Ana');
    const b = login('Beto');
    for (let i = 0; i < 10; i++) world.handle(a, { t: 'dm', to: 'Beto', text: `m${i}` });
    expect(b.all('dm').length).toBeLessThan(10);
    expect(a.last('error')?.code).toBe('rate_limited');
    now += 5000;
    world.handle(a, { t: 'dm', to: 'Beto', text: 'de volta' });
    expect(b.last('dm')?.text).toBe('de volta');
  });

  it('truncates, drops empty text and rejects malformed payloads', () => {
    const a = login('Ana');
    const b = login('Beto');
    world.handle(a, { t: 'dm', to: 'Beto', text: 'x'.repeat(500) });
    expect(b.last('dm')!.text.length).toBe(120);
    const n = b.all('dm').length;
    world.handle(a, { t: 'dm', to: 'Beto', text: '   ' });
    expect(b.all('dm').length).toBe(n);
    const bad = [
      { t: 'dm', to: 5, text: 'x' },
      { t: 'dm', to: 'Beto', text: {} },
      { t: 'dm', text: 'x' },
      { t: 'dm', to: '', text: 'x' },
      { t: 'dm', to: 'y'.repeat(200), text: 'x' },
    ];
    for (const m of bad) {
      world.handle(a, m as never);
      expect(a.last('error')?.code).toBe('bad_message');
    }
    expect(b.all('dm').length).toBe(n);
  });
});

describe('team chat', () => {
  it('reaches everyone in the same team in any room and echoes to the sender', () => {
    const a = login('Ana', 'vendas');
    const b = login('Beto', 'vendas');
    world.enterRoom(b.player!, 'lounge');
    world.handle(a, { t: 'team', text: 'bom dia time' });
    expect(b.last('team')).toMatchObject({ team: 'vendas', from: 'Ana', self: false, text: 'bom dia time' });
    expect(a.last('team')).toMatchObject({ self: true });
  });

  it('never leaks to another team, nor to the public chat', () => {
    const a = login('Ana', 'vendas');
    const b = login('Beto', 'vendas');
    const c = login('Caio', 'dev');
    const d = login('Duda'); // default team "geral"
    world.handle(a, { t: 'team', text: 'confidencial' });
    expect(b.all('team')).toHaveLength(1);
    expect(c.all('team')).toHaveLength(0);
    expect(d.all('team')).toHaveLength(0);
    for (const conn of [a, b, c, d]) expect(conn.all('chat')).toHaveLength(0);
    world.handle(d, { t: 'team', text: 'só geral' });
    expect(a.all('team')).toHaveLength(1); // just its own earlier echo
    expect(c.all('team')).toHaveLength(0);
    expect(d.all('team')).toHaveLength(1);
  });

  it('groups accounts without a team under "geral"', () => {
    const a = login('Ana');
    const b = login('Beto');
    world.handle(a, { t: 'team', text: 'oi geral' });
    expect(b.last('team')).toMatchObject({ team: 'Geral', text: 'oi geral' });
  });

  it('sanitises, rate limits and rejects malformed messages', () => {
    const a = login('Ana');
    const b = login('Beto');
    world.handle(a, { t: 'team', text: ' a‮b ' });
    expect(b.last('team')?.text).toBe('a b');
    for (let i = 0; i < 10; i++) world.handle(a, { t: 'team', text: `m${i}` });
    expect(a.last('error')?.code).toBe('rate_limited');
    world.handle(a, { t: 'team', text: 42 } as never);
    expect(a.last('error')?.code).toBe('bad_message');
  });
});
