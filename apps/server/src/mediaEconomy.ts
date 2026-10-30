import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  DEFAULT_MEDIA_POLICY,
  DEFAULT_MONTHLY_MINUTES,
  MEDIA_TEXT,
  monthKey,
  quotaLevel,
  quotaPercent,
  SILENT_ROOM_IDS,
  staffCan,
  type MediaActive,
  type MediaPolicy,
  type MediaReport,
  type MediaUsageView,
  type QuotaLevel,
} from '@workverse/shared';
import type { Player } from './room';
import type { PublishRights, StageManager } from './stage';

/**
 * Economia de midia (docs/media-economy.md). O LiveKit Cloud gratuito cobra MINUTOS DE PARTICIPANTE (5.000/mes) e SAIDA de dados
 * (50 GB): quem fica conectado a sala gasta minutos mesmo calado. Este modulo, dono do servidor autoritativo, decide:
 *  - quem conectou a chamada de cada sala e quem esta PUBLICANDO (relatos `media_report` dos clientes, validados e com prazo);
 *  - os limites na emissao do token: pessoas por sala, publicadores de VIDEO simultaneos, modo economia da staff, cota mensal;
 *  - o contador local de minutos de participante do mes (estimativa), com alertas em 70%/90% e bloqueio em 100%.
 * Nada aqui fala com o LiveKit alem de `syncRights` / `removeMedia` (injetados por media.ts).
 */

export type MediaKind = 'room' | 'stage';

export interface EconomyConfig {
  /** MEDIA_ECONOMY != off: limites de pessoas/video e conexao sob demanda. */
  enabled: boolean;
  idleDisconnectSeconds: number;
  hiddenTabSeconds: number;
  /** 0 = sem limite. */
  maxPeoplePerRoom: number;
  /** 0 = sem limite. */
  maxVideoPublishers: number;
  tokenTtlSeconds: number;
  /** 0 = sem cota. */
  monthlyMinutes: number;
  quotaTzOffsetMinutes: number;
}

export const DEFAULT_ECONOMY: EconomyConfig = {
  enabled: true,
  idleDisconnectSeconds: DEFAULT_MEDIA_POLICY.idleDisconnectSeconds,
  hiddenTabSeconds: DEFAULT_MEDIA_POLICY.hiddenTabSeconds,
  maxPeoplePerRoom: DEFAULT_MEDIA_POLICY.maxPeoplePerRoom,
  maxVideoPublishers: DEFAULT_MEDIA_POLICY.maxVideoPublishers,
  tokenTtlSeconds: 600,
  monthlyMinutes: DEFAULT_MONTHLY_MINUTES,
  quotaTzOffsetMinutes: -180,
};

function int(raw: string | undefined, def: number, min: number, max: number): number {
  if (raw === undefined || raw.trim() === '') return def;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : def;
}

/** Variaveis MEDIA_*. Valores invalidos voltam ao padrao; nada aqui impede o servidor de subir. */
export function resolveEconomyConfig(env: NodeJS.ProcessEnv = process.env): EconomyConfig {
  const off = /^(off|0|false|no|nao|não)$/i.test((env.MEDIA_ECONOMY ?? '').trim());
  return {
    enabled: !off,
    idleDisconnectSeconds: int(env.MEDIA_IDLE_DISCONNECT_SECONDS, DEFAULT_ECONOMY.idleDisconnectSeconds, 5, 3600),
    hiddenTabSeconds: int(env.MEDIA_HIDDEN_TAB_SECONDS, DEFAULT_ECONOMY.hiddenTabSeconds, 10, 86_400),
    maxPeoplePerRoom: int(env.MEDIA_MAX_PEOPLE_PER_ROOM, DEFAULT_ECONOMY.maxPeoplePerRoom, 0, 1000),
    maxVideoPublishers: int(env.MEDIA_MAX_VIDEO_PUBLISHERS, DEFAULT_ECONOMY.maxVideoPublishers, 0, 200),
    // sem economia: o tempo curto de antes (10 min)
    tokenTtlSeconds: int(env.MEDIA_TOKEN_TTL_SECONDS, off ? 600 : DEFAULT_ECONOMY.tokenTtlSeconds, 60, 21_600),
    monthlyMinutes: int(env.MEDIA_MONTHLY_MINUTES, DEFAULT_ECONOMY.monthlyMinutes, 0, 100_000_000),
    quotaTzOffsetMinutes: int(env.MEDIA_QUOTA_TZ_OFFSET_MINUTES, DEFAULT_ECONOMY.quotaTzOffsetMinutes, -720, 840),
  };
}

// ---- direitos de publicacao ---------------------------------------------------------------------------------

const RANK: Record<PublishRights, number> = { none: 0, audio: 1, av: 2, all: 3 };
/** O menor dos dois direitos. */
export const capRights = (r: PublishRights, max: PublishRights): PublishRights => (RANK[r] <= RANK[max] ? r : max);
const hasVideoRight = (r: PublishRights) => RANK[r] >= RANK.av;

type StageLookup = Pick<StageManager, 'hasPresentation' | 'rightsOf'>;

/**
 * Quem pode publicar audio/video/tela numa sala. Salas comuns liberam todos; num auditorio so o palestrante publica tudo e quem
 * recebeu a palavra publica so o microfone; numa sala com TV so quem apresenta compartilha a tela e os demais mantem microfone e camera.
 * `kind: 'stage'` so faz sentido onde ha palco (ou TV).
 */
