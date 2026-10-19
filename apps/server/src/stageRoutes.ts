import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { IMAGE_ID_PATTERN, IMAGE_MIME_TYPES, STAGE_LIMITS, checkImageUpload, type ApiErrorBody } from '@workverse/shared';
import { authenticate, type AuthDeps } from './authRoutes';
import { can } from './authz';
import { KeyedLimiter } from './limiter';
import { normalizeName } from './world';
import type { Player } from './room';

export interface StageRouteOptions {
  /** Uploads per account: burst and refill per second. */
  limit?: { capacity: number; refillPerSecond: number };
}

function fail(reply: FastifyReply, status: number, code: string, message: string, retryAfterSeconds?: number) {
  if (retryAfterSeconds !== undefined) void reply.header('Retry-After', String(retryAfterSeconds));
  const body: ApiErrorBody = { error: { code, message, ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}) } };
  return reply.code(status).send(body);
}

/**
 * Slide images travel over HTTP, not the WebSocket: they are validated (signature, type, size, pixels), kept in
 * memory per stage room and served only to authenticated people who are in that room (the audience only while
 * the presentation is live), always as a download-safe image with `nosniff`.
 */
export function registerStageRoutes(app: FastifyInstance, deps: AuthDeps, opts: StageRouteOptions = {}) {
  const limiter = new KeyedLimiter(opts.limit?.capacity ?? 10, opts.limit?.refillPerSecond ?? 0.5);
  const devLogin = deps.allowDevLogin && !deps.secureCookies;

  // Raw bytes for the three accepted types. Anything else (svg, html, json...) is refused with 415 before it is read.
  app.addContentTypeParser([...IMAGE_MIME_TYPES], { parseAs: 'buffer', bodyLimit: STAGE_LIMITS.maxImageBytes + 1 }, (_req, body, done) => done(null, body));

  /** Account from the session cookie (or, in dev login only, the X-Dev-Name header). */
  function identify(req: FastifyRequest): string | undefined {
    const fromCookie = authenticate(deps, req.headers.cookie)?.account.id;
    if (fromCookie) return fromCookie;
    if (!devLogin) return undefined;
    const raw = req.headers['x-dev-name'];
    const name = typeof raw === 'string' ? normalizeName(raw) : null;
    const account = name ? deps.store.getByName(name) : undefined;
    return account && account.passwordHash === '' ? account.id : undefined;
  }

  function playerOf(accountId: string): Player | undefined {
    const p = deps.world.findPlayerByAccount(accountId);
    return p?.roomId ? p : undefined;
  }

  app.post(
    '/api/stage/image',
    {
      bodyLimit: STAGE_LIMITS.maxImageBytes + 1,
      // Before the body is read: an anonymous request must not make the server buffer megabytes (or even parse the body).
      onRequest: async (req, reply) => {
        if (!identify(req)) return fail(reply, 401, 'unauthorized', 'Sessão inválida ou expirada.');
      },
    },
    async (req, reply) => {
    void reply.header('Cache-Control', 'no-store');
    if (deps.allowedOrigins.length > 0) {
      const origin = req.headers.origin;
      if (!origin || !deps.allowedOrigins.includes(origin)) return fail(reply, 403, 'forbidden_origin', 'Origem não permitida.');
    }
    const accountId = identify(req);
    if (!accountId) return fail(reply, 401, 'unauthorized', 'Sessão inválida ou expirada.');
    const player = playerOf(accountId);
    if (!player) return fail(reply, 403, 'not_in_room', 'Você não está em uma sala.');
    if (!limiter.take(accountId, deps.clock())) {
      return fail(reply, 429, 'rate_limited', 'Muitos envios de imagem. Aguarde um pouco.', Math.max(1, limiter.retryAfterSeconds(accountId, deps.clock())));
    }
    // Isolation: the stage consulted is the one of the ORGANIZATION OF THE SESSION, never one named by the client.
    const stage = deps.world.org(player.orgId).stage;
    if (!can(deps.world.actorOf(player), 'stage.host', { orgId: player.orgId }).allow) {
      return fail(reply, 403, 'forbidden', 'Você não tem permissão para apresentar.');
    }
    const roomId = player.roomId;
    if (!roomId || !stage.hasPresentation(roomId)) return fail(reply, 409, 'not_stage_room', 'Aqui não há palco nem TV de apresentação.');
    if (stage.roleOf(roomId, player) !== 'speaker') return fail(reply, 403, 'not_speaker', 'Só quem está apresentando (palco ou TV) pode enviar slides.');
    const body = req.body;
    if (!Buffer.isBuffer(body)) return fail(reply, 415, 'unsupported_media_type', 'Envie a imagem como PNG, JPEG ou WebP.');
    const mime = String(req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
    const check = checkImageUpload(body, mime);
    if (!check.ok) return fail(reply, check.status, check.status === 413 ? 'payload_too_large' : 'bad_image', check.error);
    const stored = stage.addImage(roomId, Buffer.from(body), check.info.mime);
    if (!stored.ok) return fail(reply, stored.status, stored.status === 413 ? 'payload_too_large' : 'conflict', stored.error);
    return { id: stored.id, width: check.info.width, height: check.info.height, bytes: body.length };
    },
  );

  app.get<{ Params: { id: string } }>('/api/stage/image/:id', async (req, reply) => {
    const accountId = identify(req);
    if (!accountId) return fail(reply, 401, 'unauthorized', 'Sessão inválida ou expirada.');
    const player = playerOf(accountId);
    const id = req.params.id;
    if (!player || !player.roomId || !IMAGE_ID_PATTERN.test(id)) return fail(reply, 404, 'not_found', 'Imagem não encontrada.');
    if (!can(deps.world.actorOf(player), 'stage.attend', { orgId: player.orgId }).allow) return fail(reply, 404, 'not_found', 'Imagem não encontrada.');
    const image = deps.world.org(player.orgId).stage.getImage(player.roomId, player, id);
    if (!image) return fail(reply, 404, 'not_found', 'Imagem não encontrada.');
    return reply
      .header('Content-Type', image.mime)
      .header('X-Content-Type-Options', 'nosniff')
      .header('Content-Security-Policy', "default-src 'none'; sandbox")
      .header('Cross-Origin-Resource-Policy', 'same-origin')
      .header('Cache-Control', 'private, max-age=300')
      .send(image.bytes);
  });
}
