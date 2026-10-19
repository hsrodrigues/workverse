import { describe, expect, it } from 'vitest';
import { EVENT_IDS, EVENT_ITEMS, ITEMS, accessOf, eventUnlockKeys, activeEvents } from '../src';

describe('event avatar items', () => {
  it('every item belongs to a real event and is unique', () => {
    expect(new Set(EVENT_ITEMS.map((i) => i.id)).size).toBe(EVENT_ITEMS.length);
    for (const i of EVENT_ITEMS) {
      expect(EVENT_IDS).toContain(i.unlock.replace('event:', ''));
      expect(ITEMS.some((x) => x.id === i.id)).toBe(true);
      expect(i.poses.idle).toBe('full');
    }
  });

  it('are locked normally and open while the event key is granted (what the server does for active events)', () => {
    const witch = EVENT_ITEMS.find((i) => i.id === 'ev.witch_hat')!;
    expect(accessOf(witch, { unlocks: new Set() })).toBe('locked');
    const keys = eventUnlockKeys(activeEvents(new Date(2026, 9, 31)));
    expect(keys).toContain('event:halloween');
    expect(accessOf(witch, { unlocks: new Set(keys) })).toBe('ok');
    expect(accessOf(witch, { unlocks: new Set(eventUnlockKeys(activeEvents(new Date(2026, 7, 20)))) })).toBe('locked');
    expect(accessOf(witch, { unlocks: new Set(['item:ev.witch_hat']) })).toBe('ok');
  });
});