export function publishRights(roomId: string, player: Player, kind: MediaKind = 'room', stage?: StageLookup): PublishRights {
  if (stage?.hasPresentation(roomId)) return stage.rightsOf(roomId, player);
  // sala silenciosa (Biblioteca): ninguem publica audio nem video; a regra vale para todos, inclusive quem administra
  if (SILENT_ROOM_IDS.includes(roomId)) return 'none';
  return kind === 'stage' ? 'none' : 'all';
}

// ---- persistencia do contador -------------------------------------------------------------------------------

export interface UsageFile {
  month: string;
  /** Minutos de participante estimados no mes. */
  minutes: number;
  strict: boolean;
  alerted: { warn70: boolean; warn90: boolean; exceeded: boolean };
  history: Array<{ month: string; minutes: number }>;
}

export interface UsageStore {
  load(): UsageFile | null;
  save(file: UsageFile): void;
}

export class MemoryUsageStore implements UsageStore {
  saved: UsageFile | null = null;
  load() {
    return this.saved ? structuredClone(this.saved) : null;
  }
  save(file: UsageFile) {
    this.saved = structuredClone(file);
  }
}

/** Um arquivo JSON pequeno (gravacao atomica: temporario + rename). Falhas de disco nunca derrubam o servidor. */
export class JsonFileUsageStore implements UsageStore {
  constructor(
    private readonly path: string,
    private readonly onError: (err: unknown) => void = () => undefined,
  ) {}
  load(): UsageFile | null {
    try {
      const raw = JSON.parse(readFileSync(this.path, 'utf8')) as Partial<UsageFile>;
      if (typeof raw.month !== 'string' || typeof raw.minutes !== 'number' || !Number.isFinite(raw.minutes)) return null;
      return {
        month: raw.month,
        minutes: Math.max(0, raw.minutes),
        strict: raw.strict === true,
        alerted: { warn70: raw.alerted?.warn70 === true, warn90: raw.alerted?.warn90 === true, exceeded: raw.alerted?.exceeded === true },
        history: Array.isArray(raw.history) ? raw.history.filter((h) => typeof h?.month === 'string' && typeof h?.minutes === 'number').slice(0, 24) : [],
      };
    } catch {
      return null;
    }
  }
  save(file: UsageFile) {
    try {
      mkdirSync(dirname(this.path), { recursive: true });
      const tmp = `${this.path}.tmp`;
      writeFileSync(tmp, JSON.stringify(file, null, 2));
      renameSync(tmp, this.path);
    } catch (err) {
      this.onError(err);
    }
  }
}

// ---- servico -----------------------------------------------------------------------------------------------

export interface EconomyHost {
  clock(): number;
  log(event: string, data?: Record<string, unknown>): void;
  /** Todos os jogadores online (politica global, alertas). */
  everyone(): Iterable<Player>;
  roomPlayers(orgId: string, roomId: string): Iterable<Player>;
  /** Direitos "de fabrica" (palco/TV) e se a pessoa e quem apresenta (isenta de modo economia e limite de video). */
  rightsOf(player: Player, kind: MediaKind): { rights: PublishRights; presenter: boolean; presentation: boolean };
  /** Empurra os direitos para quem ja esta na sala do LiveKit (media.ts). */
  syncRights?(roomId: string, identity: string, rights: PublishRights, orgId: string): void;
  removeMedia?(orgId: string, roomId: string, identity: string): void;
  /** Registro permanente de auditoria feito pelo SISTEMA (alertas de cota). */
  audit?(action: string, detail: string): void;
}

export interface GateOk {
  ok: true;
}
export interface GateDenied {
  ok: false;
  status: number;
  code: string;
  message: string;
  retryAfterSeconds?: number;
}

export interface Grant {
  rights: PublishRights;
  /** Por que os direitos vieram reduzidos (limite de video, modo economia). */
  notice?: string;
}

interface Session {
  startedAt: number;
  lastAccrued: number;
  lastSeen: number;
  /** O cliente ja disse `connected: true`. */
  connected: boolean;
  /** O servidor ja viu `participant_joined` desta sessao (webhook): dai em diante so o LiveKit conta. */
  lkSeen?: boolean;
  tokenExp: number;
}

interface Rec {
  player: Player;
  orgId: string;
  roomId: string;
  kind: MediaKind;
  mic: boolean;
  cam: boolean;
  screen: boolean;
  claimAt: number;
  /** Quando o pedido de transmitir comecou: sem conectar de verdade, vale so por INTENT_GRACE_MS. */
  intentAt: number;
  session: Session | null;
  /** Os direitos foram reduzidos ao limite de video: volta quando abrir vaga. */
  capped: boolean;
}

/** Sem relato do cliente por tanto tempo (ele manda a cada ~30 s), a sessao de midia e dada como encerrada. */
export const HEARTBEAT_TIMEOUT_MS = 100_000;
/** Token emitido e o cliente nunca disse que conectou. */
export const PENDING_TIMEOUT_MS = 45_000;
/** Folga depois do fim do token antes de encerrar a sessao (a renovacao do cliente chega antes). */
export const TOKEN_GRACE_MS = 60_000;
/** Quem diz que publica sem renovar o relato deixa de contar depois disso. */
export const CLAIM_TTL_MS = 100_000;
/** Quem diz que vai transmitir mas nao conecta a chamada nao mantem os outros conectados por mais que isso. */
export const INTENT_GRACE_MS = 20_000;
const SWEEP_EVERY_MS = 5000;
const SAVE_EVERY_MS = 15_000;
const STAFF_PUSH_EVERY_MS = 60_000;

const keyOf = (orgId: string, roomId: string) => `${orgId}\0${roomId}`;

