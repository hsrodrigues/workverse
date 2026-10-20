import { beforeEach, describe, expect, it } from 'vitest';
import {
  PET_LINES,
  PET_REACH,
  PET_TREAT_COOLDOWN_MS,
  ROOM_DEFS,
  STEP_MS,
  isWalkable,
  roomAccessOf,
  type PetFx,
  type ServerMessage,
} from '@workverse/shared';
import { PetManager, type PetHost } from '../src/pet';
import { Player, RoomInstance } from '../src/room';
import { World, type Connection } from '../src/world';
import { MemoryAccountStore } from '../src/store';

// ---- peças soltas: salas reais sem rede, jogadores falsos -------------------------------------------------------

const AVATAR = {} as never;
type Orgs = Record<string, Map<string, RoomInstance>>;

function makeOrgs(ids: string[]): Orgs {
  const out: Orgs = {};
  for (const id of ids) {
    const rooms = new Map<string, RoomInstance>();
    for (const def of ROOM_DEFS) rooms.set(def.id, new RoomInstance(def, { onPortal() {}, onChange() {} }));
    out[id] = rooms;
  }
  return out;
}

interface Ctl {
  state: Record<string, 'open' | 'locked' | 'closed'>;
  stage: Set<string>;
  reserved: Set<string>;
}

function makeHost(orgs: Orgs, ctl: Ctl): PetHost {
  return {
    rooms: (o) => orgs[o],
    roomState: (o, r) => ctl.state[`${o}/${r}`] ?? 'open',
    stageActive: (o, r) => ctl.stage.has(`${o}/${r}`),
    reserved: (o, r) => ctl.reserved.has(`${o}/${r}`),
    orgName: (o) => `Org ${o}`,
    orgs: () => Object.keys(orgs).map((id) => ({ id, name: `Org ${id}` })),
  };
}

/** Sorteio deterministico (LCG) para o comportamento ser reproduzivel. */
const seeded = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 2 ** 32;
};

let seq = 0;
function join(orgs: Orgs, orgId: string, roomId: string, now: number, name = `P${++seq}`) {
  const inbox: ServerMessage[] = [];
  const p = new Player(`id${seq}`, `acc${seq}`, name, AVATAR, (m) => inbox.push(m), now);
  p.orgId = orgId;
  orgs[orgId]!.get(roomId)!.add(p, ROOM_DEFS.find((d) => d.id === roomId)!.spawn, now, {});
  return { p, inbox, last: <T extends ServerMessage['t']>(t: T) => [...inbox].reverse().find((m) => m.t === t) as Extract<ServerMessage, { t: T }> | undefined };
}

let orgs: Orgs;
let ctl: Ctl;
let host: PetHost;
let now: number;
const mk = (opts: { enabled?: boolean; seed?: number } = {}) => new PetManager(host, { enabled: opts.enabled ?? true, rng: seeded(opts.seed ?? 7) });
const run = (pets: PetManager, ms: number, step = 100) => {
  const end = now + ms;
  while (now < end) {
    now += step;
    for (const rooms of Object.values(orgs)) for (const r of rooms.values()) r.tick(now);
    pets.tick(now);
  }
};

beforeEach(() => {
  seq = 0;
  now = 1_000_000;
  orgs = makeOrgs(['o1', 'o2']);
  ctl = { state: {}, stage: new Set(), reserved: new Set() };
  host = makeHost(orgs, ctl);
});

