import { BOOKING_RETENTION_MS, DEFAULT_BOOKING_LIMITS, isBookingStatus, isHolder, isLive, sanitizeLimits, type BookingLimits, type BookingStatus } from '@workverse/shared';

/**
 * Reservas de sala, limites e configuracao por sala. Dados puros em memoria, espelhados pelos stores persistentes (JSON/PostgreSQL)
 * por `onOp`, igual ao OrgStore. Tudo e indexado por organizacao: outra org nunca le estas linhas. As regras ficam em
 * packages/shared/src/bookings.ts e apps/server/src/bookings.ts.
 */

export interface BookingRow {
  id: string;
  orgId: string;
  roomId: string;
  ownerId: string;
  title: string;
  /** ms UTC */
  startAt: number;
  endAt: number;
  status: BookingStatus;
  /** Contas convidadas (alem do dono). */
  guestIds: string[];
  /** Define a ordem da fila. */
  createdAt: number;
  updatedAt: number;
  decidedBy: string | null;
  /** Motivo da recusa / cancelamento pela administracao. */
  reason: string | null;
  /** Quando o dono entrou na sala durante a janela (anti no-show). */
  checkedInAt: number | null;
  /** Bits de avisos ja enviados (NOTIFIED em bookings.ts). */
  notified: number;
}

export interface BookingRoomSetting {
  orgId: string;
  roomId: string;
  bookable: boolean;
  requiresApproval: boolean;
  updatedBy: string;
  updatedAt: number;
}

export interface BookingLimitsRow {
  orgId: string;
  limits: BookingLimits;
  updatedBy: string;
  updatedAt: number;
}

export interface BookingData {
  bookings?: BookingRow[];
  bookingRooms?: BookingRoomSetting[];
  bookingLimits?: BookingLimitsRow[];
}

export type BookingOp =
  | { kind: 'booking'; row: BookingRow }
  | { kind: 'booking_room'; row: BookingRoomSetting }
  | { kind: 'booking_limits'; row: BookingLimitsRow }
  | { kind: 'booking_purge'; before: number };

const roomKey = (orgId: string, roomId: string) => `${orgId} ${roomId}`;

/** Lê uma linha vinda de arquivo (tolerante: descarta o que nao faz sentido). */
export function bookingFromJson(raw: unknown): BookingRow | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Partial<BookingRow>;
  if (typeof r.id !== 'string' || typeof r.orgId !== 'string' || typeof r.roomId !== 'string' || typeof r.ownerId !== 'string') return null;
  if (!Number.isFinite(r.startAt) || !Number.isFinite(r.endAt) || !isBookingStatus(r.status)) return null;
  return {
    id: r.id,
    orgId: r.orgId,
    roomId: r.roomId,
    ownerId: r.ownerId,
    title: typeof r.title === 'string' ? r.title : '',
    startAt: r.startAt as number,
    endAt: r.endAt as number,
    status: r.status,
    guestIds: Array.isArray(r.guestIds) ? r.guestIds.filter((x): x is string => typeof x === 'string') : [],
    createdAt: Number.isFinite(r.createdAt) ? (r.createdAt as number) : 0,
    updatedAt: Number.isFinite(r.updatedAt) ? (r.updatedAt as number) : 0,
    decidedBy: typeof r.decidedBy === 'string' ? r.decidedBy : null,
    reason: typeof r.reason === 'string' ? r.reason : null,
    checkedInAt: Number.isFinite(r.checkedInAt) ? (r.checkedInAt as number) : null,
    notified: Number.isInteger(r.notified) ? (r.notified as number) : 0,
  };
}

export class BookingStore {
  private readonly rows = new Map<string, BookingRow>();
  private readonly byRoom = new Map<string, Map<string, BookingRow>>();
  private readonly rooms = new Map<string, BookingRoomSetting>();
  private readonly limits = new Map<string, BookingLimitsRow>();
  /** Definido pelo store persistente; nao e chamado ao carregar. */
  onOp: ((op: BookingOp) => void) | null = null;

  private index(row: BookingRow) {
    const old = this.rows.get(row.id);
    if (old && (old.orgId !== row.orgId || old.roomId !== row.roomId)) this.byRoom.get(roomKey(old.orgId, old.roomId))?.delete(old.id);
    this.rows.set(row.id, row);
    const k = roomKey(row.orgId, row.roomId);
    let m = this.byRoom.get(k);
    if (!m) this.byRoom.set(k, (m = new Map()));
    m.set(row.id, row);
  }

