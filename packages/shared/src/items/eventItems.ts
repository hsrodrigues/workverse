import type { ItemDef, Pose, PoseMode } from './types';

/**
 * Itens de avatar dos eventos (ver events.ts). Cada um e liberado pela chave `event:<id>`: o servidor concede essa
 * chave a todo mundo enquanto o evento esta ativo (apps/server/src/wardrobe.ts); quem esta vestindo o item o mantem depois.
 * Desenhos em apps/client/src/game/avatar/drawers/events.ts. Todos tem arte nas 4 vistas e nas 4 poses (como os chapeus).
 */
const FULL: Record<Pose, PoseMode> = { idle: 'full', walk: 'full', sit: 'full', wave: 'full' };

const ev = (id: string, name: string, slot: 'head' | 'eyewear', description: string, drawer: string, event: string, tags: string[], more: Partial<ItemDef> = {}): ItemDef => ({
  id,
  name,
  category: 'special',
  slot,
  description,
  drawer,
  rarity: 'rare',
  unlock: `event:${event}`,
  availability: 'available',
  poses: FULL,
  tags: ['sazonal', 'desbloqueável', ...tags],
  thumb: slot === 'head' ? 'head' : 'face',
  ...more,
});

export const EVENT_ITEMS: readonly ItemDef[] = [
  ev('ev.witch_hat', 'Chapéu de bruxa', 'head', 'Chapéu pontudo roxo com fivela laranja, para o Halloween.', 'ev.witch_hat', 'halloween', ['fantasia']),
  ev('ev.pumpkin_hat', 'Fantasia de abóbora', 'head', 'Uma abóbora iluminada na cabeça.', 'ev.pumpkin_hat', 'halloween', ['fantasia']),
  ev('ev.carnival_mask', 'Máscara de Carnaval', 'eyewear', 'Máscara de glitter com plumas coloridas.', 'ev.carnival_mask', 'carnaval', ['festa']),
  ev('ev.ny_glasses', 'Óculos de Ano Novo', 'eyewear', 'Óculos dourados de virada de ano, com brilho de festa.', 'ev.ny_glasses', 'anonovo', ['festa']),
  ev('ev.bunny_ears', 'Orelhas de coelho', 'head', 'Tiara com orelhas de coelho para a Páscoa.', 'ev.bunny_ears', 'pascoa', ['fantasia']),
  ev('ev.antlers', 'Chifres de rena', 'head', 'Tiara de rena com fita vermelha e guizo.', 'ev.antlers', 'natal', ['fantasia']),
];
