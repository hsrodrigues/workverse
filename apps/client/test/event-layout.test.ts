import { describe, expect, it } from 'vitest';
import { DECOR_LIMITS, FURNI_KINDS, ROOM_DEFS, auditRoomLayout, buildRoom, decorLevel, planEventDecor, reachableTiles, slotRuns, spreadSlots } from '@workverse/shared';
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

  it('density: reception/office are rich, small rooms discreet, a second event lowers one level', () => {
    expect(decorLevel('reception', 200)).toBe(3);
    expect(decorLevel('office', 200)).toBe(3);
    expect(decorLevel('lounge', 90)).toBe(2);
    expect(decorLevel('private', 20)).toBe(1);
    expect(decorLevel('office', 200, true)).toBe(2);
    expect(decorLevel('private', 20, true)).toBe(1);
    expect(DECOR_LIMITS[3].props).toBeGreaterThan(DECOR_LIMITS[2].props);
    expect(DECOR_LIMITS[2].props).toBeGreaterThan(DECOR_LIMITS[1].props);
  });

  it('spreadSlots is deterministic, spaced and symmetric on a symmetric wall', () => {
    const slots = Array.from({ length: 11 }, (_, t) => ({ side: 'n' as const, t }));
    const a = spreadSlots(slots, 3);
    expect(spreadSlots(slots, 3)).toEqual(a);
    const ts = a.map((s) => s.t).sort((x, y) => x - y);
    for (let i = 1; i < ts.length; i++) expect(ts[i]! - ts[i - 1]!).toBeGreaterThanOrEqual(2);
  });

  it('top-band slots never sit over a split A/C, TV or clock', () => {
    for (const def of ROOM_DEFS) {
      const room = buildRoom(def);
      const plan = planEventDecor(def, windowSpots(room, THEMES[def.id] ?? THEMES.office));
      for (const f of def.furniture.filter((x) => ['ac_split', 'tv', 'clock'].includes(x.kind))) {
        const north = f.dir % 2 === 0;
        for (const t of [f.x, f.y]) void t;
        const tiles = north ? Array.from({ length: FURNI_KINDS[f.kind].w }, (_, i) => f.x + i) : Array.from({ length: FURNI_KINDS[f.kind].w }, (_, i) => f.y + i);
        for (const s of plan.wallTop) if (s.side === (north ? 'n' : 'w')) expect(tiles.includes(s.t), `${def.id}/${f.id}`).toBe(false);
      }
    }
  });

  it('the layout rules still pass for the stock rooms (decoration does not change furniture)', () => {
    for (const def of ROOM_DEFS) expect(auditRoomLayout(def).filter((i) => i.code.startsWith('wall_'))).toEqual([]);
  });
});