const lkKeyOf = (orgId: string, roomId: string, identity: string) => [orgId, roomId, identity].join('|');

// ---- webhook do LiveKit (fonte de verdade) -------------------------------------------------------------------

/** Tipo de midia de uma faixa, ja normalizado por media.ts (a tela conta como video). */
export type LkSource = 'mic' | 'cam' | 'screen';

/** Evento do webhook do LiveKit, ja VERIFICADO (assinatura) e reduzido ao que o servidor usa. Tempos em ms. */
export interface LkEvent {
  id: string;
  event: string;
  createdAt: number;
  /** Nome da sala do LiveKit (`wv:${orgId}:${roomId}`). */
  room: string;
  identity?: string;
  joinedAt?: number;
  trackSid?: string;
  source?: LkSource;
  /** Faixas que o participante ja publicava ao entrar. */
  tracks?: Array<{ sid: string; source: LkSource }>;
}

export type WebhookResult = 'applied' | 'duplicate' | 'stale' | 'ignored';

/** Quem participa de verdade da sala do LiveKit (so existe com webhook). */
interface LkPart {
  orgId: string;
  roomId: string;
  identity: string;
  lastAccrued: number;
  tracks: Map<string, LkSource>;
  /** Desde quando nao ha sessao registrada no servidor para esta pessoa (0 = ha). */
  orphanAt: number;
}

/** Eventos mais velhos que isso (ou do futuro alem de 2 min) sao descartados: replay. */
export const WEBHOOK_MAX_AGE_MS = 10 * 60_000;
const WEBHOOK_FUTURE_MS = 2 * 60_000;
/** Os ids vistos ficam por mais tempo que a janela acima, senao um replay antigo-mas-valido passaria. */
const WEBHOOK_SEEN_MS = 20 * 60_000;
/** Sem evento por tanto tempo, o servidor volta a contar pela estimativa. */
export const WEBHOOK_ACTIVE_MS = 24 * 3600_000;
/** Quem conectou a sessao sem o servidor ver `participant_joined` depois disso passa a contar por estimativa (evento perdido). */
export const LK_JOIN_GRACE_MS = 180_000;
/** Participante no LiveKit sem sessao registrada: expulso depois disso. */
export const LK_ORPHAN_GRACE_MS = 60_000;
const RIGHTS_NEEDED: Record<LkSource, number> = { mic: 1, cam: 2, screen: 3 };

function freshFile(month: string, strict = false): UsageFile {
  return { month, minutes: 0, strict, alerted: { warn70: false, warn90: false, exceeded: false }, history: [] };
}

export class MediaEconomy {
  readonly config: EconomyConfig;
  private readonly recs = new Map<string, Rec>();
  private readonly lastActive = new Map<string, string>();
  private state: UsageFile;
  private dirty = false;
  private lastSave = 0;
  private lastSweep = 0;
  private lastStaffPush = 0;
  private lastPolicySig = '';
  private readonly lk = new Map<string, LkPart>();
  private readonly seenEvents = new Map<string, number>();
  private webhookAt = 0;
  private webhookWarnAt = 0;

  constructor(
    private readonly host: EconomyHost,
    config: Partial<EconomyConfig> = {},
    private readonly store: UsageStore = new MemoryUsageStore(),
  ) {
    this.config = { ...DEFAULT_ECONOMY, ...config };
    const now = host.clock();
    const loaded = store.load();
    this.state = loaded ?? freshFile(this.month(now));
    this.roll(now);
    this.lastPolicySig = this.policySig();
  }

  // ---- politica / estado ----------------------------------------------------------------------------------

  get strict(): boolean {
    return this.state.strict;
  }

  /** Regras de economia valendo: MEDIA_ECONOMY ligado ou modo economia da staff. */
  get economy(): boolean {
    return this.config.enabled || this.state.strict;
  }

  private month(now: number) {
    return monthKey(now, this.config.quotaTzOffsetMinutes);
  }

  /** Virada de mes: guarda o total no historico e zera o contador e os alertas. */
  private roll(now: number) {
    const m = this.month(now);
    if (m === this.state.month) return;
    const history = [{ month: this.state.month, minutes: Math.round(this.state.minutes * 10) / 10 }, ...this.state.history].slice(0, 12);
    this.state = { ...freshFile(m, this.state.strict), history };
    this.dirty = true;
    this.host.log('media.month_rollover', { from: history[0]?.month, to: m, minutes: history[0]?.minutes });
  }

  quotaExceeded(now = this.host.clock()): boolean {
    this.roll(now);
    return this.config.monthlyMinutes > 0 && this.state.minutes >= this.config.monthlyMinutes;
  }

  policy(now = this.host.clock()): MediaPolicy {
    return {
      economy: this.economy,
      strict: this.state.strict,
      quotaExceeded: this.quotaExceeded(now),
      idleDisconnectSeconds: this.config.idleDisconnectSeconds,
      hiddenTabSeconds: this.config.hiddenTabSeconds,
      maxVideoPublishers: this.config.maxVideoPublishers,
      maxPeoplePerRoom: this.config.maxPeoplePerRoom,
    };
  }

  private policySig() {
    return JSON.stringify(this.policy());
  }

