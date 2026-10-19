import { describe, expect, it } from 'vitest';
import { FURNI_KINDS, ROOM_DEFS, auditRoomLayout, buildRoom, planEventDecor, reachableTiles, slotRuns } from '@workverse/shared';
import { THEMES, windowSpots } from '../src/game/roomArt';

/** Event decoration never blocks a path nor covers a door, a switch or a piece of furniture. */
describe('event decoration layout', () => {
  for (const def of ROOM_DEFS) {
    it(`${def.id}: props keep the room connected and stay off doors, spawn and furniture`, () => {
      const room = buildRoom(def);
      const plan = planEventDecor(def, windowSpots(room, THEMES[def.id] ?? THEMES.office), 1);
      const { width } = room.grid;
      const start = { x: def.spawn.x, y: def.spawn.y };
      const base = reachableTiles(room, start);
      const taken = new Set(plan.props.map((p) => p.y * width + p.x));
      expect(plan.props.length).toBeGreaterThanOrEqual(1);
      for (const p of plan.props) {
        expect(room.furniAt.get(p.y * width + p.x) ?? [], `${def.id} ${p.x},${p.y} on furniture`).toEqual([]);
        expect(def.portals.some((q) => Math.abs(q.x - p.x) <= 1 && Math.abs(q.y - p.y) <= 1), 'near a door').toBe(false);
        expect(Math.abs(p.x - def.spawn.x) <= 1 && Math.abs(p.y - def.spawn.y) <= 1, 'on the spawn').toBe(false);
      }
      expect(reachableTiles(room, start, taken).size).toBe(base.size - taken.size);
      // every seat / usable piece keeps an access tile
      for (const f of def.furniture.filter((x) => FURNI_KINDS[x.kind].seat || FURNI_KINDS[x.kind].usable)) {
        const acc: number[] = [];
        for (let dy = -1; dy <= 2; dy++) for (let dx = -1; dx <= 2; dx++) {
          const i = (f.y + dy) * width + f.x + dx;
          if (base.has(i)) acc.push(i);
        }
        if (acc.length) expect(acc.some((i) => !taken.has(i)), `${def.id}/${f.id} lost its access`).toBe(true);
      }
    });

    it(`${def.id}: wall slots avoid doors, windows, light switch and wall furniture`, () => {
      const room = buildRoom(def);
      const wins = windowSpots(room, THEMES[def.id] ?? THEMES.office);
      const plan = planEventDecor(def, wins);
      const sw = def.furniture.filter((f) => f.kind === 'light_switch');
      for (const s of plan.wallFree) {
        const x = s.side === 'n' ? s.t : 0;
        const y = s.side === 'n' ? 0 : s.t;
        expect(def.portals.some((p) => p.x === x && p.y === y)).toBe(false);
        expect(wins.some((w) => w.side === s.side && w.t === s.t)).toBe(false);
        expect(room.furniAt.get(y * room.grid.width + x) ?? []).toEqual([]);
        expect(sw.some((f) => f.x === x && f.y === y)).toBe(false);
      }
      // top band: only door signs are left out
      for (const s of plan.wallTop) {
        const near = def.portals.some((p) => (s.side === 'n' ? p.y === 0 && Math.abs(p.x - s.t) <= 1 : p.x === 0 && Math.abs(p.y - s.t) <= 1));
        expect(near).toBe(false);
      }
      for (const run of slotRuns(plan.wallTop)) expect(new Set(run.map((r) => r.side)).size).toBe(1);
    });
  }

  it('the layout rules still pass for the stock rooms (decoration does not change furniture)', () => {
    for (const def of ROOM_DEFS) expect(auditRoomLayout(def).filter((i) => i.code.startsWith('wall_'))).toEqual([]);
  });
});
