import {
  BOOKING_PRESETS,
  BOOKING_TZ,
  MAX_BOOKING_SLOTS,
  addDaysMs,
  dateInputOf,
  fmtClock,
  fmtDay,
  fmtWhen,
  isValidTimeZone,
  parseLocalInput,
  startOfDayMs,
  tzParts,
  validateWindow,
  weekStartMs,
  weekdayShort,
  type BookingBlock,
  type BookingDoor,
  type BookingLimits,
  type BookingPreset,
  type BookingStatus,
  type BookingWindow,
} from '@workverse/shared';

/**
 * Logica pura do app de reservas no cliente (sem React nem rede): janelas da agenda, blocos, atalhos, datas e textos.
 * Todos os tempos sao ms UTC; o fuso entra como parametro (o do navegador, ou Brasilia, o padrao).
 */

export type AgendaView = 'day' | 'week';

/** Fuso do navegador quando e valido; senao Brasilia (padrao de exibicao). */
export function browserTz(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return isValidTimeZone(tz) ? tz : BOOKING_TZ;
  } catch {
    return BOOKING_TZ;
  }
}

export interface DayCol {
  /** Meia-noite local (ms UTC) e a da manha seguinte. */
  start: number;
  end: number;
  /** "ter" */
  weekday: string;
  /** "20/10" */
  label: string;
  today: boolean;
}

export function dayColumns(anchor: number, view: AgendaView, now: number, tz: string): DayCol[] {
  const first = view === 'week' ? weekStartMs(anchor, tz) : startOfDayMs(anchor, tz);
  const today = startOfDayMs(now, tz);
  const n = view === 'week' ? 7 : 1;
  const out: DayCol[] = [];
  for (let i = 0; i < n; i++) {
    const start = addDaysMs(first, i, tz);
    const p = tzParts(start, tz);
    out.push({ start, end: addDaysMs(start, 1, tz), weekday: weekdayShort(start, tz), label: `${String(p.d).padStart(2, '0')}/${String(p.m).padStart(2, '0')}`, today: start === today });
  }
  return out;
}

/** Janela [from, to) que a agenda precisa pedir ao servidor. */
export function agendaWindow(anchor: number, view: AgendaView, tz: string): { from: number; to: number } {
  const cols = dayColumns(anchor, view, anchor, tz);
  return { from: cols[0]!.start, to: cols[cols.length - 1]!.end };
}

/** Move a ancora um dia (ou uma semana) para tras (-1) ou para a frente (+1). */
export function shiftAnchor(anchor: number, view: AgendaView, dir: -1 | 1, tz: string): number {
  return addDaysMs(startOfDayMs(anchor, tz), dir * (view === 'week' ? 7 : 1), tz);
}

export interface PlacedBlock {
  id: string;
  /** Percentual da altura da coluna do dia (0..100). */
  top: number;
  height: number;
  state: BookingBlock['state'];
  mine: boolean;
  startAt: number;
  endAt: number;
  /** O bloco continua depois da meia-noite (ou veio de antes). */
  cutStart: boolean;
  cutEnd: boolean;
  title?: string;
  ownerName?: string;
  guests?: string[];
}

/** Recorta cada bloco ao dia e calcula onde ele cai na coluna. Blocos fora do dia somem. */
export function placeBlocks(blocks: readonly BookingBlock[], col: Pick<DayCol, 'start' | 'end'>): PlacedBlock[] {
  const len = col.end - col.start;
  const out: PlacedBlock[] = [];
  for (const b of blocks) {
    const s = Math.max(b.startAt, col.start);
    const e = Math.min(b.endAt, col.end);
    if (e <= s) continue;
    out.push({
      id: b.id,
      top: ((s - col.start) / len) * 100,
      height: ((e - s) / len) * 100,
      state: b.state,
      mine: b.mine,
      startAt: b.startAt,
      endAt: b.endAt,
      cutStart: b.startAt < col.start,
      cutEnd: b.endAt > col.end,
      ...(b.title !== undefined ? { title: b.title } : {}),
      ...(b.ownerName !== undefined ? { ownerName: b.ownerName } : {}),
      ...(b.guests !== undefined ? { guests: b.guests } : {}),
    });
  }
  return out.sort((a, b) => a.startAt - b.startAt);
}

/** Texto do bloco: quem nao tem acesso ve so "Ocupada". */
export function blockLabel(b: Pick<PlacedBlock, 'state' | 'title' | 'ownerName' | 'mine'>): string {
  const base = b.state === 'pending' ? 'Pendente' : 'Ocupada';
  if (b.title === undefined) return base;
  return `${base}: ${b.title}${b.ownerName ? ` (${b.ownerName})` : ''}`;
}

