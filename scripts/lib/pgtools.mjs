// Utilitarios compartilhados por backup.mjs / restore.mjs: achar pg_dump/pg_restore e montar a conexao.
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const exe = process.platform === 'win32' ? '.exe' : '';

/** Ordem: PG_BIN (pasta), tools/pg/bin (npm run pg:tools), PATH. Retorna undefined se nao achar. */
export function findPgTool(name, env = process.env) {
  const candidates = [];
  if (env.PG_BIN) candidates.push(resolve(env.PG_BIN, name + exe));
  candidates.push(resolve(root, 'tools/pg/bin', name + exe));
  for (const c of candidates) if (existsSync(c)) return c;
  const probe = spawnSync(name, ['--version'], { encoding: 'utf8' });
  return probe.status === 0 ? name : undefined;
}

export function requirePgTool(name, env = process.env) {
  const p = findPgTool(name, env);
  if (!p) {
    console.error(`[pg] ${name} nao encontrado. Rode "npm run pg:tools" (Windows), instale o PostgreSQL client ou defina PG_BIN.`);
    process.exit(2);
  }
  return p;
}

/** Converte DATABASE_URL em argumentos/variaveis para os utilitarios (senha via PGPASSWORD, nunca em argv). */
export function connectionFor(databaseUrl) {
  const u = new URL(databaseUrl);
  const env = {};
  if (u.password) env.PGPASSWORD = decodeURIComponent(u.password);
  const sslmode = u.searchParams.get('sslmode') ?? process.env.PGSSLMODE;
  if (sslmode) env.PGSSLMODE = sslmode;
  return {
    args: [
      '-h', u.hostname,
      '-p', u.port || '5432',
      '-U', decodeURIComponent(u.username),
      '-d', decodeURIComponent(u.pathname.replace(/^\//, '')),
    ],
    env,
  };
}

export function stamp(d = new Date()) {
  const p = (n, l = 2) => String(n).padStart(l, '0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}-${p(d.getUTCMilliseconds(), 3)}`;
}
