import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll } from 'vitest';
import { JsonFileAccountStore, MemoryAccountStore } from '../src/store';
import { bookingsStoreContract } from './helpers/bookingsContract';

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

bookingsStoreContract('MemoryAccountStore (mesma instancia)', async () => {
  const store = new MemoryAccountStore();
  return { store, settle: async () => undefined, reopen: async () => store };
});

bookingsStoreContract('JsonFileAccountStore', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wv-json-bookings-'));
  dirs.push(dir);
  const file = join(dir, 'accounts.json');
  const store = new JsonFileAccountStore(file);
  return { store, settle: async () => store.flush(), reopen: async () => new JsonFileAccountStore(file) };
});
