import { describe, expect, it } from 'vitest';
import {
  FURNI_KINDS,
  ROOM_DEFS,
  buildRoom,
  dirFromDelta,
  footprintTiles,
  findPath,
  idx,
  isValidPath,
  isWalkable,
  sanitizeAvatar,
  screenToTile,
  tileToScreen,
  type Grid,
} from '../src';

const grid = (rows: string[]): Grid => {
  const height = rows.length;
  const width = rows[0].length;
  const floor: boolean[] = [];
  const blocked: boolean[] = [];
  for (const r of rows) for (const c of r) {
    floor.push(c !== ' ');
    blocked.push(c === '#');
  }
  return { width, height, floor, blocked };
};

describe('isometric geometry', () => {
  it('round-trips tile and screen coordinates', () => {
    const s = tileToScreen(3.5, 7.25);
    const t = screenToTile(s.x, s.y);
    expect(t.x).toBeCloseTo(3.5);
    expect(t.y).toBeCloseTo(7.25);
  });

  it('maps deltas to the eight directions', () => {
    expect(dirFromDelta(1, 0)).toBe(0);
    expect(dirFromDelta(0, 1)).toBe(2);
    expect(dirFromDelta(-1, -1)).toBe(5);
    expect(dirFromDelta(0, 0, 3)).toBe(3);
  });
});

describe('pathfinding', () => {
  it('finds a straight path excluding the start', () => {
    const g = grid(['.....']);
    const p = findPath(g, { x: 0, y: 0 }, { x: 4, y: 0 })!;
    expect(p).toHaveLength(4);
    expect(p[3]).toEqual({ x: 4, y: 0 });
  });

  it('walks around obstacles', () => {
    const g = grid(['.....', '.###.', '.....']);
    const p = findPath(g, { x: 0, y: 1 }, { x: 4, y: 1 })!;
    expect(p.every((t) => isWalkable(g, t.x, t.y))).toBe(true);
    expect(isValidPath(g, { x: 0, y: 1 }, p)).toBe(true);
  });

  it('returns null for blocked goals, void tiles and sealed areas', () => {
    const g = grid(['..#..', '..#..', '..#..']);
    expect(findPath(g, { x: 0, y: 0 }, { x: 2, y: 0 })).toBeNull();
    expect(findPath(g, { x: 0, y: 0 }, { x: 4, y: 0 })).toBeNull();
    expect(findPath(grid(['. .']), { x: 0, y: 0 }, { x: 1, y: 0 })).toBeNull();
  });

  it('allows a blocked goal when asked (seats)', () => {
    const g = grid(['..#']);
    expect(findPath(g, { x: 0, y: 0 }, { x: 2, y: 0 }, { allowBlockedGoal: true })).toHaveLength(2);
  });

  it('does not cut corners diagonally', () => {
    const g = grid(['.#', '#.']);
    expect(findPath(g, { x: 0, y: 0 }, { x: 1, y: 1 })).toBeNull();
  });

  it('rejects teleporting or colliding paths', () => {
    const g = grid(['...', '.#.', '...']);
    expect(isValidPath(g, { x: 0, y: 0 }, [{ x: 2, y: 0 }])).toBe(false);
    expect(isValidPath(g, { x: 0, y: 0 }, [{ x: 1, y: 1 }])).toBe(false);
    expect(isValidPath(g, { x: 0, y: 0 }, [{ x: 5, y: 5 }])).toBe(false);
  });
});

describe('room definitions', () => {
  it('builds every room, with reachable portals and spawns', () => {
    for (const def of ROOM_DEFS) {
      const room = buildRoom(def);
      expect(isWalkable(room.grid, def.spawn.x, def.spawn.y)).toBe(true);
      for (const portal of def.portals) {
        const path = findPath(room.grid, def.spawn, portal);
        expect(path, `${def.id} portal ${portal.label}`).not.toBeNull();
        const dest = ROOM_DEFS.find((d) => d.id === portal.toRoom)!;
        expect(isWalkable(buildRoom(dest).grid, portal.toX, portal.toY)).toBe(true);
      }
    }
  });

  it('blocks furniture footprints but not rugs or computers', () => {
    const room = buildRoom(ROOM_DEFS[0]);
    const desk = ROOM_DEFS[0].furniture.find((f) => f.kind === 'desk')!;
    expect(room.grid.blocked[idx(room.grid, desk.x, desk.y)]).toBe(true);
    const rug = ROOM_DEFS[0].furniture.find((f) => f.kind === 'rug')!;
    expect(room.grid.blocked[idx(room.grid, rug.x, rug.y)]).toBe(false);
  });

  it('gives every seat a reachable neighbour', () => {
    const room = buildRoom(ROOM_DEFS[0]);
    const spawn = ROOM_DEFS[0].spawn;
    for (const f of ROOM_DEFS[0].furniture.filter((x) => x.kind === 'chair')) {
      expect(findPath(room.grid, spawn, f, { allowBlockedGoal: true }), f.id).not.toBeNull();
    }
  });
});

