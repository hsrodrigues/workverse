import { describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
// @ts-expect-error modulo .mjs sem tipos
import { ensureCloudflared, expectedSha256, parseQuickTunnelUrl, sha256Hex } from '../lib/cloudflared.mjs';

const SAMPLE_LOG = `
2026-10-18T12:00:00Z INF Thank you for trying Cloudflare Tunnel. Doing so, without a Cloudflare account, is a quick way to experiment and try it out.
2026-10-18T12:00:00Z INF Requesting new quick Tunnel on trycloudflare.com...
2026-10-18T12:00:02Z INF +--------------------------------------------------------------------------------------------+
2026-10-18T12:00:02Z INF |  Your quick Tunnel has been created! Visit it at (it may take some time to be reachable):  |
2026-10-18T12:00:02Z INF |  https://blue-river-fast-cloud.trycloudflare.com                                           |
2026-10-18T12:00:02Z INF +--------------------------------------------------------------------------------------------+
`;

describe('parseQuickTunnelUrl', () => {
  it('extrai a URL do quick tunnel da saida simulada', () => {
    expect(parseQuickTunnelUrl(SAMPLE_LOG)).toBe('https://blue-river-fast-cloud.trycloudflare.com');
  });
  it('ignora api.trycloudflare.com e devolve null sem URL', () => {
    expect(parseQuickTunnelUrl('Requesting at https://api.trycloudflare.com/tunnel ...')).toBeNull();
    expect(parseQuickTunnelUrl('nada aqui')).toBeNull();
  });
  it('funciona com a saida chegando em pedacos (acumulada)', () => {
    const parts = ['INF |  https://blue-riv', 'er-fast-cloud.trycloudflare.com   |'];
    expect(parseQuickTunnelUrl(parts[0]!)).toBeNull();
    expect(parseQuickTunnelUrl(parts.join(''))).toBe('https://blue-river-fast-cloud.trycloudflare.com');
  });
});

describe('verificacao do cloudflared', () => {
  const bin = Buffer.from('MZ-binario-falso');
  const hash = sha256Hex(bin);
  const release = (digest?: string, body = '') => ({
    tag_name: '2026.10.1',
    body,
    assets: [
      {
        name: 'cloudflared-windows-amd64.exe',
        digest,
        browser_download_url: 'https://github.com/cloudflare/cloudflared/releases/download/2026.10.1/cloudflared-windows-amd64.exe',
      },
    ],
  });
  const fakeFetch = (rel: unknown, payload: Buffer) => async (url: string) =>
    url.includes('api.github.com') ? new Response(JSON.stringify(rel), { status: 200 }) : new Response(new Uint8Array(payload), { status: 200 });

  it('le o hash do campo digest ou das notas da versao', () => {
    expect(expectedSha256(release(`sha256:${hash}`))).toBe(hash);
    expect(expectedSha256(release(undefined, `cloudflared-windows-amd64.exe: ${hash}`))).toBe(hash);
    expect(expectedSha256(release())).toBeNull();
  });

  it('instala quando o SHA-256 confere', async () => {
    const dir = mkdtempSync(resolve(tmpdir(), 'wv-cf-'));
    try {
      const exe = resolve(dir, 'cloudflared.exe');
      await ensureCloudflared({ fetchImpl: fakeFetch(release(`sha256:${hash}`), bin) as never, log: () => undefined, exePath: exe });
      expect(readFileSync(exe)).toEqual(bin);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('recusa e NAO instala quando o hash difere ou nao e publicado', async () => {
    const dir = mkdtempSync(resolve(tmpdir(), 'wv-cf-'));
    try {
      const exe = resolve(dir, 'cloudflared.exe');
      await expect(
        ensureCloudflared({ fetchImpl: fakeFetch(release(`sha256:${hash}`), Buffer.from('adulterado')) as never, log: () => undefined, exePath: exe }),
      ).rejects.toThrow(/NAO confere/);
      expect(existsSync(exe)).toBe(false);
      await expect(ensureCloudflared({ fetchImpl: fakeFetch(release(), bin) as never, log: () => undefined, exePath: exe })).rejects.toThrow(/SHA-256/);
      expect(existsSync(exe)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
