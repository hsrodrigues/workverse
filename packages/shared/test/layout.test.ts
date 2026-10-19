import { describe, expect, it } from 'vitest';
import { FURNI_KINDS, ROOM_DEFS, auditRoomLayout, furniFront, type FurniKind, type Furniture, type RoomDef } from '../src';

/**
 * Layout rules of the isometric rooms: the rules themselves live in src/layoutRules.ts (the furniture editor shows
 * them as warnings); here they must hold, with no exception, for every built-in room.
 */
const auditRoom = (def: RoomDef): string[] => auditRoomLayout(def).map((i) => i.message);

describe('layout rules (isometric rooms)', () => {
  it('knows which way each piece faces', () => {
    const f = (kind: FurniKind, dir: number): Furniture => ({ id: 't', kind, x: 0, y: 0, dir });
    expect(furniFront(f('sofa', 0))).toBe(0);
    expect(furniFront(f('sofa', 1))).toBe(1);
    expect(furniFront(f('fridge', 1))).toBe(1);
    expect(furniFront(f('bookshelf', 0))).toBe(1); // along the north wall
    expect(furniFront(f('bookshelf', 1))).toBe(0); // along the west wall
    expect(FURNI_KINDS.bookshelf.w).toBeGreaterThan(FURNI_KINDS.bookshelf.d);
  });

  for (const def of ROOM_DEFS) {
    it(`${def.id}: sofas and armchairs look at a focal point, and wall pieces stand against the wall`, () => {
      expect(auditRoom(def)).toEqual([]);
    });
  }
});
