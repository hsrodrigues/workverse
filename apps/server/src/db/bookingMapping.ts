import { sanitizeLimits, type BookingStatus } from '@workverse/shared';
import type { BookingData, BookingOp } from '../bookingStore';

/** Mapeamento BookingStore <-> tabelas room_bookings / booking_room_settings / booking_limits (migracao 0008). */

export interface BookingRows {
  bookings: Array<{
    id: string;
    org_id: string;
    room_id: string;
    owner_id: string;
    title: string;
    start_at: Date;
    end_at: Date;
    status: string;
    guest_ids: unknown;
    created_at: Date;
    updated_at: Date;
    decided_by: string | null;
    reason: string | null;
    checked_in_at: Date | null;
    notified: number;
  }>;
  rooms: Array<{ org_id: string; room_id: string; bookable: boolean; requires_approval: boolean; updated_by: string | null; updated_at: Date }>;
  limits: Array<{ org_id: string; max_duration_min: number; max_active_per_person: number; max_advance_days: number; max_daily_min: number; no_show_min: number; updated_by: string | null; updated_at: Date }>;
}

export function bookingDataFromRows(r: BookingRows): BookingData {
  return {
    bookings: r.bookings.map((b) => ({
      id: b.id,
      orgId: b.org_id,
      roomId: b.room_id,
      ownerId: b.owner_id,
      title: b.title,
      startAt: b.start_at.getTime(),
      endAt: b.end_at.getTime(),
      status: b.status as BookingStatus,
      guestIds: Array.isArray(b.guest_ids) ? (b.guest_ids as unknown[]).filter((x): x is string => typeof x === 'string') : [],
      createdAt: b.created_at.getTime(),
      updatedAt: b.updated_at.getTime(),
      decidedBy: b.decided_by,
      reason: b.reason,
      checkedInAt: b.checked_in_at ? b.checked_in_at.getTime() : null,
      notified: b.notified,
    })),
    bookingRooms: r.rooms.map((x) => ({ orgId: x.org_id, roomId: x.room_id, bookable: x.bookable, requiresApproval: x.requires_approval, updatedBy: x.updated_by ?? '', updatedAt: x.updated_at.getTime() })),
    bookingLimits: r.limits.map((x) => ({
      orgId: x.org_id,
      limits: sanitizeLimits({ maxDurationMin: x.max_duration_min, maxActivePerPerson: x.max_active_per_person, maxAdvanceDays: x.max_advance_days, maxDailyMin: x.max_daily_min, noShowMin: x.no_show_min }),
      updatedBy: x.updated_by ?? '',
      updatedAt: x.updated_at.getTime(),
    })),
  };
}

export const UPSERT_BOOKING_SQL = `INSERT INTO room_bookings (id, org_id, room_id, owner_id, title, start_at, end_at, status, guest_ids, created_at, updated_at, decided_by, reason, checked_in_at, notified)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12, $13, $14, $15)
  ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, start_at = EXCLUDED.start_at, end_at = EXCLUDED.end_at, status = EXCLUDED.status,
    guest_ids = EXCLUDED.guest_ids, updated_at = EXCLUDED.updated_at, decided_by = EXCLUDED.decided_by, reason = EXCLUDED.reason,
    checked_in_at = EXCLUDED.checked_in_at, notified = EXCLUDED.notified`;

export const UPSERT_BOOKING_ROOM_SQL = `INSERT INTO booking_room_settings (org_id, room_id, bookable, requires_approval, updated_by, updated_at) VALUES ($1, $2, $3, $4, $5, $6)
  ON CONFLICT (org_id, room_id) DO UPDATE SET bookable = EXCLUDED.bookable, requires_approval = EXCLUDED.requires_approval, updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at`;

export const UPSERT_BOOKING_LIMITS_SQL = `INSERT INTO booking_limits (org_id, max_duration_min, max_active_per_person, max_advance_days, max_daily_min, no_show_min, updated_by, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
  ON CONFLICT (org_id) DO UPDATE SET max_duration_min = EXCLUDED.max_duration_min, max_active_per_person = EXCLUDED.max_active_per_person, max_advance_days = EXCLUDED.max_advance_days,
    max_daily_min = EXCLUDED.max_daily_min, no_show_min = EXCLUDED.no_show_min, updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at`;

export const PURGE_BOOKINGS_SQL = `DELETE FROM room_bookings WHERE end_at < $1 AND status NOT IN ('pending', 'confirmed', 'queued')`;

/** SQL + parametros + chave de fusao para uma mudanca do BookingStore. */
export function bookingOpToSql(op: BookingOp): { sql: string; params: unknown[]; key?: string } {
  switch (op.kind) {
    case 'booking': {
      const b = op.row;
      return {
        sql: UPSERT_BOOKING_SQL,
        params: [b.id, b.orgId, b.roomId, b.ownerId, b.title, new Date(b.startAt), new Date(b.endAt), b.status, JSON.stringify(b.guestIds), new Date(b.createdAt), new Date(b.updatedAt), b.decidedBy, b.reason, b.checkedInAt === null ? null : new Date(b.checkedInAt), b.notified],
        key: `booking:${b.id}`,
      };
    }
    case 'booking_room': {
      const r = op.row;
      return { sql: UPSERT_BOOKING_ROOM_SQL, params: [r.orgId, r.roomId, r.bookable, r.requiresApproval, r.updatedBy || null, new Date(r.updatedAt)], key: `booking_room:${r.orgId}:${r.roomId}` };
    }
    case 'booking_limits': {
      const r = op.row;
      const l = r.limits;
      return { sql: UPSERT_BOOKING_LIMITS_SQL, params: [r.orgId, l.maxDurationMin, l.maxActivePerPerson, l.maxAdvanceDays, l.maxDailyMin, l.noShowMin, r.updatedBy || null, new Date(r.updatedAt)], key: `booking_limits:${r.orgId}` };
    }
    case 'booking_purge':
      return { sql: PURGE_BOOKINGS_SQL, params: [new Date(op.before)] };
  }
}
