import { afterAll, describe, expect, it } from 'vitest';
import type { ClientMessage, ServerMessage } from '@workverse/shared';
import { createApp } from '../src/app';
import { hashPassword, hashToken } from '../src/auth';
import { PgAccountStore } from '../src/db/pgAccountStore';
import type { Connection } from '../src/world';
import { startPg } from './helpers/pgHarness';

const PASSWORD = 'correct horse battery';
const quiet = () => undefined;

// PostgreSQL real e descartavel; se nao for possivel subir, a suite e pulada (WV_SKIP_PG=1).
const h = await startPg();
afterAll(async () => {
  await h?.stop();
}, 60_000);

class FakeConn implements Connection {
  strikes = 0;
  accountId?: string;
  sessionHash?: string;
  player?: Connection['player'];
  inbox: ServerMessage[] = [];
  send(msg: ServerMessage) {
    this.inbox.push(msg);
  }
  close() {}
}

describe.skipIf(!h)('PostgreSQL real: administracao de contas e auditoria de staff', () => {
  it('migracao 0004 cria staff_audit; criar/ban/staff/auditoria sobrevivem a reiniciar o servidor', async () => {
    const { pool } = await h!.migratedPool('staffpg');
    const tables = (await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'")).rows.map((r: { table_name: string }) => r.table_name);
    expect(tables).toContain('staff_audit');

    const store = await PgAccountStore.open(pool, { retryBaseMs: 10, log: quiet });
    const { app, world } = await createApp({ store, tickMs: 50, authLimits: { failDelayMs: 0 }, registrationMode: 'closed' });
    try {
      const admin = store.create({ email: 'adm@x.com', displayName: 'Chefe', passwordHash: await hashPassword(PASSWORD) });
      admin.staff = 'admin';
      store.save(admin);
      const login = await app.inject({ method: 'POST', url: '/api/login', payload: { email: 'adm@x.com', password: PASSWORD } });
      const raw = login.headers['set-cookie'];
      const cookie = (Array.isArray(raw) ? raw[0] : String(raw)).split(';')[0]!;
      const conn = new FakeConn();
      conn.accountId = admin.id;
      conn.sessionHash = hashToken(cookie.split('=')[1]!);
      world.handle(conn, { t: 'hello' });
      world.handle(conn, { t: 'join', roomId: 'office' } as ClientMessage);
      const call = (method: 'GET' | 'POST' | 'PATCH', url: string, payload?: unknown) => app.inject({ method, url, payload: payload as object | undefined, headers: { cookie } });

      // cria conta com senha provisoria
      const created = await call('POST', '/api/staff/accounts', { email: 'nova@x.com', displayName: 'Nova' });
      expect(created.statusCode).toBe(201);
      const pw = created.json().provisionalPassword as string;
      const nova = store.getByEmail('nova@x.com')!;
      // promove a helper, bane e silencia
      expect((await call('POST', '/api/staff/team', { identifier: 'nova@x.com', level: 'helper' })).statusCode).toBe(201);
      const outra = store.create({ email: 'outra@x.com', displayName: 'Outra', passwordHash: await hashPassword(PASSWORD) });
      expect((await call('POST', `/api/staff/accounts/${outra.id}/ban`, { minutes: null, reason: 'abuso' })).statusCode).toBe(200);
      outra.mute = { until: Date.now() + 3_600_000, by: 'Chefe', reason: 'flood' };
      store.save(outra);
      await store.flush();

      expect((await pool.query('SELECT staff FROM accounts WHERE id = $1', [nova.id])).rows[0].staff).toBe('helper');
      const extra = (await pool.query('SELECT extra FROM accounts WHERE id = $1', [nova.id])).rows[0].extra;
      expect(extra.mustChangePassword).toBe(true);
      expect(extra.createdBy).toBe('Chefe');
      const rows = (await pool.query('SELECT action, actor, target, level FROM staff_audit ORDER BY at')).rows;
      expect(rows.map((r: { action: string }) => r.action)).toEqual(expect.arrayContaining(['account.create', 'staff.add', 'account.ban']));
      expect(JSON.stringify(rows)).not.toContain(pw);

      // "reinicia o servidor": novo store sobre o mesmo banco
      const store2 = await PgAccountStore.open(pool, { retryBaseMs: 10, log: quiet });
      const nova2 = store2.getByEmail('nova@x.com')!;
      expect(nova2.mustChangePassword).toBe(true);
      expect(nova2.staff).toBe('helper');
      const outra2 = store2.getByEmail('outra@x.com')!;
      expect(outra2.ban).toMatchObject({ until: null, reason: 'abuso', by: 'Chefe' });
      expect(outra2.mute?.reason).toBe('flood');
      const audit = store2.queryAudit({ limit: 50 });
      expect(audit.map((r) => r.action)).toEqual(expect.arrayContaining(['account.create', 'staff.add', 'account.ban']));
      expect(store2.queryAudit({ target: 'outra' })[0]).toMatchObject({ action: 'account.ban', actor: 'Chefe', level: 'admin' });
      expect(store2.queryAudit({ actor: 'chefe', action: 'staff' })).toHaveLength(1);

      // o novo mundo ja nasce com o banimento e a troca obrigatoria
      const r2 = await createApp({ store: store2, tickMs: 50, registrationMode: 'closed' });
      try {
        const banned = await r2.app.inject({ method: 'POST', url: '/api/login', payload: { email: 'outra@x.com', password: PASSWORD } });
        expect(banned.json().error.code).toBe('account_banned');
        const first = await r2.app.inject({ method: 'POST', url: '/api/login', payload: { email: 'nova@x.com', password: pw } });
        expect(first.json().account.mustChangePassword).toBe(true);
        expect(r2.world.staff.mutedFor(outra2.id, Date.now())).toBeGreaterThan(0);
      } finally {
        await r2.app.close();
      }
      await store2.close();
    } finally {
      await app.close();
      await store.close();
    }
  }, 60_000);
});
