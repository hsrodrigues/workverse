// npm run build:prod  -> gera o site em apps/client/dist
// npm run start:prod  -> (builda se preciso) e sobe o servidor de producao na PORT (padrao 8080)
// Variaveis: do ambiente e de .env.production (se existir). Veja docs/deploy.md.
import { build, ensureDeps, ensureProdEnvFile, loadProdEnv, needsBuild, spawnServer } from './lib/prod.mjs';

const cmd = process.argv[2];
try {
  if (cmd === 'build') {
    ensureDeps();
    build();
  } else if (cmd === 'start') {
    if (ensureProdEnvFile().tokenAdded) console.log('[prod] gerei um METRICS_TOKEN forte em .env.production');
    if (loadProdEnv()) console.log('[prod] variaveis carregadas de .env.production');
    ensureDeps();
    if (needsBuild()) build();
    const child = spawnServer();
    for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
    child.on('exit', (code) => process.exit(code ?? 0));
  } else {
    console.error('Uso: node scripts/prod.mjs build|start');
    process.exit(2);
  }
} catch (err) {
  console.error(`[prod] ${err.message}`);
  process.exit(1);
}
