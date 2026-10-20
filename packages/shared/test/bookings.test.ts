import { describe, expect, it } from 'vitest';
import {
  BOOKING_DAY,
  BOOKING_HOUR,
  BOOKING_MINUTE,
  DEFAULT_BOOKING_LIMITS,
  addDaysMs,
  checkPersonLimits,
  conflictsWith,
  dateInputOf,
  dayIndex,
  doorOf,
  fmtClock,
  fmtDay,
  fmtRange,
  formatMinutes,
  isValidTimeZone,
  limitsAreValid,
  minutesOnDay,
  nextFreeStart,
  noShowDue,
  overlaps,
  parseLocalInput,
  promotionPlan,
  queueCompare,
  queuePosition,
  sanitizeLimits,
  startOfDayMs,
  timeInputOf,
  validateWindow,
  weekStartMs,
  windowPhase,
  zonedToMs,
  type BookingCore,
  type BookingLimits,
  type BookingStatus,
} from '../src';

const L: BookingLimits = { ...DEFAULT_BOOKING_LIMITS, maxDurationMin: 240 };
// 2026-10-20 12:00 em Brasilia (15:00 UTC)
const NOW = Date.UTC(2026, 9, 20, 15, 0, 0);
const at = (h: number, m = 0, dayOffset = 0) => NOW + dayOffset * BOOKING_DAY + (h - 12) * BOOKING_HOUR + m * BOOKING_MINUTE;
let n = 0;
const bk = (startH: number, endH: number, status: BookingStatus = 'confirmed', owner = 'ana', createdAt = ++n): BookingCore => ({ id: `b${createdAt}-${startH}`, roomId: 'private', ownerId: owner, status, createdAt, startAt: at(startH), endAt: at(endH) });

describe('janelas e conflitos', () => {
  it('overlaps: encostar nao e conflito', () => {
    expect(overlaps({ startAt: 0, endAt: 10 }, { startAt: 10, endAt: 20 })).toBe(false);
    expect(overlaps({ startAt: 0, endAt: 11 }, { startAt: 10, endAt: 20 })).toBe(true);
    expect(overlaps({ startAt: 5, endAt: 6 }, { startAt: 0, endAt: 100 })).toBe(true);
  });

  it('so reservas que ocupam o horario (pendente/confirmada) geram conflito', () => {
    const list = [bk(14, 16, 'confirmed'), bk(14, 16, 'pending'), bk(14, 16, 'queued'), bk(14, 16, 'cancelled'), bk(14, 16, 'declined'), bk(14, 16, 'no_show'), bk(14, 16, 'ended')];
    expect(conflictsWith({ startAt: at(15), endAt: at(17) }, list).map((b) => b.status)).toEqual(['confirmed', 'pending']);
    expect(conflictsWith({ startAt: at(16), endAt: at(17) }, list)).toEqual([]);
    expect(conflictsWith({ startAt: at(15), endAt: at(17) }, list, list[0]!.id)).toHaveLength(1);
  });
});

describe('validateWindow', () => {
  const ok = (s: number, e: number) => validateWindow({ startAt: s, endAt: e }, NOW, L);
  it('aceita janelas validas', () => {
    expect(ok(at(14), at(16))).toEqual({ ok: true });
    expect(ok(NOW, at(13))).toEqual({ ok: true });
  });
  it('recusa horario fora da grade de 5 min, fim antes do inicio e muito curto', () => {
    expect(ok(at(14, 3), at(16))).toMatchObject({ ok: false, code: 'bad_time' });
    expect(ok(at(14), at(14))).toMatchObject({ ok: false, code: 'bad_time' });
    expect(ok(at(14), at(13))).toMatchObject({ ok: false, code: 'bad_time' });
    expect(ok(at(14), at(14, 10))).toMatchObject({ ok: false, code: 'too_short' });
    expect(ok(Number.NaN, at(14))).toMatchObject({ ok: false, code: 'bad_time' });
  });
  it('recusa passado, duracao acima do limite e antecedencia acima do limite, com mensagem em portugues', () => {
    expect(ok(at(9), at(10))).toMatchObject({ ok: false, code: 'past', message: 'Esse horário já passou.' });
    const long = ok(at(14), at(19));
    expect(long).toMatchObject({ ok: false, code: 'too_long' });
    expect((long as { message: string }).message).toContain('4 h');
    const far = ok(at(14, 0, 31), at(15, 0, 31));
    expect(far).toMatchObject({ ok: false, code: 'too_far' });
    expect((far as { message: string }).message).toContain('30 dias');
    expect(ok(at(10, 0, 30), at(11, 0, 30))).toEqual({ ok: true });
  });
});

