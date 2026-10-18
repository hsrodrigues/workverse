import { randomBytes } from 'node:crypto';
import {
  STAGE_LIMITS,
  deckImageIds,
  validateDeck,
  isStageRoom,
  type ClientMessage,
  type Deck,
  type ImageMime,
  type ServerMessage,
  type SlideState,
  type StageRole,
  type StageView,
} from '@workverse/shared';
import type { Player, RoomInstance } from './room';

/** What a participant may publish in the LiveKit room: everything, microphone only, or nothing. */
export type PublishRights = 'all' | 'audio' | 'none';

/** Tells LiveKit about a change for someone who is already connected (see media.ts). */
export type PermissionSync = (roomId: string, identity: string, rights: PublishRights, orgId?: string) => void;

export interface StoredImage {
  mime: ImageMime;
  bytes: Buffer;
}

interface StageRoom {
  speaker: Player | null;
  /** Account whose deck and images are stored here. They survive the speaker leaving, F5 or a reconnection. */
  owner: string | null;
  /** When the speaker last stepped down (for the retention limit of an abandoned deck). */
  parkedAt: number;
  /** Open stage: everybody in the room may publish. Only while somebody holds the stage. */
  open: boolean;
  /** Audience waiting for the floor, oldest first. */
  hands: Player[];
  /** Audience allowed to speak. */
  voices: Set<string>;
  deck: Deck | null;
  slide: SlideState;
  images: Map<string, StoredImage>;
  imageBytes: number;
}

const STAGE_MESSAGES = new Set([
  'stage_take',
  'stage_release',
  'stage_alive',
  'hand_raise',
  'hand_lower',
  'voice_grant',
  'voice_revoke',
  'deck_set',
  'present_start',
  'present_end',
  'slide_goto',
  'deck_clear',
  'stage_open',
  'stage_close',
]);

/** An abandoned deck (nobody came back for it) is dropped when somebody else takes the stage after this long. */
const PARKED_DECK_MS = 12 * 60 * 60 * 1000;

export const isStageMessage = (t: string) => STAGE_MESSAGES.has(t);

export interface StageManagerOptions {
  rooms: Map<string, RoomInstance>;
  sync?: PermissionSync;
  clock?: () => number;
  log?: (event: string, data?: Record<string, unknown>) => void;
}

/**
 * Server-authoritative auditorium: who is on stage, who asked for the floor, and the slide deck. Everything a client
 * sends is validated here; the LiveKit token and live permission updates are derived from the same state.
 */
export class StageManager {
  private readonly stages = new Map<string, StageRoom>();
  private readonly sync: PermissionSync;
  private readonly log: (event: string, data?: Record<string, unknown>) => void;
  private readonly clock: () => number;

  constructor(private readonly opts: StageManagerOptions) {
    this.sync = opts.sync ?? (() => undefined);
    this.clock = opts.clock ?? Date.now;
    this.log = opts.log ?? (() => undefined);
    for (const [id, room] of opts.rooms) if (isStageRoom(room.built.def)) this.stages.set(id, this.blank());
  }

  private blank(): StageRoom {
    return { speaker: null, owner: null, parkedAt: 0, open: false, hands: [], voices: new Set(), deck: null, slide: { live: false, index: 0 }, images: new Map(), imageBytes: 0 };
  }

  isStageRoom(roomId: string | null | undefined): boolean {
    return !!roomId && this.stages.has(roomId);
  }

  roleOf(roomId: string, player: Player): StageRole {
    const st = this.stages.get(roomId);
    if (!st) return 'audience';
    if (st.speaker?.id === player.id) return 'speaker';
    return st.voices.has(player.id) ? 'voice' : 'audience';
  }

  /** What this player may publish in the LiveKit room of `roomId`. Rooms without a stage are unrestricted. */
  rightsOf(roomId: string, player: Player): PublishRights {
    if (!this.stages.has(roomId)) return 'all';
    const role = this.roleOf(roomId, player);
    if (role === 'speaker') return 'all';
    // Open stage: while the speaker allows it, the whole room may turn on microphone, camera and screen.
    if (this.stages.get(roomId)?.open) return 'all';
    return role === 'voice' ? 'audio' : 'none';
  }

  view(roomId: string): StageView | null {
    const st = this.stages.get(roomId);
    if (!st) return null;
    return {
      speakerId: st.speaker?.id ?? null,
      speakerName: st.speaker?.name ?? null,
      hands: st.hands.map((p) => ({ id: p.id, name: p.name })),
      voices: [...st.voices],
      open: st.open,
    };
  }

  slideState(roomId: string): SlideState {
    return { ...(this.stages.get(roomId)?.slide ?? { live: false, index: 0 }) };
  }

