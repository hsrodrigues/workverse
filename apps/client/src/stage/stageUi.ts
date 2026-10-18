import { useSyncExternalStore } from 'react';

/** Presentation window state, shared by the HUD bar button and the panel. */
export type StageMode = 'closed' | 'open' | 'wide';

let mode: StageMode = 'closed';
const listeners = new Set<() => void>();

export const stageUi = {
  get: () => mode,
  set(next: StageMode) {
    if (mode === next) return;
    mode = next;
    listeners.forEach((l) => l());
  },
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

export function useStageMode(): StageMode {
  return useSyncExternalStore(stageUi.subscribe, stageUi.get);
}
