import { useSyncExternalStore } from 'react';
import {
  FURNI_KINDS,
  MAX_FURNITURE,
  checkOps,
  footprintTiles,
  labelOf,
  newPieceId,
  type FurniKind,
  type Furniture,
  type FurnishIssue,
  type FurnishOp,
  type Permission,
  type RoomAccess,
  type RoomDef,
  type RoomInviteView,
  type RoomListEntry,
  type ServerMessage,
  type StaffSelf,
} from '@workverse/shared';
import { emit, listen } from '../../bus';
import { net } from '../../net';

/**
 * State of the room editor ("Modo decoração") and of room access, on the client. It holds NO authority: the same shared
 * validation paints the ghost, but the server decides again on every change (permission, validation, version).
 */

export type FurnishTab = 'furniture' | 'access';
export type NoticeKind = 'ok' | 'error' | 'warn';

export interface Hover {
  x: number;
  y: number;
  cx: number;
  cy: number;
}

export interface AccessView {
  access: RoomAccess;
  teamId: string | null;
  invites: RoomInviteView[];
  teams: Array<{ id: string; name: string }>;
  /** Equipes que entram mesmo com a sala trancada, e se é o padrão da sala. */
  passTeamIds: string[];
  passIsDefault: boolean;
}

export interface MeetingInvite {
  key: number;
  from: string;
  roomId: string;
  roomName: string;
}

export interface FurnishState {
  perms: Permission[];
  staff: StaffSelf | null;
  rooms: RoomListEntry[];
  /** Room being decorated (always the current one). */
  def: RoomDef | null;
  version: number;
  customized: boolean;
  active: boolean;
  tab: FurnishTab;
  /** Piece being placed (palette); null = select / move mode. */
  tool: FurniKind | null;
  dir: number;
  selectedId: string | null;
  hover: Hover | null;
  /** Result of the shared validation for what is under the pointer. */
  verdict: { ok: boolean; reason: string | null; warnings: string[] } | null;
  busy: boolean;
  notice: { kind: NoticeKind; text: string } | null;
  canUndo: boolean;
  canRedo: boolean;
  access: Record<string, AccessView>;
  accessNotice: { kind: NoticeKind; text: string } | null;
  invites: MeetingInvite[];
}

interface Step {
  forward: FurnishOp[];
  inverse: FurnishOp[];
}

const initial = (): FurnishState => ({
  perms: [],
  staff: null,
  rooms: [],
  def: null,
  version: 0,
  customized: false,
  active: false,
  tab: 'furniture',
  tool: null,
  dir: 0,
  selectedId: null,
  hover: null,
  verdict: null,
  busy: false,
  notice: null,
  canUndo: false,
  canRedo: false,
  access: {},
  accessNotice: null,
  invites: [],
});

let state: FurnishState = initial();
const listeners = new Set<() => void>();
let rid = 0;
let inviteKey = 0;
let undoStack: Step[] = [];
let redoStack: Step[] = [];
/** The request in flight (one at a time: each carries the version it was built on). */
let inflight: { rid: number; step: Step; how: 'do' | 'undo' | 'redo' | 'reset' } | null = null;
/** Piece being dragged with the mouse (select mode). */
let drag: { id: string; grabDx: number; grabDy: number; origin: Furniture; moved: boolean } | null = null;

function set(next: Partial<FurnishState>) {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}

// ---- permissions ---------------------------------------------------------------------------------------

export const canFurnishOf = (s: Pick<FurnishState, 'perms' | 'staff'>) => s.perms.includes('room.furnish') || (s.staff?.level === 'admin' && s.staff.duty === true);
export const canManageAccessOf = (s: Pick<FurnishState, 'perms' | 'staff'>) => s.perms.includes('room.access.set') || (s.staff?.level === 'admin' && s.staff.duty === true);

// ---- geometry helpers ----------------------------------------------------------------------------------

const FLOOR_LAYER: readonly FurniKind[] = ['rug', 'stage'];