  private room(roomId: string): RoomInstance | undefined {
    return this.opts.rooms.get(roomId);
  }

  private broadcast(roomId: string, msg: ServerMessage) {
    this.room(roomId)?.broadcast(msg);
  }

  private broadcastStage(roomId: string) {
    const stage = this.view(roomId);
    if (stage) this.broadcast(roomId, { t: 'stage', stage });
  }

  private err(player: Player, code: string, message: string) {
    player.send({ t: 'error', code, message });
  }

  /** The deck is private to the speaker until the presentation goes live. */
  private deckFor(st: StageRoom, player: Player): Deck | null {
    return st.speaker?.id === player.id || st.slide.live ? st.deck : null;
  }

  // ---- lifecycle --------------------------------------------------------

  /** Sends the current state to someone who just entered (call after the `room` message). */
  onEnter(roomId: string, player: Player) {
    const st = this.stages.get(roomId);
    if (!st) return;
    player.send({ t: 'stage', stage: this.view(roomId)! });
    player.send({ t: 'deck', deck: this.deckFor(st, player) });
    player.send({ t: 'slide', state: { ...st.slide } });
  }

  /** Call after the player was removed from the room (moved elsewhere, disconnected). */
  onLeave(roomId: string | null, player: Player) {
    if (!roomId) return;
    const st = this.stages.get(roomId);
    if (!st) return;
    if (st.speaker?.id === player.id) {
      this.releaseStage(roomId, 'saiu da sala');
      return;
    }
    let changed = false;
    if (st.voices.delete(player.id)) {
      changed = true;
      this.sync(roomId, player.id, 'none');
    }
    const n = st.hands.length;
    st.hands = st.hands.filter((p) => p.id !== player.id);
    if (st.hands.length !== n) changed = true;
    if (changed) this.broadcastStage(roomId);
  }

  /** The speaker went away (manual or automatic): the stage is freed. */
  onAway(player: Player) {
    const roomId = player.roomId;
    if (!roomId) return;
    if (this.stages.get(roomId)?.speaker?.id === player.id) this.releaseStage(roomId, 'ficou ausente');
  }

  /** Tells LiveKit what every person in the room may publish now (open stage, closing, new speaker...). */
  private resyncRoom(roomId: string) {
    for (const p of this.room(roomId)?.players.values() ?? []) this.sync(roomId, p.id, this.rightsOf(roomId, p));
  }

  /**
   * Frees the stage and ends the presentation; hands, voices and the open stage are dropped. The deck, its images
   * and the current slide stay on the server for the same account (closing the panel, F5 or coming back later
   * must not lose them); anybody else who takes the stage starts clean.
   */
  private releaseStage(roomId: string, why: string) {
    const st = this.stages.get(roomId);
    if (!st || !st.speaker) return;
    const former = st.speaker;
    const hadDeck = st.deck !== null || st.slide.live;
    const voices = [...st.voices];
    const wasOpen = st.open;
    st.speaker = null;
    st.hands = [];
    st.voices = new Set();
    st.open = false;
    st.parkedAt = this.clock();
    st.slide = { live: false, index: st.slide.index };
    this.sync(roomId, former.id, 'none');
    for (const id of voices) this.sync(roomId, id, 'none');
    if (wasOpen) this.resyncRoom(roomId);
    this.log('stage.release', { room: roomId, player: former.id, why });
    this.broadcastStage(roomId);
    if (hadDeck) {
      this.broadcast(roomId, { t: 'deck', deck: null });
      this.broadcast(roomId, { t: 'slide', state: { live: false, index: 0 } });
    }
    this.broadcast(roomId, { t: 'chat', id: null, name: '', text: `${former.name} deixou o palco.`, kind: 'system' });
  }

  private dropDeck(st: StageRoom) {
    st.deck = null;
    st.slide = { live: false, index: 0 };
    st.images.clear();
    st.imageBytes = 0;
  }

  // ---- messages ---------------------------------------------------------

  /** Podium interaction (also reachable from the HUD button). */
  takeStage(player: Player) {
    const roomId = player.roomId;
    const st = roomId ? this.stages.get(roomId) : undefined;
    if (!roomId || !st) return this.err(player, 'not_stage_room', 'Aqui não há palco.');
    if (st.speaker?.id === player.id) return;
    if (st.speaker) return this.err(player, 'stage_busy', `${st.speaker.name} já está no palco.`);
    if (player.status === 'away') return this.err(player, 'stage_away', 'Mude seu status para assumir o palco.');
    // The same account gets its slides back; somebody else (or a deck left behind for too long) starts clean.
    if (st.owner !== null && (st.owner !== player.accountId || this.clock() - st.parkedAt > PARKED_DECK_MS)) this.dropDeck(st);
    st.owner = player.accountId;
    st.speaker = player;
    st.hands = st.hands.filter((p) => p.id !== player.id);
    st.voices.delete(player.id);
    this.sync(roomId, player.id, 'all');
    this.log('stage.take', { room: roomId, player: player.id });
    this.broadcastStage(roomId);
    this.broadcast(roomId, { t: 'chat', id: null, name: '', text: `${player.name} assumiu o palco.`, kind: 'system' });
    player.send({ t: 'deck', deck: st.deck });
    player.send({ t: 'slide', state: { ...st.slide } });
    // Stand behind the podium, facing the audience.
    this.room(roomId)?.goToStageSpot(player, this.clock());
  }