/** Intervalos livres de um dia, a partir de `now` (nao oferece o passado). Descarta vaos menores que `minMs`. */
export function freeIntervals(blocks: readonly BookingWindow[], col: Pick<DayCol, 'start' | 'end'>, now: number, minMs = 15 * 60_000): BookingWindow[] {
  const out: BookingWindow[] = [];
  let cursor = Math.max(col.start, now);
  for (const b of [...blocks].sort((x, y) => x.startAt - y.startAt)) {
    if (b.endAt <= cursor) continue;
    if (b.startAt >= col.end) break;
    if (b.startAt - cursor >= minMs) out.push({ startAt: cursor, endAt: b.startAt });
    cursor = Math.max(cursor, b.endAt);
  }
  if (col.end - cursor >= minMs) out.push({ startAt: cursor, endAt: col.end });
  return out;
}

// ---- formulario de pedido -------------------------------------------------------------------------------

/** "2026-10-20" mais `n` dias (calendario local). */
export function addDaysToDate(date: string, n: number, tz: string): string {
  const ms = parseLocalInput(date, '12:00', tz);
  if (ms === null) return date;
  return dateInputOf(addDaysMs(startOfDayMs(ms, tz), n, tz) + 12 * 3_600_000, tz);
}

export interface SlotBuild {
  slots: BookingWindow[];
  error?: string;
}

/** Junta data(s) + hora de inicio + duracao em janelas ms UTC (uma por dia escolhido, no maximo 7, em ordem). */
export function buildRequestSlots(o: { date: string; time: string; minutes: number; extraDates?: readonly string[]; tz: string }): SlotBuild {
  if (!Number.isInteger(o.minutes) || o.minutes <= 0) return { slots: [], error: 'Escolha a duração.' };
  const dates = [...new Set([o.date, ...(o.extraDates ?? [])])].sort();
  if (dates.length > MAX_BOOKING_SLOTS) return { slots: [], error: `Escolha no máximo ${MAX_BOOKING_SLOTS} dias de uma vez.` };
  const slots: BookingWindow[] = [];
  for (const d of dates) {
    const start = parseLocalInput(d, o.time, o.tz);
    if (start === null) return { slots: [], error: 'Data ou hora inválida.' };
    slots.push({ startAt: start, endAt: start + o.minutes * 60_000 });
  }
  return { slots };
}

/** Resumo de problemas que o cliente ja sabe (o servidor decide de novo): primeiro erro de forma entre as janelas. */
export function firstWindowProblem(slots: readonly BookingWindow[], now: number, limits: BookingLimits): string | null {
  for (const s of slots) {
    const v = validateWindow(s, now, limits);
    if (!v.ok) return v.message;
  }
  return null;
}

/** Atalhos de duracao que cabem no limite da organizacao (os demais ficam desabilitados com explicacao). */
export function presetsFor(limits: BookingLimits): Array<BookingPreset & { allowed: boolean }> {
  return BOOKING_PRESETS.map((p) => ({ ...p, allowed: p.minutes <= limits.maxDurationMin }));
}

/** Hora de inicio sugerida: a proxima meia hora cheia (ou o horario padrao do atalho). */
export function suggestStartTime(now: number, tz: string): { date: string; time: string } {
  const next = Math.ceil((now + 60_000) / (30 * 60_000)) * 30 * 60_000;
  const p = tzParts(next, tz);
  return { date: dateInputOf(next, tz), time: `${String(p.h).padStart(2, '0')}:${String(p.min).padStart(2, '0')}` };
}

// ---- textos ---------------------------------------------------------------------------------------------

export const STATUS_LABEL: Record<BookingStatus, string> = {
  pending: 'Aguardando aprovação',
  confirmed: 'Confirmada',
  queued: 'Na fila',
  cancelled: 'Cancelada',
  declined: 'Recusada',
  ended: 'Encerrada',
  no_show: 'Liberada (ninguém entrou)',
  expired: 'Expirada',
};

export const ordinal = (n: number): string => `${n}º`;

/** "Você é o 2º da fila. Próxima janela livre: ter, 20/10 às 16:00." */
export function queueText(position: number | undefined, suggestion: number | null | undefined, tz: string): string {
  const pos = position ? `Você é o ${ordinal(position)} da fila.` : 'Você está na fila.';
  return suggestion ? `${pos} Próxima janela livre: ${fmtWhen(suggestion, tz)}.` : pos;
}

export interface DoorText {
  text: string;
  tone: 'free' | 'busy' | 'soon';
  locked: boolean;
}

/** Texto da placa da porta: quem tem acesso ve o nome do dono; quem nao tem ve so "Ocupada". */
export function doorText(d: BookingDoor, tz: string): DoorText {
  if (d.state === 'busy') {
    const until = d.until ? ` até ${fmtClock(d.until, tz)}` : '';
    return { text: d.by ? `Reservada por ${d.by}${until}` : `Ocupada${until}`, tone: 'busy', locked: !d.open };
  }
  if (d.state === 'soon') return { text: d.from ? `Reservada às ${fmtClock(d.from, tz)}` : 'Reserva em breve', tone: 'soon', locked: false };
  return { text: 'Livre', tone: 'free', locked: false };
}

/** "ter, 20/10, 15:00 às 17:00" para a lista (reexporta para a UI ter um unico ponto de formatacao). */
export { fmtDay, fmtClock, fmtWhen };
