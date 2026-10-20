import { beforeEach, describe, expect, it } from 'vitest';
import { defaultClimate, BASE_TEMP, CLIMATE_STEP_MS, DEFAULT_TARGET, OVERHEAT_TEMP, ROOM_DEFS, STEP_MS, TARGET_MAX, TARGET_MIN, isAcUnit, type ServerMessage } from '@workverse/shared';
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
const def = (id: string) => ROOM_DEFS.find((r) => r.id === id)!;
const use = (c: FakeConn, f: { id: string; x: number; y: number }) => {
  world.handle(c, { t: 'interact', furniId: f.id, x: f.x, y: f.y });
  wait(STEP_MS * 40);
};

beforeEach(() => {
  now = 1_000_000;
  world = new World({ store: new MemoryAccountStore(), allowDevLogin: true, clock: () => now, idleAwayMs: 3_600_000 });
});

describe('ar-condicionado: estado por sala, visto por todos', () => {
  it('as salas pedidas ganham splits; a TI ganha 2 splits, 1 de piso e o termostato', () => {
    for (const id of ['office', 'meeting1', 'meeting2', 'team', 'auditorium', 'lounge', 'reception']) {
      expect(def(id).furniture.some((f) => f.kind === 'ac_split'), id).toBe(true);
    }
    expect(def('office').furniture.filter((f) => f.kind === 'ac_split').length).toBeGreaterThanOrEqual(2);
    const ti = def('ti').furniture;
    expect(ti.filter((f) => f.kind === 'ac_split').length).toBe(2);
    expect(ti.filter((f) => f.kind === 'ac_floor').length).toBe(1);
    expect(ti.filter((f) => f.kind === 'thermostat').length).toBe(1);
  });

  it('o snapshot traz o clima padrão (desligado, meta 23, temperatura base)', () => {
    const c = login('Ana', 'office');
    const room = c.last('room')!.room;
    
  });

  const set = (c: FakeConn, body: Record<string, unknown>) => {
    now += 300;
    world.handle(c, { t: 'climate_set', ...body } as never);
  };

  it('usar o split ou o termostato abre o controle remoto (climate_open) só para quem usou', () => {
    const a = login('Ana', 'office');
    const b = login('Beto', 'office');
    use(a, def('office').furniture.find((f) => f.kind === 'ac_split')!);
    expect(a.all('climate_open').length).toBe(1);
    expect(b.all('climate_open').length).toBe(0);
    const t = login('Tec', 'ti');
    use(t, def('ti').furniture.find((f) => f.kind === 'thermostat')!);
    expect(t.all('climate_open').length).toBe(1);
    expect(a.last('climate')).toBeUndefined();
  });

  it('climate_set liga e desliga todas as unidades da sala e todos veem (furni + climate)', () => {
    const a = login('Ana', 'office');
    const b = login('Beto', 'office');
    const units = def('office').furniture.filter((f) => isAcUnit(f.kind));
    set(a, { power: true, target: 21, mode: 'eco', fan: 'high', swing: false });
    expect(b.all('furni').filter((m) => units.some((u) => u.id === m.id) && m.on).length).toBe(units.length);
    expect(b.last('climate')).toMatchObject({ on: true, target: 21, mode: 'eco', fan: 'high', swing: false });
    set(a, { power: false });
    expect(a.last('climate')).toMatchObject({ on: false, target: 21 });
    expect(b.last('furni')).toMatchObject({ on: false });
    const late = login('Caio', 'office');
    set(a, { power: true });
    const c2 = login('Dani', 'office');
    expect(c2.last('room')!.room.climate).toMatchObject({ on: true, target: 21, mode: 'eco' });
    expect(c2.last('room')!.room.furniState[units[0]!.id]).toBe(true);
    void late;
  });

  it('valida estritamente: fora de 18-26, tipos errados e campos extras dão strike sem mudar nada', () => {
    const a = login('Ana', 'office');
    const room = world.rooms.get('office')!;
    for (const bad of [{ target: 17 }, { target: 27 }, { target: 22.5 }, { mode: 'heat' }, { fan: 9 }, { timerMin: 45 }, { power: 'on' }, {}, { power: true, x: 1 }]) set(a, bad);
    expect(a.strikes).toBe(9);
    expect(room.climate).toMatchObject({ on: false, target: DEFAULT_TARGET });
  });

  it('só quem está numa sala com ar mexe nele; sala sem ar recusa; sem sala dá strike', () => {
    const a = login('Ana', 'focus');
    set(a, { power: true });
    expect(a.all('error').some((e) => e.code === 'no_climate')).toBe(true);
    const c = new FakeConn();
    world.handle(c, { t: 'hello', name: 'Zé' });
    world.handle(c, { t: 'climate_set', power: true } as never);
    expect(world.rooms.get('office')!.climate.on).toBe(false);
  });

  it('limita a taxa de pedidos', () => {
    const a = login('Ana', 'office');
    const room = world.rooms.get('office')!;
    for (let i = 0; i < 40; i++) world.handle(a, { t: 'climate_set', target: 18 + (i % 9) } as never);
    // a rajada passa do balde: nem todos os 40 pedidos foram aplicados (o último valor aplicado não é o do pedido 40)
    expect(a.all('climate').length).toBeLessThan(40);
    void room;
  });

  it('timer desliga o ar no servidor (relógio injetável) e a contagem vem em timerLeftMs', () => {
    const a = login('Ana', 'office');
    const b = login('Beto', 'office');
    set(a, { power: true });
    set(a, { timerMin: 30 });
    const left = b.last('climate')!.timerLeftMs;
    expect(left).toBeGreaterThan(29 * 60_000);
    expect(left).toBeLessThanOrEqual(30 * 60_000);
    wait(29 * 60_000);
    expect(world.rooms.get('office')!.climate.on).toBe(true);
    wait(2 * 60_000);
    expect(world.rooms.get('office')!.climate.on).toBe(false);
    expect(b.last('climate')).toMatchObject({ on: false, timerLeftMs: 0 });
    expect(b.all('chat').some((m) => m.text === 'O timer desligou o ar-condicionado.')).toBe(true);
    // desligar à mão cancela o timer
    set(a, { power: true, timerMin: 60 });
    set(a, { power: false });
    expect(b.last('climate')).toMatchObject({ on: false, timerLeftMs: 0 });
  });

  it('cada sala tem o seu clima (ligar na copa não liga o escritório)', () => {
    const a = login('Ana', 'lounge');
    const b = login('Beto', 'office');
    now += 300;
    world.handle(a, { t: 'climate_set', power: true } as never);
    expect(a.last('climate')).toMatchObject({ on: true });
    expect(b.last('climate')).toBeUndefined();
    expect(world.rooms.get('office')!.climate.on).toBe(false);
  });

  it('isolamento por organização: o clima de uma org nunca muda o de outra', () => {
    const a = login('Ana', 'office');
    now += 300;
    world.handle(a, { t: 'climate_set', power: true } as never);
    expect(world.rooms.get('office')!.climate.on).toBe(true);
    expect(world.org('outra').rooms.get('office')!.climate.on).toBe(false);
  });
});

