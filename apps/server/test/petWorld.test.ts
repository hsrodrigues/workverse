import { beforeEach, describe, expect, it } from 'vitest';
import type { ClientMessage, ServerMessage } from '@workverse/shared';
import { World, type Connection } from '../src/world';
import { MemoryAccountStore } from '../src/store';

class FakeConn implements Connection {
  strikes = 0;
  accountId?: string;
  player?: Connection['player'];
  inbox: ServerMessage[] = [];
  send(msg: ServerMessage) {
    this.inbox.push(msg);
  }
  close() {}
  all<T extends ServerMessage['t']>(t: T) {
    return this.inbox.filter((m) => m.t === t) as Extract<ServerMessage, { t: T }>[];
  }
  last<T extends ServerMessage['t']>(t: T) {
    return this.all(t).at(-1);
  }
}

let now = 7_000_000;
let store: MemoryAccountStore;
let world: World;
let logs: Array<{ event: string; data?: Record<string, unknown> }>;
const mk = (pet?: boolean) => {
  logs = [];
  store = new MemoryAccountStore();
  world = new World({ store, allowDevLogin: true, clock: () => now, bootstrapStaffEmails: 'helper@x.com:helper,mod@x.com:moderator', pet, log: (event, data) => logs.push({ event, data }) });
};
const login = (name: string, email?: string, room = 'lounge') => {
  if (email && !store.getByName(name)) store.create({ email, displayName: name, passwordHash: '' });
  const c = new FakeConn();
  world.handle(c, { t: 'hello', name });
  world.handle(c, { t: 'join', roomId: room });
  return c;
};
const send = (c: FakeConn, msg: Record<string, unknown>) => {
  now += 1000;
  world.handle(c, msg as ClientMessage);
};

beforeEach(() => {
  now = 7_000_000;
  mk();
});

describe('Byte no mundo', () => {
  it('quem entra numa sala permitida recebe o pet logo depois da sala; sala de foco (restrita ao Byte) recebe null', () => {
    const a = login('Ana');
    const kinds = a.inbox.map((m) => m.t).filter((t) => t === 'room' || t === 'pet');
    expect(kinds.slice(0, 2)).toEqual(['room', 'pet']);
    expect(a.last('pet')!.pet).not.toBeNull();
    send(a, { t: 'join', roomId: 'focus' });
    expect(a.last('pet')).toEqual({ t: 'pet', pet: null });
  });

  it('pet_do passa pelo mundo: carinho gera coracoes; mensagem malformada conta strike', () => {
    const a = login('Ana');
    const b = login('Beto');
    const pet = world.pets.petOf(a.player!.orgId)!;
    a.player!.x = pet.x;
    a.player!.y = pet.y;
    send(a, { t: 'pet_do', act: 'pat' });
    expect(b.all('pet_act').some((m) => m.fx === 'hearts')).toBe(true);
    const before = a.strikes;
    send(a, { t: 'pet_do', act: 'xyz' });
    expect(a.strikes).toBeGreaterThan(before);
  });

  it('PET desligado no mundo: nada de pet, pet_do responde pet_off', () => {
    mk(false);
    const a = login('Ana');
    expect(a.all('pet')).toHaveLength(0);
    send(a, { t: 'pet_do', act: 'pat' });
    expect(a.last('error')).toMatchObject({ code: 'pet_off' });
  });

  it('nao aparece em onlineCount nem na lista de jogadores da sala', () => {
    const a = login('Ana');
    expect(world.onlineCount).toBe(1);
    const room = a.last('room')!.room;
    expect(room.players.map((p) => p.name)).toEqual(['Ana']);
  });
});

describe('staff: controle do Byte', () => {
  const duty = (c: FakeConn) => send(c, { t: 'chat', text: '/staff on' });

  it('quem nao e staff nao controla (erro generico) e a auditoria nao registra nada', () => {
    const a = login('Ana');
    send(a, { t: 'staff_pet', op: 'off' });
    expect(world.pets.list()[0]!.enabled).toBe(true);
    expect(logs.filter((l) => l.event === 'staff.action' && String(l.data?.action).startsWith('pet.'))).toHaveLength(0);
  });

  it('helper so lista; moderador desliga, liga, renomeia e leva o pet, tudo auditado', () => {
    const h = login('Hele', 'helper@x.com');
    duty(h);
    send(h, { t: 'staff_pet', op: 'list' });
    expect(h.last('staff_pet')!.pets.length).toBeGreaterThan(0);
    send(h, { t: 'staff_pet', op: 'off' });
    expect(world.pets.list()[0]!.enabled).toBe(true);

    const m = login('Moda', 'mod@x.com', 'lounge');
    duty(m);
    const org = m.player!.orgId;
    send(m, { t: 'staff_pet', op: 'off' });
    expect(world.pets.list().find((e) => e.orgId === org)!.enabled).toBe(false);
    expect(m.last('pet')).toEqual({ t: 'pet', pet: null });
    send(m, { t: 'staff_pet', op: 'on' });
    expect(m.last('pet')!.pet).not.toBeNull();
    send(m, { t: 'staff_pet', op: 'rename', name: 'Bit' });
    expect(m.last('pet')!.pet!.name).toBe('Bit');
    send(m, { t: 'staff_pet', op: 'rename', name: '<x>' });
    expect(world.pets.list().find((e) => e.orgId === org)!.name).toBe('Bit');
    send(m, { t: 'join', roomId: 'office' });
    send(m, { t: 'staff_pet', op: 'bring' });
    expect(world.pets.petOf(org)!.roomId).toBe('office');
    const actions = logs.filter((l) => l.event === 'staff.action').map((l) => l.data?.action);
    expect(actions).toEqual(expect.arrayContaining(['pet.off', 'pet.on', 'pet.rename', 'pet.bring']));
  });

  it('operacao ou organizacao invalidas nao fazem nada', () => {
    const m = login('Moda', 'mod@x.com');
    duty(m);
    send(m, { t: 'staff_pet', op: 'on', orgId: 'nao-existe' });
    expect(m.all('chat').some((c) => /Organiza/.test(c.text))).toBe(true);
    const before = m.strikes;
    send(m, { t: 'staff_pet', op: 'explodir' });
    expect(m.strikes).toBeGreaterThan(before);
  });
});