  usage(now = this.host.clock()): MediaUsageView {
    this.roll(now);
    const used = Math.round(this.state.minutes * 10) / 10;
    const rooms = new Map<string, { orgId: string; roomId: string; connected: number; publishers: number }>();
    let sessions = 0;
    for (const r of this.recs.values()) {
      if (!r.session) continue;
      sessions++;
      const k = keyOf(r.orgId, r.roomId);
      const e = rooms.get(k) ?? { orgId: r.orgId, roomId: r.roomId, connected: 0, publishers: 0 };
      e.connected++;
      if (this.claims(r, now)) e.publishers++;
      rooms.set(k, e);
    }
    return {
      month: this.state.month,
      usedMinutes: used,
      limitMinutes: this.config.monthlyMinutes,
      percent: quotaPercent(this.state.minutes, this.config.monthlyMinutes),
      level: quotaLevel(this.state.minutes, this.config.monthlyMinutes),
      strict: this.state.strict,
      economyEnv: this.config.enabled,
      activeSessions: sessions,
      estimate: !this.webhookActive(now),
      webhook: this.webhookActive(now),
      history: this.state.history,
      rooms: [...rooms.values()].sort((a, b) => b.connected - a.connected).slice(0, 20),
    };
  }

  /** Para o /metrics. */
  metrics() {
    const u = this.usage();
    return { usedMinutes: u.usedMinutes, limitMinutes: u.limitMinutes, sessions: u.activeSessions, strict: u.strict, publishers: [...this.recs.values()].filter((r) => this.claims(r, this.host.clock())).length };
  }

  // ---- contagens ------------------------------------------------------------------------------------------

  /** O webhook esta chegando: a contagem vem dos eventos do LiveKit e nao dos relatos dos clientes. */
  webhookActive(now = this.host.clock()): boolean {
    return this.webhookAt > 0 && now - this.webhookAt < WEBHOOK_ACTIVE_MS;
  }

  private lkOf(r: Rec): LkPart | undefined {
    return this.lk.get(lkKeyOf(r.orgId, r.roomId, r.player.id));
  }

  /** O que a pessoa publica: as faixas vistas pelo LiveKit quando ha webhook; senao o relato (dica) do cliente. */
  private pub(r: Rec): { mic: boolean; cam: boolean; screen: boolean } {
    const e = this.lkOf(r);
    if (!e) return r;
    const v = new Set(e.tracks.values());
    return { mic: v.has('mic'), cam: v.has('cam'), screen: v.has('screen') };
  }

  private claims(r: Rec, now: number): boolean {
    const e = this.lkOf(r);
    if (e) return e.tracks.size > 0;
    return (r.mic || r.cam || r.screen) && now - r.claimAt <= CLAIM_TTL_MS && (r.session?.connected === true || now - r.intentAt <= INTENT_GRACE_MS);
  }

  private connectedCount(orgId: string, roomId: string, except?: string): number {
    let n = 0;
    for (const [account, r] of this.recs) if (account !== except && r.session && r.orgId === orgId && r.roomId === roomId) n++;
    return n;
  }

  private videoCount(orgId: string, roomId: string, except: string | undefined, now: number): number {
    let n = 0;
    for (const [account, r] of this.recs) {
      if (account === except || r.orgId !== orgId || r.roomId !== roomId) continue;
      const pb = this.pub(r);
      if ((pb.cam || pb.screen) && this.claims(r, now)) n++;
    }
    return n;
  }

  activeOf(orgId: string, roomId: string, now = this.host.clock()): MediaActive {
    const publishers: string[] = [];
    const video: string[] = [];
    for (const r of this.recs.values()) {
      if (r.orgId !== orgId || r.roomId !== roomId || !this.claims(r, now)) continue;
      publishers.push(r.player.id);
      const pb = this.pub(r);
      if (pb.cam || pb.screen) video.push(r.player.id);
    }
    publishers.sort();
    video.sort();
    return { roomId, publishers, video };
  }

  // ---- emissao de token -----------------------------------------------------------------------------------

  private note(result: string) {
    this.host.log('media.token', { result });
  }

  /** Recusas de ANTES de emitir: cota mensal e sala cheia. O apresentador (palco/TV) nunca fica de fora da propria apresentacao. */
  gate(player: Player, orgId: string, roomId: string, ctx: { presenter: boolean }, now = this.host.clock()): GateOk | GateDenied {
    if (this.quotaExceeded(now)) {
      this.note('quota');
      return { ok: false, status: 503, code: 'media_quota', message: MEDIA_TEXT.quotaExceeded };
    }
    const max = this.config.maxPeoplePerRoom;
    if (this.economy && max > 0 && !ctx.presenter && !(player.staff && player.onDuty) && this.connectedCount(orgId, roomId, player.accountId) >= max) {
      this.note('room_full');
      return { ok: false, status: 409, code: 'media_room_full', message: MEDIA_TEXT.roomFull(max), retryAfterSeconds: 20 };
    }
    return { ok: true };
  }

  /** Aplica o modo economia e o limite de video aos direitos que o palco/sala decidiram. */
  private limit(rights: PublishRights, ctx: { presenter: boolean; presentation: boolean }, videoFull: boolean): Grant & { capped: boolean } {
    let out = rights;
    let notice: string | undefined;
    let capped = false;
    if (!ctx.presenter) {
      if (this.state.strict && hasVideoRight(out)) {
        out = capRights(out, 'audio');
        notice = MEDIA_TEXT.strictVideoOff;
      } else if (this.economy && videoFull && hasVideoRight(out)) {
        out = capRights(out, 'audio');
        notice = MEDIA_TEXT.videoLimit(this.config.maxVideoPublishers);
        capped = true;
      }
    }
    return { rights: out, ...(notice ? { notice } : {}), capped };
  }

  private videoFull(orgId: string, roomId: string, except: string | undefined, now: number): boolean {
    const max = this.config.maxVideoPublishers;
    return max > 0 && this.videoCount(orgId, roomId, except, now) >= max;
  }

