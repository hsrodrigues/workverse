import type { HeldItem, ItemDef } from '@workverse/shared';

/**
 * Things picked up in the room (coffee machine, water cooler, vending machines, microwave). They are NOT catalog items: nobody can equip them, they
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
  snack: {
    ...base,
    id: 'held.snack',
    name: 'Pacote de salgadinho',
    description: 'Lanche comprado na máquina.',
    drawer: 'sp.snack',
    poses: { idle: 'full', walk: 'adapted', sit: 'full', wave: 'hidden' },
  },
  soda: {
    ...base,
    id: 'held.soda',
    name: 'Latinha de refrigerante',
    description: 'Lata gelada da máquina de bebidas.',
    drawer: 'sp.can',
    poses: { idle: 'full', walk: 'adapted', sit: 'full', wave: 'hidden' },
  },
  meal: {
    ...base,
    id: 'held.meal',
    name: 'Marmita',
    description: 'Marmita esquentada no micro-ondas.',
    drawer: 'sp.lunchbox',
    poses: { idle: 'full', walk: 'adapted', sit: 'full', wave: 'hidden' },
  },
};

/** Main color of each cup (the mug is plain white ceramic). */
export const HELD_HEX: Record<HeldItem, string> = { coffee: '#f4f1ea', water: '#dff1fa', snack: '#e0412e', soda: '#d6342a', meal: '#d9dde6' };
