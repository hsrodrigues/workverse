import { useSyncExternalStore } from 'react';
import { DEFAULT_MEDIA_POLICY, type MediaActive, type MediaPolicy, type MediaUsageView, type ServerMessage } from '@workverse/shared';
import { net } from '../net';

/** O que o servidor diz sobre a midia (politica de economia, quem publica na sala, contador da staff). Alimentado pelo WebSocket. */
export interface MediaWorldState {
  policy: MediaPolicy;
  /** Quem publica na sala atual (null ate o servidor avisar). */
  active: MediaActive | null;
  /** Ultima recusa do servidor (limite de video, modo economia): vira aviso na barra de midia. */
  notice: { key: number; message: string } | null;
  /** Contador mensal (so staff com permissao). */
  usage: MediaUsageView | null;
}

let key = 0;
let state: MediaWorldState = { policy: { ...DEFAULT_MEDIA_POLICY }, active: null, notice: null, usage: null };
const listeners = new Set<() => void>();

function set(next: Partial<MediaWorldState>) {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}

/** Aplica uma mensagem do servidor (exportado para os testes). */
export function applyMediaMessage(msg: ServerMessage) {
  switch (msg.t) {
    case 'media_policy': {
      const { t: _t, ...policy } = msg;
      set({ policy });
      break;
    }
    case 'media_active': {
      const { t: _t, ...active } = msg;
      set({ active });
      break;
    }
    case 'room':
      set({ active: null });
      break;
    case 'staff_media':
      set({ usage: msg.usage });
      break;
    case 'staff_revoked':
      set({ usage: null });
      break;
    case 'error':
      if (msg.code.startsWith('media_')) set({ notice: { key: ++key, message: msg.message } });
      break;
  }
}

net.on(applyMediaMessage);

export const mediaState = {
  get: () => state,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  reset() {
    state = { policy: { ...DEFAULT_MEDIA_POLICY }, active: null, notice: null, usage: null };
    listeners.forEach((l) => l());
  },
};

export function useMediaState(): MediaWorldState {
  return useSyncExternalStore(mediaState.subscribe, mediaState.get);
}
