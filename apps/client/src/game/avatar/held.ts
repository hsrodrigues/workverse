import type { HeldItem, ItemDef } from '@workverse/shared';

/**
 * Cups picked up in the room (coffee machine, water cooler). They are NOT catalog items: nobody can equip them, they
 * only exist while the server says the player holds one. They reuse the drawers of the special items, so the mug in the
 * hand is exactly the "Caneca de café" of the wardrobe.
 *
 * Pose support: standing, walking and sitting have art; waving hides the cup (the arm is busy), typing never holds one.
 */
const base = {
  category: 'special',
  slot: 'hand',
  rarity: 'common',
  unlock: 'free',
  availability: 'hidden',
  tags: [],
} as const;

export const HELD_ITEM_DEFS: Record<HeldItem, ItemDef> = {
  coffee: {
    ...base,
    id: 'held.coffee',
    name: 'Caneca de café',
    description: 'Caneca pega na cafeteira.',
    drawer: 'sp.mug',
    poses: { idle: 'full', walk: 'adapted', sit: 'full', wave: 'hidden' },
  },
  water: {
    ...base,
    id: 'held.water',
    name: 'Copo d’água',
    description: 'Copo pego no bebedouro.',
    drawer: 'sp.cup',
    poses: { idle: 'full', walk: 'adapted', sit: 'full', wave: 'hidden' },
  },
};

/** Main color of each cup (the mug is plain white ceramic). */
export const HELD_HEX: Record<HeldItem, string> = { coffee: '#f4f1ea', water: '#dff1fa' };
