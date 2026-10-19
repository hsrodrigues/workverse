import { describe, expect, it } from 'vitest';
import { DEFAULT_AVATAR, ITEMS, equipItem, itemColors } from '@workverse/shared';
import { FRAME_COUNT, VIEWS } from '../src/game/avatar/engine';
import { renderFrame } from '../src/game/avatar/compose';
import { drawerKeys } from '../src/game/avatar/registry';

describe('avatar drawers', () => {
  it('every catalog item has a registered drawer', () => {
    const keys = new Set(drawerKeys());
    expect(ITEMS.filter((i) => !keys.has(i.drawer)).map((i) => i.id)).toEqual([]);
  });

  it('every item renders in every view and pose without throwing', () => {
    for (const item of ITEMS) {
      const r = equipItem(DEFAULT_AVATAR, item.id);
      const look = r.ok ? r.avatar : DEFAULT_AVATAR;
      for (const view of VIEWS) for (const f of [0, 3, 8, 11]) expect(renderFrame(look, view, f).length).toBeGreaterThan(0);
    }
    expect(FRAME_COUNT).toBeGreaterThan(10);
  }, 120_000);

  it('a dress hides whatever bottom is saved under it', () => {
    const dressed = equipItem(DEFAULT_AVATAR, 'dress.midi');
    expect(dressed.ok).toBe(true);
    if (!dressed.ok) return;
    const asSkirt = { ...dressed.avatar, bottom: { id: 'bottom.skirt', color: 'wine' } };
    const asPants = { ...dressed.avatar, bottom: { id: 'bottom.jeans', color: 'denim' } };
    for (const view of VIEWS) for (const f of [0, 8]) {
      expect(Array.from(renderFrame(asSkirt, view, f))).toEqual(Array.from(renderFrame(asPants, view, f)));
    }
  });

  it('items of the same slot look different from each other (no item is a visual copy of another)', () => {
    const bySlot = new Map<string, string[]>();
    for (const item of ITEMS) {
      if (item.slot === 'back' || item.slot === 'wrist') continue;
      // Same explicit color for everything that shares a palette, so only the drawing can make two items differ.
      const r = equipItem(DEFAULT_AVATAR, item.id, itemColors(item)[0]?.id);
      if (!r.ok) continue;
      const frames = VIEWS.map((v) => Array.from(renderFrame(r.avatar, v, 0) as unknown as ArrayLike<number>).join(',')).join('/');
      const id = `${item.slot}:${frames.length}:${hash(frames)}`;
      bySlot.set(id, [...(bySlot.get(id) ?? []), item.id]);
    }
    expect([...bySlot.values()].filter((ids) => ids.length > 1)).toEqual([]);
  }, 120_000);
});

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
