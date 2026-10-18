/** Tiny typed event bus between the Phaser scene and the React HUD. */
export interface BusEvents {
  avatarClick: { id: string; name: string; x: number; y: number };
  closeMenus: undefined;
}

const target = new EventTarget();

export function emit<K extends keyof BusEvents>(type: K, detail?: BusEvents[K]) {
  target.dispatchEvent(new CustomEvent(type, { detail }));
}

export function listen<K extends keyof BusEvents>(type: K, fn: (detail: BusEvents[K]) => void): () => void {
  const h = (e: Event) => fn((e as CustomEvent).detail);
  target.addEventListener(type, h);
  return () => target.removeEventListener(type, h);
}
