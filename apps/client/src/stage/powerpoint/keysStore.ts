import { useSyncExternalStore } from 'react';

/**
 * True while the PowerPoint panel is driving the presentation with the keyboard. The older "arrow keys move the
 * image slides" handler of the speaker panel listens to this and stays quiet, so a key is never handled twice.
 */
let active = false;
const listeners = new Set<() => void>();

export const pptKeys = {
  get: () => active,
  set(next: boolean) {
    if (active === next) return;
    active = next;
    listeners.forEach((l) => l());
  },
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

export const usePowerPointKeysActive = () => useSyncExternalStore(pptKeys.subscribe, pptKeys.get);