/** Pieces whose footprint covers the tile, topmost first (solid things before rugs and stages). */
export function piecesAt(list: readonly Furniture[], x: number, y: number): Furniture[] {
  const at = list.filter((f) => footprintTiles(f).some((t) => t.x === x && t.y === y));
  const weight = (f: Furniture) => (FLOOR_LAYER.includes(f.kind) ? 0 : FURNI_KINDS[f.kind].wall ? 1 : f.kind === 'computer' ? 3 : 2);
  return at.sort((a, b) => weight(b) - weight(a));
}

/** Where the footprint of a new piece sits when the pointer is on (x, y): centered on the pointer; wall pieces snap to the wall. */
export function anchorFor(kind: FurniKind, dir: number, x: number, y: number): Furniture {
  const k = FURNI_KINDS[kind];
  const w = dir % 2 === 0 ? k.w : k.d;
  const d = dir % 2 === 0 ? k.d : k.w;
  if (k.wall) return { id: 'ghost', kind, dir, x: dir % 2 === 0 ? x : 0, y: dir % 2 === 0 ? 0 : y };
  return { id: 'ghost', kind, dir, x: x - Math.floor((w - 1) / 2), y: y - Math.floor((d - 1) / 2) };
}

function describe(issues: FurnishIssue[]): string {
  return issues[0]?.message ?? 'Não é possível colocar aqui.';
}

function verdictFor(def: RoomDef, ops: FurnishOp[]): NonNullable<FurnishState['verdict']> {
  const r = checkOps(def, def.furniture, ops);
  return { ok: r.ok, reason: r.ok ? null : describe(r.errors), warnings: r.warnings.map((w) => w.message) };
}

/** The room as the shared validator wants it: the original tiles / spawn / portals / type, plus the original pieces for `required`. */
function baseOf(def: RoomDef): RoomDef {
  return def;
}

// ---- ghost -----------------------------------------------------------------------------------------------

function pushGhost() {
  const s = state;
  const def = s.def;
  if (!s.active || !def) {
    emit('furnishGhost', { piece: null, valid: true, selected: null });
    return;
  }
  const selected = s.selectedId ? (def.furniture.find((f) => f.id === s.selectedId) ?? null) : null;
  let piece: Furniture | null = null;
  let verdict: FurnishState['verdict'] = null;
  if (drag && s.hover) {
    const p = { ...drag.origin, x: s.hover.x - drag.grabDx, y: s.hover.y - drag.grabDy };
    if (drag.origin.kind && FURNI_KINDS[drag.origin.kind].wall) {
      p.x = drag.origin.dir % 2 === 0 ? p.x : 0;
      p.y = drag.origin.dir % 2 === 0 ? 0 : p.y;
    }
    piece = p;
    verdict = p.x === drag.origin.x && p.y === drag.origin.y ? { ok: true, reason: null, warnings: [] } : verdictFor(baseOf(def), [{ op: 'update', id: p.id, x: p.x, y: p.y, dir: p.dir }]);
  } else if (s.tool && s.hover) {
    piece = anchorFor(s.tool, s.dir, s.hover.x, s.hover.y);
    verdict = verdictFor(baseOf(def), [{ op: 'add', piece: { ...piece, id: 'ghost-new' } }]);
  }
  if (s.verdict?.ok !== verdict?.ok || s.verdict?.reason !== verdict?.reason || s.verdict?.warnings.join() !== verdict?.warnings.join()) state = { ...state, verdict };
  emit('furnishGhost', { piece, valid: verdict?.ok ?? true, selected: drag ? null : selected });
  listeners.forEach((l) => l());
}

// ---- sending ---------------------------------------------------------------------------------------------

function send(step: Step, how: 'do' | 'undo' | 'redo') {
  if (state.busy || net.status !== 'online') {
    set({ notice: { kind: 'warn', text: state.busy ? 'Aguarde a alteração anterior…' : 'Sem conexão com o servidor.' } });
    return;
  }
  const ops = how === 'undo' ? step.inverse : step.forward;
  inflight = { rid: ++rid, step, how };
  set({ busy: true });
  net.send({ t: 'furnish_apply', rid: inflight.rid, base: state.version, ops });
}

