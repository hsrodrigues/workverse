import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app';
import { resolveBootConfig } from './bootConfig';
import { resolveMediaConfig } from './media';
import { resolveKeepaliveConfig, startKeepalive } from './keepalive';
import { makeOriginList } from './origins';
import { migrate } from './db/migrate';
import { PgAccountStore } from './db/pgAccountStore';
import { closePool, createPool, poolOptionsFromEnv } from './db/pool';
import { JsonFileAccountStore, type AccountStore } from './store';

const cfg = resolveBootConfig(process.env);
for (const w of cfg.warnings) console.warn(`[workverse] AVISO: ${w}`);
if (cfg.errors.length > 0) {
  console.error('\n[workverse] Configuracao insegura ou incompleta para producao. O servidor NAO vai iniciar:\n');
  for (const e of cfg.errors) console.error(`  - ${e}`);
  console.error('\nCorrija as variaveis acima (veja docs/deploy.md e .env.example) e inicie de novo.\n');
  process.exit(1);
}
const { port, host, production, allowDevLogin } = cfg;
const dataDir = resolve(process.env.DATA_DIR ?? './data');
const allowedOrigins = makeOriginList(cfg.allowedOrigins);
const trustProxy = cfg.trustProxy;
// O servidor tambem serve o site (build do cliente). WEB_ROOT opcional; por padrao apps/client/dist.
const webRoot = resolve(process.env.WEB_ROOT ?? fileURLToPath(new URL('../../client/dist', import.meta.url)));
const mediaCfg = resolveMediaConfig(process.env, production);

// DATABASE_URL definido -> PostgreSQL (cache + escrita assincrona); senao, arquivo JSON como antes.
const poolOpts = poolOptionsFromEnv();
const pool = poolOpts ? createPool(poolOpts) : null;
let store: AccountStore & { flush(): void | Promise<void> };
if (pool) {
  if (process.env.MIGRATE_ON_BOOT === '1') {
    const r = await migrate(pool, { log: (m) => console.log(`[migrate] ${m}`) });
    if (r.applied.length) console.log(`[migrate] aplicadas: ${r.applied.join(', ')}`);
  }
  try {
    store = await PgAccountStore.open(pool);
  } catch (err) {
    console.error(`[workverse] nao foi possivel carregar contas do PostgreSQL (schema migrado? use "npm run db:migrate" ou MIGRATE_ON_BOOT=1): ${(err as Error).message}`);
    process.exit(1);
  }
} else {
  store = new JsonFileAccountStore(resolve(dataDir, 'accounts.json'));
}
const { app, world } = await createApp({
  store,
  allowedOrigins,
  allowDevLogin,
  production,
  trustProxy,
  registrationMode: cfg.registration,
  web: { webRoot, production, livekitUrl: mediaCfg.enabled ? mediaCfg.url : undefined },
  logger: true,
});
if (!existsSync(resolve(webRoot, 'index.html'))) {
  app.log.warn({ webRoot }, 'build do cliente nao encontrado: so a API/WebSocket estao ativos (rode npm run build)');
}
app.log.info({ registration: cfg.registration, media: mediaCfg.enabled, postgres: cfg.usingPostgres, trustProxy }, 'workverse config');

// The old name+token profiles had no passwords and cannot be turned into real accounts.
const legacy = resolve(dataDir, 'profiles.json');
if (existsSync(legacy)) {
  app.log.warn({ file: legacy }, 'legacy profiles.json found and ignored: accounts now require e-mail and password (not migrated)');
}
if (allowDevLogin) app.log.warn('ALLOW_DEV_LOGIN=1: name-only login is enabled. Use only for development.');

// Autoping: chama o proprio /health publico para o plano gratuito nao dormir por falta de trafego (docs/deploy.md).
// Cada ping bem-sucedido faz o Byte dar uma batidinha de coracao (so visual).
const keepaliveCfg = resolveKeepaliveConfig(process.env);
const keepalive = startKeepalive(keepaliveCfg, {
  log: (m) => app.log.info(m),
  onBeat: () => world.pets.heartbeat(),
});
app.log.info({ keepalive: keepaliveCfg.enabled, reason: keepaliveCfg.reason, everyMs: keepaliveCfg.intervalMs || undefined }, 'autoping');

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'shutting down');
  keepalive?.stop();
  setTimeout(() => process.exit(1), 10_000).unref(); // nao fica preso se alguem segurar a conexao
  await app.close();
  let code = 0;
  try {
    await store.flush();
  } catch (err) {
    console.error(`[workverse] flush do store falhou: ${(err as Error).message}`);
    code = 1;
  }
  if (pool) await closePool(pool).catch(() => undefined);
  process.exit(code);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

await app.listen({ port, host });
