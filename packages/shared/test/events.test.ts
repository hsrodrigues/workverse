import { describe, expect, it } from 'vitest';
import {
  EVENT_DEFS,
  EVENT_IDS,
  activeEvents,
  carnivalTuesday,
  easterSunday,
  eventSpan,
  getEventDef,
  newYearNumber,
  nextEventSpan,
  type EventId,
} from '../src';

const d = (y: number, m: number, day: number) => new Date(y, m - 1, day, 12, 0, 0);
const ids = (date: Date, o = {}) => activeEvents(date, o).map((e) => e.id);

describe('Easter and Carnival', () => {
  it('knows Easter Sunday for a range of known years', () => {
    const known: Array<[number, number, number]> = [
      [2019, 4, 21],
      [2020, 4, 12],
      [2021, 4, 4],
      [2022, 4, 17],
      [2023, 4, 9],
      [2024, 3, 31],
      [2025, 4, 20],
      [2026, 4, 5],
      [2027, 3, 28],
      [2028, 4, 16],
      [2029, 4, 1],
      [2030, 4, 21],
      [1961, 4, 2],
      [2038, 4, 25],
    ];
    for (const [y, m, day] of known) expect(easterSunday(y), String(y)).toEqual({ month: m, day });
  });

  it('puts Carnival Tuesday 47 days before Easter', () => {
    expect(carnivalTuesday(2026)).toEqual({ month: 2, day: 17 });
    expect(carnivalTuesday(2027)).toEqual({ month: 2, day: 9 });
    expect(carnivalTuesday(2024)).toEqual({ month: 2, day: 13 });
    expect(carnivalTuesday(2025)).toEqual({ month: 3, day: 4 });
    expect(carnivalTuesday(2038)).toEqual({ month: 3, day: 9 });
  });
});

describe('event windows', () => {
  it('covers the whole table with unique ids and pt-BR names', () => {
    expect(new Set(EVENT_IDS).size).toBe(EVENT_DEFS.length);
    for (const e of EVENT_DEFS) {
      expect(e.name.length).toBeGreaterThan(2);
      expect(e.before).toBeGreaterThanOrEqual(0);
      expect(e.after).toBeGreaterThanOrEqual(0);
      expect(e.theme.tint).toHaveLength(3);
    }
  });

  it('Halloween runs from a week before to the day after', () => {
    expect(ids(d(2026, 10, 23))).not.toContain('halloween');
    expect(ids(d(2026, 10, 24))).toContain('halloween');
    expect(ids(d(2026, 10, 31))).toContain('halloween');
    expect(ids(d(2026, 11, 1))).toContain('halloween');
    expect(ids(d(2026, 11, 2))).not.toContain('halloween');
  });

  it('Carnival follows the moving date', () => {
    expect(ids(d(2026, 2, 17))).toContain('carnaval');
    expect(ids(d(2026, 2, 13))).toContain('carnaval'); // Friday before
    expect(ids(d(2026, 2, 12))).not.toContain('carnaval');
    expect(ids(d(2026, 2, 18))).not.toContain('carnaval'); // Ash Wednesday
    expect(ids(d(2027, 2, 9))).toContain('carnaval');
    expect(ids(d(2027, 2, 17))).not.toContain('carnaval');
  });

  it('Easter follows the moving date', () => {
    expect(ids(d(2026, 4, 5))).toContain('pascoa');
    expect(ids(d(2026, 3, 29))).toContain('pascoa');
    expect(ids(d(2026, 3, 28))).not.toContain('pascoa');
    expect(ids(d(2026, 4, 6))).toContain('pascoa');
    expect(ids(d(2026, 4, 7))).not.toContain('pascoa');
    expect(ids(d(2027, 3, 28))).toContain('pascoa');
  });

  it('New Year crosses the year boundary (31/12 to 02/01)', () => {
    expect(ids(d(2026, 12, 30))).not.toContain('anonovo');
    expect(ids(d(2026, 12, 31))).toContain('anonovo');
    expect(ids(d(2027, 1, 1))).toContain('anonovo');
    expect(ids(d(2027, 1, 2))).toContain('anonovo');
    expect(ids(d(2027, 1, 3))).not.toContain('anonovo');
  });

  it('Christmas is 24 to 26 December', () => {
    expect(ids(d(2026, 12, 23))).not.toContain('natal');
    for (const day of [24, 25, 26]) expect(ids(d(2026, 12, day))).toContain('natal');
    expect(ids(d(2026, 12, 27))).not.toContain('natal');
  });

  it('Festa Junina fills June; Dia dos Namorados (12/06) wins when they overlap', () => {
    expect(ids(d(2026, 5, 31))).not.toContain('junina');
    expect(ids(d(2026, 6, 1))).toContain('junina');
    expect(ids(d(2026, 6, 30))).toContain('junina');
    expect(ids(d(2026, 7, 1))).not.toContain('junina');
    const day12 = ids(d(2026, 6, 12));
    expect(day12).toContain('namorados');
    expect(day12).toContain('junina');
    expect(day12.indexOf('namorados')).toBeLessThan(day12.indexOf('junina'));
    expect(ids(d(2026, 6, 9))).not.toContain('namorados');
    expect(ids(d(2026, 6, 10))).toContain('namorados');
  });

  it('Dia das Criancas and Dia do Trabalho', () => {
    expect(ids(d(2026, 10, 12))).toContain('criancas');
    expect(ids(d(2026, 10, 18))).not.toContain('criancas');
    expect(ids(d(2026, 5, 1))).toContain('trabalho');
    expect(ids(d(2026, 5, 2))).not.toContain('trabalho');
  });

  it('the company anniversary only exists once a date is configured', () => {
    expect(ids(d(2026, 3, 15))).not.toContain('aniversario');
    const o = { companyDate: { month: 3, day: 15 } };
    expect(ids(d(2026, 3, 15), o)).toContain('aniversario');
    expect(ids(d(2026, 3, 12), o)).toContain('aniversario');
    expect(ids(d(2026, 3, 18), o)).toContain('aniversario');
    expect(ids(d(2026, 3, 19), o)).not.toContain('aniversario');
    expect(ids(d(2026, 3, 15), { companyDate: { month: 13, day: 40 } })).not.toContain('aniversario');
    // 29/02 in a common year falls on 28/02
    expect(ids(d(2027, 2, 28), { companyDate: { month: 2, day: 29 } })).toContain('aniversario');
  });

  it('Black Friday is opt-in and follows the 4th Thursday of November', () => {
    expect(eventSpan(getEventDef('blackfriday')!, 2026)!.anchor).toEqual({ year: 2026, month: 11, day: 27 });
    expect(eventSpan(getEventDef('blackfriday')!, 2027)!.anchor).toEqual({ year: 2027, month: 11, day: 26 });
    expect(ids(d(2026, 11, 27))).not.toContain('blackfriday');
    expect(ids(d(2026, 11, 27), { optional: ['blackfriday'] })).toContain('blackfriday');
    expect(ids(d(2026, 11, 24), { optional: ['blackfriday'] })).toContain('blackfriday');
    expect(ids(d(2026, 11, 20), { optional: ['blackfriday'] })).not.toContain('blackfriday');
  });

  it('nothing is active on an ordinary day, and overlapping events come ordered by priority', () => {
    expect(ids(d(2026, 8, 20))).toEqual([]);
    expect(activeEvents(d(2026, 10, 31), { forced: ['natal'] }).map((e) => e.id)).toEqual(['natal', 'halloween']);
  });
});