function inverseOf(def: RoomDef, ops: FurnishOp[]): FurnishOp[] {
  const out: FurnishOp[] = [];
  for (const o of [...ops].reverse()) {
    if (o.op === 'add') out.push({ op: 'remove', id: o.piece.id });
    else if (o.op === 'remove') {
      const old = def.furniture.find((f) => f.id === o.id);
      if (old) out.push({ op: 'add', piece: { ...old } });
    } else {
      const old = def.furniture.find((f) => f.id === o.id);
      if (old) out.push({ op: 'update', id: old.id, x: old.x, y: old.y, dir: old.dir });
    }
  }
  return out;
}

function apply(ops: FurnishOp[]) {
  const def = state.def;
  if (!def || !state.active) return;
  send({ forward: ops, inverse: inverseOf(def, ops) }, 'do');
}

// ---- messages from the server ----------------------------------------------------------------------------

function onResult(m: Extract<ServerMessage, { t: 'furnish_result' }>) {
  if (!inflight || inflight.rid !== m.rid) return;
  const { step, how } = inflight;
  inflight = null;
  if (m.ok) {
    if (how === 'reset') {
      undoStack = [];
      redoStack = [];
    } else if (how === 'do') {
      undoStack.push(step);
      redoStack = [];
    } else if (how === 'undo') redoStack.push(step);
    else undoStack.push(step);
    const warn = m.warnings?.[0]?.message;
    set({
      busy: false,
      canUndo: undoStack.length > 0,
      canRedo: redoStack.length > 0,
      notice: warn ? { kind: 'warn', text: `Feito, mas: ${warn}` } : { kind: 'ok', text: how === 'reset' ? 'Layout original restaurado.' : how === 'undo' ? 'Desfeito.' : how === 'redo' ? 'Refeito.' : 'Alteração salva.' },
    });
    // re-run the ghost on the new layout
    pushGhost();
    return;
  }
  if (m.code === 'conflict') {
    // somebody else changed the room: our history no longer applies
    undoStack = [];
    redoStack = [];
    set({ busy: false, canUndo: false, canRedo: false, notice: { kind: 'error', text: m.message ?? 'Outra pessoa alterou a sala.' } });
    return;
  }
  // an undo/redo that no longer fits is dropped instead of retried forever
  set({ busy: false, canUndo: undoStack.length > 0, canRedo: redoStack.length > 0, notice: { kind: 'error', text: m.message ?? 'Não foi possível alterar a sala.' } });
}

net.on((m: ServerMessage) => {
  switch (m.t) {
    case 'session':
      set({ perms: m.perms ?? [], staff: m.staff ?? null });
      break;
    case 'perms':
      set({ perms: m.perms });
      break;
    case 'staff_self':
      set({ staff: { level: m.level, duty: m.duty, invisible: m.invisible } });
      break;
    case 'staff_revoked':
      set({ staff: null });
      break;
    case 'rooms':
      set({ rooms: m.rooms });
      break;
    case 'room':
      undoStack = [];
      redoStack = [];
      drag = null;
      inflight = null;
      set({ def: m.room.def, version: m.room.furnishVersion ?? 0, customized: m.room.customized === true, selectedId: null, busy: false, canUndo: false, canRedo: false, notice: null, verdict: null });
      pushGhost();
      break;
    case 'furniture_changed':
      if (state.def && state.def.id === m.roomId) {
        set({
          def: { ...state.def, furniture: m.furniture },
          version: m.version,
          customized: m.customized,
          selectedId: state.selectedId && m.furniture.some((f) => f.id === state.selectedId) ? state.selectedId : null,
        });
        pushGhost();
      }
      break;
    case 'furnish_result':
      onResult(m);
      break;
    case 'room_access':
      set({ access: { ...state.access, [m.roomId]: { access: m.access, teamId: m.teamId, invites: m.invites, teams: m.teams, passTeamIds: m.passTeamIds ?? [], passIsDefault: m.passIsDefault ?? true } } });
      break;
    case 'room_access_result':
      set({ accessNotice: m.ok ? { kind: 'ok', text: 'Acesso atualizado.' } : { kind: 'error', text: m.message ?? 'Não foi possível atualizar o acesso.' } });
      break;
    case 'dm':
      if (m.roomInvite && !m.self) set({ invites: [...state.invites.filter((i) => i.roomId !== m.roomInvite!.roomId), { key: ++inviteKey, from: m.peer, roomId: m.roomInvite.roomId, roomName: m.roomInvite.roomName }].slice(-4) });
      break;
    case 'error':
      if (m.code === 'forbidden' && inflight) {
        inflight = null;
        set({ busy: false, notice: { kind: 'error', text: 'Você não tem permissão para decorar salas.' } });
      }
      if (m.code === 'kicked_room' || m.code === 'room_denied') set({ accessNotice: { kind: 'error', text: m.message } });
      break;
  }
});

