import { useSyncExternalStore } from 'react';
import type { ChallengeBoardRow, ChallengeCheckPayload, ChallengeProgressView, ChallengeSessionPayload, NetOp, NetsimStatePayload, ServerMessage } from '@workverse/shared';
import { net } from '../../net';

/** Estado do painel "Rede" (simulador). Mensagens `netsim_*` chegam pelo worldStore, que as repassa para ca. */

export type NetsimView = 'net' | 'challenges';

export interface ChallengeList {
  progress: ChallengeProgressView[];
  board: ChallengeBoardRow[];
  activeId: string | null;
  totalPoints: number;
}

export interface NetsimUi {
  open: boolean;
  busy: boolean;
  state: NetsimStatePayload | null;
  notice: string | null;
  /** `net`: rede real da organizacao; `challenges`: lista e sandbox dos desafios. */
  view: NetsimView;
  list: ChallengeList | null;
  session: ChallengeSessionPayload | null;
  /** Quando a sessao chegou (ms locais), para o cronometro. */
  sessionAt: number;
  /** Ultimo resultado de "Verificar". */
  result: ChallengeCheckPayload | null;
}

let state: NetsimUi = { open: false, busy: false, state: null, notice: null, view: 'net', list: null, session: null, sessionAt: 0, result: null };
const listeners = new Set<() => void>();
let rid = 0;
const waiting = new Map<number, (r: { ok: boolean; error?: string }) => void>();

function set(next: Partial<NetsimUi>) {
  state = { ...state, ...next };
  for (const l of listeners) l();
}

/** Em modo desafio as edicoes vao para o sandbox do servidor (nunca para a rede real). */
const inChallenge = () => state.view === 'challenges' && !!state.session;

export const netsimStore = {
  get: () => state,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  open() {
    set({ open: true, busy: true, notice: null });
    net.send({ t: 'netsim_get' });
    if (state.view === 'challenges') net.send({ t: 'netsim_challenges' });
  },
  close() {
    set({ open: false });
  },
  refresh() {
    if (state.open) net.send({ t: 'netsim_get' });
  },
  setView(view: NetsimView) {
    if (state.view === view) return;
    set({ view, notice: null });
    if (view === 'challenges') net.send({ t: 'netsim_challenges' });
  },
  /** Envia edicoes (so TI na rede real; qualquer membro no sandbox do desafio). Resolve quando o servidor confirma ou recusa. */
  edit(ops: NetOp[]): Promise<{ ok: boolean; error?: string }> {
    const id = ++rid;
    let msg: { t: 'netsim_edit' | 'netsim_challenge_edit'; rid: number; base: number; ops: NetOp[] };
    if (inChallenge()) {
      const c = state.session!;
      if (c.solved) return Promise.resolve({ ok: false, error: 'Este desafio já foi resolvido.' });
      msg = { t: 'netsim_challenge_edit', rid: id, base: c.version, ops };
    } else {
      const s = state.state;
      if (!s || !s.canEdit) return Promise.resolve({ ok: false, error: 'Somente a equipe de TI pode alterar a rede.' });
      msg = { t: 'netsim_edit', rid: id, base: s.version, ops };
    }
    set({ busy: true, notice: null });
    net.send(msg);
    return new Promise((resolve) => {
      waiting.set(id, resolve);
      setTimeout(() => {
        if (waiting.delete(id)) {
          set({ busy: false });
          resolve({ ok: false, error: 'Sem resposta do servidor.' });
        }
      }, 8000);
    });
  },
  undo() {
    const s = state.state;
    if (inChallenge() || !s?.canEdit || !s.canUndo) return;
    set({ busy: true, notice: null });
    net.send({ t: 'netsim_undo', rid: ++rid, base: s.version });
  },
  reset() {
    const s = state.state;
    if (inChallenge() || !s?.canEdit) return;
    set({ busy: true, notice: null });
    net.send({ t: 'netsim_reset', rid: ++rid, base: s.version });
  },
  // ---- desafios
  startChallenge(id: string, resume = false) {
    set({ busy: true, notice: null, result: null });
    net.send({ t: 'netsim_challenge_start', rid: ++rid, id, ...(resume ? { resume: true } : {}) });
  },
  checkChallenge() {
    if (!state.session || state.session.solved) return;
    set({ busy: true, notice: null });
    net.send({ t: 'netsim_challenge_check', rid: ++rid });
  },
  hintChallenge() {
    if (!state.session || state.session.solved || state.session.nextHintCost === null) return;
    set({ busy: true, notice: null });
    net.send({ t: 'netsim_challenge_hint', rid: ++rid });
  },
  quitChallenge() {
    set({ busy: true, notice: null, session: null, result: null });
    net.send({ t: 'netsim_challenge_quit', rid: ++rid });
  },
  /** Volta para a lista sem apagar o sandbox no servidor (so atualiza a lista). */
  leaveSession() {
    set({ session: null, result: null });
    net.send({ t: 'netsim_challenges' });
  },
  dismissResult() {
    set({ result: null });
  },
  dismissNotice() {
    set({ notice: null });
  },
  /** Chamado pelo worldStore para toda mensagem `netsim_*`. */
  onMessage(msg: ServerMessage) {
    switch (msg.t) {
      case 'netsim_open':
        netsimStore.open();
        return;
      case 'netsim_state': {
        const { t: _t, rid: r, ...payload } = msg;
        set({ state: payload, busy: false });
        if (r !== undefined) waiting.get(r)?.({ ok: true });
        if (r !== undefined) waiting.delete(r);
        return;
      }
      case 'netsim_challenges_state': {
        set({ list: { progress: msg.progress, board: msg.board, activeId: msg.activeId, totalPoints: msg.totalPoints }, busy: false });
        return;
      }
      case 'netsim_challenge_session': {
        set({ session: msg.session, sessionAt: Date.now() - msg.session.elapsedSec * 1000, busy: false });
        if (msg.rid !== undefined) {
          waiting.get(msg.rid)?.({ ok: true });
          waiting.delete(msg.rid);
        }
        return;
      }
      case 'netsim_challenge_result': {
        const { t: _t, rid: _r, ...result } = msg;
        set({ result, busy: false });
        return;
      }
      case 'netsim_error': {
        set({ busy: false, notice: msg.message });
        if (msg.rid !== undefined) {
          waiting.get(msg.rid)?.({ ok: false, error: msg.message });
          waiting.delete(msg.rid);
        }
        return;
      }
      default:
        return;
    }
  },
  /** So para testes. */
  _reset() {
    state = { open: false, busy: false, state: null, notice: null, view: 'net', list: null, session: null, sessionAt: 0, result: null };
    waiting.clear();
  },
};

export function useNetsim(): NetsimUi {
  return useSyncExternalStore(netsimStore.subscribe, netsimStore.get);
}
