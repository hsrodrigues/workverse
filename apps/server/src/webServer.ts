import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyCompress from '@fastify/compress';

export interface WebOptions {
  /** Pasta do build do cliente (apps/client/dist). Se nao existir, so os cabecalhos de seguranca sao aplicados. */
  webRoot: string;
  production: boolean;
  /** URL do LiveKit vista pelo navegador (wss://...); entra no connect-src da CSP. */
  livekitUrl?: string;
}

/** Rotas que pertencem ao servidor: nunca caem no fallback do SPA. */
const SERVER_PREFIXES = ['/api/', '/ws', '/health', '/metrics'];
export const isServerPath = (url: string) => {
  const path = url.split('?')[0]!;
  return SERVER_PREFIXES.some((p) => (p.endsWith('/') ? path.startsWith(p) : path === p || path.startsWith(`${p}/`)));
};

/** Content-Security-Policy compativel com Phaser (blob/data), LiveKit (wss + worker blob) e Google Fonts. */
export function buildCsp(livekitUrl?: string): string {
  const connect = ["'self'", 'wss:'];
  if (livekitUrl) {
    try {
      const u = new URL(livekitUrl);
      const secure = u.protocol === 'wss:' || u.protocol === 'https:';
      connect.push(`${secure ? 'wss' : 'ws'}://${u.host}`, `${secure ? 'https' : 'http'}://${u.host}`);
    } catch {
      /* URL invalida: o bootConfig ja reclama */
    }
  }
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    `connect-src ${[...new Set(connect)].join(' ')}`,
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

export function securityHeaders(opts: Pick<WebOptions, 'production' | 'livekitUrl'>): Record<string, string> {
  return {
    'Content-Security-Policy': buildCsp(opts.livekitUrl),
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'microphone=(self), camera=(self), display-capture=(self), geolocation=(), payment=(), usb=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
    ...(opts.production ? { 'Strict-Transport-Security': 'max-age=31536000' } : {}),
  };
}

/**
 * Faz o servidor Node servir o site: cabecalhos de seguranca em todas as respostas, compressao,
 * arquivos estaticos com cache (assets com hash = 1 ano; index.html = no-cache) e fallback de SPA.
 */
export async function registerWeb(app: FastifyInstance, opts: WebOptions): Promise<{ serving: boolean; root: string }> {
  const headers = securityHeaders(opts);
  app.addHook('onRequest', async (_req, reply) => {
    for (const [k, v] of Object.entries(headers)) void reply.header(k, v);
  });

  const root = resolve(opts.webRoot);
  const serving = existsSync(resolve(root, 'index.html'));
  if (!serving) return { serving, root };

  await app.register(fastifyCompress, { global: true, encodings: ['gzip', 'deflate'], threshold: 1024 });
  await app.register(fastifyStatic, {
    root,
    index: ['index.html'],
    dotfiles: 'ignore',
    cacheControl: false,
    setHeaders: (reply, path) => {
      const p = path.replace(/\\/g, '/');
      if (p.endsWith('/index.html')) void reply.header('Cache-Control', 'no-cache');
      else if (p.includes('/assets/')) void reply.header('Cache-Control', 'public, max-age=31536000, immutable');
      else void reply.header('Cache-Control', 'public, max-age=3600');
    },
  });

  // Fallback de SPA: rotas do cliente (ex.: /invite/TOKEN) devolvem o index.html; o resto do servidor segue 404 em JSON.
  app.setNotFoundHandler((req, reply) => {
    if ((req.method === 'GET' || req.method === 'HEAD') && !isServerPath(req.url) && !/\.[a-z0-9]{1,8}$/i.test(req.url.split('?')[0]!)) {
      void reply.header('Cache-Control', 'no-cache');
      return reply.type('text/html; charset=utf-8').sendFile('index.html');
    }
    return reply.code(404).send({ error: { code: 'not_found', message: 'Não encontrado.' } });
  });
  return { serving, root };
}
