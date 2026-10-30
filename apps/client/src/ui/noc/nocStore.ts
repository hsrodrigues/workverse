import type { NocView, NocWindow, ServerMessage } from '@workverse/shared';
import { net } from '../../net';

/** Estado do painel "NOC · Monitoramento". `noc_open`/`noc_result` chegam pelo worldStore, que as repassa para ca. */

export interface NocUi {
  open: boolean;
  busy: boolean;
  windowMin: NocWindow;
  view: NocView | null;
  /** Relogio local de quando o ultimo resultado chegou (para "atualizado ha N s"). */
  receivedAt: number;
  notice: string | null;
}

let state: NocUi = { open: false, busy: false, windowMin: 15, view: null, receivedAt: 0, notice: null };
const listeners = new Set<() => void>();

function set(next: Partial<NocUi>) {
  state = { ...state, ...next };
  for (const l of listeners) l();
}

export const NOC_REFRESH_MS = 5000;

export const nocStore = {
  get: () => state,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  open() {
    set({ open: true, busy: true, notice: null });
    net.send({ t: 'noc_query', window: state.windowMin });
  },
  close() {
    set({ open: false });
  },
  refresh() {
    if (state.open) net.send({ t: 'noc_query', window: state.windowMin });
  },
  setWindow(windowMin: NocWindow) {
    if (windowMin === state.windowMin) return;
    set({ windowMin, busy: true, notice: null });
    net.send({ t: 'noc_query', window: windowMin });
  },
  onMessage(msg: ServerMessage) {
    if (msg.t === 'noc_open') nocStore.open();
    else if (msg.t === 'noc_result') {
      const { t: _t, ...view } = msg;
      set({ busy: false, notice: null, view, receivedAt: Date.now() });
    }
  },
  onError(message: string) {
    if (state.open) set({ busy: false, notice: message });
  },
  /** So para testes. */
  _reset() {
    state = { open: false, busy: false, windowMin: 15, view: null, receivedAt: 0, notice: null };
  },
};
