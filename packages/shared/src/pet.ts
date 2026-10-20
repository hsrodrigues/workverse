import type { Dir8, Point } from './geometry';
import { isForbiddenChar } from './directory';
import type { RoomAccess, RoomType } from './rooms';

/**
 * Byte, o gatinho-robo do escritorio. NAO e um jogador: vive no servidor (um por organizacao, estado em memoria), nao conta em
 * populacao, presenca, listas, diretorio nem inventario de PCs. O servidor decide tudo (para onde anda, quando dorme);
 * o cliente so desenha. Ver docs/pet.md.
 */

export const PET_DEFAULT_NAME = 'Byte';
export const MAX_PET_NAME = 16;
export const MIN_PET_NAME = 2;

/** Posturas visiveis. `walk` e `idle` tambem aparecem com caminho/sem caminho; as demais duram alguns segundos. */
export type PetState = 'idle' | 'walk' | 'sit' | 'sleep' | 'happy' | 'eat';
export const PET_STATES: readonly PetState[] = ['idle', 'walk', 'sit', 'sleep', 'happy', 'eat'];
export const isPetState = (v: unknown): v is PetState => typeof v === 'string' && (PET_STATES as readonly string[]).includes(v);

/** Efeitos pontuais: coracoes (carinho), batida de coracao (autoping), comendo. */
export type PetFx = 'hearts' | 'beat' | 'eat';

/** O que uma pessoa pode pedir ao Byte. */
export type PetAct = 'pat' | 'treat' | 'call' | 'play';
export const PET_ACTS: readonly PetAct[] = ['pat', 'treat', 'call', 'play'];
export const isPetAct = (v: unknown): v is PetAct => typeof v === 'string' && (PET_ACTS as readonly string[]).includes(v);

export const PET_ACT_LABELS: Record<PetAct, string> = { pat: 'Fazer carinho', treat: 'Dar petisco', call: 'Chamar', play: 'Brincar' };

export interface PetView {
  name: string;
  x: number;
  y: number;
  dir: Dir8;
  state: PetState;
  /** Caminho restante (mesmo formato dos jogadores). */
  path: Point[];
  stepRemainingMs: number;
}

/** Linha da lista de staff (por organizacao). */
export interface PetAdminEntry {
  orgId: string;
  orgName: string;
  enabled: boolean;
  name: string;
  roomId: string | null;
  roomName: string | null;
}
export type PetStaffOp = 'list' | 'on' | 'off' | 'rename' | 'bring';
export const PET_STAFF_OPS: readonly PetStaffOp[] = ['list', 'on', 'off', 'rename', 'bring'];

// ---- tempos (servidor) -------------------------------------------------------------------------------------

/** Atraso entre decisoes de passeio (aleatorio dentro da faixa). */
export const PET_IDLE_MIN_MS = 4_000;
export const PET_IDLE_MAX_MS = 11_000;
/** Quanto tempo ele senta / dorme / fica feliz / come antes de decidir de novo. */
export const PET_SIT_MS = [14_000, 30_000] as const;
export const PET_SLEEP_MS = [30_000, 70_000] as const;
export const PET_HAPPY_MS = 3_500;
export const PET_EAT_MS = 4_500;
/** Chance (0..1) de, em cada decisao, atravessar uma porta para outra sala. */
export const PET_ROOM_CHANGE_CHANCE = 0.12;
/** Sala vazia: de vez em quando ele sai atras de gente. */
export const PET_EMPTY_ROOM_MOVE_MS = 45_000;
/** "Chamar" faz o Byte seguir a pessoa por este tempo; "Brincar" persegue o ponteiro. */
export const PET_FOLLOW_MS = 8_000;
export const PET_PLAY_MS = 5_000;
/** Distancia maxima (tiles, Chebyshev) para interagir. */
export const PET_REACH = 6;
/** Intervalo minimo por pessoa entre petiscos. */
export const PET_TREAT_COOLDOWN_MS = 20_000;
/** Falas espontaneas: chance por decisao e intervalo minimo. */
export const PET_SAY_CHANCE = 0.18;
export const PET_SAY_MIN_GAP_MS = 25_000;

// ---- regras de zona ----------------------------------------------------------------------------------------

