import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BOOKABLE_ROOM_IDS,
  FURNI_KINDS,
  NEVER_BOOKABLE_ROOM_IDS,
  ROOM_DEFS,
  auditRoomLayout,
  buildRoom,
  checkOps,
  findPath,
  footprintTiles,
  isWalkable,
  planEventDecor,
  presentationOf,
  roomAccessOf,
  validateLayout,
  type RoomAccess,
  type RoomDef,
  type RoomType,
} from '../src';

/**
 * O Corredor / Hall 2 e as nove salas que saem dele. Cada sala nova entra na tabela quando fica pronta; as verificacoes
 * comuns (planta, portas, assentos, whitelist, decoracao dos eventos, clima, luz) rodam para todas elas.
 */
const byId = (id: string): RoomDef => ROOM_DEFS.find((d) => d.id === id)!;

interface Expect {
  type: RoomType;
  access: RoomAccess;
  /** Reservavel por padrao. */
  bookable: boolean;
  /** Sem ar-condicionado nem luz de teto (area aberta). */
  open?: boolean;
  /** Presentation by TV. */
  tv?: boolean;
  /** Quantidade minima de assentos. */
  seats: number;
}

const EXPECT: Record<string, Expect> = {
  training: { type: 'training', access: 'org', bookable: true, tv: true, seats: 16 },
  rh: { type: 'hr', access: 'org', bookable: true, seats: 5 },
  lab: { type: 'lab', access: 'org', bookable: false, seats: 15 },
  cafeteria: { type: 'cafeteria', access: 'org', bookable: false, seats: 32 },
  games: { type: 'games', access: 'org', bookable: false, seats: 7 },
  terrace: { type: 'terrace', access: 'org', bookable: false, open: true, seats: 16 },
  library: { type: 'library', access: 'org', bookable: false, seats: 16 },
  studio: { type: 'studio', access: 'org', bookable: false, seats: 6 },
  board: { type: 'board', access: 'invited', bookable: false, tv: true, seats: 16 },
};
const ids = Object.keys(EXPECT).filter((id) => ROOM_DEFS.some((d) => d.id === id));

describe('Corredor / Hall 2', () => {
  const hall = byId('hall2');

  it('liga a recepcao ao corredor nos dois sentidos e nao e reservavel', () => {
    expect(hall.type).toBe('hall');
    expect(byId('reception').portals.some((p) => p.toRoom === 'hall2')).toBe(true);
    expect(hall.portals.some((p) => p.toRoom === 'reception')).toBe(true);
    expect(NEVER_BOOKABLE_ROOM_IDS).toContain('hall2');
    expect(DEFAULT_BOOKABLE_ROOM_IDS).not.toContain('hall2');
  });

  it('tem uma porta por sala nova na parede norte (x par), sem cobrir porta nem bloquear a chegada', () => {
    const doors = hall.portals.filter((p) => p.y === 0 && p.toRoom !== 'reception');
    expect(doors.map((p) => p.toRoom).sort()).toEqual([...ids].sort());
    for (const p of doors) {
      expect(p.x % 2, p.toRoom).toBe(0);
      const back = byId(p.toRoom).portals.find((q) => q.toRoom === 'hall2')!;
      expect(back, p.toRoom).toBeDefined();
      expect(back.toX).toBe(p.x);
      expect(back.toY).toBe(1);
      expect(isWalkable(buildRoom(hall).grid, back.toX, back.toY)).toBe(true);
    }
  });

  it('e valido, com clima e luz', () => {
    expect(validateLayout(hall, hall.furniture).errors).toEqual([]);
    expect(auditRoomLayout(hall)).toEqual([]);
    for (const k of ['ac_split', 'thermostat', 'light_switch']) expect(hall.furniture.some((f) => f.kind === k), k).toBe(true);
  });
});

