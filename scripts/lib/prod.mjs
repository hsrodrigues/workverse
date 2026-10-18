// Producao sem Docker: carrega .env.production, builda o site se preciso e sobe o servidor Node.
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync, copyFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { root } from './cloudflared.mjs';

export const DIST_INDEX = resolve(root, 'apps/client/dist/index.html');
export const ENV_FILE = resolve(root, '.env.production');
export const ENV_EXAMPLE = resolve(root, '.env.production.example');

/**
 * Cria .env.production a partir do modelo se faltar e garante um METRICS_TOKEN forte (gerado uma vez e gravado no arquivo).
 * Retorna { created, tokenAdded }.
 */
export function ensureProdEnvFile(file = ENV_FILE, example = ENV_EXAMPLE) {
  let created = false;
  let tokenAdded = false;
  if (!existsSync(file)) {
    if (!existsSync(example)) return { created, tokenAdded };
    copyFileSync(example, file);
    created = true;
  }
  const text = readFileSync(file, 'utf8');
  if (!/^METRICS_TOKEN=\S+/m.test(text)) {
    const token = randomBytes(32).toString('base64url');
    const line = `METRICS_TOKEN=${token}`;
    const next = /^#?\s*METRICS_TOKEN=.*$/m.test(text) ? text.replace(/^#?\s*METRICS_TOKEN=.*$/m, line) : `${text.replace(/\s*$/, '\n')}${line}\n`;
    writeFileSync(file, next);
    tokenAdded = true;
  }
  return { created, tokenAdded };
}

/** Carrega .env.production (nao sobrescreve variaveis ja definidas no ambiente). Retorna true se o arquivo existia. */
export function loadProdEnv(env = process.env, file = ENV_FILE) {
  if (!existsSync(file)) return false;
  const saved = { ...env };
  process.loadEnvFile(file);
  for (const k of Object.keys(saved)) env[k] = saved[k]; // o ambiente do processo tem prioridade
  return true;
}

function newestMtime(dir) {
  let newest = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = resolve(dir, e.name);
    newest = Math.max(newest, e.isDirectory() ? newestMtime(p) : statSync(p).mtimeMs);
  }
  return newest;
}

/** true quando falta o build do site ou alguma fonte do cliente/compartilhado e mais nova que ele. */
export function needsBuild() {
  if (!existsSync(DIST_INDEX)) return true;
  const built = statSync(DIST_INDEX).mtimeMs;
  return ['apps/client/src', 'apps/client/public', 'packages/shared/src', 'apps/client/index.html'].some((rel) => {
    const p = resolve(root, rel);
    if (!existsSync(p)) return false;
    return (statSync(p).isDirectory() ? newestMtime(p) : statSync(p).mtimeMs) > built;
  });
}

export function build(log = console.log) {
  log('[build] gerando o site (apps/client/dist)...');
  const r = spawnSync('npm run build', { cwd: root, stdio: 'inherit', shell: true });
  if (r.status !== 0) throw new Error('o build do site falhou');
}

export function ensureDeps(log = console.log) {
  if (existsSync(resolve(root, 'node_modules'))) return;
  log('[deps] instalando dependencias (so na primeira vez)...');
  const r = spawnSync('npm install', { cwd: root, stdio: 'inherit', shell: true });
  if (r.status !== 0) throw new Error('npm install falhou');
}

/** Sobe o servidor em producao (tsx). `env` sobrescreve o ambiente do filho. Retorna o processo filho. */
export function spawnServer(env = {}) {
  const childEnv = { ...process.env, NODE_ENV: 'production', ...env };
  childEnv.PORT = childEnv.PORT || '8080';
  return spawn(process.execPath, ['--import', 'tsx', 'src/main.ts'], {
    cwd: resolve(root, 'apps/server'),
    env: childEnv,
    stdio: 'inherit',
  });
}