  /** Returns true when the message belonged to the auditorium (even if it was refused). */
  handle(player: Player, msg: ClientMessage, now: number): boolean {
    if (!isStageMessage(msg.t)) return false;
    const roomId = player.roomId;
    const st = roomId ? this.stages.get(roomId) : undefined;
    if (!roomId || !st) {
      this.err(player, 'not_stage_room', 'Aqui não há palco.');
      return true;
    }
    if (msg.t === 'deck_set') {
      if (!player.deckBucket.take(now)) {
        this.err(player, 'rate_limited', 'Calma! Muitas atualizações de slides.');
        return true;
      }
    } else if (!player.stageBucket.take(now)) {
      this.err(player, 'rate_limited', 'Calma! Você está agindo rápido demais.');
      return true;
    }
    const isSpeaker = st.speaker?.id === player.id;
    const needSpeaker = () => {
      if (isSpeaker) return false;
      this.err(player, 'not_speaker', 'Só quem está no palco pode fazer isso.');
      return true;
    };

    switch (msg.t) {
      case 'stage_take':
        this.takeStage(player);
        return true;
      case 'stage_alive':
        return true;
      case 'stage_release':
        if (needSpeaker()) return true;
        this.releaseStage(roomId, 'desceu do palco');
        return true;
      case 'hand_raise': {
        if (isSpeaker) return this.refuse(player, 'stage_speaker', 'Quem está no palco já tem a palavra.');
        if (!st.speaker) return this.refuse(player, 'no_speaker', 'Ninguém está no palco.');
        if (st.voices.has(player.id)) return this.refuse(player, 'has_voice', 'Você já está com a palavra.');
        if (st.hands.some((p) => p.id === player.id)) return true;
        if (st.hands.length >= STAGE_LIMITS.maxHands) return this.refuse(player, 'hands_full', 'A fila de perguntas está cheia.');
        st.hands.push(player);
        this.broadcastStage(roomId);
        return true;
      }
      case 'hand_lower': {
        const n = st.hands.length;
        st.hands = st.hands.filter((p) => p.id !== player.id);
        if (st.hands.length !== n) this.broadcastStage(roomId);
        return true;
      }
      case 'voice_grant': {
        if (needSpeaker()) return true;
        if (typeof msg.id !== 'string') return this.refuse(player, 'bad_message', 'Mensagem inválida.');
        const target = this.room(roomId)?.players.get(msg.id);
        if (!target || target.id === player.id) return this.refuse(player, 'no_target', 'Essa pessoa não está na plateia.');
        if (st.voices.has(target.id)) return true;
        if (st.voices.size >= STAGE_LIMITS.maxVoices) return this.refuse(player, 'voices_full', `No máximo ${STAGE_LIMITS.maxVoices} pessoas falam ao mesmo tempo.`);
        st.voices.add(target.id);
        st.hands = st.hands.filter((p) => p.id !== target.id);
        this.sync(roomId, target.id, 'audio');
        this.log('stage.voice', { room: roomId, player: target.id });
        this.broadcastStage(roomId);
        return true;
      }
      case 'voice_revoke': {
        if (needSpeaker()) return true;
        if (typeof msg.id !== 'string') return this.refuse(player, 'bad_message', 'Mensagem inválida.');
        const hadVoice = st.voices.delete(msg.id);
        const n = st.hands.length;
        st.hands = st.hands.filter((p) => p.id !== msg.id);
        if (hadVoice) this.sync(roomId, msg.id, 'none');
        if (hadVoice || st.hands.length !== n) this.broadcastStage(roomId);
        return true;
      }
      case 'deck_set': {
        if (needSpeaker()) return true;
        const check = validateDeck(msg.deck);
        if (!check.ok) return this.refuse(player, 'deck_invalid', check.error);
        const ids = deckImageIds(check.deck);
        if (ids.some((id) => !st.images.has(id))) return this.refuse(player, 'deck_invalid', 'Uma das imagens não foi enviada ao servidor.');
        st.deck = check.deck;
        for (const id of [...st.images.keys()]) {
          if (ids.includes(id)) continue;
          st.imageBytes -= st.images.get(id)!.bytes.length;
          st.images.delete(id);
        }
        const clamped = Math.min(st.slide.index, check.deck.slides.length - 1);
        const slideChanged = clamped !== st.slide.index;
        st.slide.index = clamped;
        if (st.slide.live) this.broadcast(roomId, { t: 'deck', deck: st.deck });
        else player.send({ t: 'deck', deck: st.deck });
        if (slideChanged) this.broadcast(roomId, { t: 'slide', state: { ...st.slide } });
        return true;
      }
      case 'present_start': {
        if (needSpeaker()) return true;
        if (!st.deck) return this.refuse(player, 'no_deck', 'Defina os slides antes de iniciar.');
        const from = msg.index;
        const start = typeof from === 'number' && Number.isInteger(from) && from >= 0 && from < st.deck.slides.length ? from : 0;
        st.slide = { live: true, index: start };
        this.broadcast(roomId, { t: 'deck', deck: st.deck });
        this.broadcast(roomId, { t: 'slide', state: { ...st.slide } });
        this.broadcast(roomId, { t: 'chat', id: null, name: '', text: `${player.name} iniciou uma apresentação.`, kind: 'system' });
        return true;
      }
      case 'present_end': {
        if (needSpeaker()) return true;
        if (!st.slide.live) return true;
        st.slide = { live: false, index: st.slide.index };
        this.broadcast(roomId, { t: 'slide', state: { ...st.slide } });
        // Audience forgets the deck; the speaker keeps it for the next round.
        for (const p of this.room(roomId)?.players.values() ?? []) if (p.id !== player.id) p.send({ t: 'deck', deck: null });
        return true;
      }
      case 'deck_clear': {
        if (needSpeaker()) return true;
        const hadDeck = st.deck !== null || st.slide.live;
        this.dropDeck(st);
        if (hadDeck) {
          this.broadcast(roomId, { t: 'deck', deck: null });
          this.broadcast(roomId, { t: 'slide', state: { ...st.slide } });
        }
        return true;
      }
      case 'stage_open':
      case 'stage_close': {
        if (needSpeaker()) return true;
        const open = msg.t === 'stage_open';
        if (st.open === open) return true;
        st.open = open;
        this.resyncRoom(roomId);
        this.log('stage.open', { room: roomId, player: player.id, open });
        this.broadcastStage(roomId);
        this.broadcast(roomId, {
          t: 'chat',
          id: null,
          name: '',
          text: open ? `${player.name} liberou o palco: qualquer pessoa pode ligar microfone, câmera e tela.` : `${player.name} fechou o palco: só o palestrante transmite.`,
          kind: 'system',
        });
        return true;
      }
      case 'slide_goto': {
        if (needSpeaker()) return true;
        if (!st.slide.live || !st.deck) return this.refuse(player, 'not_live', 'A apresentação não está em andamento.');
        const i = msg.index;
        if (typeof i !== 'number' || !Number.isInteger(i) || i < 0 || i >= st.deck.slides.length) return this.refuse(player, 'bad_slide', 'Slide inexistente.');
        if (i !== st.slide.index) {
          st.slide.index = i;
          this.broadcast(roomId, { t: 'slide', state: { ...st.slide } });
        }
        return true;
      }
    }
    return true;
  }

