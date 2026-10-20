/**
 * Reserva de sala com fila: regras PURAS (sem relogio, sem armazenamento). O servidor (apps/server/src/bookings.ts) e o
 * cliente usam as mesmas funcoes; tudo e em milissegundos UTC. O "dia" das regras por pessoa (limite de horas por dia) segue o
 * fuso de Brasilia (UTC-3, sem horario de verao desde 2019), que tambem e o fuso padrao de exibicao.
 */

export type BookingStatus = 'pending' | 'confirmed' | 'queued' | 'cancelled' | 'declined' | 'ended' | 'no_show' | 'expired';
export const BOOKING_STATUSES: readonly BookingStatus[] = ['pending', 'confirmed', 'queued', 'cancelled', 'declined', 'ended', 'no_show', 'expired'];
export const isBookingStatus = (v: unknown): v is BookingStatus => typeof v === 'string' && (BOOKING_STATUSES as readonly string[]).includes(v);

/** Ocupam o horario da sala (bloqueiam outras): aguardando aprovacao ou confirmada. */
export const isHolder = (s: BookingStatus): boolean => s === 'pending' || s === 'confirmed';
/** Ainda "viva" para a pessoa (conta no limite de reservas futuras): ocupa o horario ou espera na fila. */
export const isLive = (s: BookingStatus): boolean => s === 'pending' || s === 'confirmed' || s === 'queued';

export const BOOKING_MINUTE = 60_000;
export const BOOKING_HOUR = 3_600_000;
export const BOOKING_DAY = 86_400_000;
/** Fuso de Brasilia (UTC-3). Define onde o dia comeca para o limite de horas por dia. */
export const BOOKING_TZ = 'America/Sao_Paulo';
export const BOOKING_TZ_OFFSET_MS = -3 * BOOKING_HOUR;

/** Inicio e fim caem em multiplos de 5 minutos. */
export const BOOKING_GRID_MS = 5 * BOOKING_MINUTE;
export const MIN_BOOKING_MS = 15 * BOOKING_MINUTE;
/** Aviso previo (comeca / termina em 5 min). */
export const BOOKING_WARN_MS = 5 * BOOKING_MINUTE;
/** Tolerancia de quem ja estava dentro quando a reserva comeca. */
export const BOOKING_START_GRACE_MS = 60_000;
export const BOOKING_EXTEND_MS = 30 * BOOKING_MINUTE;
/** Dias que uma unica solicitacao pode pedir (varios dias seguidos). */
export const MAX_BOOKING_SLOTS = 7;
export const MAX_BOOKING_TITLE = 60;
export const MAX_BOOKING_GUESTS = 12;
export const MAX_BOOKING_REASON = 120;
/** Reservas terminadas ha mais que isso sao apagadas. */
export const BOOKING_RETENTION_MS = 90 * BOOKING_DAY;
/** Janela maxima que uma consulta de agenda pode pedir. */
export const MAX_AGENDA_SPAN_MS = 15 * BOOKING_DAY;

/** Limites por organizacao (configuraveis por owner/admin). */
export interface BookingLimits {
  /** Maximo de minutos de UMA reserva. */
  maxDurationMin: number;
  /** Reservas vivas (aguardando aprovacao, confirmadas ou na fila) e ainda por acontecer, por pessoa. */
  maxActivePerPerson: number;
  /** Quantos dias a frente se pode reservar. */
  maxAdvanceDays: number;
  /** Maximo de minutos reservados por pessoa no mesmo dia. */
  maxDailyMin: number;
  /** Minutos sem o dono entrar ate a reserva ser liberada (0 = nao libera). */
  noShowMin: number;
}

export const DEFAULT_BOOKING_LIMITS: Readonly<BookingLimits> = { maxDurationMin: 480, maxActivePerPerson: 2, maxAdvanceDays: 30, maxDailyMin: 480, noShowMin: 15 };

export const BOOKING_LIMIT_BOUNDS: Readonly<Record<keyof BookingLimits, readonly [number, number]>> = {
  maxDurationMin: [15, 1440],
  maxActivePerPerson: [1, 20],
  maxAdvanceDays: [1, 365],
  maxDailyMin: [15, 1440],
  noShowMin: [0, 120],
};

