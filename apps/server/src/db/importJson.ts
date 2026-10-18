import { readFileSync } from 'node:fs';
import type { Pool } from 'pg';
import type { Account, SessionRecord } from '../store';
import { accountParams, sessionParams, INSERT_ACCOUNT_IGNORE_SQL, INSERT_SESSION_SQL } from './mapping';

export interface ImportResult {
  accounts: { read: number; inserted: number; skipped: number };
  sessions: { read: number; inserted: number; skipped: number };
}

/**
 * Importa um accounts.json (formato v2/v3 do JsonFileAccountStore) para o Postgres.
 * Idempotente: nada que ja exista (mesmo id, e-mail ou nome) e sobrescrito, e rodar de novo insere 0 linhas.
 * Orgs/membros do v3 nao sao importados: o store recria a org padrao no backfill ao abrir.
 * Tudo numa unica transacao: ou importa tudo ou nada.
 */
export async function importJson(pool: Pool, file: string, now = Date.now()): Promise<ImportResult> {
  const data = JSON.parse(readFileSync(file, 'utf8')) as { version?: number; accounts?: Account[]; sessions?: SessionRecord[] };
  if (data.version !== 2 && data.version !== 3) throw new Error(`formato nao suportado em ${file}: version=${String(data.version)} (esperado 2 ou 3)`);
  const accounts = data.accounts ?? [];
  const sessions = (data.sessions ?? []).filter((s) => s.expiresAt > now);
  const result: ImportResult = {
    accounts: { read: accounts.length, inserted: 0, skipped: 0 },
    sessions: { read: sessions.length, inserted: 0, skipped: 0 },
  };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const a of accounts) {
      const r = await client.query(INSERT_ACCOUNT_IGNORE_SQL, accountParams(a));
      if (r.rowCount) result.accounts.inserted++;
      else result.accounts.skipped++;
    }
    for (const s of sessions) {
      // Sessao de conta que nao existe (ex.: conta pulada) e ignorada em vez de quebrar a transacao.
      const exists = await client.query('SELECT 1 FROM accounts WHERE id = $1', [s.accountId]);
      if (!exists.rowCount) {
        result.sessions.skipped++;
        continue;
      }
      const r = await client.query(INSERT_SESSION_SQL, sessionParams(s));
      if (r.rowCount) result.sessions.inserted++;
      else result.sessions.skipped++;
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
  return result;
}
