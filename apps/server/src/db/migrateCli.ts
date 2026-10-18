import { migrate } from './migrate';
import { closePool, createPool, poolOptionsFromEnv } from './pool';

const opts = poolOptionsFromEnv();
if (!opts) {
  console.error('DATABASE_URL nao definido.');
  process.exit(1);
}
const pool = createPool({ ...opts, applicationName: 'workverse-migrate' });
try {
  const r = await migrate(pool, { log: (m) => console.log(`[migrate] ${m}`) });
  console.log(r.applied.length ? `[migrate] aplicadas: ${r.applied.join(', ')}` : '[migrate] nada a aplicar');
} catch (err) {
  console.error(`[migrate] ${(err as Error).message}`);
  process.exitCode = 1;
} finally {
  await closePool(pool);
}
