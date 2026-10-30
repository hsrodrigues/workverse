import type { FastifyInstance, FastifyReply } from 'fastify';
import { AccessToken, RoomServiceClient, TrackSource, TrackType, WebhookReceiver, type VideoGrant, type WebhookEvent } from 'livekit-server-sdk';
import { DEFAULT_ORG_ID, type ApiErrorBody } from '@workverse/shared';
import { can } from './authz';
import { KeyedLimiter } from './limiter';
import { authenticate, type AuthDeps } from './authRoutes';
import { normalizeName } from './world';
import type { Player } from './room';
import type { PermissionSync, PublishRights } from './stage';
import { publishRights, resolveEconomyConfig, type LkEvent, type LkSource, type MediaKind } from './mediaEconomy';

export type { PublishRights } from './stage';
export { publishRights, type MediaKind };

export interface MediaConfig {
  enabled: boolean;
  /** URL that browsers use to reach LiveKit (PUBLIC_LIVEKIT_URL, falling back to LIVEKIT_URL). */
  url: string;
  apiKey: string;
  apiSecret: string;
  /** Token lifetime in seconds. The client renews before it ends. */
  ttlSeconds: number;
}

/** Padrao sem a economia (MEDIA_ECONOMY=off). Com a economia ligada o token dura 30 min (MEDIA_TOKEN_TTL_SECONDS). */
export const MEDIA_TOKEN_TTL_SECONDS = 600;
/** LiveKit room of an (organization, room) pair: `wv:${orgId}:${roomId}`. Without an org (legacy callers): `wv:${roomId}`. */
export const livekitRoomName = (roomId: string, orgId?: string) => (orgId ? `wv:${orgId}:${roomId}` : `wv:${roomId}`);

/**
 * Reads LIVEKIT_* variables. Outside production, missing values fall back to the
 * `livekit-server --dev` defaults (devkey/secret on ws://localhost:7880); in production
 * everything must be set explicitly or media stays disabled.
 */
export function resolveMediaConfig(env: NodeJS.ProcessEnv = process.env, production = false): MediaConfig {
  const dev = !production;
  const url = (env.PUBLIC_LIVEKIT_URL || env.LIVEKIT_URL || (dev ? 'ws://localhost:7880' : '')).trim();
  const apiKey = (env.LIVEKIT_API_KEY || (dev ? 'devkey' : '')).trim();
  const apiSecret = (env.LIVEKIT_API_SECRET || (dev ? 'secret' : '')).trim();
  return { enabled: Boolean(url && apiKey && apiSecret), url, apiKey, apiSecret, ttlSeconds: resolveEconomyConfig(env).tokenTtlSeconds };
}

/** Sources a participant may publish for each level of rights. */
export function sourcesFor(rights: PublishRights): TrackSource[] {
  if (rights === 'all') return [TrackSource.MICROPHONE, TrackSource.CAMERA, TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO];
  if (rights === 'av') return [TrackSource.MICROPHONE, TrackSource.CAMERA];
  if (rights === 'audio') return [TrackSource.MICROPHONE];
  return [];
}

export function canPublishIn(roomId: string, player: Player, kind: MediaKind = 'room', stage?: Parameters<typeof publishRights>[3]): boolean {
  return publishRights(roomId, player, kind, stage) !== 'none';
}

/**
 * Pushes rights changes to people already inside the LiveKit room (`updateParticipant`; LiveKit unpublishes tracks
 * that are no longer allowed). The latest rights win on retries, and the retries cover someone who was still
 * connecting when the role changed. Failures are logged, never thrown: the token of the next connection is correct anyway.
 */
