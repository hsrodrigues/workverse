import { BOOKING_TZ } from './bookings';

/**
 * Datas e horas por fuso, sem biblioteca: tudo parte de ms UTC e de um nome de fuso IANA (padrao de exibicao: America/Sao_Paulo; o
 * cliente passa o fuso do navegador). Usado pelo servidor (textos dos avisos) e pelo cliente (formulario e agenda).
 */

const dtfCache = new Map<string, Intl.DateTimeFormat>();
function dtf(tz: string): Intl.DateTimeFormat {
  let f = dtfCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short' });
    dtfCache.set(tz, f);
  }
  return f;
}

/** `true` quando o nome do fuso e conhecido pelo ambiente. */
export function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || tz.length === 0 || tz.length > 64) return false;
  try {
    dtf(tz);
    return true;
  } catch {
    return false;
  }
}

export interface ZonedParts {
  y: number;
  /** 1..12 */
  m: number;
  d: number;
  h: number;
  min: number;
  s: number;
  /** 0 = domingo */
  wd: number;
}

const WD: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function tzParts(ms: number, tz: string = BOOKING_TZ): ZonedParts {
  const p: Record<string, string> = {};
  for (const x of dtf(tz).formatToParts(new Date(ms))) p[x.type] = x.value;
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day), h: Number(p.hour) % 24, min: Number(p.minute), s: Number(p.second), wd: WD[p.weekday ?? 'Sun'] ?? 0 };
}

/** Diferenca (local - UTC) em ms no instante `ms`. */
export function tzOffsetMs(ms: number, tz: string = BOOKING_TZ): number {
  const p = tzParts(ms, tz);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s) - Math.floor(ms / 1000) * 1000;
}

/** Instante UTC de uma data/hora de parede no fuso. Horas inexistentes (salto do horario de verao) avancam para a seguinte. */
export function zonedToMs(y: number, m: number, d: number, h: number, min: number, tz: string = BOOKING_TZ): number {
  const guess = Date.UTC(y, m - 1, d, h, min, 0);
  let ms = guess - tzOffsetMs(guess, tz);
  const again = guess - tzOffsetMs(ms, tz);
  if (again !== ms) ms = again;
  return ms;
}

/** Meia-noite local do dia que contem `ms`. */
export function startOfDayMs(ms: number, tz: string = BOOKING_TZ): number {
  const p = tzParts(ms, tz);
  return zonedToMs(p.y, p.m, p.d, 0, 0, tz);
}

/** Meia-noite local `n` dias depois de `dayStart` (n pode ser negativo). */
export function addDaysMs(dayStart: number, n: number, tz: string = BOOKING_TZ): number {
  const p = tzParts(dayStart, tz);
  return zonedToMs(p.y, p.m, p.d + n, 0, 0, tz);
}

/** Segunda-feira (meia-noite local) da semana de `ms`. */
export function weekStartMs(ms: number, tz: string = BOOKING_TZ): number {
  const day = startOfDayMs(ms, tz);
  const wd = tzParts(day, tz).wd;
  return addDaysMs(day, -((wd + 6) % 7), tz);
}

const pad = (n: number) => String(n).padStart(2, '0');

/** "2026-10-20" do dia local. */
export function dateInputOf(ms: number, tz: string = BOOKING_TZ): string {
  const p = tzParts(ms, tz);
  return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
}
/** "15:30" do horario local. */
export function timeInputOf(ms: number, tz: string = BOOKING_TZ): string {
  const p = tzParts(ms, tz);
  return `${pad(p.h)}:${pad(p.min)}`;
}

/** Junta os valores de <input type=date> e <input type=time> em ms UTC; null quando algum for invalido. */
export function parseLocalInput(date: string, time: string, tz: string = BOOKING_TZ): number | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const t = /^(\d{2}):(\d{2})$/.exec(time);
  if (!d || !t) return null;
  const [y, m, dd, h, mi] = [Number(d[1]), Number(d[2]), Number(d[3]), Number(t[1]), Number(t[2])];
  if (m < 1 || m > 12 || dd < 1 || dd > 31 || h > 23 || mi > 59) return null;
  const ms = zonedToMs(y, m, dd, h, mi, tz);
  const back = tzParts(ms, tz);
  // 31 de fevereiro e afins nao existem
  if (back.d !== dd || back.m !== m) return null;
  return ms;
}

const WEEKDAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
export const weekdayShort = (ms: number, tz: string = BOOKING_TZ): string => WEEKDAYS[tzParts(ms, tz).wd]!;

/** "15:00" */
export const fmtClock = (ms: number, tz: string = BOOKING_TZ): string => timeInputOf(ms, tz);
/** "ter, 20/10" */
export function fmtDay(ms: number, tz: string = BOOKING_TZ): string {
  const p = tzParts(ms, tz);
  return `${WEEKDAYS[p.wd]}, ${pad(p.d)}/${pad(p.m)}`;
}
/** "ter, 20/10 às 15:00" */
export const fmtWhen = (ms: number, tz: string = BOOKING_TZ): string => `${fmtDay(ms, tz)} às ${fmtClock(ms, tz)}`;
/** "ter, 20/10, 15:00 às 17:00" (e "ter, 20/10 15:00 – qua, 21/10 09:00" quando atravessa a meia-noite). */
export function fmtRange(startAt: number, endAt: number, tz: string = BOOKING_TZ): string {
  const sameDay = startOfDayMs(startAt, tz) === startOfDayMs(endAt - 1, tz);
  return sameDay ? `${fmtDay(startAt, tz)}, ${fmtClock(startAt, tz)} às ${fmtClock(endAt, tz)}` : `${fmtWhen(startAt, tz)} – ${fmtWhen(endAt, tz)}`;
}

/** "1º", "2º"... para a posicao na fila. */
export const ordinalPt = (n: number): string => `${n}º`;
