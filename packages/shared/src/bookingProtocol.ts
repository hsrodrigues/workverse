import type { BookingLimits, BookingStatus, BookingWindow } from './bookings';

/** Mensagens WebSocket do app de reservas. Tempos sempre em ms UTC; o cliente formata no fuso do navegador. */

export interface BookingRoomInfo {
  roomId: string;
  name: string;
  bookable: boolean;
  requiresApproval: boolean;
  capacity: number;
}

/** Bloco da agenda de uma sala. Quem nao tem acesso a sala so recebe `busy`/`pending` sem titulo, dono nem convidados. */
export interface BookingBlock extends BookingWindow {
  id: string;
  state: 'busy' | 'pending';
  /** A reserva e minha (dono ou convidado). */
  mine: boolean;
  title?: string;
  ownerName?: string;
  guests?: string[];
}

/** Entrada da fila de uma sala. O titulo so aparece para o dono da entrada e para quem administra. */
export interface BookingQueueEntry extends BookingWindow {
  id: string;
  position: number;
  ownerName: string;
  mine: boolean;
  title?: string;
}

export interface BookingMine extends BookingWindow {
  id: string;
  roomId: string;
  roomName: string;
  status: BookingStatus;
  title: string;
  ownerName: string;
  /** Sou o dono ou fui convidado. */
  role: 'owner' | 'guest';
  guests: string[];
  position?: number;
  /** Quanto falta para a proxima janela livre sugerida (so para quem esta na fila). */
  suggestion?: number | null;
  reason?: string;
  /** A janela esta rolando agora. */
  active: boolean;
  checkedIn: boolean;
  canExtend: boolean;
  canCancel: boolean;
  canEnd: boolean;
  canEdit: boolean;
}

export interface BookingPendingEntry extends BookingWindow {
  id: string;
  roomId: string;
  roomName: string;
  ownerName: string;
  title: string;
  guests: string[];
  createdAt: number;
}

export interface BookingSlotResult extends BookingWindow {
  ok: boolean;
  status?: BookingStatus;
  id?: string;
  position?: number;
  /** Inicio da proxima janela livre com a mesma duracao. */
  suggestion?: number | null;
  code?: string;
  message: string;
}

export type BookingNoticeKind = 'confirmed' | 'pending' | 'queued' | 'promoted' | 'starts_soon' | 'started' | 'ends_soon' | 'ended' | 'released' | 'declined' | 'approved' | 'cancelled' | 'invited' | 'extended' | 'vacate';

export interface BookingDoor {
  roomId: string;
  state: 'free' | 'busy' | 'soon';
  /** Quando `busy`: fim da reserva em curso. Quando `soon`: inicio da proxima. */
  until?: number;
  from?: number;
  /** So para quem tem acesso a sala. */
  by?: string;
  /** A pessoa pode entrar agora. */
  open: boolean;
}

export type BookingClientMessage =
  /** Pede a agenda de uma sala em [from, to) e as listas da pessoa. Sem `roomId`: a primeira sala reservavel. */
  | { t: 'booking_sync'; roomId?: string; from: number; to: number }
  | { t: 'booking_request'; rid: number; roomId: string; slots: BookingWindow[]; title: string; guests?: string[] }
  | { t: 'booking_cancel'; rid: number; id: string }
  | { t: 'booking_end'; rid: number; id: string }
  | { t: 'booking_extend'; rid: number; id: string }
  | { t: 'booking_edit'; rid: number; id: string; title?: string; guests?: string[]; startAt?: number; endAt?: number }
  | { t: 'booking_decide'; rid: number; id: string; approve: boolean; reason?: string }
  /** Quem administra liga/desliga a reserva de uma sala e a aprovacao. */
  | { t: 'booking_room_set'; rid: number; roomId: string; bookable: boolean; requiresApproval: boolean }
  | { t: 'booking_limits_set'; rid: number; limits: BookingLimits };

export type BookingServerMessage =
  | {
      t: 'bookings';
      now: number;
      roomId: string | null;
      from: number;
      to: number;
      rooms: BookingRoomInfo[];
      limits: BookingLimits;
      blocks: BookingBlock[];
      queue: BookingQueueEntry[];
      mine: BookingMine[];
      /** Presente so para quem administra. */
      pending?: BookingPendingEntry[];
      canManage: boolean;
    }
  | { t: 'booking_result'; rid: number; ok: boolean; code?: string; message: string; results?: BookingSlotResult[] }
  | { t: 'booking_notice'; kind: BookingNoticeKind; bookingId: string; roomId: string; roomName: string; text: string; at: number }
  | { t: 'booking_doors'; doors: BookingDoor[] };

export const BOOKING_CLIENT_TYPES: readonly string[] = ['booking_sync', 'booking_request', 'booking_cancel', 'booking_end', 'booking_extend', 'booking_edit', 'booking_decide', 'booking_room_set', 'booking_limits_set'];
export const isBookingClientMessage = (t: string): boolean => BOOKING_CLIENT_TYPES.includes(t);
