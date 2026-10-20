import { useSyncExternalStore } from 'react';
import { BOOKING_TZ, isValidTimeZone, type BookingClientMessage, type BookingDoor, type BookingLimits, type BookingNoticeKind, type BookingServerMessage, type BookingSlotResult, type DirEntry, type Permission, type ServerMessage, type StaffSelf } from '@workverse/shared';
import { net } from '../../net';
import { agendaWindow, browserTz, shiftAnchor, type AgendaView } from './bookingLogic';

/**
 * Estado do app "Reservas" no cliente. Nao tem autoridade nenhuma: so pede e mostra. O servidor valida cada mensagem de novo
 * (papel, organizacao, limites, conflito, taxa) e decide quem entra na sala durante uma reserva.
 */

export type BookingTab = 'agenda' | 'request' | 'mine' | 'queue' | 'pending' | 'settings';
export type BookingsMsg = Extract<BookingServerMessage, { t: 'bookings' }>;

export interface BookingToast {
  key: number;
  kind: BookingNoticeKind;
  text: string;
  roomId: string;
}

export interface BookingNotice {
  kind: 'ok' | 'error';
  text: string;
  results?: BookingSlotResult[];
}

export interface BookingState {
  open: boolean;
  tab: BookingTab;
  roomId: string | null;
  view: AgendaView;
  /** Dia (ms UTC) que a agenda mostra. */
  anchor: number;
  tz: string;
  data: BookingsMsg | null;
  busy: boolean;
  notice: BookingNotice | null;
  doors: Record<string, BookingDoor>;
  toasts: BookingToast[];
  perms: Permission[];
  staff: StaffSelf | null;
  /** Pessoas sugeridas pela busca de convidados. */
  people: DirEntry[];
  /** Diferenca entre o relogio do servidor e o do navegador (ms), para mostrar "agora" certo. */
  skew: number;
}

const TZ_KEY = 'wv.bookings.tz';
const TOAST_MS = 10_000;

function loadTz(): string {
  try {
    const saved = localStorage.getItem(TZ_KEY);
    if (saved && isValidTimeZone(saved)) return saved;
  } catch {
    /* sem armazenamento: usa o do navegador */
  }
  return browserTz();
}

const initial = (): BookingState => ({
  open: false,
  tab: 'agenda',
  roomId: null,
  view: 'week',
  anchor: Date.now(),
  tz: loadTz(),
  data: null,
  busy: false,
  notice: null,
  doors: {},
  toasts: [],
  perms: [],
  staff: null,
  people: [],
  skew: 0,
});

let state: BookingState = initial();
const listeners = new Set<() => void>();
let rid = 0;
let toastKey = 0;
/** Pedido em andamento por rid: so o ultimo resultado vira aviso na tela. */
const waiting = new Set<number>();

function set(next: Partial<BookingState>) {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}

export const canBookOf = (s: Pick<BookingState, 'perms'>) => s.perms.includes('room.book');
export const canManageOf = (s: Pick<BookingState, 'perms' | 'staff' | 'data'>) => s.data?.canManage === true || s.perms.includes('room.book.manage') || (s.staff?.level === 'admin' && s.staff.duty === true);

const nowMs = () => Date.now() + state.skew;

function send(msg: BookingClientMessage) {
  net.send(msg as never);
}

function sync() {
  const w = agendaWindow(state.anchor, state.view, state.tz);
  send({ t: 'booking_sync', ...(state.roomId ? { roomId: state.roomId } : {}), from: w.from, to: w.to });
}

net.on((msg: ServerMessage) => {
  switch (msg.t) {
    case 'session':
      set({ perms: msg.perms ?? [], staff: msg.staff ?? null });
      break;
    case 'perms':
      set({ perms: msg.perms });
      break;
    case 'staff_self':
      set({ staff: { level: msg.level, duty: msg.duty, invisible: msg.invisible } });
      break;
    case 'bookings':
      set({ data: msg, busy: false, roomId: state.roomId ?? msg.roomId, skew: msg.now - Date.now() });
      break;
    case 'booking_result': {
      if (!waiting.delete(msg.rid)) break;
      set({ busy: false, notice: { kind: msg.ok ? 'ok' : 'error', text: msg.message, ...(msg.results && msg.results.length > 1 ? { results: msg.results } : {}) } });
      break;
    }
    case 'booking_notice': {
      const toast: BookingToast = { key: ++toastKey, kind: msg.kind, text: msg.text, roomId: msg.roomId };
      set({ toasts: [...state.toasts, toast].slice(-4) });
      setTimeout(() => bookingStore.dismissToast(toast.key), TOAST_MS);
      break;
    }
    case 'booking_doors': {
      const doors: Record<string, BookingDoor> = {};
      for (const d of msg.doors) doors[d.roomId] = d;
      set({ doors });
      break;
    }
    case 'dir_result':
      if (state.open && state.tab === 'request') set({ people: msg.results.filter((r) => !r.you) });
      break;
    case 'error':
      if (state.busy && (msg.code === 'rate_limited' || msg.code === 'forbidden')) set({ busy: false, notice: { kind: 'error', text: msg.message } });
      break;
  }
});

