import { beforeEach, describe, expect, it } from 'vitest';
import { FURNI_KINDS, HOLD_MS, ROOM_DEFS, STEP_MS, type Furniture, type ServerMessage } from '@workverse/shared';
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

// The layouts belong to other people: everything below is derived from them, never hard-coded.
const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];
const office = ROOM_DEFS.find((r) => r.id === 'office')!;
const footprintAt = (def: { furniture: Furniture[] }, x: number, y: number) => def.furniture.filter((f) => f.x === x && f.y === y);
/** A chair of the office whose front tile holds a computer, and the computer. */
const workSeat = (() => {
  for (const f of office.furniture) {
    if (f.kind !== 'chair') continue;
    const [dx, dy] = DIRS[f.dir];
    const pc = footprintAt(office, f.x + dx, f.y + dy).find((o) => o.kind === 'computer');
    if (pc) return { chair: f, pc };
  }
  throw new Error('no workstation in the office');
})();
/** A seat of the office that faces no computer. */
const plainSeat = office.furniture.find((f) => {
  if (!FURNI_KINDS[f.kind].seat) return false;
  const [dx, dy] = DIRS[f.dir % 4];
  return !footprintAt(office, f.x + dx, f.y + dy).some((o) => o.kind === 'computer');
})!;
const deskChair = workSeat.chair;
const deskPc = workSeat.pc;
const meetingChair = plainSeat;
const whereIs = (kind: string) => {
  const def = ROOM_DEFS.find((r) => r.furniture.some((f) => f.kind === kind))!;
  return { def, f: def.furniture.find((f) => f.kind === kind)! };
};
const coffeeAt = whereIs('coffee');
const coolerAt = whereIs('cooler');
const fridgeAt = whereIs('fridge');
const coffee = coffeeAt.f;
const cooler = coolerAt.f;

let now = 1_000_000;
let world: World;

function login(name: string, roomId = 'office'): FakeConn {
  const c = new FakeConn();
  world.handle(c, { t: 'hello', name });
  world.handle(c, { t: 'join', roomId });
  return c;
}

/** Lets time pass in small steps (the rate limiter refills and the server tick runs). */
function wait(ms: number) {
  const end = now + ms;
  while (now < end) {
    now = Math.min(end, now + 500);
    world.tick(now);
  }
}

const sitAt = (c: FakeConn, chair = deskChair) => {
  world.handle(c, { t: 'interact', furniId: chair.id, x: chair.x, y: chair.y });
  wait(STEP_MS * 30);
};
const use = (c: FakeConn, f: { id: string; x: number; y: number }) => {
  world.handle(c, { t: 'interact', furniId: f.id, x: f.x, y: f.y });
  wait(STEP_MS * 30);
};
const room = (id = 'office') => world.rooms.get(id)!;
const away = { x: office.spawn.x, y: office.spawn.y };

beforeEach(() => {
  now = 1_000_000;
  world = new World({ store: new MemoryAccountStore(), allowDevLogin: true, clock: () => now, idleAwayMs: 3_600_000 });
});