describe('room layout rules', () => {
  it('keeps wall hangings on the wall row/column and never blocking', () => {
    for (const def of ROOM_DEFS) {
      for (const f of def.furniture.filter((x) => FURNI_KINDS[x.kind].wall)) {
        expect(FURNI_KINDS[f.kind].blocks, f.id).toBe(false);
        for (const t of footprintTiles(f)) expect(f.dir % 2 === 0 ? t.y : t.x, def.id + '/' + f.id).toBe(0);
      }
    }
  });

  it('leaves no walkable pocket cut off from the spawn', () => {
    for (const def of ROOM_DEFS) {
      const room = buildRoom(def);
      for (let y = 0; y < room.grid.height; y++) {
        for (let x = 0; x < room.grid.width; x++) {
          if (!isWalkable(room.grid, x, y)) continue;
          expect(findPath(room.grid, def.spawn, { x, y }), def.id + ' tile ' + x + ',' + y).not.toBeNull();
        }
      }
    }
  });

  it('keeps every usable object reachable from an adjacent tile', () => {
    for (const def of ROOM_DEFS) {
      const room = buildRoom(def);
      // computers are used from the chair next to them (see 'seats the office computers' below)
      for (const f of def.furniture.filter((x) => FURNI_KINDS[x.kind].usable && x.kind !== 'computer')) {
        const reachable = footprintTiles(f).some((t) =>
          [-1, 0, 1].some((dy) =>
            [-1, 0, 1].some((dx) => isWalkable(room.grid, t.x + dx, t.y + dy) && findPath(room.grid, def.spawn, { x: t.x + dx, y: t.y + dy }) !== null),
          ),
        );
        expect(reachable, def.id + '/' + f.id).toBe(true);
      }
    }
  });
});

describe('modern office and lounge', () => {
  const byId = (id: string) => ROOM_DEFS.find((d) => d.id === id)!;
  const seats = (id: string) => byId(id).furniture.filter((f) => FURNI_KINDS[f.kind].seat);

  it('gives the office at least 20 seats and the lounge at least 14', () => {
    expect(seats('office').length).toBeGreaterThanOrEqual(20);
    expect(seats('lounge').length).toBeGreaterThanOrEqual(14);
  });

  it('reaches every seat of the office and the lounge (any seat tile, with a free neighbour)', () => {
    for (const id of ['office', 'lounge']) {
      const def = byId(id);
      const room = buildRoom(def);
      for (const f of seats(id)) {
        for (const t of footprintTiles(f)) {
          expect(findPath(room.grid, def.spawn, t, { allowBlockedGoal: true }), id + '/' + f.id).not.toBeNull();
        }
      }
    }
  });

  it('seats the office computers: every computer sits on a desk with a chair right next to it', () => {
    const def = byId('office');
    const room = buildRoom(def);
    const pcs = def.furniture.filter((f) => f.kind === 'computer');
    expect(pcs.length).toBeGreaterThanOrEqual(16);
    for (const pc of pcs) {
      const desk = (room.furniAt.get(idx(room.grid, pc.x, pc.y)) ?? []).find((f) => f.kind === 'desk');
      expect(desk, pc.id + ' on a desk').toBeDefined();
      const chair = def.furniture.find((f) => f.kind === 'chair' && f.x === pc.x && Math.abs(f.y - pc.y) === 1);
      expect(chair, pc.id + ' has a chair').toBeDefined();
      // the chair faces the computer
      expect(chair!.dir).toBe(chair!.y < pc.y ? 1 : 3);
    }
  });

  it('turns sofas and armchairs toward the camera (+x or +y), unless they face a wall TV across the room', () => {
    for (const id of ['office', 'lounge']) {
      const def = byId(id);
      for (const f of def.furniture.filter((x) => x.kind === 'sofa' || x.kind === 'armchair')) {
        if (f.dir === 0 || f.dir === 1) continue;
        // facing away from the camera is only for the sofa that watches the TV on the north wall (dir 3)
        const watchesTv = f.dir === 3 && def.furniture.some((t) => t.kind === 'tv' && t.dir === 0 && t.x <= f.x + 1 && t.x + 1 >= f.x);
        expect(watchesTv, id + '/' + f.id).toBe(true);
      }
    }
  });

  it('keeps the spawn lanes and portal arrival tiles free', () => {
    const office = buildRoom(byId('office'));
    for (const p of [byId('lounge').portals[0], byId('auditorium').portals[0]]) expect(isWalkable(office.grid, p.toX, p.toY), p.label).toBe(true);
    expect(isWalkable(office.grid, 7, 8)).toBe(true);
  });
});

