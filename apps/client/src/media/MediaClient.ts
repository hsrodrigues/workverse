import {
  ConnectionState,
  Room,
  RoomEvent,
  Track,
  VideoPresets,
  type LocalParticipant,
  type Participant,
  type RemoteParticipant,
  type RemoteTrack,
} from 'livekit-client';
import { dataSaverOn } from '../clientPrefs';
import {
  DEFAULT_PROXIMITY,
  isProximityMode,
  sanitizeParams,
  volumeFor,
  type ProximityMode,
  type ProximityParams,
  type TilePositionProvider,
} from './proximity';

/** `unavailable` = no API/device/secure context; `denied` = the user or browser refused. Never thrown, only reported. */
export type PermissionState = 'prompt' | 'granted' | 'denied' | 'unavailable';
export type MediaStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'unavailable' | 'error';
export type VideoSource = 'camera' | 'screen';
/** What the server lets this person publish here: everything, microphone only (audience member given the floor) or nothing. */
/** `av`: microphone and camera but no screen share (viewers in a room with a presentation TV). */
export type PublishRights = 'all' | 'av' | 'audio' | 'none';
/** `stage` = an auditorium: only the speaker transmits. The server decides; this only labels the request. */
export type MediaKind = 'room' | 'stage';

export interface MediaParticipant {
  identity: string;
  name: string;
  isLocal: boolean;
  micOn: boolean;
  camOn: boolean;
  screenOn: boolean;
  /** The person has a microphone / camera track (on or muted): the game only draws indicators for these. */
  micPublished: boolean;
  camPublished: boolean;
  speaking: boolean;
  /** Changes when the underlying video track changes, so views know when to re-attach. */
  camTrackSid: string | undefined;
  screenTrackSid: string | undefined;
}

export interface DeviceInfo {
  deviceId: string;
  label: string;
}

export interface DeviceLists {
  audioInputs: DeviceInfo[];
  videoInputs: DeviceInfo[];
  audioOutputs: DeviceInfo[];
}

export interface InputDevices {
  audioInput?: string;
  videoInput?: string;
  audioOutput?: string;
}

export interface MediaSnapshot {
  status: MediaStatus;
  /** Portuguese, user-facing explanation for `unavailable` / `error`. */
  statusMessage: string | null;
  roomId: string | null;
  localIdentity: string | null;
  canPublish: boolean;
  rights: PublishRights;
  participants: MediaParticipant[];
  micOn: boolean;
  camOn: boolean;
  screenOn: boolean;
  micPermission: PermissionState;
  camPermission: PermissionState;
  screenPermission: PermissionState;
  /** Latest actionable warning (denied permission, device busy...). Cleared by `dismissNotice`. */
  notice: string | null;
  /** The browser blocked audio autoplay: show the "ativar áudio" button. */
  audioBlocked: boolean;
  mode: ProximityMode;
  proximity: ProximityParams;
  devices: DeviceLists;
  selected: InputDevices;
}

export interface MediaClientOptions {
  /** Dev only: identify by name when there is no session cookie (server needs ALLOW_DEV_LOGIN=1). */
  devName?: string;
  tokenUrl?: string;
  /** Proximity volume refresh interval. Default 200 ms (5x/s). */
  proximityIntervalMs?: number;
}

/** Espera antes de pedir o token ao trocar de sala: trocas rapidas em sequencia viram uma so chamada. */
const CONNECT_DEBOUNCE_MS = 300;
const LS_MODE = 'wv.media.mode';
const LS_PROX = 'wv.media.proximity';
const LS_DEV = 'wv.media.devices';

function lsGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function lsSet(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage blocked: preference lasts for this session only */
  }
}