describe('limites por pessoa', () => {
  const win = { startAt: at(14), endAt: at(16) };
  it('maximo de reservas ativas: conta pendente, confirmada e fila; ignora as encerradas e a propria editada', () => {
    const mine = [bk(10, 11, 'confirmed', 'ana'), bk(17, 18, 'queued', 'ana'), bk(8, 9, 'ended', 'ana'), bk(8, 9, 'cancelled', 'ana')];
    mine[0] = { ...mine[0]!, startAt: at(9, 0, 1), endAt: at(10, 0, 1) };
    const r = checkPersonLimits(win, mine, NOW, L);
    expect(r).toMatchObject({ ok: false, code: 'too_many' });
    expect((r as { message: string }).message).toContain('limite é 2');
    expect(checkPersonLimits(win, mine, NOW, L, mine[1]!.id)).toEqual({ ok: true });
    expect(checkPersonLimits(win, [mine[2]!, mine[3]!], NOW, L)).toEqual({ ok: true });
  });
  it('reservas que ja terminaram no relogio nao contam como futuras', () => {
    const past = { ...bk(10, 11, 'confirmed'), startAt: NOW - 3 * BOOKING_HOUR, endAt: NOW - 2 * BOOKING_HOUR };
    expect(checkPersonLimits(win, [past, past], NOW, L)).toEqual({ ok: true });
  });
  it('maximo de horas no dia (so o que ocupa horario conta) por dia de Brasilia', () => {
    const lim = { ...L, maxDurationMin: 480, maxDailyMin: 360, maxActivePerPerson: 5 };
    const mine = [bk(8, 12, 'confirmed', 'ana'), bk(8, 9, 'queued', 'ana')];
    // 4 h ja reservadas; mais 2 h = 6 h (no limite)
    expect(checkPersonLimits({ startAt: at(14), endAt: at(16) }, mine, NOW, lim)).toEqual({ ok: true });
    const r = checkPersonLimits({ startAt: at(14), endAt: at(17) }, mine, NOW, lim);
    expect(r).toMatchObject({ ok: false, code: 'daily_cap' });
    // outro dia nao e afetado
    expect(checkPersonLimits({ startAt: at(14, 0, 1), endAt: at(20, 0, 1) }, mine, NOW, lim)).toEqual({ ok: true });
  });
  it('janela que atravessa a meia-noite de Brasilia divide as horas entre os dois dias', () => {
    const day = dayIndex(at(23));
    const w = { startAt: at(22), endAt: at(26) };
    expect(minutesOnDay(w, day)).toBe(120);
    expect(minutesOnDay(w, day + 1)).toBe(120);
    expect(minutesOnDay(w, day + 2)).toBe(0);
  });
});

