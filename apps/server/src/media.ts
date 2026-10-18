import type { FastifyInstance, FastifyReply } from 'fastify';
import { AccessToken, RoomServiceClient, TrackSource, type VideoGrant } from 'livekit-server-sdk';
import { DEFAULT_ORG_ID, type ApiErrorBody } from '@workverse/shared';
import { can } from './authz';
import { KeyedLimiter } from './limiter';
import { authenticate, type AuthDeps } from './authRoutes';
import { normalizeName } from './world';
import type { Player } from './room';
import type { PermissionSync, PublishRights, StageManager } from './stage';

export type { PublishRights } from './stage';

export type MediaKind = 'room' | 'stage';

export interface MediaConfig {
  enabled: boolean;
  /** URL that browsers use to reach LiveKit (PUBLIC_LIVEKIT_URL, falling back to LIVEKIT_URL). */
  url: string;
  apiKey: string;
  apiSecret: string;
  /** Token lifetime in seconds. The client renews before it ends. */
  ttlSeconds: number;
}

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
  return { enabled: Boolean(url && apiKey && apiSecret), url, apiKey, apiSecret, ttlSeconds: MEDIA_TOKEN_TTL_SECONDS };
}

/** Sources a participant may publish for each level of rights. */
export function sourcesFor(rights: PublishRights): TrackSource[] {
  if (rights === 'all') return [TrackSource.MICROPHONE, TrackSource.CAMERA, TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO];
  if (rights === 'audio') return [TrackSource.MICROPHONE];
  return [];
}

type StageLookup = Pick<StageManager, 'isStageRoom' | 'rightsOf'>;

/**
 * Who may publish audio/video/screen in a room. Normal rooms allow everyone; in an auditorium only the speaker
 * publishes everything and an audience member the speaker called on publishes the microphone only.
 * `kind: 'stage'` only makes sense where there is a stage.
 */
export function publishRights(roomId: string, player: Player, kind: MediaKind = 'room', stage?: StageLookup): PublishRights {
  if (stage?.isStageRoom(roomId)) return stage.rightsOf(roomId, player);
  return kind === 'stage' ? 'none' : 'all';
}

export function canPublishIn(roomId: string, player: Player, kind: MediaKind = 'room', stage?: StageLookup): boolean {
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
    const rights: PublishRights = body.canPublish === false ? 'none' : decided;
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
      expiresAt: deps.clock() + config.ttlSeconds * 1000,
    };
  });
}
