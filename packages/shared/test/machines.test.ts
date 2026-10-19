import { describe, expect, it } from 'vitest';
import { FURNI_HOLDS, FURNI_KINDS, KIND_ROOM_TYPES, ROOM_DEFS, WALL_BACKED_KINDS, auditRoomLayout, categoryOf, checkOps, heldOf, isActivity, validateLayout, type FurniKind } from '../src';

const MACHINES: readonly FurniKind[] = ['snack_machine', 'soda_machine', 'microwave'];

describe('vending machines and microwave', () => {
  it('are usable, blocking, 1x1 appliances of the kitchen category that lean on a wall', () => {
    for (const k of MACHINES) {
      expect(FURNI_KINDS[k]).toMatchObject({ w: 1, d: 1, blocks: true, usable: true, seat: false });
      expect(FURNI_HOLDS[k]).toBeTruthy();
      expect(categoryOf(k)).toBe('kitchen');
      expect(WALL_BACKED_KINDS).toContain(k);
      // allowed in every kind of room (no restriction in the allow-list)
      expect(KIND_ROOM_TYPES[k]).toBeUndefined();
    }
  });

  it('the new held items are valid activities', () => {
    for (const item of ['snack', 'soda', 'meal']) {
      expect(isActivity(`holding:${item}`)).toBe(true);
      expect(heldOf(`holding:${item}` as never)).toBe(item);
    }
  });

  it('are placed in the lounge, reception and IT room with a clean layout and no blocked doors', () => {
    const where = (id: string) => ROOM_DEFS.find((r) => r.id === id)!;
    for (const id of ['lounge', 'ti']) for (const k of MACHINES) expect(where(id).furniture.some((f) => f.kind === k), `${id}/${k}`).toBe(true);
    expect(where('reception').furniture.some((f) => f.kind === 'snack_machine')).toBe(true);
    for (const id of ['lounge', 'reception', 'ti']) {
      const def = where(id);
      expect(auditRoomLayout(def).filter((i) => MACHINES.includes(def.furniture.find((f) => f.id === i.id)?.kind as FurniKind))).toEqual([]);
      const r = validateLayout(def, def.furniture);
      expect(r.errors, id).toEqual([]);
    }
  });

  it('can be added by the editor in every kind of room, on the wall with the front toward the room', () => {
    const office = ROOM_DEFS.find((r) => r.id === 'team')!;
    const x = 5; // free spot on the north wall (checked by the editor rules below)
    for (const k of MACHINES) {
      const r = checkOps(office, office.furniture, [{ op: 'add', piece: { id: `t_${k}`, kind: k, x, y: 0, dir: 1 } }]);
      expect(r.errors, k).toEqual([]);
      expect(r.warnings.filter((w) => w.id === `t_${k}`)).toEqual([]);
    }
    // a machine in the middle of the floor is only a warning (wall_not_north), never a block
    const mid = checkOps(office, office.furniture, [{ op: 'add', piece: { id: 't_mid', kind: 'snack_machine', x: 7, y: 6, dir: 1 } }]);
    expect(mid.errors.map((e) => e.code)).not.toContain('room_type');
  });
});