  /** Decide os direitos finais do token e abre (ou renova) a sessao de midia que passa a contar minutos. */
  grant(player: Player, orgId: string, roomId: string, kind: MediaKind, decided: PublishRights, ctx: { presenter: boolean; presentation: boolean }, ttlSeconds: number, now = this.host.clock()): Grant {
    const lim = this.limit(decided, ctx, this.videoFull(orgId, roomId, player.accountId, now));
    const rec = this.recFor(player, orgId, roomId, kind, now);
    rec.capped = lim.capped;
    if (!rec.session) rec.session = { startedAt: now, lastAccrued: now, lastSeen: now, connected: false, tokenExp: now + ttlSeconds * 1000 };
    else {
      rec.session.tokenExp = now + ttlSeconds * 1000;
      rec.session.lastSeen = now;
    }
    this.note('issued');
    return { rights: lim.rights, ...(lim.notice ? { notice: lim.notice } : {}) };
  }

  private recFor(player: Player, orgId: string, roomId: string, kind: MediaKind, now: number): Rec {
    let rec = this.recs.get(player.accountId);
    if (rec && (rec.orgId !== orgId || rec.roomId !== roomId || rec.player !== player)) {
      this.finish(rec, now);
      this.after(rec.orgId, rec.roomId, now);
      rec = undefined;
    }
    if (!rec) {
      rec = { player, orgId, roomId, kind, mic: false, cam: false, screen: false, claimAt: 0, intentAt: 0, session: null, capped: false };
      this.recs.set(player.accountId, rec);
    }
    rec.kind = kind;
    return rec;
  }

  // ---- relatos dos clientes -------------------------------------------------------------------------------

  /** Direitos que valem agora para esta pessoa (palco/TV + modo economia + limite de video). */
  private effective(rec: Rec, now: number): PublishRights {
    const h = this.host.rightsOf(rec.player, rec.kind);
    return this.limit(h.rights, h, rec.capped && this.videoFull(rec.orgId, rec.roomId, rec.player.accountId, now)).rights;
  }

  /** `media_report`: o cliente diz se esta conectado e o que transmite (ou esta prestes a transmitir). */
  report(player: Player, r: MediaReport, now = this.host.clock()) {
    const orgId = player.orgId;
    const roomId = player.roomId;
    if (!roomId) return;
    const wants = r.mic || r.cam || r.screen;
    let rec = this.recs.get(player.accountId);
    if (!rec) {
      if (!wants) return;
      rec = this.recFor(player, orgId, roomId, 'room', now);
    } else if (rec.orgId !== orgId || rec.roomId !== roomId || rec.player !== player) {
      rec = this.recFor(player, orgId, roomId, rec.kind, now);
    }
    if (!r.connected) this.endSession(rec, now);
    else if (rec.session) {
      rec.session.lastSeen = now;
      rec.session.connected = true;
    }

    // so conta quem pode publicar: sem direito de microfone/camera/tela o pedido e ignorado
    const rights = this.effective(rec, now);
    let { mic, cam, screen } = r;
    if (rights === 'none') mic = cam = screen = false;
    else if (rights === 'audio') cam = screen = false;
    else if (rights === 'av') screen = false;
    const host = this.host.rightsOf(player, rec.kind);
    if ((cam || screen) && !host.presenter && this.economy && this.videoFull(orgId, roomId, player.accountId, now)) {
      cam = screen = false;
      rec.capped = true;
      this.host.syncRights?.(roomId, player.id, capRights(rights, 'audio'), orgId);
      player.send({ t: 'error', code: 'media_video_limit', message: MEDIA_TEXT.videoLimit(this.config.maxVideoPublishers) });
      this.host.log('media.video_denied', { room: roomId, player: player.id });
    } else if ((r.cam || r.screen) && !(cam || screen) && !host.presenter && hasVideoRight(host.rights)) {
      // pediu video mas os direitos efetivos (modo economia ou limite de video ja aplicado ao token) so deixam audio
      if (this.state.strict) player.send({ t: 'error', code: 'media_strict', message: MEDIA_TEXT.strictVideoOff });
      else player.send({ t: 'error', code: 'media_video_limit', message: MEDIA_TEXT.videoLimit(this.config.maxVideoPublishers) });
    }
    if (!(rec.mic || rec.cam || rec.screen) && (mic || cam || screen)) rec.intentAt = now;
    rec.mic = mic;
    rec.cam = cam;
    rec.screen = screen;
    rec.claimAt = now;
    if (!rec.session && !(mic || cam || screen)) this.recs.delete(player.accountId);
    this.after(orgId, roomId, now);
  }

  /** Alguem parou de transmitir ou saiu: avisa a sala e devolve o video a quem tinha ficado so no audio. */
  private after(orgId: string, roomId: string, now: number) {
    this.rebalance(orgId, roomId, now);
    this.notifyRoom(orgId, roomId, now);
  }

  private rebalance(orgId: string, roomId: string, now: number) {
    for (const r of this.recs.values()) {
      if (!r.capped || r.orgId !== orgId || r.roomId !== roomId) continue;
      if (this.videoFull(orgId, roomId, r.player.accountId, now)) continue;
      r.capped = false;
      this.resync(r, now);
    }
  }

  private resync(rec: Rec, now: number) {
    this.host.syncRights?.(rec.roomId, rec.player.id, this.effective(rec, now), rec.orgId);
  }

