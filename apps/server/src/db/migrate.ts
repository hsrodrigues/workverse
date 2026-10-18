import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Pool } from 'pg';

export const DEFAULT_MIGRATIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../migrations');
/** Chave do pg_advisory_lock: impede duas instancias de migrar ao mesmo tempo. */
export const MIGRATION_LOCK_KEY = '7262025001';

export interface Migration {
  version: string;
  name: string;
  file: string;
  sql: string;
  checksum: string;
}

export interface MigrateResult {
  applied: string[];
  alreadyApplied: number;
}

const FILE_RE = /^(\d{4,})_([a-z0-9_]+)\.sql$/;

/** O checksum ignora diferencas de fim de linha (autocrlf no Windows). */
export function checksumOf(sql: string): string {
  return createHash('sha256').update(sql.replace(/\r\n/g, '\n')).digest('hex');
}

export function loadMigrations(dir = DEFAULT_MIGRATIONS_DIR): Migration[] {
  const out: Migration[] = [];
  for (const file of readdirSync(dir).sort()) {
    if (!file.endsWith('.sql')) continue;
    const m = FILE_RE.exec(file);
    if (!m) throw new Error(`nome de migracao invalido: ${file} (use NNNN_nome_em_minusculas.sql)`);
    const sql = readFileSync(resolve(dir, file), 'utf8');
    out.push({ version: m[1]!, name: m[2]!, file, sql, checksum: checksumOf(sql) });
  }
  const seen = new Set<string>();
  for (const m of out) {
    if (seen.has(m.version)) throw new Error(`versao de migracao duplicada: ${m.version}`);
    seen.add(m.version);
  }
  return out;
}

/**
 * Aplica as migracoes pendentes (somente `up`). Falha se uma migracao ja aplicada foi alterada,
 * se falta o arquivo de uma aplicada ou se ha pendente com versao menor que a ultima aplicada.
 * Cada migracao roda em uma transacao, a menos que o arquivo comece com "-- no-transaction".
 */
export async function migrate(
  pool: Pool,
  opts: { dir?: string; log?: (msg: string) => void } = {},
): Promise<MigrateResult> {
  const log = opts.log ?? (() => undefined);
  const migrations = loadMigrations(opts.dir);
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1::bigint)', [MIGRATION_LOCK_KEY]);
    try {
      await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
        version    text PRIMARY KEY,
        checksum   text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )`);
      const { rows } = await client.query<{ version: string; checksum: string }>(
        'SELECT version, checksum FROM schema_migrations ORDER BY version',
      );
      const applied = new Map(rows.map((r) => [r.version, r.checksum]));
      const known = new Map(migrations.map((m) => [m.version, m]));

      for (const [version, checksum] of applied) {
        const m = known.get(version);
        if (!m) throw new Error(`migracao ${version} esta aplicada no banco mas o arquivo nao existe mais`);
        if (m.checksum !== checksum) {
          throw new Error(`checksum da migracao ${m.file} mudou depois de aplicada; crie uma nova migracao em vez de editar`);
        }
      }
      const lastApplied = [...applied.keys()].sort().pop();
      const pending = migrations.filter((m) => !applied.has(m.version));
      for (const m of pending) {
        if (lastApplied && m.version < lastApplied) {
          throw new Error(`migracao pendente ${m.file} e anterior a ultima aplicada (${lastApplied})`);
        }
      }

      const done: string[] = [];
      for (const m of pending) {
        const transactional = !/^\s*--\s*no-transaction/i.test(m.sql);
        log(`aplicando ${m.file}`);
        try {
          if (transactional) await client.query('BEGIN');
          await client.query(m.sql);
          await client.query('INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)', [m.version, m.checksum]);
          if (transactional) await client.query('COMMIT');
        } catch (err) {
          if (transactional) await client.query('ROLLBACK').catch(() => undefined);
          throw new Error(`falha na migracao ${m.file}: ${(err as Error).message}`);
        }
        done.push(m.version);
      }
      return { applied: done, alreadyApplied: applied.size };
    } finally {
      await client.query('SELECT pg_advisory_unlock($1::bigint)', [MIGRATION_LOCK_KEY]).catch(() => undefined);
    }
  } finally {
    client.release();
  }
}
