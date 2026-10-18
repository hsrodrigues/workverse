import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Pool } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { importJson } from '../src/db/importJson';
import { DEFAULT_MIGRATIONS_DIR, migrate } from '../src/db/migrate';
import { PgAccountStore } from '../src/db/pgAccountStore';
import { createPool, sslConfig } from '../src/db/pool';
import { DuplicateAccountError, JsonFileAccountStore, sanitizeOutfits } from '../src/store';
import { startPg } from './helpers/pgHarness';
import { accountStoreContract } from './helpers/storeContract';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const pgBin = resolve(repoRoot, 'tools/pg/bin');
const hasPgTools = existsSync(resolve(pgBin, process.platform === 'win32' ? 'pg_dump.exe' : 'pg_dump'));
const quiet = () => undefined;

// Versoes das migracoes vindas dos arquivos: adicionar uma migracao nova nao quebra estes testes.
const MIGRATION_FILES = readdirSync(DEFAULT_MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
const MIGRATION_VERSIONS = MIGRATION_FILES.map((f) => f.slice(0, 4));
const EXTRA_VERSION = String(Number(MIGRATION_VERSIONS[MIGRATION_VERSIONS.length - 1]) + 1).padStart(4, '0');
const EXTRA_FILE = `${EXTRA_VERSION}_extra.sql`;
const OUTFITS = sanitizeOutfits([{ id: 'o1', name: 'trabalho', avatar: {}, updatedAt: 5 }]);

// Sobe um Postgres real (embedded-postgres) uma vez para o arquivo; se nao der, a suite e pulada.
const h = await startPg();
const tmpDirs: string[] = [];
const tmp = (p: string) => {
  const d = mkdtempSync(join(tmpdir(), p));
  tmpDirs.push(d);
  return d;
};
let dbCounter = 0;
const dbName = (p: string) => `${p}_${++dbCounter}`;

afterAll(async () => {
  await h?.stop();
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
}, 60_000);

const openStore = (pool: Pool, retryBaseMs = 10) => PgAccountStore.open(pool, { retryBaseMs, log: quiet });
const countOf = async (pool: Pool, table: string) => Number((await pool.query(`SELECT count(*) AS n FROM ${table}`)).rows[0].n);

describe('pool', () => {
  it('mapeia sslmode no estilo libpq', () => {
    expect(sslConfig(undefined)).toBe(false);
    expect(sslConfig('disable')).toBe(false);
    expect(sslConfig('require')).toEqual({ rejectUnauthorized: false });
    expect(sslConfig('verify-full')).toEqual({ rejectUnauthorized: true });
    expect(() => sslConfig('banana')).toThrow();
  });
});

describe.skipIf(!h)('PostgreSQL real: migracoes', () => {
  it('aplica, registra checksum e e idempotente', async () => {
    const url = await h!.newDatabase(dbName('mig'));
    const pool = createPool({ connectionString: url, max: 4 });
    try {
      const r1 = await migrate(pool);
      expect(r1.applied).toEqual(MIGRATION_VERSIONS);
      const r2 = await migrate(pool);
      expect(r2.applied).toEqual([]);
      expect(r2.alreadyApplied).toBe(MIGRATION_VERSIONS.length);
      const { rows } = await pool.query('SELECT version, checksum, applied_at FROM schema_migrations');
      expect(rows).toHaveLength(MIGRATION_VERSIONS.length);
      expect(rows[0].checksum).toMatch(/^[0-9a-f]{64}$/);
      const tables = (await pool.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY 1")).rows.map((r) => r.tablename);
      for (const t of ['accounts', 'schema_migrations', 'sessions', 'orgs', 'teams', 'org_members', 'invites']) expect(tables).toContain(t);
    } finally {
      await pool.end();
    }
  });

  it('duas instancias migrando ao mesmo tempo (advisory lock) aplicam uma vez e sem erro', async () => {
    const url = await h!.newDatabase(dbName('lock'));
    const a = createPool({ connectionString: url, max: 2 });
    const b = createPool({ connectionString: url, max: 2 });
    try {
      const [ra, rb] = await Promise.all([migrate(a), migrate(b)]);
      expect([...ra.applied, ...rb.applied]).toEqual(MIGRATION_VERSIONS);
    } finally {
      await Promise.all([a.end(), b.end()]);
    }
  });

  it('falha se uma migracao ja aplicada foi alterada, se o arquivo sumiu ou se ha pendente fora de ordem', async () => {
    const dir = tmp('wv-mig-');
    cpSync(DEFAULT_MIGRATIONS_DIR, dir, { recursive: true });
    const url = await h!.newDatabase(dbName('chk'));
    const pool = createPool({ connectionString: url, max: 2 });
    try {
      await migrate(pool, { dir });
      writeFileSync(join(dir, EXTRA_FILE), 'CREATE TABLE extra_t (id int);\n');
      expect((await migrate(pool, { dir })).applied).toEqual([EXTRA_VERSION]);

      appendFileSync(join(dir, '0001_accounts_sessions.sql'), '\n-- editada\n');
      await expect(migrate(pool, { dir })).rejects.toThrow(/checksum/);
      cpSync(join(DEFAULT_MIGRATIONS_DIR, '0001_accounts_sessions.sql'), join(dir, '0001_accounts_sessions.sql'));
      await expect(migrate(pool, { dir })).resolves.toBeTruthy();

      rmSync(join(dir, EXTRA_FILE));
      await expect(migrate(pool, { dir })).rejects.toThrow(/nao existe mais/);
      writeFileSync(join(dir, EXTRA_FILE), 'CREATE TABLE extra_t (id int);\n');
      writeFileSync(join(dir, '0000_antes.sql'), 'SELECT 1;');
      await expect(migrate(pool, { dir })).rejects.toThrow(/anterior/);
    } finally {
      await pool.end();
    }
  });

  it('migracao com erro faz rollback e nao registra versao', async () => {
    const dir = tmp('wv-mig-bad-');
    writeFileSync(join(dir, '0001_ruim.sql'), 'CREATE TABLE ok_t (id int); SELECT 1/0;');
    const url = await h!.newDatabase(dbName('bad'));
    const pool = createPool({ connectionString: url, max: 2 });
    try {
      await expect(migrate(pool, { dir })).rejects.toThrow(/0001_ruim/);
      expect((await pool.query("SELECT to_regclass('ok_t') AS t")).rows[0].t).toBeNull();
      expect(await countOf(pool, 'schema_migrations')).toBe(0);
    } finally {
      await pool.end();
    }
  });
});

describe.skipIf(!h)('PostgreSQL real: PgAccountStore', () => {
  accountStoreContract('PgAccountStore', async () => {
    const { pool } = await h!.migratedPool(dbName('contract'));
    const store = await openStore(pool);
    return { store, settle: () => store.flush() };
  });

  it('dados sobrevivem a reabrir o store (restart), inclusive campos desconhecidos em extra', async () => {
    const { pool } = await h!.migratedPool(dbName('restart'));
    const s1 = await openStore(pool);
    const a = s1.create({ email: 'Ana@Example.com', displayName: 'Ana', passwordHash: 'scrypt$abc' });
    s1.save({ ...a, lastRoom: 'lounge', status: 'busy' as never, team: 'ops', outfits: OUTFITS } as never);
    s1.createSession({ tokenHash: 'tok1', accountId: a.id, createdAt: Date.now(), expiresAt: Date.now() + 60_000 });
    s1.createSession({ tokenHash: 'expirada', accountId: a.id, createdAt: 1, expiresAt: 2 });
    await s1.flush();

    const s2 = await openStore(pool);
    const b = s2.getByEmail('ana@example.com')!;
    expect(b.id).toBe(a.id);
    expect(b.passwordHash).toBe('scrypt$abc');
    expect(b.lastRoom).toBe('lounge');
    expect(b.team).toBe('ops');
    expect(b.createdAt).toBe(a.createdAt);
    expect(b.avatar).toEqual(a.avatar);
    expect((b as unknown as { outfits: unknown }).outfits).toEqual(OUTFITS);
    expect(s2.getSession('tok1')?.accountId).toBe(a.id);
    expect(s2.getSession('expirada')).toBeUndefined(); // sessoes vencidas nao sao carregadas
    expect(() => s2.create({ email: 'ANA@example.com', displayName: 'Outra', passwordHash: '' })).toThrowError(DuplicateAccountError);
  });

  it('persiste staff (coluna 0003), outfits, unlocks e orgs/membros no PG real', async () => {
    const { pool } = await h!.migratedPool(dbName('staff'));
    const s1 = await openStore(pool);
    const a = s1.create({ email: 'adm@x.com', displayName: 'Adm', passwordHash: 'scrypt$z' });
    s1.save({ ...a, staff: 'admin', outfits: OUTFITS, unlocks: ['vip', 'beta'] });
    await s1.flush();
    expect((await pool.query('SELECT staff FROM accounts WHERE id = $1', [a.id])).rows[0].staff).toBe('admin');
    await expect(pool.query("UPDATE accounts SET staff = 'rei' WHERE id = $1", [a.id])).rejects.toThrow(/check/i);

    const s2 = await openStore(pool);
    const b = s2.getByEmail('adm@x.com')!;
    expect(b.staff).toBe('admin');
    expect(b.outfits).toEqual(OUTFITS);
    expect(b.unlocks).toEqual(['vip', 'beta']);
    expect((b as unknown as Record<string, unknown>).staff).toBe('admin');
    expect(s2.orgs.membershipsOf(b.id).length).toBeGreaterThan(0);
    expect(await countOf(pool, 'orgs')).toBeGreaterThan(0);
    expect(await countOf(pool, 'org_members')).toBeGreaterThan(0);
    // remover staff volta a NULL
    const { staff: _s, ...semStaff } = b;
    s2.save(semStaff as never);
    await s2.flush();
    expect((await pool.query('SELECT staff FROM accounts WHERE id = $1', [a.id])).rows[0].staff).toBeNull();
  });

  it('flush no shutdown grava tudo que estava na fila e a fila coalesce saves repetidos', async () => {
    const { pool } = await h!.migratedPool(dbName('flush'));
    const store = await openStore(pool);
    const accounts = Array.from({ length: 50 }, (_, i) => store.create({ email: `u${i}@x.com`, displayName: `U${i}`, passwordHash: '' }));
    for (let i = 0; i < 200; i++) store.save({ ...accounts[0]!, lastRoom: `sala${i}` });
    expect(store.queueSize).toBeGreaterThan(0);
    expect(store.queueSize).toBeLessThan(200); // os 200 saves da mesma conta coalescem (o resto da fila e de orgs/membros)
    await store.close();
    expect(store.queueSize).toBe(0);
    expect(await countOf(pool, 'accounts')).toBe(50);
    const { rows } = await pool.query('SELECT last_room FROM accounts WHERE id = $1', [accounts[0]!.id]);
    expect(rows[0].last_room).toBe('sala199');
    expect(store.stats.written).toBeGreaterThan(0);
  });

  it('banco impoe unicidade case-insensitive mesmo fora do cache', async () => {
    const { pool } = await h!.migratedPool(dbName('uniq'));
    const store = await openStore(pool);
    const a = store.create({ email: 'dup@x.com', displayName: 'Dup', passwordHash: '' });
    await store.flush();
    const insert = (id: string, email: string, name: string) =>
      pool.query(
        "INSERT INTO accounts (id, email, email_key, display_name, name_key, last_room) VALUES ($1,$2,$3,$4,$5,'office')",
        [id, email, email.toLowerCase(), name, name.toLowerCase()],
      );
    await expect(insert('11111111-1111-4111-8111-111111111111', 'DUP@x.com', 'Outro')).rejects.toMatchObject({ code: '23505' });
    await expect(insert('22222222-2222-4222-8222-222222222222', 'novo@x.com', 'DUP')).rejects.toMatchObject({ code: '23505' });
    expect(a.id).toBeTruthy();
  });

  it('segunda instancia com cache velho: colisao no banco descarta a escrita e remove a conta do cache', async () => {
    const { pool } = await h!.migratedPool(dbName('race'));
    const a = await openStore(pool);
    const b = await openStore(pool); // abriu antes de a gravar: nao enxerga a conta
    a.create({ email: 'corrida@x.com', displayName: 'Corrida', passwordHash: '' });
    await a.flush();
    const loser = b.create({ email: 'corrida@x.com', displayName: 'Corrida', passwordHash: '' });
    await b.flush();
    expect(b.stats.dropped).toBe(1);
    expect(b.getById(loser.id)).toBeUndefined();
    expect(b.getByEmail('corrida@x.com')).toBeUndefined();
    expect(await countOf(pool, 'accounts')).toBe(1);
  });

  it('banco indisponivel: faz retry com backoff e grava quando volta; queueSize reflete o atraso', async () => {
    const { pool } = await h!.migratedPool(dbName('retry'));
    let failures = 3;
    const flaky = new Proxy(pool, {
      get(target, prop, recv) {
        if (prop === 'query') {
          return async (...args: unknown[]) => {
            if (failures > 0 && String(args[0]).includes('INSERT INTO accounts')) {
              failures--;
              throw Object.assign(new Error('connection terminated'), { code: 'ECONNRESET' });
            }
            return (target.query as (...a: unknown[]) => unknown)(...args);
          };
        }
        return Reflect.get(target, prop, recv);
      },
    });
    const store = await PgAccountStore.open(flaky, { retryBaseMs: 10, log: quiet });
    store.create({ email: 'retry@x.com', displayName: 'Retry', passwordHash: '' });
    expect(store.queueSize).toBeGreaterThanOrEqual(1); // conta + org/membro do backfill
    await store.flush(5_000);
    expect(store.queueSize).toBe(0);
    expect(store.stats.retries).toBeGreaterThanOrEqual(3);
    expect(await countOf(pool, 'accounts')).toBe(1);
  });

  it('flush rejeita por timeout se o banco continua fora, mantendo a fila para diagnostico', async () => {
    const { pool } = await h!.migratedPool(dbName('down'));
    const down = new Proxy(pool, {
      get(target, prop, recv) {
        if (prop === 'query') {
          return async (...args: unknown[]) => {
            if (String(args[0]).includes('INSERT INTO accounts')) throw Object.assign(new Error('down'), { code: 'ECONNREFUSED' });
            return (target.query as (...a: unknown[]) => unknown)(...args);
          };
        }
        return Reflect.get(target, prop, recv);
      },
    });
    const store = await PgAccountStore.open(down, { retryBaseMs: 10, maxRetryDelayMs: 20, log: quiet });
    store.create({ email: 'x@x.com', displayName: 'X', passwordHash: '' });
    await expect(store.flush(300)).rejects.toThrow(/pendente/);
    expect(store.queueSize).toBe(1);
    await store.close(10).catch(() => undefined);
  });

  it('fluxo HTTP: registra, reinicia (novo store + novo app) e consegue entrar com a mesma senha', async () => {
    const { pool } = await h!.migratedPool(dbName('http'));
    const store1 = await openStore(pool);
    const { app: app1 } = await createApp({ store: store1, authLimits: { failDelayMs: 0 } });
    const reg = await app1.inject({ method: 'POST', url: '/api/register', payload: { email: 'ana@example.com', password: 'correct horse battery', displayName: 'Ana' } });
    expect(reg.statusCode).toBeLessThan(300);
    await app1.close();
    await store1.close();

    const store2 = await openStore(pool);
    const { app: app2 } = await createApp({ store: store2, authLimits: { failDelayMs: 0 } });
    const login = await app2.inject({ method: 'POST', url: '/api/login', payload: { email: 'ANA@example.com', password: 'correct horse battery' } });
    expect(login.statusCode).toBe(200);
    const dup = await app2.inject({ method: 'POST', url: '/api/register', payload: { email: 'ana@example.com', password: 'correct horse battery', displayName: 'Ana2' } });
    expect(dup.statusCode).toBe(409);
    await app2.close();
    await store2.close();
  });
});

describe.skipIf(!h)('PostgreSQL real: importacao do JSON', () => {
  it('importa o accounts.json v2 de forma idempotente e respeita conflitos', async () => {
    const dir = tmp('wv-imp-');
    const file = join(dir, 'accounts.json');
    const json = new JsonFileAccountStore(file);
    const a = json.create({ email: 'ana@x.com', displayName: 'Ana', passwordHash: 'scrypt$1' });
    const b = json.create({ email: 'bia@x.com', displayName: 'Bia', passwordHash: 'scrypt$2' });
    json.save({ ...a, lastRoom: 'lounge', team: 'devs' });
    json.createSession({ tokenHash: 'ok', accountId: b.id, createdAt: Date.now(), expiresAt: Date.now() + 3_600_000 });
    json.createSession({ tokenHash: 'velha', accountId: b.id, createdAt: 1, expiresAt: 2 });
    json.flush();

    const { pool } = await h!.migratedPool(dbName('import'));
    const r1 = await importJson(pool, file);
    expect(r1.accounts).toEqual({ read: 2, inserted: 2, skipped: 0 });
    expect(r1.sessions.inserted).toBe(1);
    const r2 = await importJson(pool, file);
    expect(r2.accounts.inserted).toBe(0);
    expect(r2.sessions.inserted).toBe(0);
    expect(await countOf(pool, 'accounts')).toBe(2);
    expect(await countOf(pool, 'sessions')).toBe(1);

    const store = await openStore(pool);
    expect(store.getByEmail('ana@x.com')).toMatchObject({ id: a.id, lastRoom: 'lounge', team: 'devs', passwordHash: 'scrypt$1' });
    expect(store.getSession('ok')?.accountId).toBe(b.id);

    // conta de outro id com o mesmo e-mail no JSON: pulada, sem quebrar a importacao
    const other = join(dir, 'outro.json');
    writeFileSync(
      other,
      JSON.stringify({ version: 2, accounts: [{ ...a, id: '33333333-3333-4333-8333-333333333333' }], sessions: [] }),
    );
    expect((await importJson(pool, other)).accounts).toEqual({ read: 1, inserted: 0, skipped: 1 });

    const bad = join(dir, 'v1.json');
    writeFileSync(bad, JSON.stringify({ version: 1 }));
    await expect(importJson(pool, bad)).rejects.toThrow(/nao suportado/);
  });
});

describe.skipIf(!h || !hasPgTools)('backup e restauracao (pg_dump / pg_restore reais)', () => {
  const script = (name: string, env: Record<string, string>, args: string[] = []) =>
    spawnSync(process.execPath, [resolve(repoRoot, 'scripts', name), ...args], {
      env: { ...process.env, PG_BIN: pgBin, ...env },
      encoding: 'utf8',
    });

  it('dump -> restore em base vazia preserva contas, sessoes e campos; recusa base nao vazia', async () => {
    const { url, pool } = await h!.migratedPool(dbName('bk_src'));
    const store = await openStore(pool);
    const accs = Array.from({ length: 5 }, (_, i) => store.create({ email: `b${i}@x.com`, displayName: `B${i}`, passwordHash: `scrypt$${i}` }));
    store.save({ ...accs[0]!, team: 'ops', conjuntos: [1, 2] } as never);
    store.createSession({ tokenHash: 'bk1', accountId: accs[1]!.id, createdAt: Date.now(), expiresAt: Date.now() + 3_600_000 });
    await store.close();

    const backupDir = tmp('wv-bk-');
    const r = script('backup.mjs', { DATABASE_URL: url, BACKUP_DIR: backupDir });
    expect(r.status, r.stderr).toBe(0);
    const dumps = readdirSync(join(backupDir, 'daily'));
    expect(dumps).toHaveLength(1);
    expect(readdirSync(join(backupDir, 'weekly'))).toHaveLength(1);

    const target = await h!.newDatabase(dbName('bk_dst'));
    const rr = script('restore.mjs', { DATABASE_URL: target }, [join(backupDir, 'daily', dumps[0]!)]);
    expect(rr.status, rr.stderr).toBe(0);

    const dst = createPool({ connectionString: target, max: 2 });
    try {
      expect(await countOf(dst, 'accounts')).toBe(5);
      expect(await countOf(dst, 'sessions')).toBe(1);
      expect(await countOf(dst, 'schema_migrations')).toBe(MIGRATION_VERSIONS.length);
      const restored = await openStore(dst);
      expect(restored.getByEmail('b0@x.com')).toMatchObject({ team: 'ops', conjuntos: [1, 2], passwordHash: 'scrypt$0' });
      expect(restored.getSession('bk1')).toBeDefined();
      // migrar depois de restaurar nao reaplica nada
      expect((await migrate(dst)).applied).toEqual([]);
    } finally {
      await dst.end();
    }

    const again = script('restore.mjs', { DATABASE_URL: target }, [join(backupDir, 'daily', dumps[0]!)]);
    expect(again.status).toBe(1);
    expect(again.stderr).toMatch(/tabela/);
  }, 90_000);

  it('retencao: mantem so os N diarios mais novos (modo JSON)', () => {
    const data = tmp('wv-data-');
    writeFileSync(join(data, 'accounts.json'), '{"version":2,"accounts":[],"sessions":[]}');
    const backupDir = tmp('wv-bk-json-');
    const env = { DATABASE_URL: '', DATA_DIR: data, BACKUP_DIR: backupDir, BACKUP_KEEP_DAILY: '2', BACKUP_KEEP_WEEKLY: '1' };
    for (let i = 0; i < 4; i++) expect(script('backup.mjs', env).status).toBe(0);
    expect(readdirSync(join(backupDir, 'daily'))).toHaveLength(2);
    expect(readdirSync(join(backupDir, 'weekly'))).toHaveLength(1);
    expect(existsSync(join(backupDir, 'daily', readdirSync(join(backupDir, 'daily'))[0]!, 'accounts.json'))).toBe(true);
  });
});