  private notifyRoom(orgId: string, roomId: string, now: number) {
    const msg = this.activeOf(orgId, roomId, now);
    const sig = `${msg.publishers.join(',')}|${msg.video.join(',')}`;
    const k = keyOf(orgId, roomId);
    if ((this.lastActive.get(k) ?? '|') === sig) return;
    if (sig === '|') this.lastActive.delete(k);
    else this.lastActive.set(k, sig);
    for (const p of this.host.roomPlayers(orgId, roomId)) p.send({ t: 'media_active', ...msg });
  }

  /** Estado da sala para quem acabou de entrar (depois da mensagem `room`). */
  sendActive(player: Player, now = this.host.clock()) {
    if (!player.roomId) return;
    player.send({ t: 'media_active', ...this.activeOf(player.orgId, player.roomId, now) });
  }

  // ---- fim de sessao -------------------------------------------------------------------------------------

  private accrue(rec: Rec, now: number) {
    const s = rec.session;
    if (!s) return;
    const dt = now - s.lastAccrued;
    if (dt > 0) {
      s.lastAccrued = now;
      // Com webhook ativo quem conta e o evento do LiveKit (accrueLk); o relato do cliente so cobre um `participant_joined` perdido.
      if (this.lkOf(rec)) return;
      if (this.webhookActive(now) && !(s.connected && !s.lkSeen && now - s.startedAt > LK_JOIN_GRACE_MS)) return;
      this.roll(now);
      this.state.minutes += dt / 60_000;
      this.dirty = true;
    }
  }

  private accrueLk(e: LkPart, now: number, until = now) {
    const end = Math.min(now, Math.max(e.lastAccrued, until));
    const dt = end - e.lastAccrued;
    if (dt > 0) {
      this.roll(now);
      this.state.minutes += dt / 60_000;
      e.lastAccrued = end;
      this.dirty = true;
    }
  }

  private dropLk(e: LkPart, now: number, until = now) {
    this.accrueLk(e, now, until);
    this.lk.delete(lkKeyOf(e.orgId, e.roomId, e.identity));
  }

  // ---- webhook do LiveKit -----------------------------------------------------------------------------------

  private recOf(orgId: string, roomId: string, identity: string): Rec | undefined {
    for (const r of this.recs.values()) if (r.player.id === identity && r.orgId === orgId && r.roomId === roomId && r.session) return r;
    return undefined;
  }

  private kick(orgId: string, roomId: string, identity: string, why: string) {
    this.host.log('media.webhook_kick', { room: roomId, identity, why });
    this.host.removeMedia?.(orgId, roomId, identity);
  }

  /**
   * Evento ja verificado do webhook do LiveKit: a FONTE DE VERDADE dos minutos, de quem esta na chamada e do que publica. Aplica os limites
   * (pessoas por sala, video, direitos) em quem passou do permitido e expulsa quem conectou sem passar pelo servidor. Idempotente por `id`.
   */
  webhook(ev: LkEvent, now = this.host.clock()): WebhookResult {
    if (!ev.id || ev.id.length > 128) return 'ignored';
    for (const [id, at] of this.seenEvents) {
      if (now - at <= WEBHOOK_SEEN_MS && this.seenEvents.size < 20_000) break;
      this.seenEvents.delete(id);
    }
    if (this.seenEvents.has(ev.id)) return 'duplicate';
    if (!Number.isFinite(ev.createdAt) || now - ev.createdAt > WEBHOOK_MAX_AGE_MS || ev.createdAt - now > WEBHOOK_FUTURE_MS) return 'stale';
    this.seenEvents.set(ev.id, now);
    const m = /^wv:([^:]+):(.+)$/.exec(ev.room);
    if (!m) return 'ignored';
    const orgId = m[1]!;
    const roomId = m[2]!;
    if (this.webhookAt === 0) this.host.log('media.webhook_active', { note: 'primeiro evento verificado do LiveKit: a contagem de minutos passa a vir dos eventos' });
    this.webhookAt = now;
    this.roll(now);
    const identity = ev.identity ?? '';
    const key = lkKeyOf(orgId, roomId, identity);
    switch (ev.event) {
      case 'room_finished': {
        for (const e of [...this.lk.values()]) if (e.orgId === orgId && e.roomId === roomId) this.dropLk(e, now, ev.createdAt);
        this.after(orgId, roomId, now);
        return 'applied';
      }
      case 'participant_left': {
        const e = this.lk.get(key);
        if (e) this.dropLk(e, now, ev.createdAt);
        this.after(orgId, roomId, now);
        return 'applied';
      }
      case 'track_unpublished': {
        const e = this.lk.get(key);
        if (e && ev.trackSid) e.tracks.delete(ev.trackSid);
        this.after(orgId, roomId, now);
        return 'applied';
      }
      case 'participant_joined':
      case 'track_published': {
        if (!identity) return 'ignored';
        const rec = this.recOf(orgId, roomId, identity);
        // Conectou sem passar pelo servidor (token nao emitido por aqui, ou sessao ja encerrada): fora.
        if (!rec) {
          this.kick(orgId, roomId, identity, 'no_session');
          const stray = this.lk.get(key);
          if (stray) this.dropLk(stray, now);
          return 'applied';
        }
        let e = this.lk.get(key);
        if (!e) {
          e = { orgId, roomId, identity, lastAccrued: Math.min(now, Math.max(ev.joinedAt ?? ev.createdAt, rec.session!.lastAccrued)), tracks: new Map(), orphanAt: 0 };
          const max = this.config.maxPeoplePerRoom;
          const h = this.host.rightsOf(rec.player, rec.kind);
          if (this.economy && max > 0 && !h.presenter && !(rec.player.staff && rec.player.onDuty)) {
            let others = 0;
            for (const o of this.lk.values()) if (o.orgId === orgId && o.roomId === roomId) others++;
            if (others >= max) {
              this.host.log('media.webhook_room_full', { room: roomId, identity, max });
              this.kick(orgId, roomId, identity, 'room_full');
              rec.player.send({ t: 'error', code: 'media_room_full', message: MEDIA_TEXT.roomFull(max) });
              this.note('webhook_room_full');
              return 'applied';
            }
          }
          this.lk.set(key, e);
        }
        rec.session!.connected = true;
        rec.session!.lkSeen = true;
        rec.session!.lastSeen = now;
        e.orphanAt = 0;
        const tracks = ev.event === 'participant_joined' ? (ev.tracks ?? []) : ev.trackSid && ev.source ? [{ sid: ev.trackSid, source: ev.source }] : [];
        for (const t of tracks) this.enforceTrack(rec, e, t.sid, t.source, now);
        this.after(orgId, roomId, now);
        return 'applied';
      }
      default:
        return 'ignored';
    }
  }

