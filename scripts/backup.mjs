// Backup das contas/sessoes.
//  - DATABASE_URL definido: pg_dump -Fc (formato custom, comprimido) para BACKUP_DIR/daily; uma copia
//    vai tambem para BACKUP_DIR/weekly quando a ultima semanal tem 7 dias ou mais.
//  - Sem DATABASE_URL (modo JSON): copia DATA_DIR (padrao apps/server/data, onde o dev grava) para BACKUP_DIR/daily/workverse-json-<data>.
// Retencao: 7 diarios e 4 semanais (BACKUP_KEEP_DAILY / BACKUP_KEEP_WEEKLY). Agende 1x por dia (cron / Agendador de Tarefas).
// Uso: npm run db:backup
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve, basename } from 'node:path';
import { connectionFor, requirePgTool, root, stamp } from './lib/pgtools.mjs';

const backupDir = resolve(process.env.BACKUP_DIR ?? './backups');
const keepDaily = Number(process.env.BACKUP_KEEP_DAILY ?? 7);
const keepWeekly = Number(process.env.BACKUP_KEEP_WEEKLY ?? 4);
const WEEK_MS = 7 * 24 * 3600 * 1000;
const daily = resolve(backupDir, 'daily');
const weekly = resolve(backupDir, 'weekly');
mkdirSync(daily, { recursive: true });
mkdirSync(weekly, { recursive: true });

const databaseUrl = process.env.DATABASE_URL;
const name = `workverse-${databaseUrl ? 'pg' : 'json'}-${stamp()}${databaseUrl ? '.dump' : ''}`;
const target = resolve(daily, name);

if (databaseUrl) {
  const pgDump = requirePgTool('pg_dump');
  const { args, env } = connectionFor(databaseUrl);
  const r = spawnSync(pgDump, ['-Fc', '--no-owner', '--no-privileges', '-f', target, ...args], {
    env: { ...process.env, ...env },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  if (r.status !== 0) {
    rmSync(target, { force: true });
    console.error(`[backup] pg_dump falhou (codigo ${r.status})`);
    process.exit(1);
  }
} else {
  const dataDir = resolve(process.env.DATA_DIR ?? resolve(root, 'apps/server/data'));
  if (!existsSync(dataDir)) {
    console.error(`[backup] ${dataDir} nao existe`);
    process.exit(1);
  }
  cpSync(dataDir, target, { recursive: true });
}
console.log(`[backup] criado ${target}`);

const entries = (dir) =>
  readdirSync(dir)
    .filter((f) => f.startsWith('workverse-'))
    .map((f) => ({ path: resolve(dir, f), mtime: statSync(resolve(dir, f)).mtimeMs }))
    .sort((a, b) => (a.path < b.path ? 1 : -1)); // o nome contem o carimbo de data: mais novo primeiro

const newestWeekly = entries(weekly)[0];
if (!newestWeekly || Date.now() - newestWeekly.mtime >= WEEK_MS) {
  const copy = resolve(weekly, basename(target));
  cpSync(target, copy, { recursive: true });
  console.log(`[backup] copia semanal ${copy}`);
}

for (const [dir, keep] of [[daily, keepDaily], [weekly, keepWeekly]]) {
  for (const old of entries(dir).slice(keep)) {
    rmSync(old.path, { recursive: true, force: true });
    console.log(`[backup] retencao: removido ${old.path}`);
  }
}
