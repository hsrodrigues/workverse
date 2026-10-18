import type { AvatarConfig } from './avatar';
import type { AvatarClientMessage, AvatarServerMessage } from './items/messages';
import type { Dir8, Point } from './geometry';
import type { RoomDef } from './rooms';
import type { Permission, Role } from './rbac';
import type { Deck, SlideState, StageView } from './stage';
import type { Activity } from './activity';
import type { OnlineEntry, RoomAdminEntry, RoomOp, StaffLevel, StaffLogEntry } from './staff';

/** Time an avatar takes to cross one tile. Shared so client animation matches the server clock. */
export const STEP_MS = 380;
export const MAX_CHAT_LENGTH = 120;
export const MAX_NAME_LENGTH = 16;
export const MIN_NAME_LENGTH = 2;
export const NAME_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N} _-]*$/u;
export const MIN_PASSWORD_LENGTH = 10;
export const MAX_PASSWORD_LENGTH = 128;

export type Emote = 'wave';
export const EMOTES: readonly Emote[] = ['wave'];

/** Closed list of presence statuses; the server rejects anything else. */
export type PresenceStatus = 'available' | 'busy' | 'focus' | 'meeting' | 'away';
export const PRESENCE_STATUSES: readonly PresenceStatus[] = ['available', 'busy', 'focus', 'meeting', 'away'];
export const STATUS_LABELS: Record<PresenceStatus, string> = {
  available: 'Disponível',
  busy: 'Ocupado',
  focus: 'Concentrado',
  meeting: 'Em reunião',
  away: 'Ausente',
};
export const isPresenceStatus = (v: unknown): v is PresenceStatus =>
  typeof v === 'string' && (PRESENCE_STATUSES as readonly string[]).includes(v);
/** Idle time without any player action before the status flips to `away`. */
export const AUTO_AWAY_MS = 5 * 60_000;
/** Team of accounts that have none assigned. Only an admin will be able to change it (future work). */
export const DEFAULT_TEAM = 'geral';
/** Max length of the `to` field of a private message (account id or display name). */
export const MAX_DM_TARGET_LENGTH = 64;

export interface PlayerView {
  id: string;
  name: string;
  avatar: AvatarConfig;
  /** Logical tile: the tile the avatar is entering (or standing on). */
  x: number;
  y: number;
  dir: Dir8;
  sitting: boolean;
  status: PresenceStatus;
  /** What the avatar is doing with the environment (working at a PC, holding a cup...). */
  activity: Activity;
  /** Remaining tiles after (x,y). */
  path: Point[];
  /** Milliseconds until the current step finishes; used to line up late joiners. */
  stepRemainingMs: number;
  /** Selo de staff: só presente quando o SERVIDOR marcou a conta como staff em serviço. */
  staff?: StaffLevel;
}

export interface RoomSnapshot {
  def: RoomDef;
  youId: string;
  players: PlayerView[];
  furniState: Record<string, boolean>;
  population: Record<string, number>;
}

export type ClientMessage =
  /** The account comes from the session cookie. `name`/`avatar` are honoured only when the server runs with ALLOW_DEV_LOGIN=1. */
  | { t: 'hello'; name?: string; avatar?: AvatarConfig; /** Organization to enter; the server checks membership (default: the last one used). */ orgId?: string }
  | { t: 'join'; roomId?: string }
  | { t: 'move'; x: number; y: number }
  | { t: 'interact'; furniId: string; x: number; y: number }
  | { t: 'chat'; text: string }
  | { t: 'emote'; emote: Emote }
  | { t: 'avatar'; avatar: AvatarConfig }
  | AvatarClientMessage
  | { t: 'status'; status: PresenceStatus }
  /** Only `idle` is accepted (drop what you hold); `working` and `holding:*` are decided by the server from furniture. */
  | { t: 'activity'; activity: Activity }
  /** Private message. `to` is an account id or a display name. Never shown in bubbles or public chat. */
  | { t: 'dm'; to: string; text: string }
  /** Message to everyone online in the sender's team, in any room. */
  | { t: 'team'; text: string }
  | { t: 'ping'; ts: number }
  // ---- auditorium (only meaningful in a room with a podium; the server validates every one of them)
  /** Takes the stage when nobody holds it. */
  | { t: 'stage_take' }
  /** The speaker steps down; the presentation ends. */
  | { t: 'stage_release' }
  /** Speaker's client: "I am still here" (counts as activity so the stage is not lost to automatic away). */
  | { t: 'stage_alive' }
  /** Audience: ask for the floor / withdraw the request. */
  | { t: 'hand_raise' }
  | { t: 'hand_lower' }
  /** Speaker only: allow `id` (a player id) to speak (audio only) or take it back. */
  | { t: 'voice_grant'; id: string }
  | { t: 'voice_revoke'; id: string }
  /** Speaker only: replaces the deck (images are uploaded first through POST /api/stage/image). */
  | { t: 'deck_set'; deck: Deck }
  /** Speaker only. */
  /** `index`: slide to start from (default 0). */
  | { t: 'present_start'; index?: number }
  | { t: 'present_end' }
  | { t: 'slide_goto'; index: number }
  /** Speaker only: forgets the deck (and ends the presentation). */
  | { t: 'deck_clear' }
  /** Speaker only: open stage (anybody may turn on mic, camera and screen) / back to speaker only. */
  | { t: 'stage_open' }
  | { t: 'stage_close' }
  | StaffClientMessage;

