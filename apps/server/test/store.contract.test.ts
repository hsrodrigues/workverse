import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll } from 'vitest';
import { JsonFileAccountStore, MemoryAccountStore } from '../src/store';
import { accountStoreContract } from './helpers/storeContract';

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

accountStoreContract('MemoryAccountStore', async () => ({ store: new MemoryAccountStore(), settle: async () => undefined }));

accountStoreContract('JsonFileAccountStore', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wv-json-'));
  dirs.push(dir);
  const store = new JsonFileAccountStore(join(dir, 'accounts.json'));
  return { store, settle: async () => store.flush() };
});
