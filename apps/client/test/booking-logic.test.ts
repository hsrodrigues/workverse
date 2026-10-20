import { describe, expect, it } from 'vitest';
import { BOOKING_DAY, BOOKING_HOUR, DEFAULT_BOOKING_LIMITS, type BookingBlock } from '@workverse/shared';
import { addDaysToDate, agendaWindow, blockLabel, buildRequestSlots, dayColumns, doorText, firstWindowProblem, freeIntervals, placeBlocks, presetsFor, queueText, shiftAnchor, suggestStartTime } from '../src/ui/bookings/bookingLogic';

const TZ = 'America/Sao_Paulo';
const NOW = Date.UTC(2026, 9, 20, 15, 0, 0); // 12:00 em Brasilia (terca)
const at = (h: number, m = 0, d = 0) => NOW + d * BOOKING_DAY + (h - 12) * BOOKING_HOUR + m * 60_000;

describe('agenda: colunas e janelas', () => {
  it('semana comeca na segunda; dia tem 1 coluna; marca hoje', () => {
    const w = dayColumns(NOW, 'week', NOW, TZ);
    expect(w).toHaveLength(7);
    expect(w[0]!.weekday).toBe('seg');
    expect(w[0]!.label).toBe('19/10');
    expect(w[1]!.today).toBe(true);
    expect(dayColumns(NOW, 'day', NOW, TZ)).toHaveLength(1);
    const win = agendaWindow(NOW, 'week', TZ);
    expect(win.to - win.from).toBe(7 * BOOKING_DAY);
  });
  it('shiftAnchor anda um dia ou uma semana', () => {
    expect(shiftAnchor(NOW, 'day', 1, TZ) - NOW).toBeGreaterThan(BOOKING_DAY - BOOKING_HOUR * 13);
    const next = shiftAnchor(NOW, 'week', 1, TZ);
    expect(agendaWindow(next, 'week', TZ).from - agendaWindow(NOW, 'week', TZ).from).toBe(7 * BOOKING_DAY);
  });
});

describe('blocos e horarios livres', () => {
  const col = dayColumns(NOW, 'day', NOW, TZ)[0]!;
  const blocks: BookingBlock[] = [
    { id: 'a', startAt: at(14), endAt: at(16), state: 'busy', mine: false },
    { id: 'b', startAt: at(18), endAt: at(19), state: 'pending', mine: true, title: 'Plano', ownerName: 'Ana' },
    { id: 'c', startAt: at(20, 0, 1), endAt: at(21, 0, 1), state: 'busy', mine: false },
  ];
  it('posiciona em percentual do dia e recorta o que passa da meia-noite', () => {
    const p = placeBlocks(blocks, col);
    expect(p.map((b) => b.id)).toEqual(['a', 'b']);
    expect(p[0]!.top).toBeCloseTo((14 / 24) * 100, 5);
    expect(p[0]!.height).toBeCloseTo((2 / 24) * 100, 5);
    const night = placeBlocks([{ id: 'n', startAt: at(22), endAt: at(26), state: 'busy', mine: false }], col);
    expect(night[0]).toMatchObject({ cutEnd: true, cutStart: false });
    expect(night[0]!.top + night[0]!.height).toBeCloseTo(100, 5);
  });
  it('estranho ve so "Ocupada"; dono ve o titulo', () => {
    const p = placeBlocks(blocks, col);
    expect(blockLabel(p[0]!)).toBe('Ocupada');
    expect(blockLabel(p[1]!)).toBe('Pendente: Plano (Ana)');
  });
  it('livres: nao oferece o passado nem vaos menores que 15 min', () => {
    const f = freeIntervals(blocks, col, NOW);
    expect(f[0]).toEqual({ startAt: NOW, endAt: at(14) });
    expect(f[1]).toEqual({ startAt: at(16), endAt: at(18) });
    expect(f[2]).toEqual({ startAt: at(19), endAt: col.end });
    expect(freeIntervals([{ startAt: at(12, 10), endAt: at(23) }], col, NOW).find((x) => x.startAt === NOW)).toBeUndefined();
  });
});

describe('formulario', () => {
  it('monta uma janela por dia na mesma hora, ordenadas, ate 7', () => {
    const r = buildRequestSlots({ date: '2026-10-21', time: '14:00', minutes: 120, extraDates: ['2026-10-22', '2026-10-21'], tz: TZ });
    expect(r.slots).toEqual([
      { startAt: at(14, 0, 1), endAt: at(16, 0, 1) },
      { startAt: at(14, 0, 2), endAt: at(16, 0, 2) },
    ]);
    expect(buildRequestSlots({ date: '2026-10-21', time: '14:00', minutes: 60, extraDates: Array.from({ length: 8 }, (_, i) => `2026-11-0${i + 1}`), tz: TZ }).error).toContain('no máximo 7');
    expect(buildRequestSlots({ date: '2026-02-31', time: '14:00', minutes: 60, tz: TZ }).error).toBe('Data ou hora inválida.');
    expect(buildRequestSlots({ date: '2026-10-21', time: '14:00', minutes: 0, tz: TZ }).error).toBe('Escolha a duração.');
  });
  it('o fuso muda o instante UTC', () => {
    const br = buildRequestSlots({ date: '2026-10-21', time: '09:00', minutes: 60, tz: TZ }).slots[0]!.startAt;
    const utc = buildRequestSlots({ date: '2026-10-21', time: '09:00', minutes: 60, tz: 'UTC' }).slots[0]!.startAt;
    expect(br - utc).toBe(3 * BOOKING_HOUR);
  });
  it('problemas conhecidos no cliente (passado, duracao) e atalhos que nao cabem no limite', () => {
    expect(firstWindowProblem([{ startAt: at(9), endAt: at(10) }], NOW, DEFAULT_BOOKING_LIMITS)).toBe('Esse horário já passou.');
    expect(firstWindowProblem([{ startAt: at(14), endAt: at(15) }], NOW, DEFAULT_BOOKING_LIMITS)).toBeNull();
    const p = presetsFor({ ...DEFAULT_BOOKING_LIMITS, maxDurationMin: 120 });
    expect(p.map((x) => [x.id, x.allowed])).toEqual([['1h', true], ['2h', true], ['half', false], ['full', false]]);
  });
  it('datas e inicio sugerido (proxima meia hora)', () => {
    expect(addDaysToDate('2026-10-31', 1, TZ)).toBe('2026-11-01');
    expect(suggestStartTime(NOW, TZ)).toEqual({ date: '2026-10-20', time: '12:30' });
  });
});

describe('textos', () => {
  it('fila e placa da porta (privacidade: sem nome para quem nao tem acesso)', () => {
    expect(queueText(2, at(16), TZ)).toBe('Você é o 2º da fila. Próxima janela livre: ter, 20/10 às 16:00.');
    expect(queueText(1, null, TZ)).toBe('Você é o 1º da fila.');
    expect(doorText({ roomId: 'private', state: 'free', open: true }, TZ)).toEqual({ text: 'Livre', tone: 'free', locked: false });
    expect(doorText({ roomId: 'private', state: 'busy', until: at(15), by: 'Ana', open: true }, TZ)).toEqual({ text: 'Reservada por Ana até 15:00', tone: 'busy', locked: false });
    expect(doorText({ roomId: 'private', state: 'busy', until: at(15), open: false }, TZ)).toEqual({ text: 'Ocupada até 15:00', tone: 'busy', locked: true });
    expect(doorText({ roomId: 'private', state: 'soon', from: at(14), open: true }, TZ).text).toBe('Reservada às 14:00');
  });
});
