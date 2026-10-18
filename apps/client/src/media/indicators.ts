import { useSyncExternalStore } from 'react';

/**
 * Bridge between the media state (React) and the Phaser scene: who has a microphone / camera and who is speaking.
 * People who never connected media simply are not in the map, so the game draws nothing for them.
 */
export interface MediaIndicator {
  micPublished: boolean;
  micOn: boolean;
  camPublished: boolean;
  camOn: boolean;
  screenOn: boolean;
  speaking: boolean;
}

let map = new Map<string, MediaIndicator>();
const listeners = new Set<() => void>();

export const mediaIndicators = {
  get: (id: string): MediaIndicator | undefined => map.get(id),
  all: () => map,
  set(next: Map<string, MediaIndicator>) {
    map = next;
    listeners.forEach((l) => l());
  },
  clear() {
    this.set(new Map());
  },
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

/** For React lists (Pessoas): re-renders when any indicator changes. */
export function useMediaIndicators(): Map<string, MediaIndicator> {
  return useSyncExternalStore(mediaIndicators.subscribe, mediaIndicators.all);
}

/** Video element of the speaker's shared screen, read by the in-game screen to show a live thumbnail. */
export const screenFeed: { video: HTMLVideoElement | null; label: string } = { video: null, label: '' };
