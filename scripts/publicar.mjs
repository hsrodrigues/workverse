// Publicar-Online.bat  -> node scripts/publicar.mjs quick   (link https://*.trycloudflare.com, sem conta)
// Publicar-Dominio.bat -> node scripts/publicar.mjs named   (dominio proprio, tunel nomeado ja criado; TUNNEL_NAME)
// Sobe o servidor de producao NESTE PC e o tunel da Cloudflare. Nada abre portas no roteador.
import { spawn } from 'node:child_process';
import { ensureCloudflared, parseQuickTunnelUrl } from './lib/cloudflared.mjs';
import { build, ensureDeps, ensureProdEnvFile, loadProdEnv, needsBuild, spawnServer } from './lib/prod.mjs';

const mode = process.argv[2] === 'named' ? 'named' : 'quick';
const log = (m) => console.log(m);
const fail = (m) => {
  console.error(`\n[ERRO] ${m}\n`);
  process.exit(1);
};
const banner = (lines) => {
  const w = Math.max(...lines.map((l) => l.length)) + 4;
  console.log(`\n${'='.repeat(w)}\n${lines.map((l) => `  ${l}`).join('\n')}\n${'='.repeat(w)}\n`);
};

const envInfo = ensureProdEnvFile();
if (envInfo.created) log('[publicar] criei .env.production a partir do modelo.');
if (envInfo.tokenAdded) log('[publicar] gerei um METRICS_TOKEN forte em .env.production (use: Authorization: Bearer <token> em /metrics).');
if (loadProdEnv()) log('[publicar] variaveis carregadas de .env.production');
const truthyEnv = (v) => ['1', 'true', 'yes', 'on'].includes(String(v ?? '').trim().toLowerCase());
if (truthyEnv(process.env.ALLOW_DEV_LOGIN)) {
  fail('ALLOW_DEV_LOGIN esta ligado no ambiente (o iniciar.bat de desenvolvimento define isso). Ele entra sem senha e NUNCA pode ir para a internet. Abra um terminal novo (sem rodar iniciar.bat antes), remova ALLOW_DEV_LOGIN e rode de novo.');
}
const port = process.env.PORT || '8080';
const local = `http://127.0.0.1:${port}`;

try {
  ensureDeps();
  if (needsBuild()) build();
} catch (err) {
  fail(err.message);
}

let cfBin = process.env.CLOUDFLARED_BIN; // so para testes (script falso que imita a saida)
if (!cfBin) {
  try {
    cfBin = await ensureCloudflared({ log });
  } catch (err) {
    fail(`cloudflared: ${err.message}`);
  }
}

const children = [];
let stopping = false;
const stopAll = (code = 0) => {
  if (stopping) return;
  stopping = true;
  for (const c of children) if (!c.killed) c.kill('SIGTERM');
  setTimeout(() => process.exit(code), 1500).unref();
};
process.on('SIGINT', () => stopAll(0));
process.on('SIGTERM', () => stopAll(0));

const startCf = (args) => {
  const isScript = cfBin.endsWith('.mjs');
  const child = spawn(isScript ? process.execPath : cfBin, isScript ? [cfBin, ...args] : args, { stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(child);
  child.on('exit', (code) => {
    if (!stopping) {
      console.error(`\n[publicar] o tunel da Cloudflare parou (codigo ${code}). Encerrando.`);
      stopAll(1);
    }
  });
  return child;
};

async function waitHealthy(timeoutMs = 60_000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try {
      const r = await fetch(`${local}/health`);
      if (r.ok) return true;
    } catch {
      /* ainda subindo */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

// Padrao deste PC: o disco e persistente, entao o arquivo JSON e aceitavel quando nao ha DATABASE_URL.
const serverDefaults = { HOST: '127.0.0.1', TRUST_PROXY: process.env.TRUST_PROXY || '1' };
if (!process.env.DATABASE_URL && !process.env.ALLOW_JSON_STORE) {
  serverDefaults.ALLOW_JSON_STORE = '1';
  log('[publicar] sem DATABASE_URL: usando o arquivo JSON local (apps/server/data). Para PostgreSQL defina DATABASE_URL em .env.production.');
}

let publicUrl;
if (mode === 'quick') {
  log('[publicar] abrindo o tunel (quick tunnel, sem conta)...');
  const cf = startCf(['tunnel', '--no-autoupdate', '--url', local]);
  publicUrl = await new Promise((resolveUrl) => {
    let buf = '';
    const timer = setTimeout(() => resolveUrl(null), 90_000);
    const onData = (d) => {
      buf += d.toString();
      if (process.env.PUBLICAR_VERBOSE === '1') process.stderr.write(d);
      const u = parseQuickTunnelUrl(buf);
      if (u) {
        clearTimeout(timer);
        cf.stdout.off('data', onData);
        cf.stderr.off('data', onData);
        // segue drenando a saida para o pipe nao encher
        cf.stdout.resume();
        cf.stderr.resume();
        resolveUrl(u);
      }
    };
    cf.stdout.on('data', onData);
    cf.stderr.on('data', onData);
  });
  if (!publicUrl) fail('nao consegui obter o link do tunel em 90 s. Verifique a internet e tente de novo (PUBLICAR_VERBOSE=1 mostra a saida do cloudflared).');
} else {
  const name = process.env.TUNNEL_NAME;
  publicUrl = (process.env.PUBLIC_URL || '').replace(/\/+$/, '');
  if (!name) fail('defina TUNNEL_NAME (nome do tunel criado com "cloudflared tunnel create") em .env.production. Veja docs/deploy.md, caminho B.');
  if (!/^https:\/\//.test(publicUrl)) fail('defina PUBLIC_URL=https://seu.dominio em .env.production (o dominio apontado com "cloudflared tunnel route dns").');
  log(`[publicar] iniciando o tunel nomeado "${name}"...`);
  const cf = startCf(['tunnel', '--no-autoupdate', 'run', '--url', local, name]);
  cf.stdout.resume();
  cf.stderr.on('data', (d) => process.env.PUBLICAR_VERBOSE === '1' && process.stderr.write(d));
}

log(`[publicar] iniciando o servidor de producao na porta ${port}...`);
const server = spawnServer({ ...serverDefaults, PUBLIC_URL: publicUrl });
children.push(server);
server.on('exit', (code) => {
  if (!stopping) {
    console.error(`\n[publicar] o servidor parou (codigo ${code}). Veja a mensagem acima. Encerrando.`);
    stopAll(code || 1);
  }
});

if (!(await waitHealthy())) fail('o servidor nao respondeu em /health. Veja as mensagens acima.');

banner([`SEU LINK: ${publicUrl}`, '', mode === 'quick' ? 'Este link muda a cada vez que voce roda o Publicar-Online.bat.' : 'Dominio fixo (tunel nomeado).', 'Deixe esta janela aberta. Ctrl+C para desligar.']);
log('Nao ha cadastro publico. A primeira conta (dona) se cria com o servidor PARADO:');
log('  npm run account:create -w @workverse/server -- seu@email.com SeuNome');
log('e coloque o e-mail em BOOTSTRAP_STAFF_EMAILS (ex.: seu@email.com:admin) no .env.production. Depois a staff cria as demais contas.\n');
