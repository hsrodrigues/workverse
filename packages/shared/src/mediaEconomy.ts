/**
 * Economia de midia (audio/video/tela via LiveKit): tipos, mensagens e regras PURAS compartilhadas entre servidor e cliente.
 * Quem decide e o servidor (apps/server/src/mediaEconomy.ts); o cliente so aplica a politica que recebe e esconde UI.
 * Veja docs/media-economy.md.
 */

/** Cota do plano gratuito do LiveKit Cloud (minutos de participante por mes). Configuravel por MEDIA_MONTHLY_MINUTES. */
export const DEFAULT_MONTHLY_MINUTES = 5000;
export const QUOTA_WARN_RATIO = 0.7;
export const QUOTA_CRITICAL_RATIO = 0.9;

export type QuotaLevel = 'ok' | 'warn70' | 'warn90' | 'exceeded';

/** Percentual usado (0..100+, uma casa). Limite 0 = sem cota. */
export function quotaPercent(used: number, limit: number): number {
  if (!(limit > 0)) return 0;
  return Math.round((Math.max(0, used) / limit) * 1000) / 10;
}

export function quotaLevel(used: number, limit: number): QuotaLevel {
  if (!(limit > 0)) return 'ok';
  const r = Math.max(0, used) / limit;
  if (r >= 1) return 'exceeded';
  if (r >= QUOTA_CRITICAL_RATIO) return 'warn90';
  if (r >= QUOTA_WARN_RATIO) return 'warn70';
  return 'ok';
}

/** `AAAA-MM` do instante, no fuso (padrao -180 = Brasilia): a cota "volta no dia 1" nesse fuso. */
export function monthKey(now: number, tzOffsetMinutes = -180): string {
  const d = new Date(now + tzOffsetMinutes * 60_000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Politica de midia que o servidor manda a todos (hello e a cada mudanca). */
export interface MediaPolicy {
  /** Regras de economia valendo (MEDIA_ECONOMY ligado ou modo economia da staff). Falso = comportamento antigo: conecta ao entrar na sala. */
  economy: boolean;
  /** Modo economia da staff: video so no palco/TV; salas comuns so audio. */
  strict: boolean;
  /** Cota mensal estourada: nao ha mais tokens ate a virada do mes. */
  quotaExceeded: boolean;
  /** Segundos sem publicadores (e sem eu publicar) ate sair da chamada. */
  idleDisconnectSeconds: number;
  /** Segundos com a aba em segundo plano ate sair da chamada (se eu nao publico). */
  hiddenTabSeconds: number;
  maxVideoPublishers: number;
  maxPeoplePerRoom: number;
}

export const DEFAULT_MEDIA_POLICY: MediaPolicy = {
  economy: false,
  strict: false,
  quotaExceeded: false,
  idleDisconnectSeconds: 20,
  hiddenTabSeconds: 120,
  maxVideoPublishers: 6,
  maxPeoplePerRoom: 20,
};

/** O que o cliente diz sobre a propria midia (a intencao conta: quem clicou no mic ja vale, antes de terminar de conectar). */
export interface MediaReport {
  /** Conectado a sala do LiveKit. */
  connected: boolean;
  mic: boolean;
  cam: boolean;
  screen: boolean;
}

/** Quem esta publicando na sala (ids de jogador). `video` = camera ou tela. */
export interface MediaActive {
  roomId: string;
  publishers: string[];
  video: string[];
}

export interface MediaUsageView {
  /** `AAAA-MM`. */
  month: string;
  usedMinutes: number;
  limitMinutes: number;
  percent: number;
  level: QuotaLevel;
  strict: boolean;
  /** MEDIA_ECONOMY nao e `off`. */
  economyEnv: boolean;
  activeSessions: number;
  /** Sempre verdadeiro: e uma ESTIMATIVA local; a cota oficial esta no painel do LiveKit. */
  estimate: true;
  /** Minutos dos meses anteriores (mais recente primeiro). */
  history: Array<{ month: string; minutes: number }>;
  /** Salas com chamada ativa agora. */
  rooms: Array<{ orgId: string; roomId: string; connected: number; publishers: number }>;
}

/** Mensagens (pt-BR) de recusa e aviso: iguais no servidor e no cliente. */
export const MEDIA_TEXT = {
  quotaExceeded: 'A cota mensal de áudio e vídeo foi atingida; a chamada volta no dia 1. O jogo e o chat continuam normais.',
  quotaShort: 'Cota mensal de áudio e vídeo atingida; volta no dia 1.',
  roomFull: (n: number) => `A chamada desta sala está cheia (${n} pessoas). Você continua no jogo e no chat; tente de novo em instantes.`,
  videoLimit: (n: number) => `Esta sala já tem ${n} câmeras ou telas ligadas (o limite). Você pode falar só com áudio; tente a câmera quando alguém desligar.`,
  strictVideoOff: 'Modo economia ligado: câmera e tela só no palco e na TV. O áudio segue normal.',
  standby: 'Sem ninguém falando: chamada em espera (não gasta cota). Ao alguém falar, você conecta sozinho.',
  suspendedHidden: 'Chamada pausada: esta aba ficou em segundo plano. Volte para a aba para reconectar.',
  suspendedAway: 'Chamada pausada enquanto você está ausente. Volte para reconectar.',
  estimateNote: 'Estimativa local do servidor; a cota oficial está no painel do LiveKit.',
} as const;

// ---- video economico ----------------------------------------------------------------------------------------

export interface VideoProfile {
  camera: { width: number; height: number; frameRate: number; maxBitrate: number; maxFramerate: number; simulcast: boolean };
  screen: { width: number; height: number; frameRate: number; maxBitrate: number; maxFramerate: number; contentHint: 'text' | 'detail' | 'motion' };
  audio: { maxBitrate: number; dtx: boolean; red: boolean };
}

/** Pessoas a partir das quais vale publicar varias camadas (simulcast): com poucos pares uma camada so poupa CPU e banda de quem publica. */
export const SIMULCAST_MIN_PARTICIPANTS = 8;

/**
 * Resolucao, taxa e bitrate de captura/publicacao. Padrao moderado: camera 360p a 20 fps (~450 kbps), tela ate 1080p a 15 fps com
 * `contentHint: 'text'`, audio de fala (24 kbps) com DTX e RED. "Economia de dados" (preferencia da pessoa) e o modo economia da staff
 * baixam para 180p/12 fps e tela 720p/8 fps.
 */
export function videoProfile(opts: { lowData: boolean; strict: boolean; participants: number }): VideoProfile {
  const low = opts.lowData || opts.strict;
  return {
    camera: low
      ? { width: 320, height: 180, frameRate: 12, maxBitrate: 150_000, maxFramerate: 12, simulcast: false }
      : { width: 640, height: 360, frameRate: 20, maxBitrate: 450_000, maxFramerate: 20, simulcast: opts.participants >= SIMULCAST_MIN_PARTICIPANTS },
    screen: low
      ? { width: 1280, height: 720, frameRate: 8, maxBitrate: 600_000, maxFramerate: 8, contentHint: 'text' }
      : { width: 1920, height: 1080, frameRate: 15, maxBitrate: 1_500_000, maxFramerate: 15, contentHint: 'text' },
    audio: { maxBitrate: 24_000, dtx: true, red: true },
  };
}
