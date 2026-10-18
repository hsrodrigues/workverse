import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import type { Pool } from 'pg';
import { migrate } from '../../src/db/migrate';
import { createPool } from '../../src/db/pool';

export interface PgHarness {
  /** Porta do cluster temporario. */
  port: number;
  /** Cria um banco novo e vazio e devolve sua URL (isolamento por suite). */
  newDatabase(name: string): Promise<string>;
  /** Banco novo ja migrado. */
  migratedPool(name: string): Promise<{ url: string; pool: Pool }>;
  stop(): Promise<void>;
  /** Binarios usados nos testes de backup. */
  adminUrl: string;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const port = (srv.address() as { port: number }).port;
      srv.close(() => resolve(port));
    });
  });
}

/**
 * Sobe um PostgreSQL real e descartavel (embedded-postgres, sem Docker) em porta aleatoria.
 * Retorna null quando nao e possivel (WV_SKIP_PG=1 ou binarios indisponiveis): a suite entao e pulada.
 * Use WV_PG_URL=postgres://... para apontar para um servidor existente em vez de subir um.
 */
export async function startPg(): Promise<PgHarness | null> {
  if (process.env.WV_SKIP_PG === '1') return null;
  const dir = mkdtempSync(join(tmpdir(), 'wv-pg-'));
  let pg: EmbeddedPostgres | null = null;
  try {
    const port = await freePort();
    pg = new EmbeddedPostgres({
      databaseDir: dir,
      port,
      user: 'wv',
      password: 'wv',
      persistent: false,
      onLog: () => undefined,
      onError: () => undefined,
    });
    await pg.initialise();
    await pg.start();
    const pools: Pool[] = [];
    const base = `postgres://wv:wv@127.0.0.1:${port}`;
    const harness: PgHarness = {
      port,
      adminUrl: `${base}/postgres`,
      async newDatabase(name) {
        await pg!.createDatabase(name);
        return `${base}/${name}`;
      },
      async migratedPool(name) {
        const url = await harness.newDatabase(name);
        const pool = createPool({ connectionString: url, max: 4 });
        pools.push(pool);
        await migrate(pool);
        return { url, pool };
      },
      async stop() {
        await Promise.allSettled(pools.map((p) => p.end()));
        try {
          await pg!.stop();
        } finally {
          rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
        }
      },
    };
    return harness;
  } catch (err) {
    console.warn(`[pg.test] PostgreSQL embutido indisponivel, suite sera pulada: ${(err as Error).message}`);
    try {
      await pg?.stop();
    } catch {
      /* nunca iniciou */
    }
    rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
    return null;
  }
}
