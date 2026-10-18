import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import websocket from '@fastify/websocket';
import type { WebSocket } from 'ws';
import type { ServerMessage } from '@workverse/shared';
import { World, type Connection } from './world';
import type { AccountStore } from './store';
import { AuthGuard, DEFAULT_AUTH_LIMITS, type AuthLimits } from './auth';
import { authenticate, originAllowed, registerAuthRoutes } from './authRoutes';
import { TokenBucket } from './limiter';
import { createLiveKitSync, registerMediaRoutes, resolveMediaConfig, type MediaConfig } from './media';
import { registerStageRoutes } from './stageRoutes';
import { registerOrgRoutes } from './orgRoutes';
import { registerAdminRoutes } from './adminRoutes';
import { registerPasswordRoutes } from './passwordRoutes';
import { registerStaffRoutes } from './staffRoutes';
import type { PermissionSync } from './stage';
import { ServerMetrics, registerMetricsRoute } from './metrics';
import type { RegistrationMode } from './registration';
import { registerWeb, type WebOptions } from './webServer';

export interface AppOptions {
  store: AccountStore;
  /** Accept name-only `hello` (ALLOW_DEV_LOGIN=1). Refused when running in production. */
  allowDevLogin?: boolean;
  /** Defaults to NODE_ENV === 'production'. Turns on the Secure cookie flag. */
  production?: boolean;
  /** Trust X-Forwarded-For (set when behind a reverse proxy) so rate limits see the real client IP. */
  trustProxy?: boolean | number;
  /** REGISTRATION_MODE; ausente = open. */
  registrationMode?: RegistrationMode;
  /** Serve o site (apps/client/dist) + cabecalhos de seguranca. Ausente = so API (testes, dev). */
  web?: WebOptions;
  authLimits?: Partial<AuthLimits>;
  /** Clock for sessions and auth rate limits (tests). */
  clock?: () => number;
  /** Comma separated allowed Origin values; empty means any origin (development only). */
  allowedOrigins?: string[];
  logger?: boolean;
  tickMs?: number;
  /** LiveKit settings; defaults to the LIVEKIT_* variables (and the `livekit-server --dev` keys outside production). */
  media?: MediaConfig;
  /** Overrides how publish-permission changes reach LiveKit (tests). */
  permissionSync?: PermissionSync;
  /** Bearer token for GET /metrics; defaults to METRICS_TOKEN. In production without a token /metrics is disabled. */
  metricsToken?: string;
  /** WebSocket abuse limits (see SocketLimits). */
  socketLimits?: Partial<SocketLimits>;
}

/** Per-connection / per-IP / per-account protection of the WebSocket endpoint. */
export interface SocketLimits {
  /** Simultaneous sockets from one IP (0 = unlimited). Default: 50 in production, unlimited in development (bots, load tests). */
  maxPerIp: number;
  /** Simultaneous sockets of one account (a newer `hello` already replaces the older session; this caps idle ones). */
  maxPerAccount: number;
  /** A socket that has not said `hello` by then is closed. */
  helloTimeoutMs: number;
  /** Messages per connection: burst and refill per second (ping included). */
  messageBurst: number;
  messagesPerSecond: number;
}

/** Ordinary messages are tiny; only the deck of slides may be bigger. */
const MAX_MESSAGE_BYTES = 4096;
const MAX_DECK_MESSAGE_BYTES = 200_000;

