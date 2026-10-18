import type { Pose } from '@workverse/shared';
import type { Ctx2, HoldSpec, Resolved, SleeveSpec } from './engine';

/**
 * Registry of drawing functions. An item of the catalog names its drawer by key (`ItemDef.drawer`); adding an item is
 * one entry in packages/shared/src/items/catalog.ts plus (if the look is new) one `registerDrawer` call here.
 *
 * A drawer does not paint directly: it EMITS parts with a depth, and the compositor sorts all parts of the frame
 * (body and items) by depth for the current view. This is what puts the long hair behind the body in the front view
 * and in front of the arms in the back view, the backpack behind the torso from the front and over it from behind, etc.
 */
export interface Emitter {
  /** A free part at a depth (smaller = farther from the camera). */
  part(depth: number, draw: () => void): void;
  /** A piece drawn as part of each leg (so it sorts together with the leg): the garment, then the shoe. */
  leg(layer: 'garment' | 'shoe', draw: (i: 0 | 1) => void): void;
}

export interface DrawerDef {
  draw(c: Ctx2, it: Resolved, e: Emitter): void;
  /** Garments with sleeves tell the arms how to draw them. Return null for sleeveless. */
  sleeve?(it: Resolved): Pick<SleeveSpec, 'len' | 'cuff'> | null;
  /** Held objects change how the arm is posed (only asked in poses where the item is not hidden). */
  hold?(pose: Pose, it: Resolved): HoldSpec | null;
}

const DRAWERS = new Map<string, DrawerDef>();

export function registerDrawer(key: string, def: DrawerDef | DrawerDef['draw']): void {
  DRAWERS.set(key, typeof def === 'function' ? { draw: def } : def);
}

export const getDrawer = (key: string): DrawerDef | undefined => DRAWERS.get(key);
export const drawerKeys = (): string[] => [...DRAWERS.keys()];
