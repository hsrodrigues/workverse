import type { ItemDef, ItemSlot, Pose, PoseMode, ThumbFocus } from './types';

/**
 * Itens de avatar dos eventos (ver events.ts). Cada um e liberado pela chave `event:<id>`: o servidor concede essa
 * chave a todo mundo enquanto o evento esta ativo (apps/server/src/wardrobe.ts); quem esta vestindo o item o mantem depois.
 * Desenhos em apps/client/src/game/avatar/drawers/events.ts. Todos tem arte nas 4 vistas e nas 4 poses (como os chapeus).
 */
const FULL: Record<Pose, PoseMode> = { idle: 'full', walk: 'full', sit: 'full', wave: 'full' };

const THUMB: Partial<Record<ItemSlot, ThumbFocus>> = { head: 'head', eyewear: 'face', ears: 'head', neck: 'torso', badge: 'torso', top: 'torso' };

const ev = (id: string, name: string, slot: ItemSlot, description: string, drawer: string, event: string, tags: string[], more: Partial<ItemDef> = {}): ItemDef => ({
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
  thumb: THUMB[slot] ?? 'head',
  ...more,
});

export const EVENT_ITEMS: readonly ItemDef[] = [
  ev('ev.witch_hat', 'Chapéu de bruxa', 'head', 'Chapéu pontudo roxo com fivela laranja, para o Halloween.', 'ev.witch_hat', 'halloween', ['fantasia']),
  ev('ev.pumpkin_hat', 'Fantasia de abóbora', 'head', 'Uma abóbora iluminada na cabeça.', 'ev.pumpkin_hat', 'halloween', ['fantasia']),
  ev('ev.carnival_mask', 'Máscara de Carnaval', 'eyewear', 'Máscara de glitter com plumas coloridas.', 'ev.carnival_mask', 'carnaval', ['festa']),
  ev('ev.ny_glasses', 'Óculos de Ano Novo', 'eyewear', 'Óculos dourados de virada de ano, com brilho de festa.', 'ev.ny_glasses', 'anonovo', ['festa']),
  ev('ev.bunny_ears', 'Orelhas de coelho', 'head', 'Tiara com orelhas de coelho para a Páscoa.', 'ev.bunny_ears', 'pascoa', ['fantasia']),
  ev('ev.antlers', 'Chifres de rena', 'head', 'Tiara de rena com fita vermelha e guizo.', 'ev.antlers', 'natal', ['fantasia']),
  // Dia do Profissional de TI (diati): homenagens genericas de ficcao cientifica, tudo original
  ev('ev.tee_answer', 'Camiseta 42', 'top', 'Camiseta com o 42, a resposta para a vida, o universo e tudo mais.', 'top.tee', 'diati', ['tech', 'camiseta'], { category: 'clothes', palette: 'cloth', defaultColor: 'navy', params: { print: 'n42' } }),
  ev('ev.towel', 'Toalha de ombro', 'neck', 'Toalha listrada pendurada no pescoço: todo bom viajante sabe onde está a sua.', 'acc.neck_kit', 'diati', ['tech', 'fofo'], { palette: 'cloth', colors: ['teal', 'sky', 'off-white', 'navy'], defaultColor: 'teal', params: { shape: 'scarf' } }),
  ev('ev.bridge_headset', 'Headset de ponte de comando', 'ears', 'Headset com orelhas de luz ciano e microfone, direto da ponte da nave.', 'ev.bridge_headset', 'diati', ['tech', 'scifi'], { excludes: ['head'] }),
  ev('ev.hacker_shades', 'Óculos de hacker neon', 'eyewear', 'Visor escuro com lentes ciano e brilho neon.', 'ev.hacker_shades', 'diati', ['tech', 'scifi']),
  ev('ev.comm_badge', 'Comunicador no peito', 'badge', 'Comunicador redondo de metal com núcleo ciano aceso.', 'ev.comm_badge', 'diati', ['tech', 'scifi']),
  ev('ev.alien_antennae', 'Antenas de alien', 'head', 'Tiara com antenas fofas e bulbos verde-matriz que brilham.', 'ev.alien_antennae', 'diati', ['tech', 'fofo', 'fantasia']),
];