describe('o Byte nao e jogador', () => {
  it('nunca entra em room.players nem na populacao, e nao aparece como jogador na sala', () => {
    const pets = mk();
    const a = join(orgs, 'o1', 'office', now);
    pets.onEnter(a.p, 'office', now);
    expect(pets.petOf('o1')).toBeTruthy();
    for (const r of Object.values(orgs).flatMap((m) => [...m.values()])) {
      expect([...r.players.values()].every((p) => p.name !== 'Byte')).toBe(true);
    }
    expect(orgs.o1!.get('office')!.players.size).toBe(1);
    const view = a.last('pet')!;
    expect(view.pet?.name).toBe('Byte');
  });

  it('no World real: nao conta em onlineCount, population, visiblePopulation, lista de staff nem busca no diretorio', () => {
    let t = 5_000_000;
    const world = new World({ store: new MemoryAccountStore(), allowDevLogin: true, clock: () => t, idleAwayMs: 3_600_000 });
    class C implements Connection {
      strikes = 0;
      accountId?: string;
      player?: Connection['player'];
      inbox: ServerMessage[] = [];
      send(m: ServerMessage) {
        this.inbox.push(m);
      }
      close() {}
    }
    const c = new C();
    world.handle(c, { t: 'hello', name: 'Ana' });
    world.handle(c, { t: 'join', roomId: 'lounge' });
    world.tick(t);
    expect(world.onlineCount).toBe(1);
    expect(world.pets.petOf('default')?.roomId ?? world.pets.petOf([...world.orgWorlds.keys()][0]!)?.roomId).toBeTruthy();
    const pop = world.population();
    expect(Object.values(pop).reduce((a, b) => a + b, 0)).toBe(1);
    expect(world.roomsOverview().flatMap((r) => r.players).map((p) => p.name)).toEqual(['Ana']);
    expect(world.visiblePopulation(c.player!)).toMatchObject({ lounge: 1 });
    const org = [...world.orgWorlds.values()][0]!;
    expect([...org.players()].map((p) => p.name)).toEqual(['Ana']);
    const joined = c.inbox.filter((m) => m.t === 'room')[0] as Extract<ServerMessage, { t: 'room' }>;
    expect(joined.room.players.map((p) => p.name)).toEqual(['Ana']);
    expect(c.inbox.some((m) => m.t === 'pet')).toBe(true);
  });
});

describe('salas permitidas', () => {
  it('quem entra numa sala restrita (privada, foco) nao recebe o Byte (so um null)', () => {
    const pets = mk();
    const a = join(orgs, 'o1', 'private', now);
    pets.onEnter(a.p, 'private', now);
    expect(a.last('pet')).toEqual({ t: 'pet', pet: null });
    const f = join(orgs, 'o1', 'focus', now);
    pets.onEnter(f.p, 'focus', now);
    expect(f.last('pet')).toEqual({ t: 'pet', pet: null });
    // o pet existe, mas numa sala permitida
    const room = pets.petOf('o1')!.roomId;
    expect(pets.roomAllowed('o1', room)).toBe(true);
  });

  it('durante muito tempo e muitos sorteios, o Byte so passa por salas org/abertas e tiles andaveis', () => {
    for (const seed of [1, 2, 3, 4]) {
      const pets = mk({ seed });
      const a = join(orgs, 'o1', 'reception', now);
      const b = join(orgs, 'o1', 'lounge', now);
      pets.onEnter(a.p, 'reception', now);
      pets.onEnter(b.p, 'lounge', now);
      const visited = new Set<string>();
      for (let i = 0; i < 6000; i++) {
        run(pets, 100);
        const pet = pets.petOf('o1')!;
        if (!pet.roomId) continue;
        visited.add(pet.roomId);
        const room = orgs.o1!.get(pet.roomId)!;
        const def = room.built.def;
        expect(roomAccessOf(def)).toBe('org');
        expect(['private', 'focus']).not.toContain(def.type);
        const sat = pet.state === 'sit';
        expect(sat || isWalkable(room.built.grid, pet.x, pet.y) || room.built.furniAt.has(pet.y * room.built.grid.width + pet.x)).toBe(true);
      }
      expect(visited.has('private')).toBe(false);
      expect(visited.has('focus')).toBe(false);
      expect(visited.size).toBeGreaterThan(1);
    }
  });

  it('sala trancada/fechada, palco ativo ou reservada: o Byte sai e as pessoas la ficam sem pet', () => {
    const pets = mk();
    const a = join(orgs, 'o1', 'lounge', now);
    pets.onEnter(a.p, 'lounge', now);
    const petRoom = () => pets.petOf('o1')!.roomId;
    expect(petRoom()).toBe('lounge');
    ctl.state['o1/lounge'] = 'locked';
    run(pets, 200);
    expect(petRoom()).not.toBe('lounge');
    expect(a.last('pet')).toEqual({ t: 'pet', pet: null });
    ctl.state['o1/lounge'] = 'open';
    const room = petRoom();
    ctl.reserved.add(`o1/${room}`);
    run(pets, 200);
    expect(petRoom()).not.toBe(room);
    ctl.reserved.clear();
    const room2 = petRoom();
    ctl.stage.add(`o1/${room2}`);
    run(pets, 200);
    expect(petRoom()).not.toBe(room2);
  });

  it('o auditorio so e permitido sem apresentador', () => {
    const pets = mk();
    expect(pets.roomAllowed('o1', 'auditorium')).toBe(true);
    ctl.stage.add('o1/auditorium');
    expect(pets.roomAllowed('o1', 'auditorium')).toBe(false);
    expect(pets.roomAllowed('o1', 'private')).toBe(false);
    expect(pets.roomAllowed('o1', 'focus')).toBe(false);
    expect(pets.roomAllowed('o1', 'nao-existe')).toBe(false);
  });

  it('com todas as salas indisponiveis ele some e volta quando alguma abre', () => {
    const pets = mk();
    const a = join(orgs, 'o1', 'reception', now);
    pets.onEnter(a.p, 'reception', now);
    for (const id of orgs.o1!.keys()) ctl.state[`o1/${id}`] = 'closed';
    run(pets, 300);
    expect(pets.petOf('o1')!.roomId).toBe('');
    ctl.state['o1/reception'] = 'open';
    run(pets, 6000);
    expect(pets.petOf('o1')!.roomId).toBe('reception');
  });
});