export const bookingStore = {
  get: () => state,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  reset() {
    state = initial();
    listeners.forEach((l) => l());
  },
  now: nowMs,

  open(opts: { roomId?: string; tab?: BookingTab } = {}) {
    set({ open: true, tab: opts.tab ?? state.tab, ...(opts.roomId ? { roomId: opts.roomId } : {}), notice: null, busy: true, anchor: nowMs() });
    sync();
  },
  close() {
    set({ open: false });
  },
  toggle() {
    if (state.open) bookingStore.close();
    else bookingStore.open();
  },
  setTab(tab: BookingTab) {
    set({ tab, notice: null });
  },
  setRoom(roomId: string) {
    set({ roomId, busy: true });
    sync();
  },
  setView(view: AgendaView) {
    set({ view, busy: true });
    sync();
  },
  shift(dir: -1 | 1) {
    set({ anchor: shiftAnchor(state.anchor, state.view, dir, state.tz), busy: true });
    sync();
  },
  today() {
    set({ anchor: nowMs(), busy: true });
    sync();
  },
  goTo(ms: number) {
    set({ anchor: ms, busy: true });
    sync();
  },
  refresh() {
    if (state.open) sync();
  },
  /** Sem abrir o painel: so atualiza a lista de salas e configuracoes (aba Acesso do editor). */
  syncQuiet() {
    sync();
  },
  setTz(tz: string) {
    if (!isValidTimeZone(tz)) return;
    try {
      localStorage.setItem(TZ_KEY, tz);
    } catch {
      /* so vale nesta sessao */
    }
    set({ tz, busy: true });
    sync();
  },
  clearNotice() {
    set({ notice: null });
  },
  dismissToast(key: number) {
    set({ toasts: state.toasts.filter((t) => t.key !== key) });
  },

  request(roomId: string, slots: Array<{ startAt: number; endAt: number }>, title: string, guests: string[]) {
    const r = ++rid;
    waiting.add(r);
    set({ busy: true, notice: null });
    send({ t: 'booking_request', rid: r, roomId, slots, title, ...(guests.length ? { guests } : {}) });
  },
  act(t: 'booking_cancel' | 'booking_end' | 'booking_extend', id: string) {
    const r = ++rid;
    waiting.add(r);
    set({ busy: true, notice: null });
    send({ t, rid: r, id });
  },
  edit(id: string, patch: { title?: string; guests?: string[]; startAt?: number; endAt?: number }) {
    const r = ++rid;
    waiting.add(r);
    set({ busy: true, notice: null });
    send({ t: 'booking_edit', rid: r, id, ...patch });
  },
  decide(id: string, approve: boolean, reason?: string) {
    const r = ++rid;
    waiting.add(r);
    set({ busy: true, notice: null });
    send({ t: 'booking_decide', rid: r, id, approve, ...(reason ? { reason } : {}) });
  },
  setRoomConfig(roomId: string, bookable: boolean, requiresApproval: boolean) {
    const r = ++rid;
    waiting.add(r);
    set({ busy: true, notice: null });
    send({ t: 'booking_room_set', rid: r, roomId, bookable, requiresApproval });
  },
  setLimits(limits: BookingLimits) {
    const r = ++rid;
    waiting.add(r);
    set({ busy: true, notice: null });
    send({ t: 'booking_limits_set', rid: r, limits });
  },
  /** Busca de convidados no diretorio (o servidor so devolve membros da propria organizacao, sem e-mail). */
  searchPeople(q: string) {
    if (!q.trim()) return set({ people: [] });
    net.send({ t: 'dir_search', q: q.trim() });
  },
  clearPeople() {
    set({ people: [] });
  },
};

export function useBookings(): BookingState {
  return useSyncExternalStore(bookingStore.subscribe, bookingStore.get);
}

export { BOOKING_TZ };
