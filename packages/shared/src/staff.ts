/**
 * Staff da PLATAFORMA (suporte / moderação do WorkVerse). Não é um papel de organização (owner/admin/member/guest):
 * vale em todas as orgs só para moderar (presença, mute, kick, aviso) e é concedido SOMENTE pelo servidor
 * (BOOTSTRAP_STAFF_EMAILS ou o comando `staff:grant`). Nada aqui é decidido pelo cliente; o cliente só esconde UI.
 */
export type StaffLevel = 'helper' | 'moderator' | 'admin';
export const STAFF_LEVELS: readonly StaffLevel[] = ['helper', 'moderator', 'admin'];
export const STAFF_RANK: Readonly<Record<StaffLevel, number>> = { helper: 1, moderator: 2, admin: 3 };
export const STAFF_LABELS: Readonly<Record<StaffLevel, string>> = { helper: 'Ajudante', moderator: 'Moderador', admin: 'Administrador' };
export const isStaffLevel = (v: unknown): v is StaffLevel => typeof v === 'string' && (STAFF_LEVELS as readonly string[]).includes(v);

/** Ações de staff; cada uma exige um nível mínimo (e o staff precisa estar "em serviço"). */
export type StaffAction =
  | 'list'
  | 'invis'
  | 'goto'
  | 'bring'
  | 'mute'
  | 'unmute'
  | 'kick.room'
  | 'kick.session'
  | 'announce.room'
  | 'announce.all'
  | 'announce.org'
  | 'dm'
  | 'item.grant'
  | 'rooms.view'
  | 'rooms.control'
  | 'events.control'
  | 'accounts.view'
  | 'accounts.create'
  | 'accounts.reset'
  | 'accounts.disable'
  | 'ban'
  | 'unban'
  | 'audit.read'
  | 'staff.manage';

export const STAFF_MIN_LEVEL: Readonly<Record<StaffAction, StaffLevel>> = {
  list: 'helper',
  invis: 'helper',
  goto: 'helper',
  bring: 'helper',
  mute: 'helper',
  unmute: 'helper',
  'kick.room': 'helper',
  'kick.session': 'moderator',
  'announce.room': 'helper',
  'announce.all': 'moderator',
  'announce.org': 'moderator',
  dm: 'helper',
  'item.grant': 'admin',
  'rooms.view': 'helper',
  'rooms.control': 'moderator',
  'events.control': 'moderator',
  'accounts.view': 'helper',
  'accounts.create': 'moderator',
  'accounts.reset': 'moderator',
  'accounts.disable': 'moderator',
  ban: 'moderator',
  unban: 'moderator',
  'audit.read': 'moderator',
  'staff.manage': 'admin',
};

export const staffCan = (level: StaffLevel | null | undefined, action: StaffAction): boolean =>
  !!level && STAFF_RANK[level] >= STAFF_RANK[STAFF_MIN_LEVEL[action]];

/** Maior silenciamento permitido por nível, em minutos. */
export const MUTE_MAX_MINUTES: Readonly<Record<StaffLevel, number>> = { helper: 30, moderator: 24 * 60, admin: 7 * 24 * 60 };
/** Maior banimento temporario por nivel, em minutos (0 = nao pode banir; null = pode banir de forma permanente). */
export const BAN_MAX_MINUTES: Readonly<Record<StaffLevel, number | null>> = { helper: 0, moderator: 30 * 24 * 60, admin: null };
export const MAX_STAFF_REASON = 80;
/** Maior papel de organizacao que cada nivel de staff pode atribuir ao criar uma conta. */
export const CREATE_ROLE_MAX: Readonly<Record<StaffLevel, 'guest' | 'member' | 'owner'>> = { helper: 'guest', moderator: 'member', admin: 'owner' };

/** Linha da lista de online (somente staff recebe). Sem nenhum conteúdo de conversas. */
export interface OnlineEntry {
  id: string;
  /** Conta do jogador (para abrir a ficha e agir pela API de contas). */
  accountId: string;
  name: string;
  status: string;
  roomId: string | null;
  roomName: string;
  orgId: string;
  orgName: string;
  staff?: StaffLevel;
  muted: boolean;
  invisible: boolean;
}

export interface StaffLogEntry {
  at: number;
  actor: string;
  level: StaffLevel;
  action: string;
  target?: string;
  detail?: string;
}

/** Linha da lista de contas do painel. O e-mail vem mascarado, exceto para staff admin. */
export interface StaffAccountRow {
  id: string;
  displayName: string;
  email: string;
  emailMasked: boolean;
  /** Conta sem senha (login rapido de desenvolvimento). */
  dev: boolean;
  staff?: StaffLevel;
  online: boolean;
  orgId: string | null;
  orgName: string | null;
  role: string | null;
  lastLoginAt: number | null;
  createdAt: number;
  disabled: boolean;
  banned: boolean;
  muted: boolean;
  mustChangePassword: boolean;
}

export interface StaffAccountDetail extends StaffAccountRow {
  memberships: { orgId: string; orgName: string; role: string; team: string | null; status: string }[];
  ban: { at: number; by: string; reason: string; until: number | null } | null;
  disabledInfo: { at: number; by: string; reason: string } | null;
  mute: { until: number; by: string; reason: string } | null;
  unlocks: string[];
  createdBy: string | null;
  passwordChangedAt: number | null;
}

export interface StaffMemberRow {
  id: string;
  displayName: string;
  email: string;
  emailMasked: boolean;
  level: StaffLevel;
  online: boolean;
  /** Definido por BOOTSTRAP_STAFF_EMAILS: so se altera pela variavel de ambiente. */
  envManaged: boolean;
  disabled: boolean;
  banned: boolean;
}

/** Registro permanente de auditoria (nunca contem texto de mensagens privadas). */
export interface AuditRecord {
  id: string;
  at: number;
  actorId: string;
  actor: string;
  level: StaffLevel | null;
  action: string;
  targetId?: string;
  target?: string;
  detail?: string;
}

export interface RoomAdminEntry {
  orgId: string;
  orgName: string;
  roomId: string;
  name: string;
  count: number;
  max: number;
  state: 'open' | 'locked' | 'closed';
  /** A sala inicial nunca pode ser trancada, fechada ou esvaziada. */
  landing: boolean;
  players: { id: string; name: string }[];
}

export type RoomOp = 'lock' | 'unlock' | 'close' | 'open' | 'empty';
export const ROOM_OPS: readonly RoomOp[] = ['lock', 'unlock', 'close', 'open', 'empty'];

/** Mascara um e-mail: `ana.silva@empresa.com` -> `a***@e***.com`. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at < 1) return '***';
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const dot = domain.indexOf('.');
  const host = dot > 0 ? domain.slice(0, dot) : domain;
  const tld = dot > 0 ? domain.slice(dot) : '';
  return `${[...local][0]}***@${[...host][0] ?? ''}***${tld}`;
}