// ---- pointer from the scene -------------------------------------------------------------------------------

listen('furnishPointer', (e) => {
  if (!e || !state.active || !state.def) return;
  const def = state.def;
  if (e.type === 'move') {
    set({ hover: { x: e.x, y: e.y, cx: e.cx, cy: e.cy } });
    pushGhost();
    return;
  }
  if (e.type === 'down') {
    state = { ...state, hover: { x: e.x, y: e.y, cx: e.cx, cy: e.cy } };
    if (state.tool) return; // placing: the click is decided on release
    const hit = piecesAt(def.furniture, e.x, e.y)[0];
    if (hit) {
      drag = { id: hit.id, grabDx: e.x - hit.x, grabDy: e.y - hit.y, origin: { ...hit }, moved: false };
      state = { ...state, selectedId: hit.id, tab: 'furniture' };
      emit('furnishGrab');
    } else {
      state = { ...state, selectedId: null };
    }
    pushGhost();
    return;
  }
  // up
  state = { ...state, hover: { x: e.x, y: e.y, cx: e.cx, cy: e.cy } };
  if (drag) {
    const d = drag;
    drag = null;
    const nx = e.x - d.grabDx;
    const ny = e.y - d.grabDy;
    const wall = FURNI_KINDS[d.origin.kind].wall === true;
    const x = wall ? (d.origin.dir % 2 === 0 ? nx : 0) : nx;
    const y = wall ? (d.origin.dir % 2 === 0 ? 0 : ny) : ny;
    if (x !== d.origin.x || y !== d.origin.y) {
      const v = verdictFor(def, [{ op: 'update', id: d.id, x, y, dir: d.origin.dir }]);
      if (v.ok) apply([{ op: 'update', id: d.id, x, y, dir: d.origin.dir }]);
      else set({ notice: { kind: 'error', text: v.reason ?? 'Não é possível mover para lá.' } });
    }
    pushGhost();
    return;
  }
  if (state.tool && !e.panned) {
    const piece = { ...anchorFor(state.tool, state.dir, e.x, e.y), id: newPieceId() };
    const v = verdictFor(def, [{ op: 'add', piece }]);
    if (!v.ok) set({ notice: { kind: 'error', text: v.reason ?? 'Não é possível colocar aqui.' } });
    else if (def.furniture.length >= MAX_FURNITURE) set({ notice: { kind: 'error', text: `Limite de ${MAX_FURNITURE} peças por sala.` } });
    else {
      apply([{ op: 'add', piece }]);
      state = { ...state, selectedId: null };
    }
  }
  pushGhost();
});

// ---- public actions ----------------------------------------------------------------------------------------