function loadJson<T>(key: string): T | undefined {
  const raw = lsGet(key);
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

const EMPTY_DEVICES: DeviceLists = { audioInputs: [], videoInputs: [], audioOutputs: [] };
const MSG = {
  micDenied: 'Microfone bloqueado. Libere o acesso no ícone de cadeado do navegador para falar. O chat continua funcionando.',
  camDenied: 'Câmera bloqueada. Libere o acesso no ícone de cadeado do navegador para usar vídeo. O chat continua funcionando.',
  micMissing: 'Nenhum microfone encontrado (ou o navegador não permite acesso a ele aqui). O chat continua funcionando.',
  camMissing: 'Nenhuma câmera encontrada (ou o navegador não permite acesso a ela aqui). O chat continua funcionando.',
  busy: 'O dispositivo está em uso por outro programa. Feche-o e tente de novo.',
  noPublish: 'Você não tem permissão para transmitir nesta sala.',
  tvScreenOnly: 'Só quem está apresentando na TV da sala compartilha a tela. Clique na TV para apresentar.',
  audienceOnly: 'Na plateia só se fala quando o palestrante dá a palavra. Levante a mão para pedir.',
  rightsLost: 'Sua transmissão foi encerrada: você não está mais com a palavra.',
  screenUnsupported: 'Este navegador não permite compartilhar a tela.',
  screenCancelled: 'Compartilhamento de tela cancelado.',
  screenDenied: 'O navegador bloqueou o compartilhamento de tela.',
  generic: 'Não foi possível ativar. Tente de novo.',
  unavailable: 'Mídia indisponível: o servidor de áudio e vídeo não está acessível. O chat e o jogo continuam normais.',
};

function errName(e: unknown): string {
  return e && typeof e === 'object' && 'name' in e ? String((e as { name: unknown }).name) : '';
}

/** Maps a getUserMedia/getDisplayMedia failure to a permission state. */
function classify(e: unknown): 'denied' | 'missing' | 'busy' | 'other' {
  const n = errName(e);
  if (n === 'NotAllowedError' || n === 'PermissionDeniedError' || n === 'SecurityError') return 'denied';
  if (n === 'NotFoundError' || n === 'DevicesNotFoundError' || n === 'OverconstrainedError' || n === 'TypeError') return 'missing';
  if (n === 'NotReadableError' || n === 'TrackStartError' || n === 'AbortError') return 'busy';
  const msg = e instanceof Error ? e.message.toLowerCase() : '';
  if (msg.includes('permission') || msg.includes('denied')) return 'denied';
  if (msg.includes('not found') || msg.includes('no device')) return 'missing';
  return 'other';
}

/**
 * Audio, video and screen share on top of LiveKit. One instance per page; `connect(roomId)` follows the
 * player between world rooms. Nothing here asks for camera/microphone access until `toggleMic`/`toggleCam`
 * are called by a user click. Failures are reported through the snapshot, never thrown at the UI.
 */
export class MediaClient {
  private snapshot: MediaSnapshot;
  private listeners = new Set<() => void>();
  private room: Room | undefined;
  private generation = 0;
  private wantedRoom: string | null = null;
  private tilePos: TilePositionProvider = () => undefined;
  private proxTimer: ReturnType<typeof setInterval> | undefined;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  /** Espera pedida pelo servidor (Retry-After de um 429) para a proxima tentativa. */
  private retryHintMs = 0;
  private retries = 0;
  private audioHost: HTMLDivElement | undefined;
  private audioEls = new Map<string, HTMLMediaElement>();
  private wantMic = false;
  private wantCam = false;
  private permCleanup: (() => void)[] = [];
  private readonly opts: Required<Pick<MediaClientOptions, 'tokenUrl' | 'proximityIntervalMs'>> & MediaClientOptions;
  private lastVolumes = new Map<string, number>();
  private wantedKind: MediaKind = 'room';
  /** Speaker and people with the floor in an auditorium: always audible, whatever the proximity mode. */
  private stageVoices = new Set<string>();

  constructor(opts: MediaClientOptions = {}) {
    this.opts = { tokenUrl: '/api/media/token', proximityIntervalMs: 200, ...opts };
    const storedMode = lsGet(LS_MODE);
    const hasUserMedia = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
    const hasDisplay = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia;
    this.snapshot = {
      status: 'idle',
      statusMessage: null,
      roomId: null,
      localIdentity: null,
      canPublish: true,
      rights: 'all',
      participants: [],
      micOn: false,
      camOn: false,
      screenOn: false,
      micPermission: hasUserMedia ? 'prompt' : 'unavailable',
      camPermission: hasUserMedia ? 'prompt' : 'unavailable',
      screenPermission: hasDisplay ? 'prompt' : 'unavailable',
      notice: null,
      audioBlocked: false,
      mode: isProximityMode(storedMode) ? storedMode : 'room',
      proximity: sanitizeParams(loadJson<Partial<ProximityParams>>(LS_PROX) ?? DEFAULT_PROXIMITY),
      devices: EMPTY_DEVICES,
      selected: loadJson<InputDevices>(LS_DEV) ?? {},
    };
    this.watchPermissions();
  }

  // ---- reactive store (useSyncExternalStore) ------------------------------

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): MediaSnapshot => this.snapshot;

  private patch(p: Partial<MediaSnapshot>) {
    this.snapshot = { ...this.snapshot, ...p };
    this.listeners.forEach((l) => l());
  }

  setTilePositionProvider(fn: TilePositionProvider | undefined) {
    this.tilePos = fn ?? (() => undefined);
  }

  // ---- connection ---------------------------------------------------------

  /** Joins the LiveKit room of a world room (leaving the previous one). Idempotent for the same room. */
  async connect(roomId: string, kind: MediaKind = 'room'): Promise<void> {
    if (this.wantedRoom === roomId && this.wantedKind === kind && this.room && this.room.state !== ConnectionState.Disconnected) return;
    this.wantedRoom = roomId;
    this.wantedKind = kind;
    this.retries = 0;
    // Trocas de sala em sequencia rapida pedem so um token (o da sala em que o usuario parou): sem isso cada sala
    // do caminho gasta uma chamada /api/media/token e o limite do servidor (429) derruba a chamada de verdade.
    const gen = ++this.generation;
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => {
      if (gen === this.generation && this.wantedRoom === roomId) void this.open(roomId);
    }, CONNECT_DEBOUNCE_MS);
  }

  /** Leaves the room and releases the camera, microphone and audio elements. */
  async disconnect(): Promise<void> {
    this.wantedRoom = null;
    this.generation++;
    clearTimeout(this.retryTimer);
    await this.teardown();
    this.wantMic = false;
    this.wantCam = false;
    this.patch({ status: 'idle', statusMessage: null, roomId: null, localIdentity: null, participants: [], micOn: false, camOn: false, screenOn: false });
  }

  /** Stops everything and removes listeners from the page (call when discarding the instance). */
  async dispose(): Promise<void> {
    await this.disconnect();
    this.permCleanup.forEach((f) => f());
    this.permCleanup = [];
    this.audioHost?.remove();
    this.audioHost = undefined;
    this.listeners.clear();
  }

  private async teardown() {
    clearInterval(this.proxTimer);
    this.proxTimer = undefined;
    const room = this.room;
    this.room = undefined;
    this.lastVolumes.clear();
    for (const el of this.audioEls.values()) {
      el.srcObject = null;
      el.remove();
    }
    this.audioEls.clear();
    if (room) {
      room.removeAllListeners();
      try {
        await room.disconnect(true);
      } catch {
        /* already closed */
      }
    }
  }

  private async fetchToken(roomId: string): Promise<{ token: string; url: string; identity: string; canPublish: boolean; rights?: PublishRights } | 'unavailable' | 'error'> {
    let res: Response;
    try {
      res = await fetch(this.opts.tokenUrl, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomId, kind: this.wantedKind, ...(this.opts.devName ? { devName: this.opts.devName } : {}) }),
      });
    } catch {
      return 'unavailable';
    }
    if (res.status === 429) {
      const wait = Number(res.headers.get('Retry-After'));
      this.retryHintMs = Number.isFinite(wait) && wait > 0 ? Math.min(60, wait) * 1000 : 0;
    }
    if (res.status === 503) return 'unavailable';
    if (res.status === 403 || res.status === 404) return 'error'; // not in that room (yet): the caller retries
    if (!res.ok) return 'error';
    try {
      return (await res.json()) as { token: string; url: string; identity: string; canPublish: boolean; rights?: PublishRights };
    } catch {
      return 'error';
    }
  }

  private async open(roomId: string) {
    const gen = ++this.generation;
    clearTimeout(this.retryTimer);
    await this.teardown();
    if (gen !== this.generation) return;
    this.patch({ status: 'connecting', statusMessage: null, roomId, participants: [], micOn: false, camOn: false, screenOn: false, localIdentity: null });

    const t = await this.fetchToken(roomId);
    if (gen !== this.generation) return;
    if (t === 'unavailable') {
      this.patch({ status: 'unavailable', statusMessage: MSG.unavailable });
      return this.scheduleRetry(roomId, gen, 15_000);
    }
    if (t === 'error') {
      this.patch({ status: 'error', statusMessage: 'Não foi possível entrar na chamada desta sala. Tentando de novo...' });
      return this.scheduleRetry(roomId, gen);
    }

    const sel = this.snapshot.selected;
    const room = new Room({
      adaptiveStream: true,
      dynacast: true,
      audioCaptureDefaults: { deviceId: sel.audioInput, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      // Modo economia de dados (Meu perfil): camera em 360p.
      videoCaptureDefaults: { deviceId: sel.videoInput, ...(dataSaverOn() ? { resolution: VideoPresets.h360.resolution } : {}) },
      audioOutput: { deviceId: sel.audioOutput },
    });
    this.room = room;
    this.bind(room, gen);
    try {
      await room.connect(t.url, t.token, { autoSubscribe: true });
    } catch {
      if (gen !== this.generation) return;
      this.room = undefined;
      this.patch({ status: 'unavailable', statusMessage: MSG.unavailable });
      return this.scheduleRetry(roomId, gen, 15_000);
    }
    if (gen !== this.generation) {
      await room.disconnect().catch(() => undefined);
      return;
    }
    this.retries = 0;
    const rights: PublishRights = t.rights ?? (t.canPublish ? 'all' : 'none');
    this.patch({ status: 'connected', statusMessage: null, localIdentity: t.identity, canPublish: rights !== 'none', rights });
    this.startProximity();
    this.refresh();
    void this.refreshDevices();
    // Keep what the user already enabled when they walk into another room (no new permission prompt: already granted).
    if (rights !== 'none') {
      if (this.wantMic) void this.setEnabled('mic', true);
      if (this.wantCam && (rights === 'all' || rights === 'av')) void this.setEnabled('cam', true);
    }
  }

  private scheduleRetry(roomId: string, gen: number, minMs = 1000) {
    this.retries++;
    const delay = Math.min(30_000, Math.max(minMs, this.retryHintMs, 1000 * 2 ** this.retries)) + Math.random() * 500;
    this.retryHintMs = 0;
    this.retryTimer = setTimeout(() => {
      if (gen !== this.generation || this.wantedRoom !== roomId) return;
      void this.open(roomId);
    }, delay);
  }

  private bind(room: Room, gen: number) {
    const changed = () => {
      if (gen === this.generation) this.refresh();
    };
    room
      .on(RoomEvent.ParticipantConnected, changed)
      .on(RoomEvent.ParticipantDisconnected, changed)
      .on(RoomEvent.ParticipantNameChanged, changed)
      .on(RoomEvent.TrackPublished, changed)
      .on(RoomEvent.TrackUnpublished, changed)
      .on(RoomEvent.TrackMuted, changed)
      .on(RoomEvent.TrackUnmuted, changed)
      .on(RoomEvent.LocalTrackPublished, changed)
      .on(RoomEvent.LocalTrackUnpublished, changed)
      .on(RoomEvent.ActiveSpeakersChanged, changed)
      .on(RoomEvent.TrackSubscribed, (track: RemoteTrack, _pub, participant: RemoteParticipant) => {
        if (gen !== this.generation) return;
        if (track.kind === Track.Kind.Audio) this.attachAudio(track, participant);
        this.refresh();
      })
      .on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
        if (gen !== this.generation) return;
        if (track.kind === Track.Kind.Audio) this.detachAudio(track);
        this.refresh();
      })
      .on(RoomEvent.AudioPlaybackStatusChanged, () => {
        if (gen === this.generation) this.patch({ audioBlocked: !room.canPlaybackAudio });
      })
      .on(RoomEvent.MediaDevicesChanged, () => {
        if (gen === this.generation) void this.refreshDevices();
      })
      .on(RoomEvent.MediaDevicesError, (e: Error) => {
        if (gen === this.generation) this.handleMediaError(e, 'mic');
      })
      .on(RoomEvent.ParticipantPermissionsChanged, (_prev, participant: Participant) => {
        if (gen === this.generation && participant === room.localParticipant) this.onLocalPermissions(room);
      })
      .on(RoomEvent.Reconnecting, () => gen === this.generation && this.patch({ status: 'reconnecting' }))
      .on(RoomEvent.Reconnected, () => gen === this.generation && this.patch({ status: 'connected' }))
      .on(RoomEvent.Disconnected, () => {
        if (gen !== this.generation || this.room !== room) return;
        // Unexpected drop (network, server restart, expired token): rejoin with a fresh token.
        this.patch({ status: 'reconnecting', participants: [], micOn: false, camOn: false, screenOn: false });
        const id = this.wantedRoom;
        if (id) this.scheduleRetry(id, gen);
      });
  }

  /** The server changed what we may publish (stage taken or released, floor given or taken back). */
  private onLocalPermissions(room: Room) {
    const perm = room.localParticipant.permissions;
    let rights: PublishRights = 'all';
    if (!perm?.canPublish) rights = 'none';
    else {
      // An empty list means "every source" for LiveKit; 1 = camera, 2 = microphone, 3/4 = screen share.
      const src = perm.canPublishSources ?? [];
      if (src.length > 0 && !src.includes(3)) rights = src.includes(1) ? 'av' : 'audio';
    }
    if (rights === this.snapshot.rights) return;
    const wasTransmitting = this.snapshot.micOn || this.snapshot.camOn || this.snapshot.screenOn;
    this.patch({ rights, canPublish: rights !== 'none' });
    const lp = room.localParticipant;
    if (rights !== 'all') void lp.setScreenShareEnabled(false).catch(() => undefined);
    if (rights === 'audio' || rights === 'none') {
      void lp.setCameraEnabled(false).catch(() => undefined);
      this.wantCam = false;
    }
    if (rights === 'none') {
      void lp.setMicrophoneEnabled(false).catch(() => undefined);
      this.wantMic = false;
      if (wasTransmitting) this.patch({ notice: MSG.rightsLost });
    }
    this.refresh();
  }

  /** Speaker and people with the floor in an auditorium (player ids): their audio ignores the proximity mode. */
  setStageVoices(ids: readonly string[]) {
    const next = new Set(ids);
    if (next.size === this.stageVoices.size && [...next].every((i) => this.stageVoices.has(i))) return;
    this.stageVoices = next;
    this.lastVolumes.clear();
    this.applyVolumes();
  }

  // ---- audio --------------------------------------------------------------

  private host(): HTMLDivElement {
    if (!this.audioHost) {
      const d = document.createElement('div');
      d.setAttribute('data-wv-media-audio', '');
      d.style.display = 'none';
      document.body.appendChild(d);
      this.audioHost = d;
    }
    return this.audioHost;
  }

  private attachAudio(track: RemoteTrack, participant: RemoteParticipant) {
    const el = track.attach() as HTMLMediaElement;
    el.autoplay = true;
    el.setAttribute('data-identity', participant.identity);
    this.host().appendChild(el);
    const sid = track.sid ?? `${participant.identity}:${track.source}`;
    this.audioEls.set(sid, el);
    this.applyVolumes();
    // `play()` may be rejected by the autoplay policy: LiveKit then reports canPlaybackAudio=false.
    void el.play?.().catch(() => this.patch({ audioBlocked: true }));
    if (this.room && !this.room.canPlaybackAudio) this.patch({ audioBlocked: true });
  }

  private detachAudio(track: RemoteTrack) {
    for (const el of track.detach()) el.remove();
    for (const [sid, el] of this.audioEls) if (sid === track.sid) this.audioEls.delete(sid);
  }

  /** User gesture: lets the browser start audio that autoplay blocked. */
  async enableAudio(): Promise<void> {
    try {
      await this.room?.startAudio();
    } catch {
      /* still blocked: the button stays visible */
    }
    for (const el of this.audioEls.values()) void el.play?.().catch(() => undefined);
    this.patch({ audioBlocked: this.room ? !this.room.canPlaybackAudio : false });
  }

  setMode(mode: ProximityMode) {
    if (!isProximityMode(mode)) return;
    lsSet(LS_MODE, mode);
    this.patch({ mode });
    this.applyVolumes();
  }

  setProximityParams(p: Partial<ProximityParams>) {
    const proximity = sanitizeParams({ ...this.snapshot.proximity, ...p });
    lsSet(LS_PROX, JSON.stringify(proximity));
    this.patch({ proximity });
    this.applyVolumes();
  }

  private startProximity() {
    clearInterval(this.proxTimer);
    this.proxTimer = setInterval(() => {
      if (this.snapshot.mode === 'proximity') this.applyVolumes();
    }, this.opts.proximityIntervalMs);
  }

  /** Sets every remote participant's playback volume from the mode (and distance, in proximity mode). */
  applyVolumes() {
    const room = this.room;
    if (!room) return;
    const { mode, proximity, localIdentity } = this.snapshot;
    const self = localIdentity ? this.tilePos(localIdentity) : undefined;
    for (const p of room.remoteParticipants.values()) {
      const v = this.stageVoices.has(p.identity) ? (mode === 'off' ? 0 : 1) : volumeFor(mode, self, this.tilePos(p.identity), proximity);
      if (this.lastVolumes.get(p.identity) === v) continue;
      this.lastVolumes.set(p.identity, v);
      p.setVolume(v, Track.Source.Microphone);
      p.setVolume(v, Track.Source.ScreenShareAudio);
    }
  }

  /** Current computed volume of a remote participant (0..1); useful for UI and tests. */
  volumeOf(identity: string): number | undefined {
    return this.lastVolumes.get(identity);
  }

  // ---- publishing ---------------------------------------------------------

  async toggleMic(): Promise<void> {
    await this.setEnabled('mic', !this.snapshot.micOn);
  }
  async toggleCam(): Promise<void> {
    await this.setEnabled('cam', !this.snapshot.camOn);
  }
  async toggleScreenShare(): Promise<void> {
    await this.setEnabled('screen', !this.snapshot.screenOn);
  }

  dismissNotice() {
    this.patch({ notice: null });
  }

  private async setEnabled(kind: 'mic' | 'cam' | 'screen', on: boolean) {
    const room = this.room;
    if (!room || room.state !== ConnectionState.Connected) {
      this.patch({ notice: 'Sem conexão com a chamada desta sala no momento.' });
      return;
    }
    const rights = this.snapshot.rights;
    if (on && (rights === 'none' || (rights === 'audio' && kind !== 'mic') || (rights === 'av' && kind === 'screen'))) {
      this.patch({ notice: rights === 'av' ? MSG.tvScreenOnly : this.wantedKind === 'stage' ? MSG.audienceOnly : MSG.noPublish });
      return;
    }
    if (on && kind !== 'screen' && this.snapshot[kind === 'mic' ? 'micPermission' : 'camPermission'] === 'unavailable') {
      this.patch({ notice: kind === 'mic' ? MSG.micMissing : MSG.camMissing });
      return;
    }
    if (on && kind === 'screen' && this.snapshot.screenPermission === 'unavailable') {
      this.patch({ notice: MSG.screenUnsupported });
      return;
    }
    const lp: LocalParticipant = room.localParticipant;
    try {
      if (kind === 'mic') {
        await lp.setMicrophoneEnabled(on);
        this.wantMic = on;
        if (on) this.patch({ micPermission: 'granted', notice: null });
      } else if (kind === 'cam') {
        await lp.setCameraEnabled(on);
        this.wantCam = on;
        if (on) this.patch({ camPermission: 'granted', notice: null });
      } else {
        await lp.setScreenShareEnabled(on, { audio: true, selfBrowserSurface: 'exclude' } as never);
        if (on) this.patch({ screenPermission: 'granted', notice: null });
      }
    } catch (e) {
      this.handleMediaError(e, kind);
    }
    this.refresh();
    if (on) void this.refreshDevices();
  }

  private handleMediaError(e: unknown, kind: 'mic' | 'cam' | 'screen') {
    const c = classify(e);
    if (kind === 'screen') {
      if (c === 'denied') {
        // NotAllowedError is also what a cancelled picker raises: treat as a soft notice, not a lasting denial.
        this.patch({ notice: MSG.screenCancelled });
      } else {
        this.patch({ notice: c === 'busy' ? MSG.busy : MSG.screenDenied });
      }
      return;
    }
    if (kind === 'mic') this.wantMic = false;
    else this.wantCam = false;
    const key = kind === 'mic' ? 'micPermission' : 'camPermission';
    if (c === 'denied') this.patch({ [key]: 'denied', notice: kind === 'mic' ? MSG.micDenied : MSG.camDenied } as Partial<MediaSnapshot>);
    else if (c === 'missing') this.patch({ [key]: 'unavailable', notice: kind === 'mic' ? MSG.micMissing : MSG.camMissing } as Partial<MediaSnapshot>);
    else this.patch({ notice: c === 'busy' ? MSG.busy : MSG.generic });
  }

  /** Reads the browser permission state without prompting (Permissions API; unsupported browsers stay on 'prompt'). */
  private watchPermissions() {
    const perms = typeof navigator !== 'undefined' ? navigator.permissions : undefined;
    if (!perms?.query) return;
    const watch = (name: string, key: 'micPermission' | 'camPermission') => {
      perms
        .query({ name: name as PermissionName })
        .then((status) => {
          const apply = () => {
            if (this.snapshot[key] === 'unavailable') return;
            const s = status.state === 'granted' ? 'granted' : status.state === 'denied' ? 'denied' : 'prompt';
            this.patch({ [key]: s } as Partial<MediaSnapshot>);
          };
          apply();
          status.addEventListener('change', apply);
          this.permCleanup.push(() => status.removeEventListener('change', apply));
        })
        .catch(() => undefined);
    };
    watch('microphone', 'micPermission');
    watch('camera', 'camPermission');
  }

  // ---- devices ------------------------------------------------------------

  private async refreshDevices() {
    const room = this.room;
    if (!room || !navigator.mediaDevices?.enumerateDevices) return;
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      const pick = (kind: MediaDeviceKind): DeviceInfo[] =>
        all.filter((d) => d.kind === kind && d.deviceId).map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Dispositivo ${i + 1}` }));
      if (room !== this.room) return;
      this.patch({ devices: { audioInputs: pick('audioinput'), videoInputs: pick('videoinput'), audioOutputs: pick('audiooutput') } });
    } catch {
      /* enumeration is cosmetic */
    }
  }

  async setInputDevices(d: InputDevices): Promise<void> {
    const selected = { ...this.snapshot.selected, ...d };
    lsSet(LS_DEV, JSON.stringify(selected));
    this.patch({ selected });
    const room = this.room;
    if (!room) return;
    try {
      if (d.audioInput) await room.switchActiveDevice('audioinput', d.audioInput);
      if (d.videoInput) await room.switchActiveDevice('videoinput', d.videoInput);
      if (d.audioOutput) await room.switchActiveDevice('audiooutput', d.audioOutput);
    } catch {
      this.patch({ notice: 'Não foi possível trocar de dispositivo. O navegador pode não permitir essa troca.' });
    }
  }

  // ---- participants / video ----------------------------------------------

  private find(identity: string): Participant | undefined {
    const room = this.room;
    if (!room) return undefined;
    return room.localParticipant.identity === identity ? room.localParticipant : room.remoteParticipants.get(identity);
  }

  /** Attaches the participant's camera or screen video to an element; returns the detach function. */
  attachVideo(identity: string, source: VideoSource, el: HTMLVideoElement): () => void {
    const pub = this.find(identity)?.getTrackPublication(source === 'camera' ? Track.Source.Camera : Track.Source.ScreenShare);
    const track = pub?.track;
    if (!track) return () => undefined;
    track.attach(el);
    return () => {
      track.detach(el);
    };
  }

  private describe(p: Participant, isLocal: boolean): MediaParticipant {
    const mic = p.getTrackPublication(Track.Source.Microphone);
    const cam = p.getTrackPublication(Track.Source.Camera);
    const scr = p.getTrackPublication(Track.Source.ScreenShare);
    const live = (pub: typeof mic) => !!pub && !pub.isMuted && (isLocal ? !!pub.track : true);
    return {
      identity: p.identity,
      name: p.name || p.identity,
      isLocal,
      micOn: live(mic),
      camOn: live(cam),
      screenOn: live(scr),
      micPublished: !!mic && (isLocal ? !!mic.track : true),
      camPublished: !!cam && (isLocal ? !!cam.track : true),
      speaking: p.isSpeaking,
      camTrackSid: cam?.track ? cam.trackSid : undefined,
      screenTrackSid: scr?.track ? scr.trackSid : undefined,
    };
  }

  private refresh() {
    const room = this.room;
    if (!room) return;
    const me = this.describe(room.localParticipant, true);
    const others = [...room.remoteParticipants.values()].map((p) => this.describe(p, false)).sort((a, b) => a.name.localeCompare(b.name));
    this.applyVolumes();
    this.patch({
      participants: [me, ...others],
      micOn: me.micOn,
      camOn: me.camOn,
      screenOn: me.screenOn,
      audioBlocked: this.snapshot.audioBlocked ? !room.canPlaybackAudio : false,
    });
  }
}