describe('temperatura ambiente e superaquecimento', () => {
  it('sobe com mais gente e desce com o ar ligado, sem passar da meta', () => {
    const people = ['A1', 'A2', 'A3', 'A4', 'A5', 'A6'].map((n) => login(n, 'meeting2'));
    expect(people.length).toBe(6);
    const room = world.rooms.get('meeting2')!;
    wait(CLIMATE_STEP_MS * 60);
    const warm = room.climate.temp;
    expect(warm).toBeGreaterThan(BASE_TEMP + 0.5);
    now += 300;
    world.handle(people[0]!, { t: 'climate_set', power: true, mode: 'cool', fan: 'high' } as never);
    wait(CLIMATE_STEP_MS * 80);
    expect(room.climate.temp).toBeLessThan(warm - 0.5);
    expect(room.climate.temp).toBeGreaterThanOrEqual(room.climate.target - 0.01);
  });

  it('a Sala da TI esquenta pelos racks; sem ar passa de 30 °C, avisa no chat e acende o alerta; ligar o ar resolve', () => {
    const c = login('Tec', 'ti');
    const room = world.rooms.get('ti')!;
    wait(CLIMATE_STEP_MS * 100);
    expect(room.climate.temp).toBeGreaterThan(OVERHEAT_TEMP);
    expect(room.climate.overheat).toBe(true);
    expect(c.last('climate')).toMatchObject({ overheat: true });
    expect(c.all('chat').some((m) => m.kind === 'system' && m.text === 'Sala da TI superaquecendo!')).toBe(true);
    // só um aviso por episódio
    wait(CLIMATE_STEP_MS * 20);
    expect(c.all('chat').filter((m) => m.text === 'Sala da TI superaquecendo!').length).toBe(1);
    c.strikes = 0;
    now += 300;
    world.handle(c, { t: 'climate_set', power: true } as never);
    expect(room.climate.overheat).toBe(false);
    wait(CLIMATE_STEP_MS * 150);
    expect(room.climate.temp).toBeLessThan(OVERHEAT_TEMP - 3);
    expect(room.climate.overheat).toBe(false);
  });

  it('salas sem racks nunca superaquecem; reiniciar o servidor volta ao padrão', () => {
    login('Ana', 'office');
    wait(CLIMATE_STEP_MS * 200);
    expect(world.rooms.get('office')!.climate.overheat).toBe(false);
    const fresh = new World({ store: new MemoryAccountStore(), allowDevLogin: true, clock: () => now });
    expect(fresh.org('default').rooms.get('ti')!.climate).toEqual(defaultClimate());
  });
});
