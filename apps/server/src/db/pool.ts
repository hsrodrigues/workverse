import { readFileSync } from 'node:fs';
import pg from 'pg';

export type SslMode = 'disable' | 'allow' | 'prefer' | 'require' | 'verify-ca' | 'verify-full' | 'no-verify';

export interface PoolOptions {
  connectionString?: string;
  /** Mesmo vocabulario do libpq (PGSSLMODE). `require` cifra sem validar o certificado. */
  sslMode?: SslMode;
  /** Certificado da CA (conteudo PEM ou caminho de arquivo) para verify-ca/verify-full. */
  sslCa?: string;
  max?: number;
  idleTimeoutMs?: number;
  connectionTimeoutMs?: number;
  statementTimeoutMs?: number;
  applicationName?: string;
  onError?: (err: Error) => void;
}

const SSL_MODES = new Set(['disable', 'allow', 'prefer', 'require', 'verify-ca', 'verify-full', 'no-verify']);

function intEnv(env: NodeJS.ProcessEnv, name: string): number | undefined {
  const raw = env[name];
  if (raw === undefined || raw === '') return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) throw new Error(`${name} deve ser um inteiro >= 0 (recebido "${raw}")`);
  return n;
}

/** Le a configuracao das variaveis de ambiente. Retorna undefined sem DATABASE_URL. */
export function poolOptionsFromEnv(env: NodeJS.ProcessEnv = process.env): PoolOptions | undefined {
  const url = env.DATABASE_URL;
  if (!url) return undefined;
  const mode = env.PGSSLMODE;
  if (mode && !SSL_MODES.has(mode)) throw new Error(`PGSSLMODE invalido: "${mode}"`);
  return {
    connectionString: url,
    sslMode: (mode || undefined) as SslMode | undefined,
    sslCa: env.PGSSLROOTCERT,
    max: intEnv(env, 'DB_POOL_MAX'),
    idleTimeoutMs: intEnv(env, 'DB_POOL_IDLE_MS'),
    connectionTimeoutMs: intEnv(env, 'DB_CONNECT_TIMEOUT_MS'),
    statementTimeoutMs: intEnv(env, 'DB_STATEMENT_TIMEOUT_MS'),
  };
}

/**
 * Remove `sslmode` da URL (o pg trata de forma propria e mudou de semantica entre versoes)
 * e devolve o modo pedido, para que a decisao fique explicita neste arquivo.
 */
function splitSslMode(connectionString: string): { url: string; mode?: string } {
  try {
    const u = new URL(connectionString);
    const mode = u.searchParams.get('sslmode') ?? undefined;
    if (mode !== undefined) {
      u.searchParams.delete('sslmode');
      return { url: u.toString(), mode };
    }
  } catch {
    /* URL nao parseavel: deixa o pg reclamar */
  }
  return { url: connectionString };
}

function readCa(ca: string): string {
  return ca.includes('BEGIN CERTIFICATE') ? ca : readFileSync(ca, 'utf8');
}

export function sslConfig(mode: string | undefined, ca?: string): pg.ClientConfig['ssl'] {
  switch (mode) {
    case undefined:
    case '':
    case 'disable':
    case 'allow':
    case 'prefer':
      return false;
    case 'require':
    case 'no-verify':
      return { rejectUnauthorized: false };
    case 'verify-ca':
    case 'verify-full':
      return { rejectUnauthorized: true, ...(ca ? { ca: readCa(ca) } : {}) };
    default:
      throw new Error(`sslmode invalido: "${mode}"`);
  }
}

export function createPool(opts: PoolOptions): pg.Pool {
  const raw = opts.connectionString;
  if (!raw) throw new Error('DATABASE_URL nao definido');
  const { url, mode } = splitSslMode(raw);
  const pool = new pg.Pool({
    connectionString: url,
    ssl: sslConfig(opts.sslMode ?? mode, opts.sslCa),
    max: opts.max ?? 10,
    idleTimeoutMillis: opts.idleTimeoutMs ?? 30_000,
    connectionTimeoutMillis: opts.connectionTimeoutMs ?? 10_000,
    statement_timeout: opts.statementTimeoutMs ?? 30_000,
    application_name: opts.applicationName ?? 'workverse-server',
  });
  // Sem este handler, um erro em conexao ociosa (ex.: banco reiniciou) derruba o processo.
  const onError = opts.onError ?? ((e: Error) => console.error('[db] erro em conexao ociosa:', e.message));
  pool.on('error', onError);
  return pool;
}

/** Encerramento limpo: espera as consultas em andamento e fecha as conexoes. Idempotente. */
export async function closePool(pool: pg.Pool): Promise<void> {
  if (pool.ended) return;
  await pool.end();
}

export type { Pool, PoolClient } from 'pg';