  // ---- reservas
  get(id: string): BookingRow | undefined {
    return this.rows.get(id);
  }
  /** Reserva `id` somente se for da organizacao (outra org: como se nao existisse). */
  getIn(orgId: string, id: string): BookingRow | undefined {
    const r = this.rows.get(id);
    return r && r.orgId === orgId ? r : undefined;
  }
  /** Todas as reservas de uma sala (qualquer status). */
  ofRoom(orgId: string, roomId: string): BookingRow[] {
    return [...(this.byRoom.get(roomKey(orgId, roomId))?.values() ?? [])];
  }
  /** Reservas ainda vivas (aguardando, confirmadas, na fila) de uma sala. */
  liveOfRoom(orgId: string, roomId: string): BookingRow[] {
    return this.ofRoom(orgId, roomId).filter((r) => isLive(r.status));
  }
  /** Reservas de uma pessoa (dona) na organizacao, em qualquer sala. */
  ofOwner(orgId: string, ownerId: string): BookingRow[] {
    const out: BookingRow[] = [];
    for (const r of this.rows.values()) if (r.orgId === orgId && r.ownerId === ownerId) out.push(r);
    return out;
  }
  ofOrg(orgId: string): BookingRow[] {
    return [...this.rows.values()].filter((r) => r.orgId === orgId);
  }
  /** Salas de uma organizacao com alguma reserva viva (para o relogio varrer so o necessario). */
  liveRooms(): Array<{ orgId: string; roomId: string }> {
    const out: Array<{ orgId: string; roomId: string }> = [];
    for (const m of this.byRoom.values()) {
      for (const r of m.values()) {
        if (isLive(r.status)) {
          out.push({ orgId: r.orgId, roomId: r.roomId });
          break;
        }
      }
    }
    return out;
  }
  put(row: BookingRow): void {
    this.index(row);
    this.onOp?.({ kind: 'booking', row });
  }
  /** Apaga as reservas terminadas ha mais que a retencao. Devolve quantas. */
  purge(now: number, retentionMs = BOOKING_RETENTION_MS): number {
    const before = now - retentionMs;
    let n = 0;
    for (const r of [...this.rows.values()]) {
      if (isHolder(r.status) || r.status === 'queued' || r.endAt >= before) continue;
      this.rows.delete(r.id);
      this.byRoom.get(roomKey(r.orgId, r.roomId))?.delete(r.id);
      n++;
    }
    if (n > 0) this.onOp?.({ kind: 'booking_purge', before });
    return n;
  }

  // ---- configuracao
  getRoom(orgId: string, roomId: string): BookingRoomSetting | undefined {
    return this.rooms.get(roomKey(orgId, roomId));
  }
  roomsOf(orgId: string): BookingRoomSetting[] {
    return [...this.rooms.values()].filter((r) => r.orgId === orgId);
  }
  putRoom(row: BookingRoomSetting): void {
    this.rooms.set(roomKey(row.orgId, row.roomId), row);
    this.onOp?.({ kind: 'booking_room', row });
  }
  getLimits(orgId: string): BookingLimits {
    return this.limits.get(orgId)?.limits ?? { ...DEFAULT_BOOKING_LIMITS };
  }
  getLimitsRow(orgId: string): BookingLimitsRow | undefined {
    return this.limits.get(orgId);
  }
  putLimits(row: BookingLimitsRow): void {
    this.limits.set(row.orgId, row);
    this.onOp?.({ kind: 'booking_limits', row });
  }

  // ---- persistencia
  snapshot(): Required<BookingData> {
    return { bookings: [...this.rows.values()], bookingRooms: [...this.rooms.values()], bookingLimits: [...this.limits.values()] };
  }
  /** Carrega linhas sem avisar `onOp`. */
  load(data: BookingData): void {
    for (const raw of data.bookings ?? []) {
      const r = bookingFromJson(raw);
      if (r) this.index(r);
    }
    for (const r of data.bookingRooms ?? []) if (r && typeof r.orgId === 'string' && typeof r.roomId === 'string') this.rooms.set(roomKey(r.orgId, r.roomId), { ...r, bookable: r.bookable === true, requiresApproval: r.requiresApproval === true });
    for (const r of data.bookingLimits ?? []) if (r && typeof r.orgId === 'string') this.limits.set(r.orgId, { ...r, limits: sanitizeLimits(r.limits) });
  }
}