  /** Uma faixa publicada de verdade: vale se os direitos e o limite de video deixam; senao o servidor tira o direito e a faixa cai. */
  private enforceTrack(rec: Rec, e: LkPart, sid: string, src: LkSource, now: number) {
    const eff = this.effective(rec, now);
    const presenter = this.host.rightsOf(rec.player, rec.kind).presenter;
    let deny = RANK[eff] < RIGHTS_NEEDED[src];
    let videoCap = false;
    if (!deny && src !== 'mic' && !presenter && this.economy && this.videoFull(rec.orgId, rec.roomId, rec.player.accountId, now)) {
      deny = true;
      videoCap = true;
    }
    if (!deny) {
      e.tracks.set(sid, src);
      return;
    }
    e.tracks.delete(sid);
    if (videoCap) rec.capped = true;
    this.host.log('media.webhook_track_denied', { room: rec.roomId, identity: rec.player.id, source: src, why: videoCap ? 'video_limit' : 'rights' });
    this.host.syncRights?.(rec.roomId, rec.player.id, videoCap ? capRights(eff, 'audio') : eff, rec.orgId);
    if (src !== 'mic') {
      if (this.state.strict) rec.player.send({ t: 'error', code: 'media_strict', message: MEDIA_TEXT.strictVideoOff });
      else rec.player.send({ t: 'error', code: 'media_video_limit', message: MEDIA_TEXT.videoLimit(this.config.maxVideoPublishers) });
    }
  }

  /** Participantes do LiveKit sem sessao no servidor (a sessao acabou ou nunca existiu): somem depois da tolerancia. */
  private sweepLk(now: number) {
    for (const e of [...this.lk.values()]) {
      this.accrueLk(e, now);
      if (this.recOf(e.orgId, e.roomId, e.identity)) {
        e.orphanAt = 0;
        continue;
      }
      if (e.orphanAt === 0) e.orphanAt = now;
      else if (now - e.orphanAt > LK_ORPHAN_GRACE_MS) {
        this.kick(e.orgId, e.roomId, e.identity, 'orphan');
        this.dropLk(e, now);
        this.after(e.orgId, e.roomId, now);
      }
    }
    // Aviso (no maximo a cada 6 h) de que a contagem esta sendo estimada.
    if (!this.webhookActive(now) && this.sessionCount > 0 && now - this.webhookWarnAt > 6 * 3600_000) {
      this.webhookWarnAt = now;
      this.host.log('media.webhook_inactive', { note: 'webhook do LiveKit nao configurado (ou sem eventos): contagem de minutos ESTIMADA. Veja docs/media-economy.md.' });
    }
  }

  private endSession(rec: Rec, now: number) {
    if (!rec.session) return;
    this.accrue(rec, now);
    rec.session = null;
    rec.capped = false;
  }

  /** Tira a pessoa do controle (saiu da sala ou da sessao). `evict`: tambem derruba a conexao dela ao LiveKit (a sessao do jogo acabou). */
  private finish(rec: Rec, now: number, evict = false) {
    const had = rec.session !== null;
    this.endSession(rec, now);
    if (this.recs.get(rec.player.accountId) === rec) this.recs.delete(rec.player.accountId);
    if (evict && had) this.host.removeMedia?.(rec.orgId, rec.roomId, rec.player.id);
  }

  /** A pessoa saiu da sala (ou da sessao): para a contagem e atualiza quem ficou. Chamado DEPOIS de tira-la da sala. */
  leave(player: Player, opts: { evict?: boolean } = {}, now = this.host.clock()) {
    const rec = this.recs.get(player.accountId);
    if (!rec) return;
    this.finish(rec, now, opts.evict === true);
    this.after(rec.orgId, rec.roomId, now);
  }

  // ---- modo economia da staff ------------------------------------------------------------------------------

  /** Liga/desliga o modo economia global. Retorna false quando nada mudou. */
  setStrict(on: boolean, now = this.host.clock()): boolean {
    if (this.state.strict === on) return false;
    this.roll(now);
    this.state.strict = on;
    this.dirty = true;
    this.save(now, true);
    this.host.log('media.strict', { on });
    const touched = new Set<string>();
    for (const rec of this.recs.values()) {
      const presenter = this.host.rightsOf(rec.player, rec.kind).presenter;
      if (on && !presenter && (rec.cam || rec.screen)) {
        rec.cam = false;
        rec.screen = false;
        touched.add(keyOf(rec.orgId, rec.roomId));
      }
      if (rec.session) this.resync(rec, now);
    }
    for (const k of touched) {
      const [orgId, roomId] = k.split('\0') as [string, string];
      this.notifyRoom(orgId, roomId, now);
    }
    this.broadcastPolicy();
    this.pushStaff(now);
    return true;
  }

