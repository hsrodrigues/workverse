// Utilitarios do cloudflared (Cloudflare Tunnel): baixar com checksum e achar a URL do "quick tunnel".
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const CF_ASSET = 'cloudflared-windows-amd64.exe';
export const CF_DIR = resolve(root, 'tools/cloudflared');
export const CF_EXE = resolve(CF_DIR, 'cloudflared.exe');
const RELEASE_API = 'https://api.github.com/repos/cloudflare/cloudflared/releases/latest';

/** URL https://algo-aleatorio.trycloudflare.com na saida do cloudflared (ignora api.trycloudflare.com). */
export function parseQuickTunnelUrl(text) {
  const re = /https:\/\/([a-z0-9][a-z0-9-]*)\.trycloudflare\.com\b/gi;
  for (const m of String(text).matchAll(re)) {
    if (m[1].toLowerCase() !== 'api') return `https://${m[1].toLowerCase()}.trycloudflare.com`;
  }
  return null;
}

/** SHA-256 publicado para o asset: campo `digest` da API do GitHub, ou a linha "nome: hash" das notas da versao. */
export function expectedSha256(release, assetName = CF_ASSET) {
  const asset = (release?.assets ?? []).find((a) => a.name === assetName);
  const fromDigest = /^sha256:([0-9a-f]{64})$/i.exec(asset?.digest ?? '');
  if (fromDigest) return fromDigest[1].toLowerCase();
  const line = new RegExp(`${assetName.replace(/[.]/g, '\\.')}\\s*:\\s*([0-9a-f]{64})`, 'i').exec(release?.body ?? '');
  return line ? line[1].toLowerCase() : null;
}

export const sha256Hex = (buf) => createHash('sha256').update(buf).digest('hex');

/**
 * Garante tools/cloudflared/cloudflared.exe. Baixa do GitHub oficial (cloudflare/cloudflared) e CONFERE o SHA-256
 * publicado pela release; sem hash publicado ou com hash diferente, aborta e nao instala nada.
 * `fetchImpl` e injetavel para teste.
 */
export async function ensureCloudflared({ fetchImpl = fetch, log = console.log, exePath = CF_EXE } = {}) {
  if (existsSync(exePath)) return exePath;
  log('[cloudflared] baixando o cloudflared oficial (github.com/cloudflare/cloudflared)...');
  const relRes = await fetchImpl(RELEASE_API, { headers: { 'User-Agent': 'workverse-publicar', Accept: 'application/vnd.github+json' } });
  if (!relRes.ok) throw new Error(`nao consegui consultar a release do cloudflared (HTTP ${relRes.status})`);
  const release = await relRes.json();
  const asset = (release.assets ?? []).find((a) => a.name === CF_ASSET);
  if (!asset?.browser_download_url?.startsWith('https://github.com/cloudflare/cloudflared/')) {
    throw new Error(`asset ${CF_ASSET} nao encontrado na release ${release.tag_name}`);
  }
  const want = expectedSha256(release);
  if (!want && process.env.CLOUDFLARED_SKIP_CHECKSUM !== '1') {
    throw new Error('a release nao publica o SHA-256; por seguranca nao instalei. (CLOUDFLARED_SKIP_CHECKSUM=1 ignora, nao recomendado)');
  }
  const dl = await fetchImpl(asset.browser_download_url, { headers: { 'User-Agent': 'workverse-publicar' }, redirect: 'follow' });
  if (!dl.ok) throw new Error(`download falhou (HTTP ${dl.status})`);
  const buf = Buffer.from(await dl.arrayBuffer());
  const got = sha256Hex(buf);
  if (want && got !== want) throw new Error(`SHA-256 NAO confere (esperado ${want}, obtido ${got}). Download descartado.`);
  mkdirSync(dirname(exePath), { recursive: true });
  const tmp = `${exePath}.part`;
  writeFileSync(tmp, buf);
  rmSync(exePath, { force: true });
  renameSync(tmp, exePath);
  log(`[cloudflared] ${release.tag_name} instalado em ${exePath}${want ? ' (SHA-256 verificado)' : ''}`);
  return exePath;
}
