// Restaura um backup gerado por backup.mjs.
//  - Dump do Postgres (*.dump): pg_restore em uma base VAZIA (recusa se ja houver tabelas em public).
//    Uso: DATABASE_URL=... npm run db:restore -- backups/daily/workverse-pg-....dump
//  - Backup JSON (pasta): copia para DATA_DIR (recusa sobrescrever accounts.json existente, a menos que --force).
// A base de destino deve existir e estar vazia (ex.: CREATE DATABASE workverse_restore).
import { cpSync, existsSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import pg from 'pg';
import { connectionFor, requirePgTool, root } from './lib/pgtools.mjs';

const args = process.argv.slice(2);
const force = args.includes('--force');
const file = args.find((a) => !a.startsWith('--'));
if (!file) {
  console.error('uso: node scripts/restore.mjs <arquivo.dump | pasta-de-backup-json> [--force]');
  process.exit(2);
}
const source = resolve(file);
if (!existsSync(source)) {
  console.error(`[restore] ${source} nao existe`);
  process.exit(2);
}

if (statSync(source).isDirectory()) {
  const dataDir = resolve(process.env.DATA_DIR ?? resolve(root, 'apps/server/data'));
  if (existsSync(resolve(dataDir, 'accounts.json')) && !force) {
    console.error(`[restore] ${dataDir}/accounts.json ja existe; mova-o ou use --force`);
    process.exit(1);
  }
  cpSync(source, dataDir, { recursive: true });
  console.log(`[restore] ${source} -> ${dataDir}`);
  process.exit(0);
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('[restore] defina DATABASE_URL apontando para a base de destino (vazia).');
  process.exit(2);
}
const pgRestore = requirePgTool('pg_restore');

const client = new pg.Client({ connectionString: databaseUrl.replace(/[?&]sslmode=[^&]*/, ''), ssl: sslFor(databaseUrl) });
await client.connect();
const { rows } = await client.query(
  "SELECT count(*)::int AS n FROM pg_tables WHERE schemaname NOT IN ('pg_catalog', 'information_schema')",
);
await client.end();
if (rows[0].n > 0) {
  console.error(`[restore] a base de destino tem ${rows[0].n} tabela(s); restaure apenas em base vazia.`);
  process.exit(1);
}

const { args: connArgs, env } = connectionFor(databaseUrl);
const r = spawnSync(pgRestore, ['--no-owner', '--no-privileges', '--exit-on-error', ...connArgs, source], {
  env: { ...process.env, ...env },
  stdio: ['ignore', 'inherit', 'inherit'],
});
if (r.status !== 0) {
  console.error(`[restore] pg_restore falhou (codigo ${r.status})`);
  process.exit(1);
}
console.log('[restore] concluido. Suba o servidor normalmente (as migracoes ja constam em schema_migrations).');

function sslFor(url) {
  const mode = new URL(url).searchParams.get('sslmode') ?? process.env.PGSSLMODE;
  if (!mode || ['disable', 'allow', 'prefer'].includes(mode)) return false;
  return { rejectUnauthorized: mode === 'verify-full' || mode === 'verify-ca' };
}
