import http from 'node:http';
import type { AddressInfo } from 'node:net';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import {
  POWERPOINT_EXPORT_LIMITS,
  type BlankKind,
  type ConnectorErrorCode,
  type ExportFormat,
  type PointerMode,
  type PresentationStatus,
  type ShowMode,
} from '@workverse/shared';
import { AdapterError, type PresentationAdapter } from './adapter';
import { ExportManager } from './exports';
import { TokenBucket, hostAllowed, newPairCode, newSecret, safeEqual } from './security';

export interface ConnectorOptions {
  adapter: PresentationAdapter;
  /** Exact origins (scheme://host:port) allowed to call the connector from a browser. */
  origins: string[];
  /** 0 = pick a free port (tests). */
  port?: number;
  /** Fixed values for tests; random by default. */
  pairCode?: string;
  secret?: string;
  /** Folder for exported images; a private random one inside the OS temp folder by default. */
  exportRoot?: string;
  log?: (line: string) => void;
  now?: () => number;
  /** Requests per second the whole connector accepts (burst = 2x). */
  ratePerSecond?: number;
  /** Wrong pairing codes tolerated per minute before the code is changed. */
  maxPairFailures?: number;
}

export interface Connector {
  readonly server: http.Server;
  /** Current pairing code; changes after too many wrong attempts. */
  pairCode(): string;
  readonly port: number;
  readonly exportRoot: string;
  close(): Promise<void>;
}

const MAX_BODY = 2048;
const JSON_TYPE = 'application/json';

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: ConnectorErrorCode,
    message: string,
    readonly retryAfter?: number,
  ) {
    super(message);
  }
}

const STATUS_FOR_CODE: Partial<Record<ConnectorErrorCode, number>> = {
  bad_request: 400,
  no_powerpoint: 409,
  no_presentation: 409,
  no_show: 409,
  protected_view: 409,
  busy: 503,
  unsupported: 501,
  timeout: 504,
  cancelled: 409,
};

const SHOW_MODES: ShowMode[] = ['fullscreen', 'window'];
const POINTERS: PointerMode[] = ['arrow', 'pen', 'laser', 'hidden', 'erase'];
const BLANKS: BlankKind[] = ['black', 'white'];
const FORMATS: ExportFormat[] = ['png', 'jpeg'];