describe('comportamento por tick (relogio injetado)', () => {
  it('passeia: manda pet_path validos, com a sala vendo o mesmo caminho', () => {
    const pets = mk({ seed: 11 });
    const a = join(orgs, 'o1', 'lounge', now);
    const b = join(orgs, 'o1', 'lounge', now);
    pets.onEnter(a.p, 'lounge', now);
    pets.onEnter(b.p, 'lounge', now);
    run(pets, 120_000);
    const pa = a.inbox.filter((m) => m.t === 'pet_path');
    expect(pa.length).toBeGreaterThan(2);
    // as duas pessoas recebem exatamente as mesmas mensagens de pet
    const petMsgs = (i: ServerMessage[]) => i.filter((m) => m.t === 'pet_path' || m.t === 'pet_act').map((m) => JSON.stringify(m));
    expect(petMsgs(b.inbox)).toEqual(petMsgs(a.inbox));
    const room = orgs.o1!.get('lounge')!;
    for (const m of pa) {
      if (m.t !== 'pet_path') continue;
      let prev = m.from;
      for (const s of m.path) {
        expect(Math.max(Math.abs(s.x - prev.x), Math.abs(s.y - prev.y))).toBe(1);
        prev = s;
      }
      if (m.path.length) {
        const last = m.path[m.path.length - 1]!;
        const f = room.built.furniAt.get(last.y * room.built.grid.width + last.x);
        expect(isWalkable(room.built.grid, last.x, last.y) || (f?.length ?? 0) > 0).toBe(true);
      }
    }
  });

  it('dorme quando a sala esta vazia e nada anda sem ninguem online', () => {
    const pets = mk({ seed: 5 });
    const a = join(orgs, 'o1', 'reception', now);
    pets.onEnter(a.p, 'reception', now);
    run(pets, 5_000);
    orgs.o1!.get('reception')!.remove(a.p);
    run(pets, 1_000);
    const pet = pets.petOf('o1')!;
    expect(pet.frozen).toBe(true);
    expect(pet.state).toBe('sleep');
    const snap = { x: pet.x, y: pet.y, roomId: pet.roomId };
    run(pets, 600_000, 1000);
    expect(pets.petOf('o1')).toMatchObject(snap);
    // volta alguem: ele aparece dormindo e acorda em instantes
    const b = join(orgs, 'o1', snap.roomId, now);
    pets.onEnter(b.p, snap.roomId, now);
    expect(b.last('pet')!.pet!.state).toBe('sleep');
    run(pets, 3_500);
    expect(b.inbox.some((m) => m.t === 'pet_act' && m.state === 'idle')).toBe(true);
  });

  it('sala vazia mas org com gente em outra sala: dorme e depois vai atras de gente', () => {
    const pets = mk({ seed: 9 });
    const a = join(orgs, 'o1', 'reception', now);
    pets.onEnter(a.p, 'reception', now);
    run(pets, 1_000);
    // a pessoa muda de sala: o Byte fica na recepcao vazia
    orgs.o1!.get('reception')!.remove(a.p);
    const c = join(orgs, 'o1', 'meeting1', now);
    pets.onEnter(c.p, 'meeting1', now);
    run(pets, 90_000);
    expect(pets.petOf('o1')!.roomId).toBe('meeting1');
  });

  it('segue de leve quem o chamou e para depois de alguns segundos', () => {
    const pets = mk({ seed: 3 });
    const a = join(orgs, 'o1', 'lounge', now);
    pets.onEnter(a.p, 'lounge', now);
    run(pets, 1_000);
    expect(pets.handle(a.p, { t: 'pet_do', act: 'call' }, now)).toBe(true);
    run(pets, 6_000);
    const pet = pets.petOf('o1')!;
    expect(Math.max(Math.abs(pet.x - a.p.x), Math.abs(pet.y - a.p.y))).toBeLessThanOrEqual(2);
    run(pets, 12_000);
    expect(pets.petOf('o1')!.follow).toBeNull();
  });

  it('um pet por organizacao: o2 nao ve o pet nem as mensagens do o1', () => {
    const pets = mk();
    const a = join(orgs, 'o1', 'lounge', now);
    const b = join(orgs, 'o2', 'lounge', now);
    pets.onEnter(a.p, 'lounge', now);
    pets.onEnter(b.p, 'lounge', now);
    expect(pets.petOf('o1')).not.toBe(pets.petOf('o2'));
    expect(pets.handle(a.p, { t: 'pet_do', act: 'pat' }, now)).toBe(true);
    expect(b.inbox.filter((m) => m.t === 'pet_act' && m.fx === 'hearts')).toHaveLength(0);
    pets.setEnabled('o1', false, now);
    expect(pets.list().find((e) => e.orgId === 'o2')!.enabled).toBe(true);
    expect(b.last('pet')!.pet).not.toBeNull();
  });
});

