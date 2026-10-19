import { useSyncExternalStore } from 'react';
import { DEFAULT_TEAM, presentationOf, type AvatarConfig, type Deck, type OnlineEntry, type PresenceStatus, type RoomAdminEntry, type RoomDef, type ServerMessage, type SlideState, type StaffLevel, type StaffLogEntry, type StaffSelf, type StageView } from '@workverse/shared';
import { net } from './net';

export interface RosterEntry {
  id: string;
  name: string;
  avatar: AvatarConfig;
  /** Presence status; the Phaser layer can read it from here to draw an indicator over the avatar. */
  status: PresenceStatus;
  /** Selo de staff: so vale o que o SERVIDOR mandou (PlayerView.staff / staff_flag). */
  staff?: StaffLevel;
}

export interface StaffAnnounce {
  key: number;
  scope: 'room' | 'all' | 'org' | 'private';
  from: string;
  level: StaffLevel;
  text: string;
  highlight: boolean;
}

export interface SocialLine {
  key: number;
  /** Name of the author. */
  from: string;
  self: boolean;
  text: string;
  at: number;
}

export interface Conversation {
  /** Lowercase display name of the other person. */
  key: string;
  peer: string;
  lines: SocialLine[];
  unread: number;
}

/** Tab ids of the chat window: 'team' or a conversation key. */
export type ChatTab = string;

export interface ChatLine {
  key: number;
  kind: 'say' | 'system';
  name: string;
  text: string;
  at: number;
}

export interface WorldState {
  youId: string | null;
  room: RoomDef | null;
  roster: RosterEntry[];
  chat: ChatLine[];
  population: Record<string, number>;
  /** Own presence status as confirmed by the server. */
  myStatus: PresenceStatus;
  team: string;
  conversations: Record<string, Conversation>;
  teamLines: SocialLine[];
  teamUnread: number;
  /** Whether the chat window is open and which tab is showing (to count unread messages). */
  chatOpen: boolean;
  chatTab: ChatTab;
  /** Last error of a private message (e.g. recipient offline). */
  socialNotice: string | null;
  /** Auditorium: null outside a room with a stage. */
  stage: StageView | null;
  /** Deck in view: the audience only receives it while the presentation is live. */
  deck: Deck | null;
  slide: SlideState;
  /** Last refusal of an auditorium action (stage busy, not the speaker...). */
  stageNotice: string | null;
  /** Staff da plataforma: so existe quando o servidor diz que a conta e staff. */
  staff: StaffSelf | null;
  staffOnline: OnlineEntry[];
  staffLog: StaffLogEntry[];
  staffRooms: RoomAdminEntry[];
  /** Ultimo anuncio de staff (faixa dourada no topo). */
  announce: StaffAnnounce | null;
}

const MAX_LINES = 120;
let lineKey = 0;
const initial = (): WorldState => ({
  youId: null,
  room: null,
  roster: [],
  chat: [],
  population: {},
  myStatus: 'available',
  team: DEFAULT_TEAM,
  conversations: {},
  teamLines: [],
  teamUnread: 0,
  chatOpen: false,
  chatTab: 'team',
  socialNotice: null,
  stage: null,
  deck: null,
  slide: { live: false, index: 0 },
  stageNotice: null,
  staff: null,
  staffOnline: [],
  staffLog: [],
  staffRooms: [],
  announce: null,
});

/** Error codes of the auditorium: shown in the presentation panel and in the chat log. */
const STAGE_ERRORS = new Set([
  'not_stage_room',
  'tv_room',
  'stage_busy',
  'stage_away',
  'not_speaker',
  'no_speaker',
  'stage_speaker',
  'has_voice',
  'hands_full',
  'no_target',
  'voices_full',
  'deck_invalid',
  'no_deck',
  'not_live',
  'bad_slide',
]);
let state: WorldState = initial();
const listeners = new Set<() => void>();

function set(next: Partial<WorldState>) {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}

function addLine(kind: ChatLine['kind'], name: string, text: string) {
  const chat = [...state.chat, { key: ++lineKey, kind, name, text, at: Date.now() }].slice(-MAX_LINES);
  set({ chat });
}

export const peerKey = (name: string) => name.normalize('NFKC').toLocaleLowerCase();

function isViewing(tab: ChatTab) {
  return state.chatOpen && state.chatTab === tab && (typeof document === 'undefined' || !document.hidden);
}

function receiveDm(peer: string, self: boolean, text: string, at: number) {
  const key = peerKey(peer);
  const conv = state.conversations[key] ?? { key, peer, lines: [], unread: 0 };
  const unread = self || isViewing(key) ? conv.unread : conv.unread + 1;
  const lines = [...conv.lines, { key: ++lineKey, from: self ? 'Você' : peer, self, text, at }].slice(-MAX_LINES);
  set({ conversations: { ...state.conversations, [key]: { ...conv, peer, lines, unread } }, socialNotice: null });
}