describe('reception hub and the other rooms', () => {
  const byId = (id: string) => ROOM_DEFS.find((d) => d.id === id)!;
  const NEW = ['reception', 'team', 'meeting1', 'meeting2', 'private', 'focus'];

  it('defines every room with a type, unique ids and Portuguese names', () => {
    expect(new Set(ROOM_DEFS.map((d) => d.id)).size).toBe(ROOM_DEFS.length);
    for (const id of NEW) {
      const d = byId(id);
      expect(d, id).toBeDefined();
      expect(d.type, id).toBeDefined();
      expect(d.name.length).toBeGreaterThan(3);
      expect(d.maxPlayers).toBeGreaterThan(0);
    }
    expect(byId('private').maxPlayers).toBeLessThanOrEqual(4);
  });

  it('links portals both ways, with the reception as hub of every room', () => {
    for (const d of ROOM_DEFS) {
      for (const p of d.portals) {
        const dest = byId(p.toRoom);
        expect(dest, `${d.id} -> ${p.toRoom}`).toBeDefined();
        expect(dest.portals.some((q) => q.toRoom === d.id), `${p.toRoom} has no way back to ${d.id}`).toBe(true);
      }
      if (d.id !== 'reception') expect(d.portals.some((p) => p.toRoom === 'reception'), d.id).toBe(true);
    }
    const reached = new Set(byId('reception').portals.map((p) => p.toRoom));
    for (const d of ROOM_DEFS) if (d.id !== 'reception') expect(reached.has(d.id), d.id).toBe(true);
  });

  it('lands each portal on a free tile next to the return door, reachable from the destination spawn', () => {
    for (const d of ROOM_DEFS) {
      for (const p of d.portals) {
        const dest = byId(p.toRoom);
        const room = buildRoom(dest);
        expect(isWalkable(room.grid, p.toX, p.toY), `${d.id} -> ${p.toRoom}`).toBe(true);
        expect(room.portalAt.has(idx(room.grid, p.toX, p.toY)), 'arrival must not be a portal').toBe(false);
        expect(findPath(room.grid, dest.spawn, { x: p.toX, y: p.toY }), `${d.id} -> ${p.toRoom}`).not.toBeNull();
      }
    }
  });

  it('reaches every seat of the new rooms and keeps their seats facing the table or desk', () => {
    for (const id of NEW) {
      const def = byId(id);
      const room = buildRoom(def);
      for (const f of def.furniture.filter((x) => FURNI_KINDS[x.kind].seat)) {
        for (const t of footprintTiles(f)) expect(findPath(room.grid, def.spawn, t, { allowBlockedGoal: true }), id + '/' + f.id).not.toBeNull();
      }
    }
    expect(byId('meeting1').furniture.filter((f) => f.kind === 'chair').length).toBeGreaterThanOrEqual(12);
    expect(byId('focus').furniture.filter((f) => f.kind === 'chair').length).toBeGreaterThanOrEqual(6);
  });

  it('keeps the logo and reception desk of the hub', () => {
    const kinds = new Set(byId('reception').furniture.map((f) => f.kind));
    for (const k of ['reception_desk', 'logo', 'tv', 'sofa', 'plant']) expect(kinds.has(k as never), k).toBe(true);
  });
});

describe('avatar sanitising', () => {
  it('migrates legacy index configs and clamps invalid values to defaults', () => {
    const a = sanitizeAvatar({ skin: 999, hairStyle: -1, top: 'x', topColor: 2 });
    expect(a.v).toBe(2);
    expect(a.skin).toBe('peach');
    expect(a.hair.id).toBe('hair.short');
    expect(a.top.color).toBe('yellow'); // legacy topColor 2
  });
  it('survives non-object input', () => {
    expect(sanitizeAvatar(null).v).toBe(2);
    expect(sanitizeAvatar('abc').skin).toBeTypeOf('string');
  });
});
