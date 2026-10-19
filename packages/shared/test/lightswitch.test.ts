import { describe, expect, it } from 'vitest';
import { FURNI_KINDS, ROOM_DEFS, buildRoom, findPath, idx, interactiveAt, isWalkable } from '../src';

describe('interruptor de luz', () => {
  it('toda sala tem exatamente um interruptor, numa parede, usavel e sem bloquear', () => {
    for (const def of ROOM_DEFS) {
      const switches = def.furniture.filter((f) => f.kind === 'light_switch');
      expect(switches, def.id).toHaveLength(1);
      const sw = switches[0];
      expect(FURNI_KINDS.light_switch.usable && FURNI_KINDS.light_switch.wall).toBe(true);
      expect(FURNI_KINDS.light_switch.blocks).toBe(false);
      expect(sw.x === 0 || sw.y === 0, `${def.id}: na parede norte ou oeste`).toBe(true);
    }
  });

  it('o interruptor fica alcancavel a pe e nao esconde porta nem outro movel de parede', () => {
    for (const def of ROOM_DEFS) {
      const room = buildRoom(def);
      const sw = def.furniture.find((f) => f.kind === 'light_switch')!;
      expect(interactiveAt(room, sw.x, sw.y)?.id, def.id).toBe(sw.id);
      const north = sw.dir % 2 === 0;
      const front = north ? { x: sw.x, y: sw.y + 1 } : { x: sw.x + 1, y: sw.y };
      expect(isWalkable(room.grid, front.x, front.y), `${def.id}: vizinho andavel`).toBe(true);
      expect(findPath(room.grid, def.spawn, front), `${def.id}: caminho do spawn`).not.toBeNull();
      expect(def.portals.some((p) => p.x === sw.x && p.y === sw.y)).toBe(false);
      const others = def.furniture.filter((f) => f.id !== sw.id && f.x === sw.x && f.y === sw.y);
      expect(others, `${def.id}: tile livre de outros moveis`).toHaveLength(0);
      expect(room.grid.blocked[idx(room.grid, sw.x, sw.y)]).toBe(false);
    }
  });
});