  private refuse(player: Player, code: string, message: string): true {
    this.err(player, code, message);
    return true;
  }

  // ---- images -----------------------------------------------------------

  /** Stores an already validated image for the speaker. */
  addImage(roomId: string, bytes: Buffer, mime: ImageMime): { ok: true; id: string } | { ok: false; error: string; status: 413 | 409 } {
    const st = this.stages.get(roomId);
    if (!st) return { ok: false, error: 'Aqui não há palco.', status: 409 };
    if (st.imageBytes + bytes.length > STAGE_LIMITS.maxTotalImageBytes) return { ok: false, error: 'Limite total de imagens atingido.', status: 413 };
    if (st.images.size >= STAGE_LIMITS.maxSlides * 2) return { ok: false, error: 'Imagens demais.', status: 413 };
    const id = randomBytes(12).toString('hex');
    st.images.set(id, { mime, bytes });
    st.imageBytes += bytes.length;
    return { ok: true, id };
  }

  /** Image visible to `player`: the speaker always; the audience only while the presentation is live. */
  getImage(roomId: string, player: Player, id: string): StoredImage | undefined {
    const st = this.stages.get(roomId);
    if (!st) return undefined;
    if (st.speaker?.id !== player.id && !st.slide.live) return undefined;
    return st.images.get(id);
  }

  imageStats(roomId: string): { count: number; bytes: number } {
    const st = this.stages.get(roomId);
    return { count: st?.images.size ?? 0, bytes: st?.imageBytes ?? 0 };
  }
}
