/** Tiny typed event bus between the Phaser scene and the React HUD. */
import type { Furniture } from '@workverse/shared';
export interface BusEvents {
  avatarClick: { id: string; name: string; x: number; y: number };
  closeMenus: undefined;
  /** UI -> scene: shows where a PC is (inventory "Localizar"): the camera goes there and a marker blinks. The scene waits for the room when it is another one. */
  locateHost: { roomId: string; x: number; y: number; label: string };
  /** scene -> UI: the player clicked the receptionist NPC (opens the "Atendimento" panel). */
  receptionistClick: undefined;
  /** scene -> UI: the player clicked Byte, the office pet (opens the small action menu at the click). */
  petClick: { name: string; x: number; y: number };
  /** UI -> scene: "Brincar" was chosen: for a few seconds the pointer position is sent to the server so Byte chases it. */
  petPlay: undefined;
  // ---- room editor ("Modo decoração"): the scene only reports pointers and draws what the UI asks for
  /** UI -> scene: decorate mode on/off (while on, clicks never walk, sit or open avatar menus). */
  furnishActive: boolean;
  /** UI -> scene: the ghost to draw (green/red footprint + translucent sprite) and the selected piece. */
  furnishGhost: { piece: Furniture | null; valid: boolean; selected: Furniture | null };
  /** UI -> scene, while handling a `down`: "I take this drag" (moving a piece), so the camera does not pan. */
  furnishGrab: undefined;
  /** scene -> UI: pointer over the tile (x, y) (may be outside the floor); cx/cy are screen coordinates for tooltips. */
  furnishPointer: { type: 'move' | 'down' | 'up'; x: number; y: number; cx: number; cy: number; panned?: boolean };
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