export function createLiveKitSync(config: MediaConfig, log: (event: string, data?: Record<string, unknown>) => void = () => undefined): PermissionSync {
  if (!config.enabled) return () => undefined;
  const client = new RoomServiceClient(config.url.replace(/^ws/i, 'http'), config.apiKey, config.apiSecret);
  const latest = new Map<string, PublishRights>();
  const apply = async (roomId: string, identity: string, orgId?: string) => {
    const rights = latest.get(`${orgId ?? ''}:${roomId}:${identity}`);
    if (!rights) return;
    try {
      await client.updateParticipant(livekitRoomName(roomId, orgId), identity, undefined, {
        canSubscribe: true,
        canPublish: rights !== 'none',
        canPublishData: false,
        canPublishSources: sourcesFor(rights),
      });
    } catch (err) {
      // Not connected (yet) is expected; anything else is worth a log line.
      log('livekit.sync_failed', { room: roomId, identity, error: err instanceof Error ? err.message : String(err) });
    }
  };
  return (roomId, identity, rights, orgId) => {
    latest.set(`${orgId ?? ''}:${roomId}:${identity}`, rights);
    void apply(roomId, identity, orgId);
    for (const ms of [1500, 5000]) setTimeout(() => void apply(roomId, identity, orgId), ms).unref();
    if (latest.size > 5000) latest.clear();
  };
}

/**
 * Throws a person out of the LiveKit room (access to the room revoked). Their token cannot be renewed anyway: the token route
 * refuses anybody who may not be in the room. Failures are logged, never thrown.
 */
export function createLiveKitRemover(config: MediaConfig, log: (event: string, data?: Record<string, unknown>) => void = () => undefined): (orgId: string, roomId: string, identity: string) => void {
  if (!config.enabled) return () => undefined;
  const client = new RoomServiceClient(config.url.replace(/^ws/i, 'http'), config.apiKey, config.apiSecret);
  return (orgId, roomId, identity) => {
    client.removeParticipant(livekitRoomName(roomId, orgId), identity).catch((err) => {
      // "Not connected" is the normal case for people without media on.
      log('livekit.remove_failed', { room: roomId, identity, error: err instanceof Error ? err.message : String(err) });
    });
  };
}

/** Corpo maximo aceito no webhook (os eventos reais tem poucos KB). */
export const WEBHOOK_BODY_LIMIT = 32 * 1024;

/** Fonte de uma faixa para o servidor: tela (e audio da tela) = `screen`; fonte desconhecida cai pelo tipo (video = camera). */
function lkSource(source: TrackSource | undefined, type: TrackType | undefined): LkSource | undefined {
  if (source === TrackSource.MICROPHONE) return 'mic';
  if (source === TrackSource.CAMERA) return 'cam';
  if (source === TrackSource.SCREEN_SHARE || source === TrackSource.SCREEN_SHARE_AUDIO) return 'screen';
  if (type === TrackType.VIDEO) return 'cam';
  if (type === TrackType.AUDIO) return 'mic';
  return undefined;
}

const toMs = (v: bigint | number | undefined) => (v === undefined ? 0 : Number(v) * 1000);

/** Reduz o evento verificado do SDK ao que a economia de midia usa. */
export function toLkEvent(ev: WebhookEvent): LkEvent {
  const tracks: NonNullable<LkEvent['tracks']> = [];
  for (const t of ev.participant?.tracks ?? []) {
    const source = lkSource(t.source, t.type);
    if (source && t.sid) tracks.push({ sid: t.sid, source });
  }
  const source = lkSource(ev.track?.source, ev.track?.type);
  return {
    id: ev.id,
    event: ev.event,
    createdAt: toMs(ev.createdAt),
    room: ev.room?.name ?? '',
    ...(ev.participant?.identity ? { identity: ev.participant.identity } : {}),
    ...(ev.participant?.joinedAt ? { joinedAt: toMs(ev.participant.joinedAt) } : {}),
    ...(ev.track?.sid ? { trackSid: ev.track.sid } : {}),
    ...(source ? { source } : {}),
    ...(tracks.length ? { tracks } : {}),
  };
}

export interface MediaOptions {
  config?: MediaConfig;
  /** Overrides the policy with a yes/no (tests). */
  canPublishIn?: (roomId: string, player: Player, kind: MediaKind) => boolean;
  /** Overrides the policy with a level of rights (tests). */
  publishRights?: (roomId: string, player: Player, kind: MediaKind) => PublishRights;
  /** Token requests per account: burst and refill per second. */
  limit?: { capacity: number; refillPerSecond: number };
}

