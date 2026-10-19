import type { ItemDef, Pose, PoseMode } from './types';

/**
 * Uniforme exclusivo do setor de TI (equipe/setor cujo nome normalizado e "ti"). Todos usam o desbloqueio por SETOR
 * `dept:ti`: o servidor deriva a chave do vinculo atual da conta com o setor (apps/server/src/wardrobe.ts), nunca de dado
 * editavel pela pessoa. Aparecem no editor para todos, bloqueados para quem nao e da TI. Desenhos reaproveitam os drawers
 * das pecas comuns com detalhes ciano/neon (engine.ts, drawers/outers.ts, drawers/specials.ts, drawers/events.ts).
 */
const FULL: Record<Pose, PoseMode> = { idle: 'full', walk: 'full', sit: 'full', wave: 'full' };

export const TI_UNLOCK = 'dept:ti';

const ti = (d: Omit<ItemDef, 'unlock' | 'availability' | 'poses' | 'tags'> & { tags?: string[] }): ItemDef => ({
  unlock: TI_UNLOCK,
  availability: 'available',
  poses: FULL,
  ...d,
  tags: ['ti', 'uniform', 'tech', 'desbloqueável', ...(d.tags ?? [])],
});

export const TI_ITEMS: readonly ItemDef[] = [
  ti({ id: 'ti.polo', name: 'Polo técnica da TI', category: 'clothes', slot: 'top', description: 'Polo azul-escuro com frisos ciano e o chip do setor no peito.', drawer: 'top.polo', params: { variant: 'ti' }, palette: 'cloth', colors: ['navy', 'charcoal', 'slate'], defaultColor: 'navy', rarity: 'rare', thumb: 'torso' }),
  ti({ id: 'ti.tee', name: 'Camiseta técnica da TI', category: 'clothes', slot: 'top', description: 'Camiseta escura com listras ciano nas laterais e o chip do setor no peito.', drawer: 'top.tee', params: { variant: 'ti' }, palette: 'cloth', colors: ['navy', 'charcoal', 'slate'], defaultColor: 'charcoal', rarity: 'rare', thumb: 'torso' }),
  ti({ id: 'ti.vest', name: 'Colete da TI', category: 'clothes', slot: 'outer', description: 'Colete escuro com frisos ciano, chip no peito e faixa refletiva nas costas.', drawer: 'outer.vest', params: { variant: 'ti' }, palette: 'cloth', colors: ['navy', 'charcoal'], defaultColor: 'navy', rarity: 'epic', thumb: 'torso' }),
  ti({ id: 'ti.cargo', name: 'Calça cargo da TI', category: 'clothes', slot: 'bottom', description: 'Calça cargo escura com costuras ciano.', drawer: 'bottom.pants', params: { variant: 'cargo', accent: 'ti' }, palette: 'cloth', colors: ['charcoal', 'navy', 'slate'], defaultColor: 'charcoal', rarity: 'rare', thumb: 'legs' }),
  ti({ id: 'ti.sneakers', name: 'Tênis tech da TI', category: 'shoes', slot: 'shoes', description: 'Tênis escuro com solado e faixa ciano.', drawer: 'shoes.sneakers', params: { accent: 'ti' }, palette: 'shoe', colors: ['black', 'blue', 'gray'], defaultColor: 'black', rarity: 'rare', thumb: 'feet' }),
  ti({ id: 'ti.backpack', name: 'Mochila de notebook da TI', category: 'accessories', slot: 'back', description: 'Mochila escura com bolso de notebook e zíper ciano.', drawer: 'acc.backpack', params: { accent: 'ti' }, palette: 'bag', colors: ['navy', 'black', 'gray'], defaultColor: 'navy', rarity: 'epic', thumb: 'back' }),
  ti({ id: 'ti.headset', name: 'Headset da TI', category: 'special', slot: 'ears', description: 'Headset com orelhas de luz ciano e microfone.', drawer: 'ti.headset', excludes: ['head'], rarity: 'epic', thumb: 'head' }),
  ti({
    id: 'ti.badge',
    name: 'Crachá da TI',
    category: 'special',
    slot: 'badge',
    description: 'Crachá ciano neon com chip de circuito, as letras TI, mini-retrato e a faixa na cor do seu setor.',
    drawer: 'sp.badge',
    params: { ti: true },
    palette: 'lanyard',
    colors: ['cyan'],
    defaultColor: 'cyan',
    rarity: 'epic',
    thumb: 'torso',
  }),
];
