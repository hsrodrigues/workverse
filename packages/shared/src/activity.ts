import type { FurniKind } from './rooms';

/**
 * What an avatar is doing with the environment, visible to everybody in the room. The SERVER owns it: a client can
 * only ask to drop what it holds (see `ClientMessage`), every other state is derived from furniture the player used.
 *
 * - `idle`: nothing special.
 * - `working`: seated in a chair that faces a computer (the monitor turns on).
 * - `holding:<item>`: carrying a cup picked up at the coffee machine or the water cooler.
 */
export type HeldItem = 'coffee' | 'water';
export const HELD_ITEMS: readonly HeldItem[] = ['coffee', 'water'];
export type Activity = 'idle' | 'working' | `holding:${HeldItem}`;
export const ACTIVITIES: readonly Activity[] = ['idle', 'working', 'holding:coffee', 'holding:water'];

export const isActivity = (v: unknown): v is Activity => typeof v === 'string' && (ACTIVITIES as readonly string[]).includes(v);
export const heldOf = (a: Activity): HeldItem | null => (a.startsWith('holding:') ? (a.slice(8) as HeldItem) : null);

/** How long a cup stays in the hand if nobody drops it. */
export const HOLD_MS = 25_000;

/** Furniture that hands out an item when used (the kind must also be `usable`). */
export const FURNI_HOLDS: Partial<Record<FurniKind, HeldItem>> = {
  coffee: 'coffee',
  cooler: 'water',
  fridge: 'water',
};

/** Line written to the system chat when somebody picks an item up. */
export const HELD_CHAT: Record<HeldItem, string> = {
  coffee: 'pegou um café.',
  water: 'pegou um copo d’água.',
};