export type ServerMessage =
  | {
      t: 'session';
      id: string;
      name: string;
      avatar: AvatarConfig;
      isNew: boolean;
      status: PresenceStatus;
      /** Name of the player's team in the organization (DEFAULT_TEAM when none). */
      team: string;
      orgId: string;
      orgName: string;
      role: Role;
      teamId: string | null;
      /** What the role allows. Only hides UI on the client; the server checks every action again. */
      perms: Permission[];
      /** Presente só para contas staff (definido pelo servidor). */
      staff?: StaffSelf;
    }
  /** The role or team of the live session changed (a member-management action). */
  | { t: 'perms'; orgId: string; role: Role; teamId: string | null; team: string; perms: Permission[] }
  | { t: 'room'; room: RoomSnapshot }
  | { t: 'joined'; player: PlayerView }
  | { t: 'left'; id: string }
  | { t: 'path'; id: string; from: Point; path: Point[]; stepRemainingMs: number }
  | { t: 'sit'; id: string; x: number; y: number; dir: Dir8 }
  /** Someone finished walking and now faces `dir` (the speaker on the stage). */
  | { t: 'face'; id: string; dir: Dir8 }
  | { t: 'chat'; id: string | null; name: string; text: string; kind: 'say' | 'system' }
  | { t: 'emote'; id: string; emote: Emote }
  | { t: 'avatar'; id: string; avatar: AvatarConfig }
  | AvatarServerMessage
  | { t: 'status'; id: string; status: PresenceStatus }
  | { t: 'activity'; id: string; activity: Activity }
  /** `peerId` is the other party's account id; `self` is true on the sender's echo. */
  | { t: 'dm'; peerId: string; peer: string; self: boolean; text: string; at: number }
  | { t: 'team'; team: string; from: string; self: boolean; text: string; at: number }
  | { t: 'furni'; id: string; on: boolean }
  | { t: 'population'; population: Record<string, number> }
  | { t: 'pong'; ts: number }
  /** Auditorium state; sent after `room` when entering one and on every change. */
  | { t: 'stage'; stage: StageView }
  | { t: 'deck'; deck: Deck | null }
  | { t: 'slide'; state: SlideState }
  | { t: 'error'; code: string; message: string }
  | StaffServerMessage;

/** Shape of the HTTP auth API (`/api/*`). */
export interface AccountView {
  id: string;
  email: string;
  displayName: string;
  avatar: AvatarConfig;
  /** Conta criada/redefinida por staff com senha provisoria: a pessoa precisa trocar a senha antes de entrar. */
  mustChangePassword?: boolean;
}

export interface ApiErrorBody {
  error: { code: string; message: string; retryAfterSeconds?: number };
}

export interface ServerConfig {
  /** True when the server accepts name-only `hello` (development / bots). */
  devLogin: boolean;
  /** Quem pode criar conta: open (qualquer um), invite (so com convite) ou closed (so pelo CLI). Ausente = open. */
  registration?: 'open' | 'invite' | 'closed';
}

// ---- staff da plataforma (ver docs/staff.md); o servidor valida nível, serviço, alvo e taxa de cada mensagem ----

export interface StaffSelf {
  level: StaffLevel;
  duty: boolean;
  invisible: boolean;
}

/** Só têm efeito para staff em serviço; qualquer outra conta recebe um erro genérico (e a tentativa é registrada). */
export type StaffClientMessage =
  | { t: 'staff_duty'; on: boolean }
  | { t: 'staff_invis'; on: boolean }
  /** Pede a lista de online (com sala e org) e o log das últimas ações. */
  | { t: 'staff_list' }
  /** minutes = 0 remove o silenciamento. */
  | { t: 'staff_mute'; target: string; minutes: number; reason?: string }
  | { t: 'staff_kick'; target: string; scope: 'room' | 'session'; reason?: string }
  | { t: 'staff_goto'; target: string }
  | { t: 'staff_bring'; target: string }
  /** scope 'room': a sala atual da staff, ou `orgId`+`roomId` de qualquer sala; 'org': todos online de `orgId`; 'all': todos. */
  | { t: 'staff_announce'; text: string; scope: 'room' | 'all' | 'org'; orgId?: string; roomId?: string; highlight?: boolean }
  /** Mensagem privada de staff para uma pessoa online (nao e uma DM comum). */
  | { t: 'staff_dm'; target: string; text: string }
  /** Pede a lista de salas (populacao, estado) de todas as organizacoes. */
  | { t: 'staff_rooms' }
  | { t: 'staff_room'; orgId: string; roomId: string; op: RoomOp }
  /** Concede/revoga uma chave de desbloqueio do guarda-roupa (ex.: event:natal, item:sp.mug_gold). */
  | { t: 'staff_item'; target: string; key: string; grant: boolean };

export type StaffServerMessage =
  | ({ t: 'staff_self' } & StaffSelf)
  | { t: 'staff_online'; players: OnlineEntry[] }
  | { t: 'staff_log'; entries: StaffLogEntry[]; append: boolean }
  /** Selo de um jogador da sala mudou (entrou/saiu de serviço). */
  | { t: 'staff_flag'; id: string; staff: StaffLevel | null }
  | { t: 'staff_rooms'; rooms: RoomAdminEntry[] }
  /** O nivel de staff desta conta foi removido (efeito imediato): esconda o painel. */
  | { t: 'staff_revoked' }
  /** Anúncio de staff: sala, organização, todos os online ou mensagem privada; `highlight` = destaque. */
  | { t: 'announce'; scope: 'room' | 'all' | 'org' | 'private'; from: string; level: StaffLevel; text: string; at: number; highlight?: boolean };
