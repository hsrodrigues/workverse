import { afterAll } from 'vitest';
import { PgAccountStore } from '../src/db/pgAccountStore';
import { MemoryAccountStore } from '../src/store';
import { startPg } from './helpers/pgHarness';
import { profileStoreContract } from './helpers/profileContract';

// PostgreSQL real e descartavel; sem ele (WV_SKIP_PG=1) o contrato roda contra a memoria so para a suite nao quebrar.
const h = await startPg();
afterAll(async () => {
  await h?.stop();
}, 60_000);

let n = 0;
profileStoreContract('PgAccountStore (PostgreSQL real, migracao 0009)', async () => {
  if (!h) {
    const store = new MemoryAccountStore();
    return { store, settle: async () => undefined, reopen: async () => store };
  }
  const { pool } = await h.migratedPool(`profile_${++n}`);
  const open = () => PgAccountStore.open(pool, { retryBaseMs: 10, log: () => undefined });
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