export async function startConnector(opts: ConnectorOptions): Promise<Connector> {
  const now = opts.now ?? Date.now;
  const log = opts.log ?? (() => undefined);
  const origins = new Set(opts.origins);
  const secret = opts.secret ?? newSecret();
  let code = opts.pairCode ?? newPairCode();
  const maxFailures = opts.maxPairFailures ?? 5;
  const rate = new TokenBucket((opts.ratePerSecond ?? 30) * 2, opts.ratePerSecond ?? 30, now);
  const pairFailures: number[] = [];
  let totalPairFailures = 0;
  const authFailures = new TokenBucket(20, 20 / 60, now);

  const exportRoot = opts.exportRoot ?? path.join(os.tmpdir(), `workverse-connector-${randomBytes(6).toString('hex')}`);
  await fs.mkdir(exportRoot, { recursive: true });
  const adapter = opts.adapter;
  const exportsMgr = new ExportManager(adapter, exportRoot, log);

  let port = opts.port ?? 0;
  let lastKey = '';
  let lastTotal = 0;

  function corsHeaders(origin: string | undefined): Record<string, string> {
    if (!origin || !origins.has(origin)) return {};
    return {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Allow-Private-Network': 'true',
      'Access-Control-Max-Age': '600',
      Vary: 'Origin',
    };
  }

  function send(res: http.ServerResponse, status: number, body: unknown, extra: Record<string, string> = {}) {
    const payload = JSON.stringify(body);
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(payload),
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...extra,
    });
    res.end(payload);
  }

  async function readJson(req: http.IncomingMessage): Promise<Record<string, unknown>> {
    const type = String(req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
    const declared = Number(req.headers['content-length'] ?? 0);
    if (declared > MAX_BODY) throw new HttpError(413, 'payload_too_large', 'Corpo grande demais.');
    if (declared === 0 && !req.headers['transfer-encoding']) return {};
    if (type !== JSON_TYPE) throw new HttpError(415, 'unsupported_media_type', 'Use application/json.');
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const c of req) {
      size += (c as Buffer).length;
      if (size > MAX_BODY) throw new HttpError(413, 'payload_too_large', 'Corpo grande demais.');
      chunks.push(c as Buffer);
    }
    if (size === 0) return {};
    try {
      const v = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
      if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new Error('shape');
      return v as Record<string, unknown>;
    } catch {
      throw new HttpError(400, 'bad_request', 'JSON inválido.');
    }
  }

  const oneOf = <T extends string>(v: unknown, list: readonly T[], fallback?: T): T => {
    if (v === undefined && fallback !== undefined) return fallback;
    if (typeof v === 'string' && (list as readonly string[]).includes(v)) return v as T;
    throw new HttpError(400, 'bad_request', 'Valor inválido.');
  };
  const intIn = (v: unknown, min: number, max: number): number => {
    if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) throw new HttpError(400, 'bad_request', 'Número inválido.');
    return v;
  };

  async function fullStatus(): Promise<PresentationStatus> {
    const s = await adapter.status();
    if (s.presentation) {
      lastKey = `${s.presentation.name}|${s.presentation.slides}`;
      lastTotal = s.presentation.slides;
      exportsMgr.ensureThumbs(lastKey, lastTotal);
    } else {
      lastKey = '';
      lastTotal = 0;
    }
    return { ...s, thumbs: exportsMgr.thumbsInfo(), capabilities: adapter.capabilities };
  }

  /** Runs an action and answers with the fresh status, so the interface updates without another round trip. */
  async function act(res: http.ServerResponse, cors: Record<string, string>, fn: () => Promise<unknown>) {
    await fn();
    send(res, 200, { ok: true, status: await fullStatus() }, cors);
  }

  async function route(req: http.IncomingMessage, res: http.ServerResponse, cors: Record<string, string>, url: URL) {
    const method = req.method ?? 'GET';
    const p = url.pathname;

    if (method === 'POST' && p === '/v1/pair') {
      const origin = req.headers.origin;
      if (!origin) throw new HttpError(403, 'forbidden_origin', 'Origem não permitida.');
      const recent = pairFailures.filter((t) => now() - t < 60_000);
      pairFailures.length = 0;
      pairFailures.push(...recent);
      if (recent.length >= maxFailures) throw new HttpError(429, 'rate_limited', 'Muitas tentativas. Aguarde um minuto.', 60);
      const body = await readJson(req);
      if (typeof body.code !== 'string' || !safeEqual(body.code.replace(/\s+/g, ''), code)) {
        pairFailures.push(now());
        totalPairFailures++;
        if (totalPairFailures >= maxFailures * 3) {
          code = newPairCode();
          totalPairFailures = 0;
          pairFailures.length = 0;
          log('Código de pareamento trocado após muitas tentativas erradas. Veja o novo código no console.');
        }
        throw new HttpError(401, 'unauthorized', 'Código incorreto. Confira o código mostrado no console do conector.');
      }
      log('Navegador pareado.');
      return send(res, 200, { token: secret }, cors);
    }

    // Everything else needs the token.
    const auth = String(req.headers.authorization ?? '');
    const given = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    if (!given || !safeEqual(given, secret)) {
      if (!authFailures.take()) throw new HttpError(429, 'rate_limited', 'Muitas tentativas.', 30);
      throw new HttpError(401, 'unauthorized', 'Conexão não autorizada. Pareie novamente com o código do conector.');
    }

    if (method === 'GET' && p === '/v1/status') return send(res, 200, await fullStatus(), cors);

    if (method === 'GET' && p === '/v1/export') return send(res, 200, exportsMgr.progress(), cors);

    const slide = /^\/v1\/slides\/(\d{1,3})\/(thumb|full)$/.exec(p);
    if (method === 'GET' && slide) {
      const file = await exportsMgr.read(slide[2] === 'thumb' ? 'thumb' : 'full', Number(slide[1]));
      if (!file) throw new HttpError(404, 'not_found', 'Imagem ainda não disponível.');
      res.writeHead(200, {
        'Content-Type': file.mime,
        'Content-Length': file.bytes.length,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        ...cors,
      });
      return void res.end(file.bytes);
    }

    if (method !== 'POST') throw new HttpError(404, 'not_found', 'Rota inexistente.');
    const body = await readJson(req);

    switch (p) {
      case '/v1/open':
        return send(res, 200, { opened: await adapter.openWithDialog(), status: await fullStatus() }, cors);
      case '/v1/start': {
        const mode = oneOf(body.mode, SHOW_MODES, 'fullscreen');
        const from = body.from === undefined ? undefined : intIn(body.from, 1, 5000);
        return act(res, cors, () => adapter.start(mode, from));
      }
      case '/v1/next':
        return act(res, cors, () => adapter.next());
      case '/v1/prev':
        return act(res, cors, () => adapter.previous());
      case '/v1/first':
        return act(res, cors, () => adapter.first());
      case '/v1/last':
        return act(res, cors, () => adapter.last());
      case '/v1/goto': {
        const index = intIn(body.index, 1, 5000);
        return act(res, cors, () => adapter.goto(index));
      }
      case '/v1/blank': {
        const kind = oneOf(body.kind, BLANKS, 'black');
        return act(res, cors, () => adapter.blank(kind));
      }
      case '/v1/pointer': {
        const mode = oneOf(body.mode, POINTERS);
        return act(res, cors, () => adapter.pointer(mode));
      }
      case '/v1/end':
        return act(res, cors, () => adapter.end());
      case '/v1/thumbs': {
        await fullStatus();
        if (lastKey) exportsMgr.refreshThumbs(lastKey, lastTotal);
        return send(res, 200, { ok: true }, cors);
      }
      case '/v1/export': {
        const width = body.width === undefined ? 1600 : intIn(body.width, POWERPOINT_EXPORT_LIMITS.minWidth, POWERPOINT_EXPORT_LIMITS.maxWidth);
        const format = oneOf(body.format, FORMATS, 'png');
        await fullStatus();
        if (!lastKey) throw new HttpError(409, 'no_presentation', 'Nenhuma apresentação aberta no PowerPoint. Use "Abrir apresentação…".');
        return send(res, 200, exportsMgr.startFull(lastKey, lastTotal, width, format), cors);
      }
      default:
        throw new HttpError(404, 'not_found', 'Rota inexistente.');
    }
  }

  const server = http.createServer((req, res) => {
    const origin = typeof req.headers.origin === 'string' ? req.headers.origin : undefined;
    const cors = corsHeaders(origin);
    const started = now();
    const done = (status: number) => log(`${req.method} ${(req.url ?? '').split('?')[0].replace(/\d{1,3}/g, '#')} ${status} ${now() - started}ms`);
    const fail = (e: unknown) => {
      if (res.headersSent) return res.end();
      if (e instanceof HttpError) {
        done(e.status);
        return send(res, e.status, { error: { code: e.code, message: e.message, ...(e.retryAfter ? { retryAfterSeconds: e.retryAfter } : {}) } }, { ...cors, ...(e.retryAfter ? { 'Retry-After': String(e.retryAfter) } : {}) });
      }
      if (e instanceof AdapterError) {
        const status = STATUS_FOR_CODE[e.code] ?? 500;
        done(status);
        return send(res, status, { error: { code: e.code, message: e.message } }, cors);
      }
      done(500);
      return send(res, 500, { error: { code: 'internal', message: 'Erro interno do conector.' } }, cors);
    };

    // 1) DNS rebinding: only the loopback names with our port.
    if (!hostAllowed(req.headers.host, (server.address() as AddressInfo).port)) {
      done(403);
      return send(res, 403, { error: { code: 'forbidden_host', message: 'Host não permitido.' } });
    }
    // 2) Browsers: the origin must be on the list (requests without Origin, such as curl, still need the token).
    if (origin !== undefined && !origins.has(origin)) {
      done(403);
      return send(res, 403, { error: { code: 'forbidden_origin', message: 'Origem não permitida. Inicie o conector com --origin <endereço do WorkVerse>.' } });
    }
    // 3) Preflight (never needs the token; only says what is allowed).
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { ...cors, 'Content-Length': '0', 'Cache-Control': 'no-store' });
      done(204);
      return void res.end();
    }
    // 4) Rate limit for everything else.
    if (!rate.take()) {
      done(429);
      return send(res, 429, { error: { code: 'rate_limited', message: 'Muitos pedidos. Aguarde um instante.', retryAfterSeconds: rate.retryAfterSeconds() } }, { ...cors, 'Retry-After': String(rate.retryAfterSeconds()) });
    }
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    route(req, res, cors, url).then(
      () => done(res.statusCode),
      fail,
    );
  });
  server.requestTimeout = 120_000;
  server.headersTimeout = 10_000;

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  port = (server.address() as AddressInfo).port;

  return {
    server,
    pairCode: () => code,
    port,
    exportRoot,
    async close() {
      await new Promise<void>((r) => {
        server.close(() => r());
        server.closeAllConnections();
      });
      await exportsMgr.cleanup();
      await adapter.dispose();
    },
  };
}
