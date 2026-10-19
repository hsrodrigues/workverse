import { beforeEach, describe, expect, it } from 'vitest';
import { FURNI_DELAY_MS, FURNI_HOLDS, HELD_CHAT, HELD_ITEMS, HOLD_MS, ROOM_DEFS, STEP_MS, type FurniKind, type ServerMessage } from '@workverse/shared';
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
}

const whereIs = (kind: FurniKind) => {
  const def = ROOM_DEFS.find((r) => r.furniture.some((f) => f.kind === kind))!;
  return { def, f: def.furniture.find((f) => f.kind === kind)! };
};

let now = 1_000_000;
let world: World;
const login = (name: string, roomId: string): FakeConn => {
  const c = new FakeConn();
  world.handle(c, { t: 'hello', name });
  world.handle(c, { t: 'join', roomId });
  return c;
};
const wait = (ms: number) => {
  const end = now + ms;
  while (now < end) {
    now = Math.min(end, now + 250);
    world.tick(now);
  }
};
const interact = (c: FakeConn, f: { id: string; x: number; y: number }) => world.handle(c, { t: 'interact', furniId: f.id, x: f.x, y: f.y });

beforeEach(() => {
  now = 1_000_000;
  world = new World({ store: new MemoryAccountStore(), allowDevLogin: true, clock: () => now, idleAwayMs: 3_600_000 });
});

describe('vending machines and microwave: catalog', () => {
  it('are usable pieces that hand out their own item', () => {
    expect(FURNI_HOLDS.snack_machine).toBe('snack');
    expect(FURNI_HOLDS.soda_machine).toBe('soda');
    expect(FURNI_HOLDS.microwave).toBe('meal');
    expect(FURNI_DELAY_MS.microwave).toBeGreaterThan(0);
    for (const item of ['snack', 'soda', 'meal'] as const) {
      expect(HELD_ITEMS).toContain(item);
      expect(HELD_CHAT[item].length).toBeGreaterThan(3);
    }
  });

  it('exist in the copa, the reception and the IT room', () => {
    const has = (room: string, kind: FurniKind) => ROOM_DEFS.find((r) => r.id === room)!.furniture.some((f) => f.kind === kind);
    expect(has('lounge', 'snack_machine') && has('lounge', 'soda_machine') && has('lounge', 'microwave')).toBe(true);
    expect(has('reception', 'snack_machine')).toBe(true);
    expect(has('ti', 'snack_machine') && has('ti', 'soda_machine') && has('ti', 'microwave')).toBe(true);
  });
});

describe('using the machines on the server', () => {
  for (const [kind, item] of [['snack_machine', 'snack'], ['soda_machine', 'soda']] as const) {
    it(`${kind}: the player walks there, holds a ${item}, the room sees it and a system line is written`, () => {
      const at = whereIs(kind);
      const a = login('Ana', at.def.id);
      const b = login('Beto', at.def.id);
      interact(a, at.f);
      wait(STEP_MS * 40);
      expect(a.player!.activity).toBe(`holding:${item}`);
      expect(b.last('activity')).toEqual({ t: 'activity', id: a.player!.id, activity: `holding:${item}` });
      expect(b.last('chat')).toMatchObject({ kind: 'system', text: `Ana ${HELD_CHAT[item]}` });
      wait(HOLD_MS);
      expect(a.player!.activity).toBe('idle');
    });
  }

  it('the microwave lights up first and only then hands the lunch box', () => {
    const at = whereIs('microwave');
    const a = login('Ana', at.def.id);
    const b = login('Beto', at.def.id);
    interact(a, at.f);
    // the player has arrived (the path is short) or is walking: whenever the light turns on, the hand is still empty
    let sawOn = false;
    for (let i = 0; i < 80 && !a.player!.activity.startsWith('holding:'); i++) {
      if (world.rooms.get(at.def.id)!.furniState[at.f.id]) {
        sawOn = true;
        expect(a.player!.activity).toBe('idle');
      }
      wait(100);
    }
    expect(sawOn).toBe(true);
    expect(a.player!.activity).toBe('holding:meal');
    expect(b.last('chat')).toMatchObject({ kind: 'system', text: 'Ana esquentou a marmita no micro-ondas.' });
    // the light goes off a little after the lunch box is ready
    wait(FURNI_DELAY_MS.microwave! + 500);
    expect(world.rooms.get(at.def.id)!.furniState[at.f.id]).toBe(false);
    expect(b.last('furni')).toEqual({ t: 'furni', id: at.f.id, on: false });
  });

  it('walking away from the microwave cancels the lunch box', () => {
    const at = whereIs('microwave');
    const a = login('Ana', at.def.id);
    interact(a, at.f);
    // arrive next to it, then leave before the timer ends
    for (let i = 0; i < 200 && !world.rooms.get(at.def.id)!.furniState[at.f.id]; i++) wait(50);
    expect(world.rooms.get(at.def.id)!.furniState[at.f.id]).toBe(true);
    const spawn = at.def.spawn;
    world.handle(a, { t: 'move', x: spawn.x, y: spawn.y });
    wait(FURNI_DELAY_MS.microwave! + 2000);
    expect(a.player!.activity).not.toBe('holding:meal');
  });

  it('a late joiner sees the item in the hand', () => {
    const at = whereIs('soda_machine');
    const a = login('Ana', at.def.id);
    interact(a, at.f);
    wait(STEP_MS * 40);
    const c = login('Caio', at.def.id);
    expect(c.last('room')!.room.players.find((p) => p.name === 'Ana')!.activity).toBe('holding:soda');
  });
});