net.on((msg: ServerMessage) => {
  switch (msg.t) {
    case 'session':
      set({ youId: msg.id, myStatus: msg.status ?? 'available', team: msg.team ?? DEFAULT_TEAM, staff: msg.staff ?? null });
      break;
    case 'room':
      set({
        room: msg.room.def,
        youId: msg.room.youId,
        roster: msg.room.players.map((p) => ({ id: p.id, name: p.name, avatar: p.avatar, status: p.status ?? 'available', staff: p.staff })),
        population: msg.room.population,
        stage: null,
        deck: null,
        slide: { live: false, index: 0 },
        stageNotice: null,
      });
      addLine('system', '', `Você entrou em: ${msg.room.def.name}`);

      break;
    case 'joined':
      set({ roster: [...state.roster.filter((p) => p.id !== msg.player.id), { id: msg.player.id, name: msg.player.name, avatar: msg.player.avatar, status: msg.player.status ?? 'available', staff: msg.player.staff }] });
      addLine('system', '', `${msg.player.name} entrou na sala.`);
      break;
    case 'left': {
      const who = state.roster.find((p) => p.id === msg.id);
      set({ roster: state.roster.filter((p) => p.id !== msg.id) });
      if (who) addLine('system', '', `${who.name} saiu da sala.`);
      break;
    }
    case 'avatar':
      set({ roster: state.roster.map((p) => (p.id === msg.id ? { ...p, avatar: msg.avatar } : p)) });
      break;
    case 'status':
      set({
        roster: state.roster.map((p) => (p.id === msg.id ? { ...p, status: msg.status } : p)),
        ...(msg.id === state.youId ? { myStatus: msg.status } : {}),
      });
      break;
    case 'dm':
      receiveDm(msg.peer, msg.self, msg.text, msg.at);
      break;
    case 'team': {
      const lines = [...state.teamLines, { key: ++lineKey, from: msg.from, self: msg.self, text: msg.text, at: msg.at }].slice(-MAX_LINES);
      set({ teamLines: lines, team: msg.team, teamUnread: msg.self || isViewing('team') ? state.teamUnread : state.teamUnread + 1 });
      break;
    }
    case 'chat':
      addLine(msg.kind, msg.name, msg.text);
      break;
    case 'population':
      set({ population: msg.population });
      break;
    case 'stage':
      set({ stage: msg.stage });
      break;
    case 'deck':
      set({ deck: msg.deck });
      break;
    case 'slide':
      set({ slide: msg.state });
      break;
    case 'staff_flag':
      set({ roster: state.roster.map((p) => (p.id === msg.id ? { ...p, staff: msg.staff ?? undefined } : p)) });
      break;
    case 'staff_self':
      set({ staff: { level: msg.level, duty: msg.duty, invisible: msg.invisible } });
      break;
    case 'staff_online':
      set({ staffOnline: msg.players });
      break;
    case 'staff_log':
      set({ staffLog: (msg.append ? [...state.staffLog, ...msg.entries] : msg.entries).slice(-60) });
      break;
    case 'staff_rooms':
      set({ staffRooms: msg.rooms });
      break;
    case 'staff_revoked':
      set({ staff: null, staffOnline: [], staffRooms: [], staffLog: [] });
      addLine('system', '', 'Seu acesso de staff foi removido.');
      break;
    case 'announce':
      set({ announce: { key: ++lineKey, scope: msg.scope, from: msg.from, level: msg.level, text: msg.text, highlight: msg.highlight === true } });
      addLine('system', '', `[${msg.scope === 'private' ? 'MENSAGEM DA EQUIPE' : msg.scope === 'all' ? 'AVISO GERAL' : 'AVISO'}] ${msg.from}: ${msg.text}`);
      break;
    case 'error':
      if (['rate_limited', 'room_full', 'room_locked', 'room_denied', 'forbidden', 'muted', 'unmuted', 'kicked_room', 'off_duty'].includes(msg.code)) addLine('system', '', msg.message);
      if (msg.code === 'dm_offline' || msg.code === 'dm_self') set({ socialNotice: msg.message });
      if (STAGE_ERRORS.has(msg.code)) {
        set({ stageNotice: msg.message });
        addLine('system', '', msg.message);
      }
      break;
  }
});

export const worldStore = {
  get: () => state,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  reset() {
    state = initial();
    listeners.forEach((l) => l());
  },
  /** Opens (or creates) a private conversation and shows the chat window on it. */
  openConversation(peer: string) {
    const key = peerKey(peer);
    const conv = state.conversations[key] ?? { key, peer, lines: [], unread: 0 };
    set({ conversations: { ...state.conversations, [key]: { ...conv, unread: 0 } }, chatOpen: true, chatTab: key, socialNotice: null });
  },
  /** Selects a tab; its unread counter is cleared. */
  selectChatTab(tab: ChatTab) {
    if (tab === 'team') set({ chatTab: 'team', teamUnread: 0, socialNotice: null });
    else {
      const conv = state.conversations[tab];
      set({ chatTab: tab, socialNotice: null, ...(conv ? { conversations: { ...state.conversations, [tab]: { ...conv, unread: 0 } } } : {}) });
    }
  },
  clearAnnounce(key: number) {
    if (state.announce?.key === key) set({ announce: null });
  },
  setChatOpen(open: boolean) {
    set({ chatOpen: open });
    if (open) worldStore.selectChatTab(state.chatTab);
  },
};

/** True when the current room has a presentation target: a stage (auditorium) or a TV on a stand. */
export const isStageRoomDef = (room: RoomDef | null): boolean => !!room && presentationOf(room) !== null;
/** True when the presentation target of the room is a TV (not the auditorium stage). */
export const isTvRoomDef = (room: RoomDef | null): boolean => !!room && presentationOf(room) === 'tv';

export function useWorld(): WorldState {
  return useSyncExternalStore(worldStore.subscribe, worldStore.get);
}

export function useNetStatus() {
  return useSyncExternalStore(
    (l) => net.onStatus(l),
    () => `${net.status}|${net.latencyMs}`,
  ).split('|') as [typeof net.status, string];
}