export const LIMIT_LABELS: Readonly<Record<keyof BookingLimits, string>> = {
  maxDurationMin: 'Duração máxima de uma reserva (min)',
  maxActivePerPerson: 'Reservas futuras ativas por pessoa',
  maxAdvanceDays: 'Antecedência máxima (dias)',
  maxDailyMin: 'Máximo por pessoa em um dia (min)',
  noShowMin: 'Liberar se o dono não entrar em (min, 0 = nunca)',
};

/** Lê limites vindos de fora (armazenamento / mensagem): inteiros dentro dos limites, senao o padrao. */
export function sanitizeLimits(raw: unknown, base: BookingLimits = DEFAULT_BOOKING_LIMITS): BookingLimits {
  const out = { ...base };
  if (typeof raw !== 'object' || raw === null) return out;
  for (const k of Object.keys(BOOKING_LIMIT_BOUNDS) as Array<keyof BookingLimits>) {
    const v = (raw as Record<string, unknown>)[k];
    const [lo, hi] = BOOKING_LIMIT_BOUNDS[k];
    if (typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi) out[k] = v;
  }
  return out;
}

/** `true` quando todos os campos estao presentes e dentro dos limites (validacao estrita de mensagem). */
export function limitsAreValid(raw: unknown): raw is BookingLimits {
  if (typeof raw !== 'object' || raw === null) return false;
  for (const k of Object.keys(BOOKING_LIMIT_BOUNDS) as Array<keyof BookingLimits>) {
    const v = (raw as Record<string, unknown>)[k];
    const [lo, hi] = BOOKING_LIMIT_BOUNDS[k];
    if (typeof v !== 'number' || !Number.isInteger(v) || v < lo || v > hi) return false;
  }
  return true;
}

/** Atalhos de duracao do formulario. `startHour`: hora sugerida quando a pessoa ainda nao escolheu a de inicio. */
export interface BookingPreset {
  id: '1h' | '2h' | 'half' | 'full';
  label: string;
  minutes: number;
  startHour?: number;
}
export const BOOKING_PRESETS: readonly BookingPreset[] = [
  { id: '1h', label: '1 h', minutes: 60 },
  { id: '2h', label: '2 h', minutes: 120 },
  { id: 'half', label: 'Meio período', minutes: 240 },
  { id: 'full', label: 'Dia todo', minutes: 480, startHour: 9 },
];

// ---- janelas ------------------------------------------------------------------------------------------

export interface BookingWindow {
  startAt: number;
  endAt: number;
}

export interface BookingCore extends BookingWindow {
  id: string;
  roomId: string;
  ownerId: string;
  status: BookingStatus;
  createdAt: number;
}

export const overlaps = (a: BookingWindow, b: BookingWindow): boolean => a.startAt < b.endAt && b.startAt < a.endAt;

/** Reservas que ocupam o horario e batem com a janela (ignora `ignoreId`, ex.: a propria reserva ao editar). */
export function conflictsWith<T extends BookingCore>(win: BookingWindow, roomBookings: readonly T[], ignoreId?: string): T[] {
  return roomBookings.filter((b) => b.id !== ignoreId && isHolder(b.status) && overlaps(win, b));
}

/** Ordem de chegada: quem pediu primeiro vem primeiro (desempate pelo id, para ser estavel). */
export const queueCompare = (a: Pick<BookingCore, 'createdAt' | 'id'>, b: Pick<BookingCore, 'createdAt' | 'id'>): number => a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Posicao (1 = primeiro) de uma reserva na fila da MESMA sala e janela: conta quem chegou antes e disputa o mesmo horario. */
export function queuePosition(target: BookingCore, roomBookings: readonly BookingCore[]): number {
  let ahead = 0;
  for (const b of roomBookings) {
    if (b.id === target.id || b.status !== 'queued' || b.roomId !== target.roomId) continue;
    if (overlaps(b, target) && queueCompare(b, target) < 0) ahead++;
  }
  return ahead + 1;
}