for (const id of ids) {
  const def = byId(id);
  const want = EXPECT[id]!;
  describe(`sala ${id}`, () => {
    it('tem tipo, acesso, reserva padrao e lotacao coerentes', () => {
      expect(def.type).toBe(want.type);
      expect(roomAccessOf(def)).toBe(want.access);
      expect(def.guestAllowed).toBeFalsy();
      expect(DEFAULT_BOOKABLE_ROOM_IDS.includes(id)).toBe(want.bookable);
      const room = buildRoom(def);
      const seats = def.furniture.filter((f) => FURNI_KINDS[f.kind].seat).reduce((n, f) => n + footprintTiles(f).length, 0);
      expect(seats, 'assentos').toBeGreaterThanOrEqual(want.seats);
      let floor = 0;
      for (const v of room.grid.floor) if (v) floor++;
      expect(def.maxPlayers).toBeGreaterThanOrEqual(Math.ceil(seats * 0.6));
      expect(def.maxPlayers).toBeLessThanOrEqual(Math.floor(floor / 2));
      expect(def.description.length).toBeGreaterThan(20);
    });

    it('volta ao corredor e todos os assentos, usaveis e portas sao alcancaveis', () => {
      const back = def.portals.find((p) => p.toRoom === 'hall2')!;
      expect(back.x).toBe(0);
      const room = buildRoom(def);
      expect(findPath(room.grid, def.spawn, back)).not.toBeNull();
      for (const f of def.furniture.filter((x) => FURNI_KINDS[x.kind].seat)) {
        for (const t of footprintTiles(f)) expect(findPath(room.grid, def.spawn, t, { allowBlockedGoal: true }), `${f.id}`).not.toBeNull();
      }
      expect(validateLayout(def, def.furniture).errors).toEqual([]);
      expect(auditRoomLayout(def)).toEqual([]);
    });

    it('tem interruptor e, fora as areas abertas, ar-condicionado e termostato', () => {
      const has = (k: string) => def.furniture.some((f) => f.kind === k);
      if (want.open) {
        expect(has('light_switch')).toBe(false);
        expect(has('ac_split') || has('ac_floor')).toBe(false);
      } else {
        expect(has('light_switch')).toBe(true);
        expect(has('ac_split') || has('ac_floor')).toBe(true);
        expect(has('thermostat')).toBe(true);
      }
    });

    it('apresentacao: TV so onde a sala foi feita para isso', () => {
      expect(presentationOf(def)).toBe(want.tv ? 'tv' : null);
    });

    it('todo computador fica sobre uma mesa e tem um assento virado para ele (a pessoa digita)', () => {
      const room = buildRoom(def);
      const V = [[1, 0], [0, 1], [-1, 0], [0, -1]] as const;
      for (const pc of def.furniture.filter((f) => f.kind === 'computer')) {
        const onTop = (room.furniAt.get(pc.y * room.grid.width + pc.x) ?? []).some((o) => o !== pc && FURNI_KINDS[o.kind].blocks);
        expect(onTop, pc.id).toBe(true);
        const faced = def.furniture.some((c) => FURNI_KINDS[c.kind].seat && c.x + V[c.dir % 4]![0] === pc.x && c.y + V[c.dir % 4]![1] === pc.y);
        expect(faced, `nenhum assento olha para ${pc.id}`).toBe(true);
      }
    });

    it('a whitelist do editor recusa o que nao combina e a decoracao de eventos acha vagas sem colidir', () => {
      const bad = checkOps(def, def.furniture, [{ op: 'add', piece: { id: 'x1', kind: 'noc_console', x: def.spawn.x + 3, y: def.spawn.y, dir: 0 } }]);
      expect(bad.errors.map((e) => e.code)).toContain('room_type');
      const plan = planEventDecor(def);
      const room = buildRoom(def);
      expect(plan.props.length).toBeGreaterThanOrEqual(2);
      for (const p of plan.props) expect(room.furniAt.get(p.y * room.grid.width + p.x) ?? [], `${p.x},${p.y}`).toEqual([]);
      expect(plan.wallFree.length).toBeGreaterThanOrEqual(3);
      expect(plan.wallTop.length).toBeGreaterThanOrEqual(3);
    });
  });
}