describe('interacoes', () => {
  const setup = () => {
    const pets = mk({ seed: 21 });
    const a = join(orgs, 'o1', 'lounge', now);
    pets.onEnter(a.p, 'lounge', now);
    return { pets, a };
  };
  const fxs = (inbox: ServerMessage[]): PetFx[] => inbox.flatMap((m) => (m.t === 'pet_act' && m.fx ? [m.fx] : []));

  it('carinho: coracoes e uma fala fofa; de longe, erro', () => {
    const { pets, a } = setup();
    const pet = pets.petOf('o1')!;
    // põe a pessoa perto
    a.p.x = pet.x;
    a.p.y = pet.y;
    expect(pets.handle(a.p, { t: 'pet_do', act: 'pat' }, now)).toBe(true);
    const act = a.inbox.filter((m) => m.t === 'pet_act').pop() as Extract<ServerMessage, { t: 'pet_act' }>;
    expect(act).toMatchObject({ state: 'happy', fx: 'hearts' });
    expect(act.say).toBeTruthy();
    // longe demais
    a.p.x = pet.x + PET_REACH + 3;
    now += 5_000;
    expect(pets.handle(a.p, { t: 'pet_do', act: 'pat' }, now)).toBe(true);
    expect(a.last('error')).toMatchObject({ code: 'pet_far', message: PET_LINES.tooFar });
  });

  it('petisco: come, e tem cooldown por pessoa (outra pessoa nao e afetada)', () => {
    const { pets, a } = setup();
    const pet = pets.petOf('o1')!;
    a.p.x = pet.x;
    a.p.y = pet.y;
    const b = join(orgs, 'o1', 'lounge', now);
    b.p.x = pet.x;
    b.p.y = pet.y;
    pets.handle(a.p, { t: 'pet_do', act: 'treat' }, now);
    expect(fxs(a.inbox)).toContain('eat');
    now += 6_000;
    pets.handle(a.p, { t: 'pet_do', act: 'treat' }, now);
    expect(a.last('error')).toMatchObject({ code: 'pet_cooldown' });
    pets.handle(b.p, { t: 'pet_do', act: 'treat' }, now);
    expect(b.last('error')).toBeUndefined();
    now += PET_TREAT_COOLDOWN_MS;
    a.inbox.length = 0;
    pets.handle(a.p, { t: 'pet_do', act: 'treat' }, now);
    expect(a.last('error')).toBeUndefined();
  });

  it('petisco com lanche na mao: a pessoa entrega o lanche', () => {
    const { pets, a } = setup();
    const pet = pets.petOf('o1')!;
    a.p.x = pet.x;
    a.p.y = pet.y;
    a.p.activity = 'holding:snack';
    pets.handle(a.p, { t: 'pet_do', act: 'treat' }, now);
    expect(a.p.activity).toBe('idle');
  });

  it('brincar: persegue o ponteiro por ~5 s; ponteiro bloqueado e recusado', () => {
    const { pets, a } = setup();
    const room = orgs.o1!.get('lounge')!;
    const g = room.built.grid;
    let target = { x: 0, y: 0 };
    for (let y = 0; y < g.height; y++) for (let x = 0; x < g.width; x++) if (isWalkable(g, x, y) && Math.abs(x - 6) + Math.abs(y - 4) < 3 && !room.built.portalAt.has(y * g.width + x)) target = { x, y };
    pets.handle(a.p, { t: 'pet_do', act: 'play', x: target.x, y: target.y }, now);
    expect(pets.petOf('o1')!.play).toBeTruthy();
    run(pets, 5_800);
    run(pets, 2_000);
    expect(pets.petOf('o1')!.play).toBeNull();
    pets.handle(a.p, { t: 'pet_do', act: 'play', x: -3, y: 999 }, now + 10_000);
    expect(a.last('error')).toMatchObject({ code: 'pet_blocked' });
  });

  it('validacao estrita: acao desconhecida e coordenadas nao inteiras sao malformadas (false)', () => {
    const { pets, a } = setup();
    expect(pets.handle(a.p, { t: 'pet_do', act: 'explodir' }, now)).toBe(false);
    expect(pets.handle(a.p, { t: 'pet_do', act: 'play', x: 1.5, y: 2 }, now)).toBe(false);
    expect(pets.handle(a.p, { t: 'pet_do', act: 'play', x: '1' as never, y: 2 }, now)).toBe(false);
    expect(pets.handle(a.p, { t: 'pet_do', act: { evil: 1 } }, now)).toBe(false);
  });

  it('rate limit por pessoa e por pet', () => {
    const { pets, a } = setup();
    const pet = pets.petOf('o1')!;
    a.p.x = pet.x;
    a.p.y = pet.y;
    let slow = 0;
    for (let i = 0; i < 30; i++) {
      a.inbox.length = 0;
      pets.handle(a.p, { t: 'pet_do', act: 'pat' }, now);
      if (a.last('error')?.code === 'pet_slow') slow++;
    }
    expect(slow).toBeGreaterThanOrEqual(20);
    // muitas pessoas juntas tambem batem no teto do pet
    let slowAny = 0;
    for (let i = 0; i < 40; i++) {
      const x = join(orgs, 'o1', 'lounge', now);
      x.p.x = pet.x;
      x.p.y = pet.y;
      pets.handle(x.p, { t: 'pet_do', act: 'pat' }, now);
      if (x.last('error')?.code === 'pet_slow') slowAny++;
    }
    expect(slowAny).toBeGreaterThan(10);
  });

  it('so interage com o Byte quem esta na mesma sala', () => {
    const { pets } = setup();
    const other = join(orgs, 'o1', 'reception', now);
    pets.onEnter(other.p, 'reception', now);
    pets.handle(other.p, { t: 'pet_do', act: 'pat' }, now);
    expect(other.last('error')).toMatchObject({ code: 'pet_off' });
  });

  it('batida de coracao do autoping: todos da sala veem, so visual (fx beat, sem texto tecnico)', () => {
    const { pets, a } = setup();
    const b = join(orgs, 'o1', 'lounge', now);
    pets.heartbeat();
    for (const x of [a, b]) {
      const m = x.inbox.filter((i) => i.t === 'pet_act').pop() as Extract<ServerMessage, { t: 'pet_act' }>;
      expect(m.fx).toBe('beat');
      expect(m.say).toBeUndefined();
    }
  });
});

