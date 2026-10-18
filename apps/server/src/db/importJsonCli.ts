import { resolve } from 'node:path';
import { importJson } from './importJson';
import { migrate } from './migrate';
import { closePool, createPool, poolOptionsFromEnv } from './pool';

// Uso: npm run db:import-json -w @workverse/server [-- caminho/accounts.json]
const opts = poolOptionsFromEnv();
if (!opts) {
  console.error('DATABASE_URL nao definido.');
  process.exit(1);
}
const file = resolve(process.argv[2] ?? resolve(process.env.DATA_DIR ?? './data', 'accounts.json'));
const pool = createPool({ ...opts, applicationName: 'workverse-import' });
try {
  await migrate(pool, { log: (m) => console.log(`[import] ${m}`) });
  const r = await importJson(pool, file);
  console.log(`[import] ${file}`);
  console.log(`[import] contas:  ${r.accounts.inserted} inseridas, ${r.accounts.skipped} ja existiam/conflitavam (de ${r.accounts.read})`);
  console.log(`[import] sessoes: ${r.sessions.inserted} inseridas, ${r.sessions.skipped} puladas (de ${r.sessions.read} validas)`);
} catch (err) {
  console.error(`[import] ${(err as Error).message}`);
  process.exitCode = 1;
} finally {
  await closePool(pool);
}
