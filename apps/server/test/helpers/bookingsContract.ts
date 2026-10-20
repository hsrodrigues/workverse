import { describe, expect, it } from 'vitest';
import { BOOKING_RETENTION_MS, DEFAULT_BOOKING_LIMITS } from '@workverse/shared';
import type { BookingRow } from '../../src/bookingStore';
import type { RoomsHandle } from './roomsContract';

const DAY = 86_400_000;
const T0 = 1_800_000_000_000;

/** What every persistent store must keep about room bookings: reservations, per-room settings and limits, per organization. */
export function bookingsStoreContract(label: string, make: () => Promise<RoomsHandle>) {
  describe(`contrato de reservas: ${label}`, () => {
    async function seed(h: RoomsHandle) {
      const { store } = h;
      const boss = store.create({ email: 'chefe@x.com', displayName: 'Chefe', passwordHash: 'scrypt$x' });
      const ana = store.create({ email: 'ana@x.com', displayName: 'Ana', passwordHash: 'scrypt$x' });
      const bia = store.create({ email: 'bia@x.com', displayName: 'Bia', passwordHash: 'scrypt$x' });
      for (const id of ['orgA', 'orgB']) store.orgs.putOrg({ id, slug: id.toLowerCase(), name: id, settings: {}, createdAt: 1 });
      return { boss, ana, bia };
    }
    const row = (over: Partial<BookingRow> & Pick<BookingRow, 'id' | 'ownerId'>): BookingRow => ({
      orgId: 'orgA',
      roomId: 'private',
      title: 'Reuniao com cliente',
      startAt: T0 + 2 * DAY,
      endAt: T0 + 2 * DAY + 3_600_000,
      status: 'confirmed',
      guestIds: [],
      createdAt: T0,
      updatedAt: T0,
      decidedBy: null,
      reason: null,
      checkedInAt: null,
      notified: 0,
      ...over,
    });

    it('keeps bookings (every field), room settings and limits after a restart, separated by organization', async () => {
      const h = await make();
      const { boss, ana, bia } = await seed(h);
      h.store.bookings.put(row({ id: 'b1', ownerId: ana.id, guestIds: [bia.id], decidedBy: boss.id, checkedInAt: T0 + 5, notified: 5, updatedAt: T0 + 9 }));
      h.store.bookings.put(row({ id: 'b2', ownerId: bia.id, status: 'queued', createdAt: T0 + 100, reason: 'fila' }));
      h.store.bookings.put(row({ id: 'b3', ownerId: ana.id, orgId: 'orgB', title: 'Outra org' }));
      h.store.bookings.putRoom({ orgId: 'orgA', roomId: 'meeting1', bookable: true, requiresApproval: true, updatedBy: boss.id, updatedAt: T0 });
      h.store.bookings.putRoom({ orgId: 'orgA', roomId: 'private', bookable: false, requiresApproval: false, updatedBy: boss.id, updatedAt: T0 });
      h.store.bookings.putLimits({ orgId: 'orgA', limits: { maxDurationMin: 90, maxActivePerPerson: 3, maxAdvanceDays: 10, maxDailyMin: 200, noShowMin: 0 }, updatedBy: boss.id, updatedAt: T0 });
      await h.settle();

      const again = await h.reopen();
      expect(again.bookings.getIn('orgA', 'b1')).toEqual(row({ id: 'b1', ownerId: ana.id, guestIds: [bia.id], decidedBy: boss.id, checkedInAt: T0 + 5, notified: 5, updatedAt: T0 + 9 }));
      expect(again.bookings.getIn('orgA', 'b2')).toMatchObject({ status: 'queued', createdAt: T0 + 100, reason: 'fila', checkedInAt: null, decidedBy: null });
      expect(again.bookings.getRoom('orgA', 'meeting1')).toMatchObject({ bookable: true, requiresApproval: true });
      expect(again.bookings.getRoom('orgA', 'private')).toMatchObject({ bookable: false });
      expect(again.bookings.getLimits('orgA')).toEqual({ maxDurationMin: 90, maxActivePerPerson: 3, maxAdvanceDays: 10, maxDailyMin: 200, noShowMin: 0 });
      // isolation: the other organization sees only its own rows, and the defaults for the rest
      expect(again.bookings.getIn('orgA', 'b3')).toBeUndefined();
      expect(again.bookings.getIn('orgB', 'b1')).toBeUndefined();
      expect(again.bookings.ofOrg('orgB').map((b) => b.id)).toEqual(['b3']);
      expect(again.bookings.ofRoom('orgA', 'private').map((b) => b.id).sort()).toEqual(['b1', 'b2']);
      expect(again.bookings.roomsOf('orgB')).toEqual([]);
      expect(again.bookings.getLimits('orgB')).toEqual(DEFAULT_BOOKING_LIMITS);
    });

    it('updates a booking in place (status changes stick) and indexes by room, owner and liveness', async () => {
      const h = await make();
      const { ana, bia } = await seed(h);
      h.store.bookings.put(row({ id: 'b1', ownerId: ana.id, status: 'pending' }));
      h.store.bookings.put(row({ id: 'b1', ownerId: ana.id, status: 'confirmed', updatedAt: T0 + 1 }));
      h.store.bookings.put(row({ id: 'b2', ownerId: ana.id, status: 'cancelled', roomId: 'meeting1' }));
      h.store.bookings.put(row({ id: 'b3', ownerId: bia.id, status: 'queued' }));
      await h.settle();
      const again = await h.reopen();
      expect(again.bookings.getIn('orgA', 'b1')).toMatchObject({ status: 'confirmed', updatedAt: T0 + 1 });
      expect(again.bookings.ofOwner('orgA', ana.id).map((b) => b.id).sort()).toEqual(['b1', 'b2']);
      expect(again.bookings.liveOfRoom('orgA', 'private').map((b) => b.id).sort()).toEqual(['b1', 'b3']);
      expect(again.bookings.liveOfRoom('orgA', 'meeting1')).toEqual([]);
      expect(again.bookings.liveRooms()).toEqual([{ orgId: 'orgA', roomId: 'private' }]);
    });

    it('purges finished bookings older than 90 days and keeps the rest, also after a restart', async () => {
      const h = await make();
      const { ana } = await seed(h);
      const now = T0 + 200 * DAY;
      const oldEnd = now - BOOKING_RETENTION_MS - DAY;
      h.store.bookings.put(row({ id: 'old1', ownerId: ana.id, status: 'ended', startAt: oldEnd - 3_600_000, endAt: oldEnd }));
      h.store.bookings.put(row({ id: 'old2', ownerId: ana.id, status: 'cancelled', startAt: oldEnd - 3_600_000, endAt: oldEnd }));
      h.store.bookings.put(row({ id: 'recent', ownerId: ana.id, status: 'ended', startAt: now - 5 * DAY, endAt: now - 5 * DAY + 3_600_000 }));
      h.store.bookings.put(row({ id: 'live', ownerId: ana.id, status: 'confirmed', startAt: now + DAY, endAt: now + DAY + 3_600_000 }));
      await h.settle();
      expect(h.store.bookings.purge(now)).toBe(2);
      expect(h.store.bookings.purge(now)).toBe(0);
      await h.settle();
      const again = await h.reopen();
      expect(again.bookings.ofOrg('orgA').map((b) => b.id).sort()).toEqual(['live', 'recent']);
    });
  });
}