function fail(reply: FastifyReply, status: number, code: string, message: string, retryAfterSeconds?: number) {
  if (retryAfterSeconds !== undefined) void reply.header('Retry-After', String(retryAfterSeconds));
  const body: ApiErrorBody = { error: { code, message, ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}) } };
  return reply.code(status).send(body);
}

/** The live player of an account, wherever it is. */
function findPlayer(deps: Pick<AuthDeps, 'world'>, accountId: string): Player | undefined {
  const p = deps.world.findPlayerByAccount(accountId);
  return p?.roomId ? p : undefined;
}

export function registerMediaRoutes(app: FastifyInstance, deps: AuthDeps, opts: MediaOptions = {}) {
  const config = opts.config ?? resolveMediaConfig(process.env, deps.secureCookies);
  const limiter = new KeyedLimiter(opts.limit?.capacity ?? 12, opts.limit?.refillPerSecond ?? 0.2);
  // Name-only identification exists only with ALLOW_DEV_LOGIN, and never in production.
  const devLogin = deps.allowDevLogin && !deps.secureCookies;

  app.get('/api/media/config', async (_req, reply) => {
    void reply.header('Cache-Control', 'no-store');
    return config.enabled ? { enabled: true, url: config.url } : { enabled: false, url: '' };
  });

  // Webhook do LiveKit (docs/media-economy.md): chamado pelo servidor do LiveKit, nunca por navegador. Corpo cru `application/webhook+json`
  // verificado com a mesma chave da API (JWT + sha256 do corpo); tudo que nao verifica e recusado. Sem CORS e sem aceitar `Origin`.
  const receiver = config.enabled ? new WebhookReceiver(config.apiKey, config.apiSecret) : undefined;
  const hookLimiter = new KeyedLimiter(60, 5);
  void app.register(async (scope) => {
    scope.addContentTypeParser('application/webhook+json', { parseAs: 'string', bodyLimit: WEBHOOK_BODY_LIMIT }, (_req, body, done) => done(null, body));
    scope.post('/api/media/webhook', { bodyLimit: WEBHOOK_BODY_LIMIT }, async (req, reply) => {
      void reply.header('Cache-Control', 'no-store');
      if (!receiver) return fail(reply, 503, 'media_disabled', 'Mídia indisponível neste servidor.');
      if (req.headers.origin !== undefined) return fail(reply, 403, 'forbidden_origin', 'Origem não permitida.');
      const now = deps.clock();
      if (!hookLimiter.take(req.ip, now)) return fail(reply, 429, 'rate_limited', 'Muitas solicitações.', Math.max(1, hookLimiter.retryAfterSeconds(req.ip, now)));
      let event: WebhookEvent;
      try {
        if (typeof req.body !== 'string' || !req.headers.authorization) throw new Error('missing');
        event = await receiver.receive(req.body, req.headers.authorization);
      } catch {
        // Quem erra a assinatura gasta mais do balde: tentativa de adivinhar nao compensa.
        hookLimiter.take(req.ip, now);
        hookLimiter.take(req.ip, now);
        app.log.warn({ event: 'media.webhook_rejected', ip: req.ip }, 'webhook do LiveKit recusado (assinatura invalida)');
        return fail(reply, 401, 'unauthorized', 'Assinatura inválida.');
      }
      const result = deps.world.media.webhook(toLkEvent(event), now);
      return { ok: true, result };
    });
  });
  if (config.enabled) app.log.info({ event: 'media.webhook_pending' }, 'LiveKit: webhook nao confirmado (contagem estimada) ate chegar o primeiro evento em /api/media/webhook; veja docs/media-economy.md');

  app.post('/api/media/token', { bodyLimit: 2048 }, async (req, reply) => {
    void reply.header('Cache-Control', 'no-store');
    if (deps.allowedOrigins.length > 0) {
      const origin = req.headers.origin;
      if (!origin || !deps.allowedOrigins.includes(origin)) return fail(reply, 403, 'forbidden_origin', 'Origem não permitida.');
    }
    const body = (typeof req.body === 'object' && req.body !== null ? req.body : {}) as Record<string, unknown>;

    let accountId: string | undefined = authenticate(deps, req.headers.cookie)?.account.id;
    if (!accountId && devLogin && typeof body.devName === 'string') {
      const name = normalizeName(body.devName);
      const account = name ? deps.store.getByName(name) : undefined;
      // Password accounts are never reachable through the name-only path.
      if (account && account.passwordHash === '') accountId = account.id;
    }
    if (!accountId) return fail(reply, 401, 'unauthorized', 'Sessão inválida ou expirada.');

    if (!limiter.take(accountId, deps.clock())) {
      return fail(reply, 429, 'rate_limited', 'Muitas solicitações de mídia. Aguarde um pouco.', Math.max(1, limiter.retryAfterSeconds(accountId, deps.clock())));
    }
    if (!config.enabled) return fail(reply, 503, 'media_disabled', 'Mídia indisponível neste servidor.');

    const roomId = body.roomId;
    if (typeof roomId !== 'string' || roomId.length === 0 || roomId.length > 64) return fail(reply, 400, 'bad_request', 'Informe a sala.');
    // Isolation: the organization comes from the live session of the account, never from the request.
    const player = findPlayer(deps, accountId);
    const orgWorld = deps.world.org(player?.orgId || DEFAULT_ORG_ID);
    if (!orgWorld.rooms.has(roomId)) return fail(reply, 404, 'room_not_found', 'Sala inexistente.');
    const kind: MediaKind = body.kind === 'stage' ? 'stage' : 'room';
    if (body.kind !== undefined && body.kind !== 'room' && body.kind !== 'stage') return fail(reply, 400, 'bad_request', 'Tipo de mídia inválido.');

    // Isolation: only the room the player is in right now.
    if (!player || player.roomId !== roomId) return fail(reply, 403, 'not_in_room', 'Você não está nessa sala.');
    // Access to the room itself (team / invitation / guests): a revoked person gets no new token.
    if (!deps.world.canEnter(player, roomId).allow) return fail(reply, 403, 'forbidden_room', 'Você não tem acesso a essa sala.');
    const decision = can(deps.world.actorOf(player), 'media.use', { orgId: orgWorld.id, guestAllowed: orgWorld.rooms.get(roomId)!.built.def.guestAllowed === true });
    if (!decision.allow) return fail(reply, 403, 'forbidden', 'Você não tem permissão para usar mídia aqui.');

    // The server decides; the client's `canPublish` can only ask for less.
    const decided: PublishRights = opts.publishRights
      ? opts.publishRights(roomId, player, kind)
      : opts.canPublishIn
        ? opts.canPublishIn(roomId, player, kind)
          ? 'all'
          : 'none'
        : publishRights(roomId, player, kind, orgWorld.stage);
    const asked: PublishRights = body.canPublish === false ? 'none' : decided;
    // Economia de midia (mediaEconomy.ts): cota mensal, sala cheia, modo economia e limite de video, tudo decidido aqui.
    const eco = deps.world.media;
    const presentation = orgWorld.stage.hasPresentation(roomId);
    const presenter = presentation && orgWorld.stage.roleOf(roomId, player) === 'speaker';
    const gate = eco.gate(player, orgWorld.id, roomId, { presenter });
    if (!gate.ok) return fail(reply, gate.status, gate.code, gate.message, gate.retryAfterSeconds);
    const granted = eco.grant(player, orgWorld.id, roomId, kind, asked, { presenter, presentation }, config.ttlSeconds);
    const rights: PublishRights = granted.rights;
    const canPublish = rights !== 'none';
    const grant: VideoGrant = {
      roomJoin: true,
      room: livekitRoomName(roomId, orgWorld.id),
      canSubscribe: true,
      canPublish,
      canPublishData: false,
      canUpdateOwnMetadata: false,
      canPublishSources: sourcesFor(rights),
    };
    const at = new AccessToken(config.apiKey, config.apiSecret, { identity: player.id, name: player.name, ttl: config.ttlSeconds });
    at.addGrant(grant);
    const token = await at.toJwt();
    return {
      token,
      url: config.url,
      identity: player.id,
      roomName: grant.room,
      canPublish,
      rights,
      ...(granted.notice ? { notice: granted.notice } : {}),
      strict: eco.strict,
      expiresAt: deps.clock() + config.ttlSeconds * 1000,
    };
  });
}