export const furnishStore = {
  get: () => state,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  reset() {
    state = initial();
    undoStack = [];
    redoStack = [];
    drag = null;
    inflight = null;
    listeners.forEach((l) => l());
  },
  setActive(on: boolean) {
    if (on && !canFurnishOf(state)) return;
    drag = null;
    set({ active: on, tool: null, selectedId: null, hover: null, verdict: null, notice: null });
    emit('furnishActive', on);
    pushGhost();
  },
  setTab(tab: FurnishTab) {
    set({ tab });
  },
  chooseTool(kind: FurniKind | null) {
    const def = FURNI_KINDS[kind ?? 'plant'];
    // a wall piece starts on the north wall; the others keep the rotation in use
    const dir = kind && def.wall ? state.dir % 2 : state.dir;
    set({ tool: kind, selectedId: null, dir, verdict: null, notice: kind ? { kind: 'ok', text: `${labelOf(kind)}: clique no chão para colocar (R gira, Esc cancela).` } : null });
    pushGhost();
  },
  rotate() {
    const def = state.def;
    if (state.tool) {
      set({ dir: (state.dir + 1) % 4 });
      pushGhost();
      return;
    }
    const sel = def?.furniture.find((f) => f.id === state.selectedId);
    if (!def || !sel) return;
    const dir = (sel.dir + 1) % 4;
    const k = FURNI_KINDS[sel.kind];
    // wall pieces change wall (north <-> west) and snap to it
    const op: FurnishOp = k.wall ? { op: 'update', id: sel.id, x: dir % 2 === 0 ? sel.x : 0, y: dir % 2 === 0 ? 0 : sel.y, dir } : { op: 'update', id: sel.id, x: sel.x, y: sel.y, dir };
    const v = verdictFor(def, [op]);
    if (!v.ok) set({ notice: { kind: 'error', text: v.reason ?? 'Não dá para girar aqui.' } });
    else apply([op]);
  },
  removeSelected() {
    const def = state.def;
    if (!def || !state.selectedId) return;
    const piece = def.furniture.find((f) => f.id === state.selectedId);
    if (!piece) return;
    const v = verdictFor(def, [{ op: 'remove', id: piece.id }]);
    if (!v.ok) set({ notice: { kind: 'error', text: v.reason ?? 'Não dá para remover.' } });
    else {
      apply([{ op: 'remove', id: piece.id }]);
      set({ selectedId: null });
      pushGhost();
    }
  },
  undo() {
    const step = undoStack.pop();
    if (!step) return;
    set({ canUndo: undoStack.length > 0 });
    send(step, 'undo');
  },
  redo() {
    const step = redoStack.pop();
    if (!step) return;
    set({ canRedo: redoStack.length > 0 });
    send(step, 'redo');
  },
  /** Back to the original layout of the room (the caller confirms with the person first). */
  restore() {
    if (state.busy) return;
    inflight = { rid: ++rid, step: { forward: [], inverse: [] }, how: 'reset' };
    set({ busy: true });
    net.send({ t: 'furnish_reset', rid: inflight.rid, base: state.version });
  },
  select(id: string | null) {
    set({ selectedId: id, tool: null });
    pushGhost();
  },
  clearNotice() {
    set({ notice: null });
  },
  // ---- access
  loadAccess(roomId: string) {
    net.send({ t: 'room_access_get', roomId });
  },
  setAccess(roomId: string, access: RoomAccess, teamId?: string | null, passTeamIds?: string[]) {
    set({ accessNotice: null });
    net.send({ t: 'room_access_set', rid: ++rid, roomId, access, ...(access === 'team' ? { teamId: teamId ?? null } : {}), ...(passTeamIds ? { passTeamIds } : {}) });
  },
  invite(roomId: string, who: string, hours: number) {
    set({ accessNotice: null });
    net.send({ t: 'room_invite_add', rid: ++rid, roomId, who, hours });
  },
  uninvite(roomId: string, accountId: string) {
    set({ accessNotice: null });
    net.send({ t: 'room_invite_remove', rid: ++rid, roomId, accountId });
  },
  inviteToMeeting(target: string) {
    net.send({ t: 'meeting_invite', target });
  },
  dismissInvite(key: number) {
    set({ invites: state.invites.filter((i) => i.key !== key) });
  },
};

// Dev-only handle for browser tests.
if (import.meta.env?.DEV && typeof window !== 'undefined') (window as unknown as { __fz: unknown }).__fz = furnishStore;

export function useFurnish(): FurnishState {
  return useSyncExternalStore(furnishStore.subscribe, furnishStore.get);
}
