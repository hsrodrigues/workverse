import { describe, expect, it } from 'vitest';
import { getItem } from '@workverse/shared';
import { EventsService, parseCompanyDate, parseOptionalEvents } from '../src/eventsService';
import { canUse, setActiveEventsProvider } from '../src/wardrobe';
import type { Account } from '../src/store';

const at = (m: number, d: number) => new Date(2026, m - 1, d, 12).getTime();

describe('EventsService', () => {
  it('follows the date and the manual overrides, and reports changes', () => {
    let now = at(8, 20);
    const s = new EventsService(() => now);
    expect(s.activeIds()).toEqual([]);
    expect(s.changed()).toBe(false);
    expect(s.setMode('halloween', 'on')).toBe(true);
    expect(s.setMode('halloween', 'on')).toBe(false);
    expect(s.activeIds()).toEqual(['halloween']);
    expect(s.changed()).toBe(true);
    expect(s.changed()).toBe(false);
    s.setMode('halloween', 'auto');
    now = at(10, 31);
    expect(s.activeIds()).toEqual(['halloween']);
    s.setMode('halloween', 'off');
    expect(s.activeIds()).toEqual([]);
    expect(s.view().disabled).toEqual(['halloween']);
    expect(s.setMode('nao-existe', 'on')).toBe(false);
  });

  it('parses the company date and the optional events', () => {
    expect(parseCompanyDate('15/03')).toEqual({ month: 3, day: 15 });
    expect(parseCompanyDate('03-15')).toEqual({ month: 3, day: 15 });
    expect(parseCompanyDate('2019-03-15')).toEqual({ month: 3, day: 15 });
    expect(parseCompanyDate('31/04')).toBeNull();
    expect(parseCompanyDate('x')).toBeNull();
    expect(parseOptionalEvents('blackfriday, foo')).toEqual(['blackfriday']);
    const s = new EventsService(() => at(3, 15), { companyDate: { month: 3, day: 15 } });
    expect(s.activeIds()).toEqual(['aniversario']);
  });
});

describe('event items in the wardrobe', () => {
  const acc = (avatarItems: string[] = []) => ({ unlocks: [], avatar: { v: 2, special: avatarItems.map((id) => ({ id })), accessories: [] } }) as unknown as Account;

  it('unlock only while the event is active; wearing keeps it', () => {
    const witch = getItem('ev.witch_hat')!;
    setActiveEventsProvider(() => []);
    expect(canUse(acc(), witch)).toBe(false);
    setActiveEventsProvider(() => ['halloween']);
    expect(canUse(acc(), witch)).toBe(true);
    setActiveEventsProvider(() => []);
    expect(canUse(acc(['ev.witch_hat']), witch)).toBe(true);
  });
});