describe('fila e proxima janela livre', () => {
  it('posicao: ordem de chegada entre quem disputa a mesma janela da mesma sala', () => {
    const q1 = bk(14, 16, 'queued', 'b', 10);
    const q2 = bk(15, 17, 'queued', 'c', 20);
    const q3 = bk(18, 19, 'queued', 'd', 5); // janela diferente
    const other = { ...bk(14, 16, 'queued', 'e', 1), roomId: 'meeting1' };
    const all = [q2, q1, q3, other, bk(14, 16, 'confirmed', 'a', 0)];
    expect(queuePosition(q1, all)).toBe(1);
    expect(queuePosition(q2, all)).toBe(2);
    expect(queuePosition(q3, all)).toBe(1);
  });
  it('desempate pelo id quando chegam no mesmo instante', () => {
    const a = { ...bk(14, 15, 'queued', 'a', 7), id: 'a' };
    const b = { ...bk(14, 15, 'queued', 'b', 7), id: 'b' };
    expect([b, a].sort(queueCompare).map((x) => x.id)).toEqual(['a', 'b']);
  });
  it('nextFreeStart pula blocos seguidos e respeita a antecedencia maxima', () => {
    const holders = [bk(14, 16), bk(16, 17), bk(18, 19)];
    expect(nextFreeStart(holders, 2 * BOOKING_HOUR, at(14), NOW, L)).toBe(at(19));
    expect(nextFreeStart(holders, 1 * BOOKING_HOUR, at(14), NOW, L)).toBe(at(17));
    expect(nextFreeStart([], BOOKING_HOUR, at(9), NOW, L)).toBe(NOW); // no passado: parte de agora
    const wall = [{ startAt: NOW, endAt: NOW + 40 * BOOKING_DAY }];
    expect(nextFreeStart(wall, BOOKING_HOUR, NOW, NOW, L)).toBeNull();
  });
  it('promotionPlan: sobe em ordem de chegada o que cabe, expira o que ja comecou, deixa o resto esperando', () => {
    const holder = bk(14, 16, 'confirmed', 'a', 1);
    const q1 = bk(15, 17, 'queued', 'b', 2); // bate com o holder: espera
    const q2 = bk(16, 18, 'queued', 'c', 3); // cabe
    const q3 = bk(17, 19, 'queued', 'd', 4); // bate com q2 (que sobe antes): espera
    const old = bk(11, 13, 'queued', 'e', 5); // ja comecou
    const plan = promotionPlan([holder, q1, q2, q3, old], NOW);
    expect(plan.promote.map((b) => b.ownerId)).toEqual(['c']);
    expect(plan.expire.map((b) => b.ownerId)).toEqual(['e']);
    // cancelando o holder, q1 sobe; q2 (bate com q1) espera e q3 (livre depois de q1) sobe tambem
    const plan2 = promotionPlan([{ ...holder, status: 'cancelled' }, q1, q2, q3], NOW);
    expect(plan2.promote.map((b) => b.ownerId)).toEqual(['b', 'd']);
  });
  it('promotionPlan aplica a regra extra do chamador (skip / expire)', () => {
    const q1 = bk(15, 17, 'queued', 'b', 2);
    const q2 = bk(15, 17, 'queued', 'c', 3);
    const plan = promotionPlan([q1, q2], NOW, (b) => (b.ownerId === 'b' ? 'expire' : 'ok'));
    expect(plan.expire.map((b) => b.ownerId)).toEqual(['b']);
    expect(plan.promote.map((b) => b.ownerId)).toEqual(['c']);
  });
});

describe('relogio da reserva', () => {
  it('fases', () => {
    const w = { startAt: at(14), endAt: at(15) };
    expect(windowPhase(w, at(13, 59))).toBe('upcoming');
    expect(windowPhase(w, at(14))).toBe('active');
    expect(windowPhase(w, at(14, 59))).toBe('active');
    expect(windowPhase(w, at(15))).toBe('over');
  });
  it('no-show: so confirmada, sem entrada, passado o prazo e antes do fim', () => {
    const b = { status: 'confirmed' as BookingStatus, startAt: at(14), endAt: at(16), checkedInAt: null };
    expect(noShowDue(b, at(14, 14), L)).toBe(false);
    expect(noShowDue(b, at(14, 15), L)).toBe(true);
    expect(noShowDue({ ...b, checkedInAt: at(14, 2) }, at(14, 30), L)).toBe(false);
    expect(noShowDue({ ...b, status: 'pending' }, at(14, 30), L)).toBe(false);
    expect(noShowDue(b, at(14, 30), { ...L, noShowMin: 0 })).toBe(false);
    expect(noShowDue(b, at(16), L)).toBe(false);
  });
  it('placa da porta: livre, em breve, ocupada (blocos colados contam como um)', () => {
    expect(doorOf([], NOW)).toEqual({ state: 'free' });
    expect(doorOf([bk(15, 16)], NOW)).toEqual({ state: 'free' });
    expect(doorOf([{ ...bk(12, 13), startAt: at(12, 20) }], NOW)).toEqual({ state: 'soon', from: at(12, 20) });
    expect(doorOf([bk(11, 13)], NOW)).toEqual({ state: 'busy', until: at(13) });
    expect(doorOf([bk(11, 13), bk(13, 14), bk(15, 16)], NOW)).toEqual({ state: 'busy', until: at(14) });
  });
});