describe('desligado (PET=off) e controle da staff', () => {
  it('PET=off: ninguem recebe o Byte e as acoes respondem pet_off', () => {
    const pets = mk({ enabled: false });
    const a = join(orgs, 'o1', 'lounge', now);
    pets.onEnter(a.p, 'lounge', now);
    expect(a.inbox.some((m) => m.t === 'pet')).toBe(false);
    expect(pets.petOf('o1')).toBeUndefined();
    pets.handle(a.p, { t: 'pet_do', act: 'pat' }, now);
    expect(a.last('error')).toMatchObject({ code: 'pet_off' });
    run(pets, 5_000);
    pets.heartbeat();
    expect(a.inbox.some((m) => m.t === 'pet_act')).toBe(false);
  });

  it('desligar por organizacao some da sala; ligar de novo volta', () => {
    const pets = mk();
    const a = join(orgs, 'o1', 'lounge', now);
    pets.onEnter(a.p, 'lounge', now);
    expect(pets.setEnabled('o1', false, now)).toBe(true);
    expect(pets.setEnabled('o1', false, now)).toBe(false);
    expect(a.last('pet')).toEqual({ t: 'pet', pet: null });
    run(pets, 30_000);
    expect(a.inbox.filter((m) => m.t === 'pet_path').length).toBe(0);
    pets.setEnabled('o1', true, now);
    expect(a.last('pet')!.pet).not.toBeNull();
  });

  it('renomear valida o nome e atualiza a sala; levar ate mim respeita as salas permitidas', () => {
    const pets = mk();
    const a = join(orgs, 'o1', 'lounge', now);
    pets.onEnter(a.p, 'lounge', now);
    expect(pets.rename('o1', 'x', now)).toBeNull();
    expect(pets.rename('o1', '<script>', now)).toBeNull();
    expect(pets.rename('o1', '  Bit  ', now)).toBe('Bit');
    expect(a.last('pet')!.pet!.name).toBe('Bit');
    expect(pets.bring('o1', 'private', { x: 1, y: 1 }, now)).toMatchObject({ ok: false });
    const r = pets.bring('o1', 'lounge', { x: 4, y: 4 }, now);
    expect(r).toEqual({ ok: true });
    expect(pets.petOf('o1')!.roomId).toBe('lounge');
    expect(STEP_MS).toBeGreaterThan(0);
  });
});