describe('manual overrides', () => {
  it('forced events appear off-season, even the optional ones', () => {
    expect(ids(d(2026, 8, 20), { forced: ['halloween', 'blackfriday'] })).toEqual(['halloween', 'blackfriday']);
  });

  it('disabled events are removed from the date, and win over forced', () => {
    expect(ids(d(2026, 10, 31), { disabled: ['halloween'] })).toEqual([]);
    expect(ids(d(2026, 10, 31), { forced: ['halloween'], disabled: ['halloween'] })).toEqual([]);
  });

  it('accepts any iterable and ignores unknown ids', () => {
    expect(ids(d(2026, 8, 20), { forced: new Set(['pascoa', 'nao-existe']) })).toEqual(['pascoa']);
  });

  it('works with timestamps, not just Dates', () => {
    expect(activeEvents(d(2026, 10, 31).getTime()).map((e) => e.id)).toContain('halloween');
  });
});

describe('helpers', () => {
  it('nextEventSpan finds the current or next occurrence', () => {
    const halloween = getEventDef('halloween')!;
    expect(nextEventSpan(halloween, d(2026, 10, 18))!.anchor).toEqual({ year: 2026, month: 10, day: 31 });
    expect(nextEventSpan(halloween, d(2026, 11, 20))!.anchor).toEqual({ year: 2027, month: 10, day: 31 });
    expect(nextEventSpan(getEventDef('aniversario')!, d(2026, 1, 1))).toBeNull();
  });

  it('the New Year number rolls over in July', () => {
    expect(newYearNumber(d(2026, 12, 31))).toBe(2027);
    expect(newYearNumber(d(2027, 1, 1))).toBe(2027);
  });

  it('every id is a known event', () => {
    const all: EventId[] = [...EVENT_IDS];
    expect(all).toContain('anonovo');
  });
});
