import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll } from 'vitest';
import { JsonFileAccountStore, MemoryAccountStore } from '../src/store';
import { accountStoreContract } from './helpers/storeContract';
import { roomsStoreContract } from './helpers/roomsContract';

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

roomsStoreContract('MemoryAccountStore (mesma instancia)', async () => {
  const store = new MemoryAccountStore();
  return { store, settle: async () => undefined, reopen: async () => store };
});

roomsStoreContract('JsonFileAccountStore', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wv-json-rooms-'));
  dirs.push(dir);
  const file = join(dir, 'accounts.json');
  const store = new JsonFileAccountStore(file);
  return { store, settle: async () => store.flush(), reopen: async () => new JsonFileAccountStore(file) };
});