describe('limites de organizacao', () => {
  it('sanitizeLimits e limitsAreValid sao estritos', () => {
    expect(sanitizeLimits({ maxDurationMin: 90, maxActivePerPerson: 0, noShowMin: 5 })).toEqual({ ...DEFAULT_BOOKING_LIMITS, maxDurationMin: 90, noShowMin: 5 });
    expect(sanitizeLimits('x')).toEqual(DEFAULT_BOOKING_LIMITS);
    expect(limitsAreValid(DEFAULT_BOOKING_LIMITS)).toBe(true);
    expect(limitsAreValid({ ...DEFAULT_BOOKING_LIMITS, maxDurationMin: 5 })).toBe(false);
    expect(limitsAreValid({ ...DEFAULT_BOOKING_LIMITS, maxAdvanceDays: 1.5 })).toBe(false);
    expect(limitsAreValid({ ...DEFAULT_BOOKING_LIMITS, noShowMin: undefined })).toBe(false);
    expect(limitsAreValid(null)).toBe(false);
  });
  it('formatMinutes', () => {
    expect(formatMinutes(45)).toBe('45 min');
    expect(formatMinutes(240)).toBe('4 h');
    expect(formatMinutes(90)).toBe('1 h 30 min');
  });
});

describe('fusos e formatacao', () => {
  it('Brasilia: 12:00 local = 15:00 UTC e o dia comeca as 03:00 UTC', () => {
    expect(timeInputOf(NOW)).toBe('12:00');
    expect(dateInputOf(NOW)).toBe('2026-10-20');
    expect(startOfDayMs(NOW)).toBe(Date.UTC(2026, 9, 20, 3, 0, 0));
    expect(zonedToMs(2026, 10, 20, 12, 0)).toBe(NOW);
  });
  it('parseLocalInput converte data+hora no fuso e recusa lixo', () => {
    expect(parseLocalInput('2026-10-20', '12:00')).toBe(NOW);
    expect(parseLocalInput('2026-10-20', '12:00', 'UTC')).toBe(Date.UTC(2026, 9, 20, 12, 0, 0));
    expect(parseLocalInput('2026-10-20', '09:30', 'Asia/Tokyo')).toBe(Date.UTC(2026, 9, 20, 0, 30, 0));
    expect(parseLocalInput('2026-02-31', '10:00')).toBeNull();
    expect(parseLocalInput('2026-10-20', '25:00')).toBeNull();
    expect(parseLocalInput('20/10/2026', '10:00')).toBeNull();
  });
  it('troca de horario de verao (Nova York): meia-noite local e adicionar dias', () => {
    const tz = 'America/New_York';
    const d1 = zonedToMs(2026, 3, 7, 0, 0, tz);
    const d2 = addDaysMs(d1, 1, tz); // 8/3 00:00 (EST)
    const d3 = addDaysMs(d2, 1, tz); // 9/3 00:00 (EDT, o dia anterior teve 23 h)
    expect(d2 - d1).toBe(BOOKING_DAY);
    expect(d3 - d2).toBe(BOOKING_DAY - BOOKING_HOUR);
    expect(timeInputOf(d3, tz)).toBe('00:00');
  });
  it('semana comeca na segunda-feira', () => {
    const w = weekStartMs(NOW); // 20/10/2026 e terca
    expect(dateInputOf(w)).toBe('2026-10-19');
    expect(weekStartMs(w)).toBe(w);
  });
  it('textos em pt-BR', () => {
    expect(fmtClock(NOW)).toBe('12:00');
    expect(fmtDay(NOW)).toBe('ter, 20/10');
    expect(fmtRange(at(14), at(16))).toBe('ter, 20/10, 14:00 às 16:00');
    expect(fmtRange(at(22), at(26))).toBe('ter, 20/10 às 22:00 – qua, 21/10 às 02:00');
    expect(fmtClock(NOW, 'UTC')).toBe('15:00');
  });
  it('isValidTimeZone', () => {
    expect(isValidTimeZone('America/Sao_Paulo')).toBe(true);
    expect(isValidTimeZone('Marte/Olympus')).toBe(false);
    expect(isValidTimeZone(42)).toBe(false);
  });
});
