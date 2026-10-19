import type { FurniKind } from './rooms';

/**
 * What an avatar is doing with the environment, visible to everybody in the room. The SERVER owns it: a client can
 * only ask to drop what it holds (see `ClientMessage`), every other state is derived from furniture the player used.
 *
 * - `idle`: nothing special.
 * - `working`: seated in a chair that faces a computer (the monitor turns on).
 * - `holding:<item>`: carrying a cup, can, snack or lunch box picked up at a machine (coffee, water, vending, microwave).
 */
export type HeldItem = 'coffee' | 'water' | 'snack' | 'soda' | 'meal';
export const HELD_ITEMS: readonly HeldItem[] = ['coffee', 'water', 'snack', 'soda', 'meal'];
export type Activity = 'idle' | 'working' | `holding:${HeldItem}`;
export const ACTIVITIES: readonly Activity[] = ['idle', 'working', 'holding:coffee', 'holding:water', 'holding:snack', 'holding:soda', 'holding:meal'];

export const isActivity = (v: unknown): v is Activity => typeof v === 'string' && (ACTIVITIES as readonly string[]).includes(v);
export const heldOf = (a: Activity): HeldItem | null => (a.startsWith('holding:') ? (a.slice(8) as HeldItem) : null);

/** How long a cup stays in the hand if nobody drops it. */
export const HOLD_MS = 25_000;

/** Pieces a seat can face to count as a workstation (the avatar types): PCs, the IT command desk and the hardware bench. */
export const WORKSTATION_KINDS: readonly FurniKind[] = ['computer', 'command_desk', 'hardware_bench'];

/** Furniture that hands out an item when used (the kind must also be `usable`). */
export const FURNI_HOLDS: Partial<Record<FurniKind, HeldItem>> = {
  coffee: 'coffee',
  espresso: 'coffee',
  cooler: 'water',
  fridge: 'water',
  snack_machine: 'snack',
  soda_machine: 'soda',
  microwave: 'meal',
};

/** Aparelhos que demoram a entregar: a luz fica acesa (estado `furni`) por este tempo e só então o item vai para a mão. */
export const FURNI_DELAY_MS: Partial<Record<FurniKind, number>> = { microwave: 3000 };

/** Line written to the system chat when somebody picks an item up. */
export const HELD_CHAT: Record<HeldItem, string> = {
  coffee: 'pegou um café.',
  water: 'pegou um copo d’água.',
  snack: 'comprou um lanche na máquina.',
  soda: 'pegou uma latinha de refrigerante.',
  meal: 'esquentou a marmita no micro-ondas.',
};