describe('working at a PC', () => {
  it('sitting in a chair that faces a computer starts working, turns the monitor on and tells everyone', () => {
    const a = login('Ana');
    const b = login('Beto');
    sitAt(a);
    expect(a.player!.activity).toBe('working');
    expect(b.last('activity')).toEqual({ t: 'activity', id: a.player!.id, activity: 'working' });
    expect(b.last('furni')).toEqual({ t: 'furni', id: deskPc.id, on: true });
    expect(room().furniState[deskPc.id]).toBe(true);
  });

  it('a chair that faces no computer is just a seat', () => {
    const a = login('Ana');
    sitAt(a, meetingChair);
    expect(a.player!.sitting).toBe(true);
    expect(a.player!.activity).toBe('idle');
    expect(a.all('activity')).toHaveLength(0);
  });

  it('someone who joins later sees the worker and the lit monitor', () => {
    const a = login('Ana');
    sitAt(a);
    const c = login('Caio');
    const snap = c.last('room')!.room;
    expect(snap.players.find((p) => p.name === 'Ana')!.activity).toBe('working');
    expect(snap.furniState[deskPc.id]).toBe(true);
  });

  it('standing up clears the state and switches the monitor off', () => {
    const a = login('Ana');
    const b = login('Beto');
    sitAt(a);
    world.handle(a, { t: 'move', ...away });
    expect(a.player!.activity).toBe('idle');
    expect(b.last('activity')).toEqual({ t: 'activity', id: a.player!.id, activity: 'idle' });
    expect(b.last('furni')).toEqual({ t: 'furni', id: deskPc.id, on: false });
    expect(b.all('sit')).toHaveLength(1);
    expect(room().furniState[deskPc.id]).toBe(false);
  });

  it('leaving the room or disconnecting while working also clears everything', () => {
    const a = login('Ana');
    const b = login('Beto');
    sitAt(a);
    world.disconnect(a);
    expect(b.last('furni')).toEqual({ t: 'furni', id: deskPc.id, on: false });
    expect(room().furniState[deskPc.id]).toBe(false);
  });

  it('clicking the monitor of someone who is working does not switch it off', () => {
    const a = login('Ana');
    const b = login('Beto');
    sitAt(a);
    use(b, deskPc);
    expect(room().furniState[deskPc.id]).toBe(true);
  });

  it('suggests "focus" only over "available" and gives it back on standing up', () => {
    const a = login('Ana');
    const b = login('Beto');
    sitAt(a);
    expect(a.player!.status).toBe('focus');
    expect(b.last('status')).toEqual({ t: 'status', id: a.player!.id, status: 'focus' });
    world.handle(a, { t: 'move', ...away });
    expect(a.player!.status).toBe('available');
  });

  it('never overwrites a status the player chose', () => {
    const a = login('Ana');
    world.handle(a, { t: 'status', status: 'busy' });
    sitAt(a);
    expect(a.player!.activity).toBe('working');
    expect(a.player!.status).toBe('busy');
    world.handle(a, { t: 'move', ...away });
    expect(a.player!.status).toBe('busy');
  });

  it('a status chosen while working survives standing up', () => {
    const a = login('Ana');
    sitAt(a);
    wait(300);
    world.handle(a, { t: 'status', status: 'focus' });
    world.handle(a, { t: 'move', ...away });
    expect(a.player!.status).toBe('focus');
  });
});

