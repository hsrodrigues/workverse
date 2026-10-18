// Sobe um PostgreSQL de desenvolvimento portatil (embedded-postgres: binarios reais, sem Docker/instalacao).
// Dados em tools/pg-data (ignorado pelo git). Porta propria (padrao 54329, mude com PG_DEV_PORT).
// Uso: npm run pg:dev   -> imprime a DATABASE_URL; Ctrl+C encerra com parada limpa.
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import EmbeddedPostgres from 'embedded-postgres';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = resolve(root, process.env.PG_DEV_DATA ?? 'tools/pg-data');
const port = Number(process.env.PG_DEV_PORT ?? 54329);
const user = 'workverse';
const password = 'workverse';
const database = 'workverse';

const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  port,
  user,
  password,
  persistent: true,
  onLog: () => undefined,
  onError: (e) => console.error('[pg-dev]', e instanceof Error ? e.message : String(e).trim()),
});

const fresh = !existsSync(resolve(dataDir, 'PG_VERSION'));
if (fresh) {
  console.log(`[pg-dev] inicializando cluster em ${dataDir} (so na primeira vez)...`);
  await pg.initialise();
}
await pg.start();
if (fresh) await pg.createDatabase(database);
else {
  // idempotente: cria o banco se alguem o removeu
  try {
    await pg.createDatabase(database);
  } catch {
    /* ja existe */
  }
}

const url = `postgres://${user}:${password}@127.0.0.1:${port}/${database}`;
console.log(`[pg-dev] PostgreSQL pronto na porta ${port}`);
console.log(`[pg-dev] DATABASE_URL=${url}`);
console.log('[pg-dev] Ctrl+C para parar.');

let stopping = false;
const stop = async () => {
  if (stopping) return;
  stopping = true;
  console.log('\n[pg-dev] parando...');
  try {
    await pg.stop();
  } finally {
    process.exit(0);
  }
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
setInterval(() => undefined, 1 << 30); // mantem o processo vivo
