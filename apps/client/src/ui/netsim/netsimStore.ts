import { useSyncExternalStore } from 'react';
import type { NetOp, NetsimStatePayload, ServerMessage } from '@workverse/shared';
import { net } from '../../net';

/** Estado do painel "Rede" (simulador). Mensagens `netsim_*` chegam pelo worldStore, que as repassa para ca. */

export interface NetsimUi {
  open: boolean;
  busy: boolean;
  state: NetsimStatePayload | null;
  notice: string | null;
}

let state: NetsimUi = { open: false, busy: false, state: null, notice: null };
const listeners = new Set<() => void>();
let rid = 0;
const waiting = new Map<number, (r: { ok: boolean; error?: string }) => void>();

function set(next: Partial<NetsimUi>) {
  state = { ...state, ...next };
  for (const l of listeners) l();
}

export const netsimStore = {
  get: () => state,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  open() {
    set({ open: true, busy: true, notice: null });
    net.send({ t: 'netsim_get' });
  },
  close() {
    set({ open: false });
  },
  refresh() {
    if (state.open) net.send({ t: 'netsim_get' });
  },
  /** Envia edicoes (so TI). Resolve quando o servidor confirma (novo estado) ou recusa. */
  edit(ops: NetOp[]): Promise<{ ok: boolean; error?: string }> {
    const s = state.state;
    if (!s || !s.canEdit) return Promise.resolve({ ok: false, error: 'Somente a equipe de TI pode alterar a rede.' });
    const id = ++rid;
    set({ busy: true, notice: null });
    net.send({ t: 'netsim_edit', rid: id, base: s.version, ops });
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
    if (!s?.canEdit || !s.canUndo) return;
    set({ busy: true, notice: null });
    net.send({ t: 'netsim_undo', rid: ++rid, base: s.version });
  },
  reset() {
    const s = state.state;
    if (!s?.canEdit) return;
    set({ busy: true, notice: null });
    net.send({ t: 'netsim_reset', rid: ++rid, base: s.version });
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
};

export function useNetsim(): NetsimUi {
  return useSyncExternalStore(netsimStore.subscribe, netsimStore.get);
}