describe('cups from the coffee machine and the cooler', () => {
  it('the coffee machine hands out a coffee, visible to the room, with a system chat line', () => {
    const a = login('Ana', coffeeAt.def.id);
    const b = login('Beto', coffeeAt.def.id);
    use(a, coffee);
    expect(a.player!.activity).toBe('holding:coffee');
    expect(b.last('activity')).toEqual({ t: 'activity', id: a.player!.id, activity: 'holding:coffee' });
    expect(b.last('chat')).toMatchObject({ kind: 'system', text: 'Ana pegou um café.' });
  });

  it('the water cooler (now usable) hands out a glass of water', () => {
    const a = login('Ana', coolerAt.def.id);
    const b = login('Beto', coolerAt.def.id);
    use(a, cooler);
    expect(a.player!.activity).toBe('holding:water');
    expect(b.last('activity')?.activity).toBe('holding:water');
    expect(b.last('chat')).toMatchObject({ kind: 'system', text: expect.stringContaining('Ana pegou um copo') });
  });

  it('the fridge hands out water too', () => {
    const a = login('Ana', fridgeAt.def.id);
    use(a, fridgeAt.f);
    expect(a.player!.activity).toBe('holding:water');
  });

  it('late joiners see what is held', () => {
    const a = login('Ana', coffeeAt.def.id);
    use(a, coffee);
    const c = login('Caio', coffeeAt.def.id);
    expect(c.last('room')!.room.players.find((p) => p.name === 'Ana')!.activity).toBe('holding:coffee');
  });

  it('keeps the cup while walking and puts it down after the hold time', () => {
    const a = login('Ana', coffeeAt.def.id);
    const b = login('Beto', coffeeAt.def.id);
    use(a, coffee);
    world.handle(a, { t: 'move', ...away });
    wait(STEP_MS * 12);
    expect(a.player!.activity).toBe('holding:coffee');
    wait(HOLD_MS);
    expect(a.player!.activity).toBe('idle');
    expect(b.last('activity')).toEqual({ t: 'activity', id: a.player!.id, activity: 'idle' });
  });

  it('using the machine again hands a fresh cup and restarts the timer', () => {
    const a = login('Ana', coffeeAt.def.id);
    use(a, coffee);
    wait(10_000);
    use(a, coffee);
    wait(10_000);
    expect(a.player!.activity).toBe('holding:coffee');
  });

  it('the client can put the cup down', () => {
    const a = login('Ana', coolerAt.def.id);
    const b = login('Beto', coolerAt.def.id);
    use(a, cooler);
    world.handle(a, { t: 'activity', activity: 'idle' });
    expect(a.player!.activity).toBe('idle');
    expect(b.last('activity')).toEqual({ t: 'activity', id: a.player!.id, activity: 'idle' });
  });

  it('sitting at a PC replaces the cup with work, and taking a cup stops the work', () => {
    const a = login('Ana');
    const b = login('Beto');
    use(a, cooler);
    sitAt(a);
    expect(a.player!.activity).toBe('working');
    use(a, cooler);
    expect(a.player!.activity).toBe('holding:water');
    expect(room().furniState[deskPc.id]).toBe(false);
    expect(b.last('furni')).toEqual({ t: 'furni', id: deskPc.id, on: false });
  });

  it('the cup is gone when leaving the room', () => {
    const a = login('Ana', coffeeAt.def.id);
    use(a, coffee);
    world.disconnect(a);
    const b = login('Beto', coffeeAt.def.id);
    expect(b.last('room')!.room.players.map((p) => p.name)).toEqual(['Beto']);
    expect(b.player!.activity).toBe('idle');
  });
});

describe('validation and limits', () => {
  it('the client can never claim working or holding: only the server derives them', () => {
    const a = login('Ana');
    const b = login('Beto');
    for (const activity of ['working', 'holding:coffee', 'holding:water'] as const) {
      world.handle(a, { t: 'activity', activity });
      wait(300);
      expect(a.last('error')?.code).toBe('activity_not_allowed');
    }
    expect(a.player!.activity).toBe('idle');
    expect(b.all('activity')).toHaveLength(0);
    expect(a.strikes).toBe(0);
  });

  it('unknown states are malformed messages and count as strikes', () => {
    const a = login('Ana');
    for (const activity of ['holding:tea', 'WORKING', '', 7, null, { x: 1 }]) {
      world.handle(a, { t: 'activity', activity } as never);
      wait(300);
    }
    expect(a.strikes).toBe(6);
    expect(a.last('error')?.code).toBe('bad_message');
    expect(a.player!.activity).toBe('idle');
  });

  it('is rate limited', () => {
    const a = login('Ana');
    for (let i = 0; i < 60; i++) world.handle(a, { t: 'activity', activity: 'working' });
    expect(a.all('error').filter((e) => e.code === 'activity_not_allowed').length).toBeLessThanOrEqual(12);
  });

  it('dropping with nothing in the hand is a no-op that tells nobody', () => {
    const a = login('Ana');
    const b = login('Beto');
    world.handle(a, { t: 'activity', activity: 'idle' });
    expect(b.all('activity')).toHaveLength(0);
  });

  it('a spoofed server-style message from a client is ignored as unknown', () => {
    const a = login('Ana');
    world.handle(a, { t: 'activity', id: 'someone-else', activity: 'idle' } as never);
    expect(a.strikes).toBe(0);
  });
});
