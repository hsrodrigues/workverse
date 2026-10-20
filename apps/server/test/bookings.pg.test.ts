import { afterAll, describe, expect, it } from 'vitest';
import { PgAccountStore } from '../src/db/pgAccountStore';
import { MemoryAccountStore } from '../src/store';
import { startPg } from './helpers/pgHarness';
import { bookingsStoreContract } from './helpers/bookingsContract';

const quiet = () => undefined;

// PostgreSQL real e descartavel; se nao for possivel subir, a suite e pulada (WV_SKIP_PG=1).
const h = await startPg();
afterAll(async () => {
  await h?.stop();
}, 60_000);

let n = 0;
bookingsStoreContract('PgAccountStore (PostgreSQL real, migracao 0008)', async () => {
  if (!h) {
    const store = new MemoryAccountStore();
    return { store, settle: async () => undefined, reopen: async () => store };
  }
  const { pool } = await h.migratedPool(`bookings_${++n}`);
  const open = () => PgAccountStore.open(pool, { retryBaseMs: 10, log: quiet });
  let current = await open();
  return {
    store: current,
    settle: () => current.flush(),
    reopen: async () => {
      await current.flush();
      current = await open();
      return current;
    },
  };
});

describe.skipIf(!h)('PostgreSQL real: reservas de sala', () => {
  it('a migracao 0008 cria as tabelas e os indices por sala/janela', async () => {
    const { pool } = await h!.migratedPool('bookings_tables');
    const tables = (await pool.query("SELECT tablename FROM pg_tables WHERE schemaname='public'")).rows.map((r) => r.tablename);
    for (const t of ['room_bookings', 'booking_room_settings', 'booking_limits']) expect(tables).toContain(t);
    const idx = (await pool.query("SELECT indexname FROM pg_indexes WHERE tablename='room_bookings'")).rows.map((r) => r.indexname);
    expect(idx).toEqual(expect.arrayContaining(['room_bookings_window_idx', 'room_bookings_owner_idx', 'room_bookings_live_idx', 'room_bookings_end_idx']));
  });

  it('o banco recusa status invalido, fim antes do inicio e limites fora da faixa', async () => {
    const { pool } = await h!.migratedPool('bookings_checks');
    const store = await PgAccountStore.open(pool, { retryBaseMs: 10, log: quiet });
    const a = store.create({ email: 'a@x.com', displayName: 'Ana', passwordHash: 'scrypt$x' });
    a.orgsInit = true;
    store.save(a);
    store.orgs.putOrg({ id: 'o1', slug: 'o1', name: 'O1', settings: {}, createdAt: 1 });
    await store.flush();
    const ins = (status: string, start: number, end: number) =>
      pool.query("INSERT INTO room_bookings (id, org_id, room_id, owner_id, title, start_at, end_at, status) VALUES ($1, 'o1', 'private', $2, 't', $3, $4, $5)", [`x${Math.random()}`, a.id, new Date(start), new Date(end), status]);
    await ins('confirmed', 1000, 5000);
    await expect(ins('maybe', 1000, 5000)).rejects.toThrow();
    await expect(ins('confirmed', 5000, 1000)).rejects.toThrow();
    await expect(pool.query("INSERT INTO booking_limits (org_id, max_duration_min, max_active_per_person, max_advance_days, max_daily_min, no_show_min) VALUES ('o1', 5, 2, 30, 480, 15)")).rejects.toThrow();
  });

  it('apagar a organizacao apaga as reservas dela (ON DELETE CASCADE) e nao as de outra', async () => {
    const { pool } = await h!.migratedPool('bookings_cascade');
    const store = await PgAccountStore.open(pool, { retryBaseMs: 10, log: quiet });
    const a = store.create({ email: 'a@x.com', displayName: 'Ana', passwordHash: 'scrypt$x' });
    a.orgsInit = true;
    store.save(a);
    for (const id of ['o1', 'o2']) store.orgs.putOrg({ id, slug: id, name: id, settings: {}, createdAt: 1 });
    for (const id of ['o1', 'o2']) {
      store.bookings.put({ id: `b-${id}`, orgId: id, roomId: 'private', ownerId: a.id, title: 't', startAt: 1000, endAt: 5000, status: 'confirmed', guestIds: [], createdAt: 1, updatedAt: 1, decidedBy: null, reason: null, checkedInAt: null, notified: 0 });
    }
    await store.flush();
    await pool.query("DELETE FROM orgs WHERE id = 'o1'");
    const rest = (await pool.query('SELECT id FROM room_bookings')).rows.map((r) => r.id);
    expect(rest).toEqual(['b-o2']);
  });
});