  private broadcastPolicy() {
    const sig = this.policySig();
    this.lastPolicySig = sig;
    const msg = { t: 'media_policy' as const, ...this.policy() };
    for (const p of this.host.everyone()) p.send(msg);
  }

  // ---- relogio (a cada ~5 s) --------------------------------------------------------------------------------

  /** Chamado pelo tick do mundo: so trabalha de tempos em tempos. */
  sweepIfDue(now: number) {
    if (now - this.lastSweep < SWEEP_EVERY_MS) return;
    this.sweep(now);
  }

  sweep(now: number) {
    this.lastSweep = now;
    this.roll(now);
    const rooms = new Set<string>();
    for (const rec of [...this.recs.values()]) {
      if (rec.session) {
        this.accrue(rec, now);
        const s = rec.session;
        // o participante esta de fato no LiveKit (evento verificado): isso vale como sinal de vida, mesmo sem relato do cliente
        if (this.lkOf(rec)) s.lastSeen = now;
        const stale = now - s.lastSeen > (s.connected ? HEARTBEAT_TIMEOUT_MS : PENDING_TIMEOUT_MS);
        const expired = now > s.tokenExp + TOKEN_GRACE_MS;
        if (stale || expired) {
          this.host.log('media.session_timeout', { room: rec.roomId, player: rec.player.id, why: stale ? 'heartbeat' : 'token' });
          this.finish(rec, now, true);
          rooms.add(keyOf(rec.orgId, rec.roomId));
          continue;
        }
      }
      if ((rec.mic || rec.cam || rec.screen) && now - rec.claimAt > CLAIM_TTL_MS) {
        rec.mic = rec.cam = rec.screen = false;
        rooms.add(keyOf(rec.orgId, rec.roomId));
        if (!rec.session) this.recs.delete(rec.player.accountId);
      }
    }
    for (const k of rooms) {
      const [orgId, roomId] = k.split('\0') as [string, string];
      this.after(orgId, roomId, now);
    }
    this.sweepLk(now);
    this.checkQuota(now);
    if (this.policySig() !== this.lastPolicySig) this.broadcastPolicy();
    this.save(now);
    if (now - this.lastStaffPush >= STAFF_PUSH_EVERY_MS) this.pushStaff(now);
  }

  /** Alertas em 70% e 90% (uma vez por mes) e bloqueio em 100%: ninguem mais recebe token e quem estava conectado e desligado. */
  private checkQuota(now: number) {
    const level = quotaLevel(this.state.minutes, this.config.monthlyMinutes);
    const a = this.state.alerted;
    // o limite foi aumentado (ou o uso caiu): os alertas voltam a valer
    if (level !== 'exceeded') a.exceeded = false;
    if (level === 'ok' || level === 'warn70') a.warn90 = false;
    if (level === 'ok') a.warn70 = false;
    if (level === 'ok') return;
    const u = this.usage(now);
    const text = (pct: string) => `[MÍDIA] Uso estimado de áudio/vídeo: ${u.percent}% (${u.usedMinutes} de ${u.limitMinutes} min) ${pct}. Estimativa local; a cota oficial está no painel do LiveKit.`;
    if (!a.warn70) {
      a.warn70 = true;
      this.alert('media.quota.70', text('passou de 70% da cota do mês'));
    }
    if ((level === 'warn90' || level === 'exceeded') && !a.warn90) {
      a.warn90 = true;
      this.alert('media.quota.90', text('passou de 90% da cota do mês'));
    }
    if (level === 'exceeded' && !a.exceeded) {
      a.exceeded = true;
      this.alert('media.quota.100', text('atingiu 100%: novos tokens bloqueados até o dia 1'));
      for (const rec of [...this.recs.values()]) {
        const { orgId, roomId } = rec;
        this.finish(rec, now, true);
        this.after(orgId, roomId, now);
      }
    }
    this.dirty = true;
  }

  private alert(action: string, text: string) {
    this.host.log(action, { text });
    this.host.audit?.(action, text);
    for (const p of this.host.everyone()) {
      if (p.staff && p.onDuty && staffCan(p.staff, 'media.view')) p.send({ t: 'chat', id: null, name: '', text, kind: 'system' });
    }
  }

  /** Contador atualizado para a staff em servico. */
  pushStaff(now = this.host.clock()) {
    this.lastStaffPush = now;
    const msg = { t: 'staff_media' as const, usage: this.usage(now) };
    for (const p of this.host.everyone()) if (p.staff && p.onDuty && staffCan(p.staff, 'media.view')) p.send(msg);
  }

  // ---- persistencia -----------------------------------------------------------------------------------------

  private save(now: number, force = false) {
    if (!this.dirty) return;
    if (!force && now - this.lastSave < SAVE_EVERY_MS) return;
    this.lastSave = now;
    this.dirty = false;
    this.store.save(this.state);
  }

  /** Grava agora (desligamento do servidor): minutos das sessoes abertas entram na conta. */
  flush(now = this.host.clock()) {
    for (const rec of this.recs.values()) this.accrue(rec, now);
    for (const e of this.lk.values()) this.accrueLk(e, now);
    this.dirty = true;
    this.save(now, true);
  }

  /** Visivel para testes: quem esta com sessao de midia aberta. */
  get sessionCount(): number {
    let n = 0;
    for (const r of this.recs.values()) if (r.session) n++;
    return n;
  }
}

export type { QuotaLevel };
