import { ITEMS, type ItemCategory, type ItemSlot } from '@workverse/shared';
import type { Filter, SectionDef } from './ItemSection';

export type TabId = 'hair' | 'face' | 'clothes' | 'shoes' | 'accessories' | 'special' | 'wardrobe';

export const TABS: readonly { id: TabId; label: string }[] = [
  { id: 'hair', label: 'Cabelo' },
  { id: 'face', label: 'Rosto' },
  { id: 'clothes', label: 'Roupas' },
  { id: 'shoes', label: 'Calçados' },
  { id: 'accessories', label: 'Acessórios' },
  { id: 'special', label: 'Itens especiais' },
  { id: 'wardrobe', label: 'Meu Guarda-Roupa' },
];

const items = (category: ItemCategory, slot: ItemSlot) => ITEMS.filter((i) => i.category === category && i.slot === slot);

const HAIR_FILTERS: Filter[] = [
  { id: 'curto', label: 'Curto', tag: 'curto' },
  { id: 'medio', label: 'Médio', tag: 'médio' },
  { id: 'comprido', label: 'Comprido', tag: 'comprido' },
  { id: 'cacheado', label: 'Cacheado', tag: 'cacheado' },
  { id: 'espetado', label: 'Espetado', tag: 'espetado' },
  { id: 'fem', label: 'Feminino', tag: 'feminino' },
  { id: 'masc', label: 'Masculino', tag: 'masculino' },
  { id: 'uni', label: 'Unissex', tag: 'unissex' },
];
const STYLE_FILTERS: Filter[] = [
  { id: 'casual', label: 'Casual', tag: 'casual' },
  { id: 'corp', label: 'Corporativo', tag: 'corporate' },
  { id: 'uniform', label: 'Uniforme', tag: 'uniform' },
  { id: 'staff', label: 'Equipe', tag: 'staff' },
  { id: 'fem', label: 'Feminino', tag: 'feminino' },
];

/** The option sections of every tab except "Meu Guarda-Roupa" (and the skin tone, handled by the editor). */
export const SECTIONS: Record<Exclude<TabId, 'wardrobe'>, SectionDef[]> = {
  hair: [{ id: 'hair', title: 'Estilo do cabelo', slot: 'hair', items: items('hair', 'hair'), filters: HAIR_FILTERS }],
  face: [
    { id: 'eyes', title: 'Olhos', slot: 'eyes', items: items('face', 'eyes') },
    { id: 'brows', title: 'Sobrancelhas', slot: 'brows', items: items('face', 'brows') },
    { id: 'mouth', title: 'Expressões', slot: 'mouth', items: items('face', 'mouth') },
    { id: 'blush', title: 'Blush', slot: 'cheeks', items: items('accessories', 'cheeks'), removable: true, noneLabel: 'Sem blush' },
    { id: 'freckles', title: 'Sardas', slot: 'freckles', items: items('accessories', 'freckles'), removable: true, noneLabel: 'Sem sardas' },
    { id: 'lids', title: 'Sombra', slot: 'lids', items: items('accessories', 'lids'), removable: true, noneLabel: 'Sem sombra' },
    { id: 'facialHair', title: 'Barba, bigode e cavanhaque', slot: 'facialHair', items: items('face', 'facialHair'), removable: true, noneLabel: 'Sem barba' },
  ],
  clothes: [
    { id: 'top', title: 'Parte de cima', slot: 'top', items: items('clothes', 'top').filter((i) => !i.covers), filters: STYLE_FILTERS },
    { id: 'dress', title: 'Vestidos (peça inteira, cobrem a parte de baixo)', slot: 'top', items: items('clothes', 'top').filter((i) => !!i.covers), filters: STYLE_FILTERS },
    { id: 'outer', title: 'Jaquetas e casacos', slot: 'outer', items: items('clothes', 'outer'), removable: true, noneLabel: 'Sem casaco', filters: STYLE_FILTERS },
    { id: 'bottom', title: 'Calças, bermudas e saias', slot: 'bottom', items: items('clothes', 'bottom'), filters: STYLE_FILTERS.slice(0, 2) },
  ],
  shoes: [{ id: 'shoes', title: 'Calçados', slot: 'shoes', items: items('shoes', 'shoes') }],
  accessories: [
    { id: 'eyewear', title: 'Óculos', slot: 'eyewear', items: items('accessories', 'eyewear'), removable: true },
    { id: 'head', title: 'Bonés e chapéus', slot: 'head', items: items('accessories', 'head'), removable: true },
    { id: 'ears', title: 'Fones e headsets', slot: 'ears', items: items('accessories', 'ears'), removable: true },
    { id: 'back', title: 'Mochilas e bolsas', slot: 'back', items: items('accessories', 'back'), removable: true },
    { id: 'neck', title: 'Cachecóis, gravatas e colares', slot: 'neck', items: items('accessories', 'neck'), removable: true },
    { id: 'wrist', title: 'Relógios e tech', slot: 'wrist', items: items('accessories', 'wrist'), removable: true },
  ],
  special: [
    { id: 'hand', title: 'Para levar na mão', slot: 'hand', items: items('special', 'hand'), removable: true, noneLabel: 'Mãos livres' },
    { id: 'badge', title: 'Crachá', slot: 'badge', items: items('special', 'badge'), removable: true, noneLabel: 'Sem crachá' },
    { id: 'partyhead', title: 'Para a cabeça e eventos', slot: 'head', items: items('special', 'head'), removable: true, noneLabel: 'Nenhum' },
    { id: 'specialears', title: 'Headsets especiais', slot: 'ears', items: items('special', 'ears'), removable: true, noneLabel: 'Nenhum' },
    { id: 'specialback', title: 'Asas, capas e caudas', slot: 'back', items: items('special', 'back'), removable: true, noneLabel: 'Nenhum' },
    { id: 'aura', title: 'Aura', slot: 'aura', items: items('special', 'aura'), removable: true, noneLabel: 'Sem aura' },
  ],
};
