import { describe, expect, it } from 'vitest';
import { FURNI_KINDS, ROOM_DEFS, buildRoom, findPath, footprintTiles, furniFront, isWalkable, presentationOf, tvStandOf, validateLayout, type Furniture } from '../src';

const VEC = [[1, 0], [0, 1], [-1, 0], [0, -1]] as const;
const TV_ROOMS = ['meeting1', 'meeting2', 'team'];

describe('presentation TV (tv_stand)', () => {
  it('is a blocking, usable 2x1 piece', () => {
    expect(FURNI_KINDS.tv_stand).toMatchObject({ w: 2, d: 1, blocks: true, usable: true, seat: false });
  });

  it('decides the presentation target of each room from its furniture', () => {
    const modes = Object.fromEntries(ROOM_DEFS.map((r) => [r.id, presentationOf(r)]));
    expect(modes).toMatchObject({ auditorium: 'stage', meeting1: 'tv', meeting2: 'tv', team: 'tv', office: null, lounge: null, reception: null, private: null, focus: null });
  });

  for (const id of TV_ROOMS) {
    const def = ROOM_DEFS.find((r) => r.id === id)!;
    const tv = tvStandOf(def)!;

    it(`${id}: one TV, facing the table, with a reachable neighbour and the paths intact`, () => {
      expect(def.furniture.filter((f) => f.kind === 'tv_stand')).toHaveLength(1);
      // the screen faces the table within a few tiles
      const [dx, dy] = VEC[furniFront(tv)];
      const tiles = footprintTiles(tv);
      const sees = tiles.some((t) => [1, 2, 3, 4, 5, 6].some((i) => def.furniture.some((g) => g.kind === 'table' && footprintTiles(g).some((q) => q.x === t.x + dx * i && q.y === t.y + dy * i))));
      expect(sees, 'no table in front of the TV').toBe(true);
      // usable: some walkable tile next to it is reachable from the spawn
      const room = buildRoom(def);
      const reach = tiles.some((t) =>
        [-1, 0, 1].some((oy) => [-1, 0, 1].some((ox) => isWalkable(room.grid, t.x + ox, t.y + oy) && findPath(room.grid, def.spawn, { x: t.x + ox, y: t.y + oy }) !== null)),
      );
      expect(reach).toBe(true);
      for (const p of def.portals) expect(findPath(room.grid, def.spawn, p), `${id} portal ${p.label}`).not.toBeNull();
      // nothing else sits under it
      const under = def.furniture.filter((g) => g !== tv && FURNI_KINDS[g.kind].blocks && footprintTiles(g).some((q) => tiles.some((t) => t.x === q.x && t.y === q.y)));
      expect(under).toEqual([]);
    });
  }

  it('the layout validator accepts one TV, refuses a second one and refuses it in the reception and the auditorium', () => {
    const meeting = ROOM_DEFS.find((r) => r.id === 'meeting2')!;
    const extra: Furniture = { id: 'extra-tv', kind: 'tv_stand', x: 5, y: 7, dir: 0 };
    const codes = (r: ReturnType<typeof validateLayout>) => r.errors.map((e) => e.code);
    expect(validateLayout(meeting, meeting.furniture, { noWarnings: true }).ok).toBe(true);
    expect(codes(validateLayout(meeting, [...meeting.furniture, extra], { noWarnings: true }))).toContain('too_many');
    for (const id of ['reception', 'auditorium']) {
      const def = ROOM_DEFS.find((r) => r.id === id)!;
      expect(codes(validateLayout(def, [...def.furniture, { ...extra, x: 2, y: 5 }], { noWarnings: true })), id).toContain('room_type');
    }
  });
});