/** Invite links carry a secret in the path (`/api/invites/<token>`, `/invite/<token>`): it never goes to the access log. */
export const redactUrl = (url: string) => url.replace(/(\/invites?\/)[^/?#\s]+/g, '$1[redacted]');

/** Request line for the logs: no headers (cookies!), no query values, no invite tokens. */
const requestForLog = (r: { method?: string; url?: string; host?: string; ip?: string }) => ({
  method: r.method,
  url: redactUrl((r.url ?? '').split('?')[0]!),
  host: r.host,
  remoteAddress: r.ip,
});

export async function createApp(opts: AppOptions): Promise<{ app: FastifyInstance; world: World }> {
  const production = opts.production ?? process.env.NODE_ENV === 'production';
  const allowDevLogin = opts.allowDevLogin === true;
  if (production && allowDevLogin) {
    throw new Error('ALLOW_DEV_LOGIN must not be enabled when NODE_ENV=production.');
  }
  const clock = opts.clock ?? Date.now;
  const app = Fastify({ logger: opts.logger ? { serializers: { req: requestForLog } } : false, trustProxy: typeof opts.trustProxy === 'number' ? (opts.trustProxy > 0 ? (_addr: string, hop: number) => hop < (opts.trustProxy as number) : false) : (opts.trustProxy ?? false), bodyLimit: 4096 });
  const mediaConfig = opts.media ?? resolveMediaConfig(process.env, production);
  // Metrics (docs/monitoring.md) are fed by hooks on `log`, the socket layer and the tick below.
  let metrics: ServerMetrics | undefined;
  const log = (event: string, data?: Record<string, unknown>) => {
    metrics?.audit(event, data);
    app.log.info({ event, ...data }, 'audit');
  };
  const world = new World({
    store: opts.store,
    allowDevLogin,
    log,
    permissionSync: opts.permissionSync ?? createLiveKitSync(mediaConfig, log),
  });
  const allowed = opts.allowedOrigins ?? [];
  const limits: SocketLimits = {
    maxPerIp: production ? 50 : 0,
    maxPerAccount: 5,
    helloTimeoutMs: 10_000,
    messageBurst: 60,
    messagesPerSecond: 30,
    ...opts.socketLimits,
  };
  const socketsByIp = new Map<string, number>();
  const socketsByAccount = new Map<string, number>();
  const bump = (map: Map<string, number>, key: string, by: 1 | -1) => {
    const n = (map.get(key) ?? 0) + by;
    if (n <= 0) map.delete(key);
    else map.set(key, n);
  };
  const m = (metrics = new ServerMetrics(world));

  // ALLOW_DEV_LOGIN lets anyone in by typing a name: refuse requests that arrive through a proxy or tunnel
  // (Cloudflare, ngrok, nginx...), which means someone exposed a development server to the internet by mistake.
  if (allowDevLogin) {
    app.addHook('onRequest', async (req, reply) => {
      const h = req.headers;
      if (h['x-forwarded-for'] || h['x-forwarded-host'] || h['cf-connecting-ip'] || h['cf-ray'] || h.forwarded) {
        return reply.code(403).send({ error: { code: 'dev_login_not_public', message: 'ALLOW_DEV_LOGIN está ligado: este servidor não pode ser exposto à internet.' } });
      }
    });
  }
  registerMetricsRoute(app, m, { token: opts.metricsToken ?? process.env.METRICS_TOKEN, production });

  await app.register(websocket, { options: { maxPayload: MAX_DECK_MESSAGE_BYTES } });

  const guard = new AuthGuard({ ...DEFAULT_AUTH_LIMITS, ...opts.authLimits }, clock);
  const authDeps = { store: opts.store, world, guard, clock, secureCookies: production, allowDevLogin, allowedOrigins: allowed, registrationMode: opts.registrationMode };
  registerAuthRoutes(app, authDeps);
  registerPasswordRoutes(app, authDeps);
  registerStaffRoutes(app, authDeps);
  registerMediaRoutes(app, authDeps, { config: mediaConfig });
  registerStageRoutes(app, authDeps);
  registerOrgRoutes(app, authDeps);
  registerAdminRoutes(app, authDeps);

  // Keep malformed /api requests (bad JSON, oversized or wrong content type) in the API's error format.
  app.setErrorHandler((err: { statusCode?: number; message: string }, req, reply) => {
    const status = err.statusCode && err.statusCode >= 400 && err.statusCode < 500 ? err.statusCode : 500;
    if (status >= 500) req.log.error({ err }, 'request failed');
    if (!req.url.startsWith('/api/')) return reply.code(status).send(status >= 500 ? { error: 'Internal Server Error' } : err);
    const known: Record<number, [string, string]> = {
      400: ['bad_request', 'Requisição inválida.'],
      413: ['payload_too_large', 'Requisição grande demais.'],
      415: ['unsupported_media_type', 'Tipo de conteúdo não suportado.'],
    };
    const [code, message] = known[status] ?? (status >= 500 ? ['internal', 'Erro interno.'] : ['bad_request', 'Requisição inválida.']);
    return reply.code(status).send({ error: { code, message } });
  });

  // Public endpoint: aggregate numbers only, nothing that belongs to one organization (no per-room population).
  app.get('/health', async () => ({ ok: true, online: world.onlineCount }));

  const onSocket = (socket: WebSocket, req: FastifyRequest) => {
    const conn: Connection = {
      accountId: req.auth?.account.id,
      sessionHash: req.auth?.sessionHash,
      strikes: 0,
      send: (msg: ServerMessage) => {
        if (socket.readyState !== socket.OPEN) return;
        const json = JSON.stringify(msg);
        m.send(msg, json.length);
        socket.send(json);
      },
      close: (code, reason) => socket.close(code, reason),
    };
    m.connOpen();
    const ip = req.ip;
    const account = conn.accountId;
    bump(socketsByIp, ip, 1);
    if (account) bump(socketsByAccount, account, 1);
    // A socket that never says hello would otherwise sit there forever.
    const helloTimer = setTimeout(() => {
      if (!conn.player) socket.close(4008, 'hello timeout');
    }, limits.helloTimeoutMs);
    helloTimer.unref();
    const msgBucket = new TokenBucket(limits.messageBurst, limits.messagesPerSecond);
    let alive = true;
    socket.on('pong', () => {
      alive = true;
    });
    const heartbeat = setInterval(() => {
      if (!alive) {
        socket.terminate();
        return;
      }
      alive = false;
      socket.ping();
    }, 20_000);

    socket.on('message', (raw) => {
      let data: unknown;
      // Flood protection for EVERY message type (ping and pre-hello traffic included): excess is dropped, repeat offenders cut off.
      if (!msgBucket.take()) {
        m.error('oversize');
        conn.strikes++;
        if (conn.strikes >= 20) socket.close(1008, 'flood');
        return;
      }
      const size = Array.isArray(raw) ? raw.reduce((n, b) => n + b.length, 0) : (raw as Buffer | ArrayBuffer).byteLength;
      try {
        data = JSON.parse(raw.toString());
      } catch {
        m.error('parse');
        conn.strikes++;
        if (conn.strikes >= 20) socket.close(1008, 'invalid');
        return;
      }
      m.recv((data as { t?: unknown } | null)?.t, size);
      if (size > MAX_MESSAGE_BYTES && (data as { t?: unknown } | null)?.t !== 'deck_set') {
        m.error('oversize');
        conn.strikes++;
        conn.send({ t: 'error', code: 'bad_message', message: 'Mensagem grande demais.' });
        if (conn.strikes >= 20) socket.close(1008, 'invalid');
        return;
      }
      const t0 = performance.now();
      try {
        world.handle(conn, data);
        m.handled((data as { t?: unknown } | null)?.t, performance.now() - t0);
      } catch (err) {
        m.error('handler');
        app.log.error({ err }, 'message handler failed');
        conn.send({ t: 'error', code: 'internal', message: 'Erro interno.' });
      }
    });
    socket.on('close', () => {
      clearInterval(heartbeat);
      clearTimeout(helloTimer);
      bump(socketsByIp, ip, -1);
      if (account) bump(socketsByAccount, account, -1);
      m.connClose();
      world.disconnect(conn);
    });
    socket.on('error', (err) => {
      m.error('socket');
      app.log.warn({ err }, 'socket error');
    });
  };

  // Authentication happens before the upgrade: no valid session cookie, no WebSocket.
  app.get(
    '/ws',
    {
      websocket: true,
      preValidation: async (req, reply) => {
        if (!originAllowed(req.headers, authDeps)) {
          return reply.code(403).send({ error: { code: 'forbidden_origin', message: 'Origem não permitida.' } });
        }
        req.auth = authenticate(authDeps, req.headers.cookie);
        if (!req.auth && !allowDevLogin) {
          return reply.code(401).send({ error: { code: 'unauthorized', message: 'Faça login para entrar.' } });
        }
        const tooMany = { error: { code: 'too_many_connections', message: 'Conexões demais. Feche outras abas e tente de novo.' } };
        if (limits.maxPerIp > 0 && (socketsByIp.get(req.ip) ?? 0) >= limits.maxPerIp) return reply.code(429).header('Retry-After', '30').send(tooMany);
        if (req.auth && (socketsByAccount.get(req.auth.account.id) ?? 0) >= limits.maxPerAccount) return reply.code(429).header('Retry-After', '30').send(tooMany);
      },
    },
    onSocket,
  );

  const timer = setInterval(() => {
    const t0 = performance.now();
    world.tick();
    m.tick(performance.now() - t0);
  }, opts.tickMs ?? 100);
  timer.unref();
  const sweeper = setInterval(() => opts.store.deleteExpiredSessions(clock()), 60 * 60_000);
  sweeper.unref();
  app.addHook('onClose', async () => {
    clearInterval(timer);
    clearInterval(sweeper);
    m.stop();
  });

  if (opts.web) await registerWeb(app, opts.web);

  return { app, world };
}