export type Verdict = { ok: true } | { ok: false; code: string; message: string };
const ok: Verdict = { ok: true };
const no = (code: string, message: string): Verdict => ({ ok: false, code, message });

/** "4 h", "1 h 30 min", "45 min". */
export function formatMinutes(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** Forma da janela (grade, duracao, passado, antecedencia). Nao olha conflitos nem limites por pessoa. */
export function validateWindow(win: BookingWindow, now: number, limits: BookingLimits): Verdict {
  const { startAt, endAt } = win;
  if (!Number.isSafeInteger(startAt) || !Number.isSafeInteger(endAt)) return no('bad_time', 'Horário inválido.');
  if (startAt % BOOKING_GRID_MS !== 0 || endAt % BOOKING_GRID_MS !== 0) return no('bad_time', 'Use horários em múltiplos de 5 minutos.');
  if (endAt <= startAt) return no('bad_time', 'O fim precisa ser depois do início.');
  const len = endAt - startAt;
  if (len < MIN_BOOKING_MS) return no('too_short', 'A reserva precisa ter pelo menos 15 minutos.');
  if (len > limits.maxDurationMin * BOOKING_MINUTE) return no('too_long', `Cada reserva pode ter no máximo ${formatMinutes(limits.maxDurationMin)}.`);
  if (startAt < now - BOOKING_GRID_MS || endAt <= now) return no('past', 'Esse horário já passou.');
  if (startAt > now + limits.maxAdvanceDays * BOOKING_DAY) return no('too_far', `Só dá para reservar com até ${limits.maxAdvanceDays} dias de antecedência.`);
  return ok;
}

/** Numero do dia (fuso de Brasilia). */
export const dayIndex = (ms: number): number => Math.floor((ms + BOOKING_TZ_OFFSET_MS) / BOOKING_DAY);
/** Inicio (UTC) do dia de numero `day`. */
export const dayStartMs = (day: number): number => day * BOOKING_DAY - BOOKING_TZ_OFFSET_MS;

/** Minutos da janela que caem no dia `day`. */
export function minutesOnDay(win: BookingWindow, day: number): number {
  const s = Math.max(win.startAt, dayStartMs(day));
  const e = Math.min(win.endAt, dayStartMs(day + 1));
  return Math.max(0, Math.round((e - s) / BOOKING_MINUTE));
}

/**
 * Limites POR PESSOA: reservas vivas futuras e horas no dia. `mine` = reservas da pessoa (qualquer sala); `ignoreId` = a que esta
 * sendo editada. Reservas na fila contam no total de ativas, mas so as que ocupam horario contam nas horas do dia.
 */
export function checkPersonLimits(win: BookingWindow, mine: readonly BookingCore[], now: number, limits: BookingLimits, ignoreId?: string): Verdict {
  const others = mine.filter((b) => b.id !== ignoreId);
  const active = others.filter((b) => isLive(b.status) && b.endAt > now).length;
  if (active >= limits.maxActivePerPerson) {
    return no('too_many', `Você já tem ${active} reserva${active === 1 ? '' : 's'} ativa${active === 1 ? '' : 's'}. O limite é ${limits.maxActivePerPerson}: cancele uma antes de pedir outra.`);
  }
  for (let d = dayIndex(win.startAt); d <= dayIndex(win.endAt - 1); d++) {
    let used = minutesOnDay(win, d);
    for (const b of others) if (isHolder(b.status)) used += minutesOnDay(b, d);
    if (used > limits.maxDailyMin) return no('daily_cap', `Você passaria de ${formatMinutes(limits.maxDailyMin)} reservados nesse dia (limite por pessoa).`);
  }
  return ok;
}

/**
 * Proximo horario livre (inicio) com a duracao pedida, a partir de `from`. `holders` = o que ocupa a sala. null = nada dentro da
 * antecedencia maxima.
 */
export function nextFreeStart(holders: readonly BookingWindow[], durationMs: number, from: number, now: number, limits: BookingLimits): number | null {
  let start = Math.ceil(Math.max(from, now) / BOOKING_GRID_MS) * BOOKING_GRID_MS;
  const horizon = now + limits.maxAdvanceDays * BOOKING_DAY;
  for (let i = 0; i < 500 && start <= horizon; i++) {
    const win = { startAt: start, endAt: start + durationMs };
    const hit = holders.filter((h) => overlaps(win, h));
    if (hit.length === 0) return start;
    start = Math.max(...hit.map((h) => h.endAt));
  }
  return null;
}

export type PromotionCheck = 'ok' | 'skip' | 'expire';
export interface PromotionPlan<T> {
  promote: T[];
  expire: T[];
}

/**
 * Quem sai da fila quando algo liberou: em ordem de chegada, quem ainda cabe sobe; quem ja perdeu o inicio expira. `check` permite ao
 * chamador aplicar regras que dependem de outros dados (pessoa saiu da org, limites): 'skip' deixa na fila, 'expire' descarta.
 */
export function promotionPlan<T extends BookingCore>(roomBookings: readonly T[], now: number, check: (b: T) => PromotionCheck = () => 'ok'): PromotionPlan<T> {
  const holders: BookingWindow[] = roomBookings.filter((b) => isHolder(b.status)).map((b) => ({ startAt: b.startAt, endAt: b.endAt }));
  const plan: PromotionPlan<T> = { promote: [], expire: [] };
  for (const b of roomBookings.filter((x) => x.status === 'queued').sort(queueCompare)) {
    if (b.startAt <= now) {
      plan.expire.push(b);
      continue;
    }
    if (holders.some((h) => overlaps(h, b))) continue;
    const c = check(b);
    if (c === 'expire') plan.expire.push(b);
    else if (c === 'ok') {
      plan.promote.push(b);
      holders.push({ startAt: b.startAt, endAt: b.endAt });
    }
  }
  return plan;
}

// ---- relogio da reserva --------------------------------------------------------------------------------

/** `upcoming` (ainda nao comecou), `active` (dentro da janela) ou `over`. */
export function windowPhase(win: BookingWindow, now: number): 'upcoming' | 'active' | 'over' {
  if (now < win.startAt) return 'upcoming';
  return now < win.endAt ? 'active' : 'over';
}

/** O dono nao entrou e passou o prazo: a reserva confirmada e liberada. */
export function noShowDue(b: Pick<BookingCore, 'status' | 'startAt' | 'endAt'> & { checkedInAt: number | null }, now: number, limits: BookingLimits): boolean {
  return b.status === 'confirmed' && b.checkedInAt === null && limits.noShowMin > 0 && now >= b.startAt + limits.noShowMin * BOOKING_MINUTE && now < b.endAt;
}

/** Bits de avisos ja enviados (para nao repetir apos reinicio). */
export const NOTIFIED = { startSoon: 1, started: 2, endSoon: 4, evictWarned: 8 } as const;

// ---- placa da porta -----------------------------------------------------------------------------------

export type DoorState = 'free' | 'busy' | 'soon';
/** Estado de uma porta, sem detalhes (privacidade). `holders` = reservas CONFIRMADAS da sala. */
export function doorOf(holders: readonly BookingWindow[], now: number): { state: DoorState; until?: number; from?: number } {
  const cur = holders.find((h) => h.startAt <= now && now < h.endAt);
  if (cur) {
    // reservas coladas contam como uma so
    let until = cur.endAt;
    for (let moved = true; moved; ) {
      moved = false;
      for (const h of holders) if (h.startAt <= until && h.endAt > until) (until = h.endAt), (moved = true);
    }
    return { state: 'busy', until };
  }
  const next = holders.filter((h) => h.startAt > now).sort((a, b) => a.startAt - b.startAt)[0];
  if (next && next.startAt - now <= BOOKING_WARN_MS * 6) return { state: 'soon', from: next.startAt };
  return { state: 'free' };
}

/** Sala reservavel por padrao (a Sala Privada); as demais so quando a organizacao liga. */
export const DEFAULT_BOOKABLE_ROOM_IDS: readonly string[] = ['private'];
/** Salas que nunca podem ser reservadas: sao por onde todos passam. */
export const NEVER_BOOKABLE_ROOM_IDS: readonly string[] = ['office', 'reception'];