export interface PetZoneInfo {
  type?: RoomType;
  access: RoomAccess;
  /** Estado de acesso da equipe: aberta, trancada ou fechada. */
  state: 'open' | 'locked' | 'closed';
  /** Ha palco ativo (apresentador) na sala. */
  stageActive: boolean;
  /** Reservada agora (reserva de sala). */
  reserved: boolean;
}

/** Tipos de sala em que o Byte nunca entra, mesmo abertos (silencio / concentracao e privacidade). */
export const PET_BANNED_TYPES: readonly RoomType[] = ['private', 'focus'];

/**
 * O Byte so entra em salas abertas a toda a organizacao: acesso `org`, nao trancadas nem fechadas, nao reservadas, nao privadas
 * nem de foco, e nao no auditorio/TV enquanto alguem apresenta.
 */
export function petRoomAllowed(z: PetZoneInfo): boolean {
  if (z.access !== 'org') return false;
  if (z.state !== 'open') return false;
  if (z.reserved || z.stageActive) return false;
  if (z.type && (PET_BANNED_TYPES as readonly string[]).includes(z.type)) return false;
  return true;
}

// ---- nome --------------------------------------------------------------------------------------------------

/** Nome valido do pet (letras/numeros/espacos/-_), ou null. */
export function cleanPetName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  let s = '';
  for (const ch of raw.normalize('NFKC')) s += isForbiddenChar(ch.codePointAt(0)!) ? ' ' : ch;
  s = s.replace(/\s+/g, ' ').trim();
  const n = [...s].length;
  if (n < MIN_PET_NAME || n > MAX_PET_NAME) return null;
  if (!/^[\p{L}\p{N}][\p{L}\p{N} _-]*$/u.test(s)) return null;
  return s;
}

// ---- falas -------------------------------------------------------------------------------------------------

export const PET_LINES = {
  random: [
    'miau.exe parou de responder',
    'sudo dar petisco',
    'compilando soneca…',
    'Já tentou me desligar e ligar de novo?',
    'Ronc.exe em execução',
    'git commit -m "mais carinho"',
    'Erro 404: ratinho não encontrado',
    'ping… pong! Tudo certo por aqui',
    'while(true) { fazer_carinho(); }',
    'Cache cheio de petiscos',
    'Reiniciando o ronronar…',
    'npm install carinho',
  ],
  pat: ['prrrr… ronron', 'ronronando em 60 fps', 'prrr, carinho.exe instalado!', 'miau! (traduzindo: mais um pouquinho)'],
  treat: ['nham nham, obrigado!', 'petisco.zip extraído com sucesso', 'miau! Delícia!', 'sudo comer tudo'],
  call: ['a caminho!', 'miau, chegando!', 'indo até você…'],
  play: ['vou pegar!', 'modo caça ativado', 'ataque ao ponteiro!'],
  sleepy: ['zzz… compilando soneca', 'zzz…'],
  tooFar: 'O Byte está longe demais. Chegue mais perto!',
  slow: 'Calma, o Byte precisa respirar!',
  cooldown: 'O Byte ainda está cheio de petisco. Tente de novo daqui a pouco.',
  off: 'O Byte está de folga hoje.',
} as const;

export const PET_ACT_LINES: Record<PetAct, readonly string[]> = { pat: PET_LINES.pat, treat: PET_LINES.treat, call: PET_LINES.call, play: PET_LINES.play };

/** Escolhe uma fala de uma lista com um sorteio em [0,1). Pura (testada). */
export function pickLine(list: readonly string[], rnd: number): string {
  return list[Math.min(list.length - 1, Math.max(0, Math.floor(rnd * list.length)))]!;
}

// ---- cliente: direcao de 4 vistas --------------------------------------------------------------------------

/** As 4 vistas isometricas do Byte: SE, SW, NW, NE (SE/NE sao espelho de SW/NW). */
export type PetFacing = 'se' | 'sw' | 'nw' | 'ne';
const FACING: readonly PetFacing[] = ['se', 'se', 'sw', 'sw', 'nw', 'nw', 'ne', 'ne'];
export const petFacing = (d: Dir8): PetFacing => FACING[d]!;
/** Vista de frente (rosto visivel) ou de costas; `flip` espelha a arte desenhada para SW/NW. */
export const petViewOf = (f: PetFacing): { back: boolean; flip: boolean } => ({ back: f === 'nw' || f === 'ne', flip: f === 'se' || f === 'ne' });
