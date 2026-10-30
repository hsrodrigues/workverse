import { afterAll, describe, expect, it } from 'vitest';
import { edgeNatDhcp } from '@workverse/shared';
import { PgAccountStore } from '../src/db/pgAccountStore';
import { MemoryAccountStore } from '../src/store';
import { startPg } from './helpers/pgHarness';
import { netsimStoreContract } from './helpers/netsimContract';

const quiet = () => undefined;

// PostgreSQL real e descartavel; se nao for possivel subir, a suite e pulada (WV_SKIP_PG=1).
const h = await startPg();
afterAll(async () => {
  await h?.stop();
}, 60_000);

let n = 0;
netsimStoreContract('PgAccountStore (PostgreSQL real, migracoes 0010 e 0011)', async () => {
  if (!h) {
    const store = new MemoryAccountStore();
    return { store, settle: async () => undefined, reopen: async () => store };
  }
  const { pool } = await h.migratedPool(`netsim_${++n}`);
  const open = () => PgAccountStore.open(pool, { retryBaseMs: 10, log: quiet });
  let current = await open();
  return {
    store: current,
    settle: () => current.flush(),
    reopen: async () => {
      await current.flush();
      current = await open();
      return current;
    },
  };
});

describe.skipIf(!h)('PostgreSQL real: simulador de rede', () => {
  it('a migracao 0010 cria as tabelas', async () => {
    const { pool } = await h!.migratedPool('netsim_tables');
    const tables = (await pool.query("SELECT tablename FROM pg_tables WHERE schemaname='public'")).rows.map((r) => r.tablename);
    expect(tables).toEqual(expect.arrayContaining(['netsim_topologies', 'netsim_progress']));
  });

  it('o banco recusa versao 0, JSON que nao e topologia e pontuacao fora da faixa', async () => {
    const { pool } = await h!.migratedPool('netsim_checks');
    const store = await PgAccountStore.open(pool, { retryBaseMs: 10, log: quiet });
    const a = store.create({ email: 'a@x.com', displayName: 'Ana', passwordHash: 'scrypt$x' });
    a.orgsInit = true;
    store.save(a);
    store.orgs.putOrg({ id: 'o1', slug: 'o1', name: 'O1', settings: {}, createdAt: 1 });
    await store.flush();
    const topo = (version: number, json: string) => pool.query('INSERT INTO netsim_topologies (org_id, version, topology) VALUES ($1, $2, $3::jsonb)', ['o1', version, json]);
    await expect(topo(0, JSON.stringify(edgeNatDhcp()))).rejects.toThrow();
    await expect(topo(1, '[]')).rejects.toThrow();
    await expect(topo(1, '{"devices":1,"cables":[]}')).rejects.toThrow();
    await topo(1, JSON.stringify(edgeNatDhcp()));
    await expect(pool.query("INSERT INTO netsim_progress (org_id, account_id, challenge_id, best) VALUES ('o1', $1, 'x', 101)", [a.id])).rejects.toThrow();
    await expect(pool.query("INSERT INTO netsim_progress (org_id, account_id, challenge_id, best, hints) VALUES ('o1', $1, 'y', 50, 4)", [a.id])).rejects.toThrow();
  });

  it('apagar a organizacao apaga a topologia e o progresso dela, e nao os de outra', async () => {
    const { pool } = await h!.migratedPool('netsim_cascade');
    const store = await PgAccountStore.open(pool, { retryBaseMs: 10, log: quiet });
    const a = store.create({ email: 'a@x.com', displayName: 'Ana', passwordHash: 'scrypt$x' });
    a.orgsInit = true;
    store.save(a);
    for (const id of ['o1', 'o2']) store.orgs.putOrg({ id, slug: id, name: id, settings: {}, createdAt: 1 });
    for (const id of ['o1', 'o2']) {
      store.netsim.put({ orgId: id, version: 1, topology: edgeNatDhcp(), updatedBy: a.id, updatedAt: 1 });
      store.netsim.putProgress({ orgId: id, accountId: a.id, challengeId: 'c', best: 50, attempts: 1, hints: 0, solvedAt: null, updatedAt: 1 });
    }
    await store.flush();
    await pool.query("DELETE FROM orgs WHERE id = 'o1'");
    expect((await pool.query('SELECT org_id FROM netsim_topologies')).rows.map((r) => r.org_id)).toEqual(['o2']);
    expect((await pool.query('SELECT org_id FROM netsim_progress')).rows.map((r) => r.org_id)).toEqual(['o2']);
  });
});
