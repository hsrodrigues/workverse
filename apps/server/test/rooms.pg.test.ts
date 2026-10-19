import { afterAll, describe, expect, it } from 'vitest';
import { PgAccountStore } from '../src/db/pgAccountStore';
import { MemoryAccountStore } from '../src/store';
import { World } from '../src/world';
import { startPg } from './helpers/pgHarness';
import { roomsStoreContract } from './helpers/roomsContract';

const quiet = () => undefined;

// PostgreSQL real e descartavel; se nao for possivel subir, a suite e pulada (WV_SKIP_PG=1).
const h = await startPg();
afterAll(async () => {
  await h?.stop();
}, 60_000);

let n = 0;
roomsStoreContract('PgAccountStore (PostgreSQL real, migracao 0005)', async () => {
  if (!h) {
    // sem Postgres o contrato roda contra a memoria so para a suite nao quebrar; a prova real e o PG (ver skipIf abaixo)
    const store = new MemoryAccountStore();
    return { store, settle: async () => undefined, reopen: async () => store };
  }
  const { pool } = await h.migratedPool(`rooms_${++n}`);
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

describe.skipIf(!h)('PostgreSQL real: salas', () => {
  it('a migracao 0005 cria as tabelas room_furniture, room_settings e room_invites', async () => {
    const { pool } = await h!.migratedPool('rooms_tables');
    const tables = (await pool.query("SELECT tablename FROM pg_tables WHERE schemaname='public'")).rows.map((r) => r.tablename);
    for (const t of ['room_furniture', 'room_settings', 'room_invites']) expect(tables).toContain(t);
  });

  it('o mundo recarregado do banco traz o layout e o acesso da org certa, sem tocar na outra', async () => {
    const { pool } = await h!.migratedPool('rooms_world');
    const store = await PgAccountStore.open(pool, { retryBaseMs: 10, log: quiet });
    const boss = store.create({ email: 'c@x.com', displayName: 'Chefe', passwordHash: 'scrypt$x' });
    boss.orgsInit = true;
    store.save(boss);
    for (const id of ['orgA', 'orgB']) store.orgs.putOrg({ id, slug: id.toLowerCase(), name: id, settings: {}, createdAt: 1 });
    const base = new World({ store: new MemoryAccountStore(), clock: () => 0 }).org('orgB').baseDefs.get('lounge')!;
    store.orgs.putRoomLayout({ orgId: 'orgA', roomId: 'lounge', version: 2, furniture: [{ id: 'u1', kind: 'rug', x: 4, y: 7, dir: 0 }, ...base.furniture.filter((f) => f.kind !== 'rug')], updatedBy: boss.id, updatedAt: 1 });
    store.orgs.putRoomSetting({ orgId: 'orgA', roomId: 'meeting1', access: 'invited', teamId: null, updatedBy: boss.id, updatedAt: 1 });
    await store.flush();
    const reopened = await PgAccountStore.open(pool, { retryBaseMs: 10, log: quiet });
    const world = new World({ store: reopened, clock: () => 0 });
    expect(world.org('orgA').rooms.get('lounge')!.version).toBe(2);
    expect(world.org('orgA').rooms.get('meeting1')!.built.def.access).toBe('invited');
    expect(world.org('orgB').rooms.get('lounge')!.version).toBe(0);
    expect(world.org('orgB').rooms.get('meeting1')!.built.def.access).toBe('org');
  });
});
