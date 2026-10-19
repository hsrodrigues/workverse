import type { Palette, PaletteColor, PaletteId } from './types';

/**
 * Palettes are append-only: avatars store the color ids. Every color is a single base tone; the client
 * derives the light/shadow/outline tones from it by a fixed rule (`recolor.ts`), so any color of any
 * palette keeps the item's shading and outline intact.
 */
const c = (id: string, name: string, hex: string, group: string): PaletteColor => ({ id, name, hex, group });

const SKIN: PaletteColor[] = [
  // The first 8 reproduce the legacy SKIN_TONES, in order.
  c('pale-peach', 'Pêssego claro', '#ffdcb9', 'clara'),
  c('peach', 'Pêssego', '#f2c28f', 'clara'),
  c('tan', 'Bronzeado', '#d8a070', 'média'),
  c('bronze', 'Bronze', '#b57a4e', 'média'),
  c('brown', 'Marrom', '#8a5634', 'escura'),
  c('deep', 'Marrom profundo', '#5c3a24', 'escura'),
  c('porcelain', 'Porcelana', '#fbe6d6', 'clara'),
  c('ebony', 'Ébano', '#3f2818', 'escura'),
  c('rosy', 'Rosada', '#eab8a0', 'clara'),
  c('golden', 'Dourada', '#e0b078', 'média'),
  c('olive', 'Oliva', '#c99a6b', 'média'),
  c('cocoa', 'Cacau', '#75492c', 'escura'),
];

const HAIR: PaletteColor[] = [
  // The first 13 reproduce the legacy HAIR_COLORS, in order.
  c('black', 'Preto', '#1c1410', 'preto'),
  c('dark-brown', 'Castanho escuro', '#4a2c17', 'castanho'),
  c('brown', 'Castanho', '#8a5a2b', 'castanho'),
  c('blonde', 'Loiro', '#c9962f', 'loiro'),
  c('light-blonde', 'Loiro claro', '#e8d27a', 'loiro'),
  c('red', 'Ruivo', '#b3361f', 'ruivo'),
  c('gray', 'Grisalho', '#6b6f78', 'grisalho'),
  c('blue', 'Azul', '#3b6fd4', 'fantasia'),
  c('white', 'Branco', '#e9e6df', 'grisalho'),
  c('pink', 'Rosa', '#d96aa8', 'fantasia'),
  c('teal', 'Turquesa', '#2fa89a', 'fantasia'),
  c('purple', 'Roxo', '#7a4bc8', 'fantasia'),
  c('orange', 'Laranja', '#d9702a', 'ruivo'),
  c('chestnut', 'Castanho médio', '#6a3d1e', 'castanho'),
  c('auburn', 'Acobreado', '#8a3a22', 'ruivo'),
  c('ash-blonde', 'Loiro acinzentado', '#b8a070', 'loiro'),
  c('silver', 'Prata', '#a8adb8', 'grisalho'),
  c('green', 'Verde', '#4cae4c', 'fantasia'),
  c('magenta', 'Magenta', '#c0307a', 'fantasia'),
];

const BROW: string[] = ['black', 'dark-brown', 'chestnut', 'brown', 'blonde', 'red', 'gray'];

const EYE: PaletteColor[] = [
  c('ink', 'Preto', '#241821', 'escuro'),
  c('brown', 'Castanho', '#4a2c17', 'escuro'),
  c('hazel', 'Mel', '#8a6a2b', 'claro'),
  c('green', 'Verde', '#3f8a4f', 'claro'),
  c('blue', 'Azul', '#3d82d6', 'claro'),
  c('gray', 'Cinza', '#6b7380', 'claro'),
  c('violet', 'Violeta', '#7a4bc8', 'fantasia'),
];

const CLOTH: PaletteColor[] = [
  // The first 19 reproduce the legacy CLOTH_COLORS, in order.
  c('red', 'Vermelho', '#e04848', 'quente'),
  c('orange', 'Laranja', '#e8873a', 'quente'),
  c('yellow', 'Amarelo', '#f0c93a', 'quente'),
  c('green', 'Verde', '#58b858', 'frio'),
  c('teal', 'Turquesa', '#2fa89a', 'frio'),
  c('blue', 'Azul', '#3d82d6', 'frio'),
  c('violet', 'Violeta', '#6a55c8', 'frio'),
  c('magenta', 'Magenta', '#c85aa8', 'quente'),
  c('off-white', 'Branco', '#f4f1ea', 'neutro'),
  c('gray', 'Cinza', '#9aa0a8', 'neutro'),
  c('slate', 'Grafite', '#4a4f5c', 'escuro'),
  c('charcoal', 'Preto', '#23252e', 'escuro'),
  c('sky', 'Celeste', '#7fd1e8', 'pastel'),
  c('rose', 'Rosa', '#f4a6c0', 'pastel'),
  c('lime', 'Lima', '#a8d880', 'pastel'),
  c('wine', 'Vinho', '#8a2f45', 'escuro'),
  c('navy', 'Marinho', '#1f3a6e', 'escuro'),
  c('brown', 'Marrom', '#6b4a2f', 'escuro'),
  c('sand', 'Areia', '#c9b79a', 'neutro'),
  c('denim', 'Jeans', '#3a5f9a', 'frio'),
  c('light-denim', 'Jeans claro', '#6b8fc4', 'frio'),
  c('olive', 'Oliva', '#5c6b3a', 'escuro'),
  c('khaki', 'Cáqui', '#b5a26a', 'neutro'),
  c('forest', 'Verde floresta', '#2f6b45', 'escuro'),
  c('mustard', 'Mostarda', '#d6a82a', 'quente'),
  c('coral', 'Coral', '#ee6a5a', 'quente'),
];

const SHOE: PaletteColor[] = [
  // The first 9 reproduce the legacy SHOE_COLORS, in order.
  c('black', 'Preto', '#23252e', 'escuro'),
  c('white', 'Branco', '#f4f1ea', 'neutro'),
  c('red', 'Vermelho', '#e04848', 'vivo'),
  c('blue', 'Azul', '#3d82d6', 'vivo'),
  c('brown', 'Marrom', '#8a5634', 'escuro'),
  c('green', 'Verde', '#58b858', 'vivo'),
  c('yellow', 'Amarelo', '#f0c93a', 'vivo'),
  c('purple', 'Roxo', '#6a55c8', 'vivo'),
  c('gray', 'Cinza', '#9aa0a8', 'neutro'),
  c('navy', 'Marinho', '#1f3a6e', 'escuro'),
  c('tan', 'Caramelo', '#c9a070', 'neutro'),
  c('burgundy', 'Bordô', '#6a2535', 'escuro'),
  c('pink', 'Rosa', '#f4a6c0', 'vivo'),
];

const HAT: PaletteColor[] = [
  c('brick', 'Tijolo', '#c44a3a', 'quente'),
  c('blue', 'Azul', '#3d82d6', 'frio'),
  c('black', 'Preto', '#2b2f3a', 'escuro'),
  c('white', 'Branco', '#f1ede2', 'neutro'),
  c('navy', 'Marinho', '#1f3a6e', 'escuro'),
  c('green', 'Verde', '#3f9a58', 'frio'),
  c('yellow', 'Amarelo', '#f0c93a', 'quente'),
  c('gray', 'Cinza', '#8a8f9a', 'neutro'),
  c('pink', 'Rosa', '#e88aa8', 'quente'),
  c('brown', 'Marrom', '#7a5436', 'escuro'),
  c('sand', 'Areia', '#d2bf94', 'neutro'),
];

const FRAME: PaletteColor[] = [
  c('ink', 'Preto fosco', '#15131b', 'escuro'),
  c('black', 'Preto', '#2a2635', 'escuro'),
  c('silver', 'Prata', '#aab0bc', 'metal'),
  c('gold', 'Dourado', '#d9b24a', 'metal'),
  c('red', 'Vermelho', '#c0392b', 'cor'),
  c('blue', 'Azul', '#3d6fd4', 'cor'),
  c('tortoise', 'Tartaruga', '#8a5a2b', 'escuro'),
  c('pink', 'Rosa', '#e07aa6', 'cor'),
  c('green', 'Verde', '#3f9a58', 'cor'),
  c('white', 'Branco', '#e8e6df', 'neutro'),
];

const GADGET: PaletteColor[] = [
  c('blue', 'Azul', '#3d82d6', 'cor'),
  c('red', 'Vermelho', '#e04848', 'cor'),
  c('black', 'Preto', '#3a3f4e', 'escuro'),
  c('white', 'Branco', '#e8e6df', 'neutro'),
  c('green', 'Verde', '#58b858', 'cor'),
  c('purple', 'Roxo', '#6a55c8', 'cor'),
  c('orange', 'Laranja', '#e8873a', 'cor'),
  c('pink', 'Rosa', '#f4a6c0', 'cor'),
  c('silver', 'Prata', '#aab0bc', 'metal'),
];

const BAG: PaletteColor[] = [
  c('navy', 'Marinho', '#1f3a6e', 'escuro'),
  c('black', 'Preto', '#23252e', 'escuro'),
  c('gray', 'Cinza', '#6b7380', 'neutro'),
  c('red', 'Vermelho', '#c0392b', 'cor'),
  c('green', 'Verde', '#3f7a52', 'cor'),
  c('olive', 'Oliva', '#5c6b3a', 'escuro'),
  c('orange', 'Laranja', '#e8873a', 'cor'),
  c('brown', 'Marrom', '#7a5436', 'escuro'),
  c('blue', 'Azul', '#3d82d6', 'cor'),
  c('teal', 'Turquesa', '#2fa89a', 'cor'),
];

const STRAP: PaletteColor[] = [
  c('black', 'Preto', '#23252e', 'escuro'),
  c('brown', 'Marrom', '#7a5436', 'escuro'),
  c('silver', 'Metal', '#aab0bc', 'metal'),
  c('red', 'Vermelho', '#c0392b', 'cor'),
  c('blue', 'Azul', '#3d6fd4', 'cor'),
  c('white', 'Branco', '#e8e6df', 'neutro'),
  c('green', 'Verde', '#3f9a58', 'cor'),
  c('pink', 'Rosa', '#e07aa6', 'cor'),
];

const CERAMIC: PaletteColor[] = [
  c('white', 'Branco', '#f4f1ea', 'neutro'),
  c('red', 'Vermelho', '#e04848', 'cor'),
  c('blue', 'Azul', '#3d82d6', 'cor'),
  c('green', 'Verde', '#58b858', 'cor'),
  c('yellow', 'Amarelo', '#f0c93a', 'cor'),
  c('black', 'Preto', '#2b2f3a', 'escuro'),
  c('pink', 'Rosa', '#f4a6c0', 'cor'),
  c('gold', 'Dourado', '#e0b43c', 'metal'),
];

const LANYARD: PaletteColor[] = [
  c('blue', 'Azul', '#3d82d6', 'cor'),
  c('red', 'Vermelho', '#e04848', 'cor'),
  c('green', 'Verde', '#58b858', 'cor'),
  c('orange', 'Laranja', '#e8873a', 'cor'),
  c('purple', 'Roxo', '#6a55c8', 'cor'),
  c('black', 'Preto', '#2b2f3a', 'escuro'),
  c('gold', 'Dourado', '#e0b43c', 'metal'),
  c('cyan', 'Ciano', '#27d9ff', 'cor'),
];

const DEVICE: PaletteColor[] = [
  c('silver', 'Prata', '#aab0bc', 'metal'),
  c('space', 'Cinza espacial', '#5a606e', 'escuro'),
  c('black', 'Preto', '#2b2f3a', 'escuro'),
  c('white', 'Branco', '#e8e6df', 'neutro'),
  c('rose', 'Ouro rosé', '#e0a89a', 'cor'),
  c('blue', 'Azul', '#3d82d6', 'cor'),
  c('green', 'Verde', '#4aa86a', 'cor'),
];

const LIP: PaletteColor[] = [
  c('red', 'Vermelho', '#d0283c', 'vivo'),
  c('crimson', 'Carmim', '#a81a38', 'escuro'),
  c('pink', 'Rosa', '#e8708f', 'vivo'),
  c('nude', 'Nude', '#c98a78', 'suave'),
  c('coral', 'Coral', '#ee6a5a', 'vivo'),
  c('berry', 'Frutas vermelhas', '#8a2a5a', 'escuro'),
  c('plum', 'Ameixa', '#6a2048', 'escuro'),
  c('rose', 'Rosé', '#d4849a', 'suave'),
  c('orange', 'Laranja', '#e8873a', 'vivo'),
  c('mauve', 'Malva', '#a8607a', 'suave'),
];

const SHADOW: PaletteColor[] = [
  c('rose', 'Rosé', '#e8a0b8', 'suave'),
  c('lilac', 'Lilás', '#a890e0', 'cor'),
  c('teal', 'Turquesa', '#3fb0a0', 'cor'),
  c('gold', 'Dourado', '#d9b24a', 'metal'),
  c('blue', 'Azul', '#5a8ae0', 'cor'),
  c('smoke', 'Esfumado', '#5a5a6a', 'escuro'),
  c('peach', 'Pêssego', '#f0a880', 'suave'),
  c('green', 'Verde', '#6ab060', 'cor'),
];

const NAMES: Record<PaletteId, string> = {
  skin: 'Tons de pele',
  hair: 'Cores de cabelo',
  brow: 'Cores de sobrancelha',
  eye: 'Cores dos olhos',
  cloth: 'Cores de tecido',
  shoe: 'Cores de calçado',
  hat: 'Cores de chapéu',
  frame: 'Cores de armação',
  gadget: 'Cores de gadget',
  bag: 'Cores de mochila',
  strap: 'Cores de pulseira',
  ceramic: 'Cores de cerâmica',
  lanyard: 'Cores de cordão',
  device: 'Cores de dispositivo',
  lip: 'Cores de batom e blush',
  shadow: 'Cores de sombra',
};

const RAW: Record<PaletteId, readonly PaletteColor[]> = {
  skin: SKIN,
  hair: HAIR,
  brow: HAIR.filter((x) => BROW.includes(x.id)),
  eye: EYE,
  cloth: CLOTH,
  shoe: SHOE,
  hat: HAT,
  frame: FRAME,
  gadget: GADGET,
  bag: BAG,
  strap: STRAP,
  ceramic: CERAMIC,
  lanyard: LANYARD,
  device: DEVICE,
  lip: LIP,
  shadow: SHADOW,
};

export const PALETTES: Readonly<Record<PaletteId, Palette>> = Object.fromEntries(
  (Object.keys(RAW) as PaletteId[]).map((id) => [id, { id, name: NAMES[id], colors: RAW[id] }]),
) as Record<PaletteId, Palette>;

export function paletteColor(palette: PaletteId, colorId: string): PaletteColor | undefined {
  return PALETTES[palette].colors.find((x) => x.id === colorId);
}

/** Hex of a color id; falls back to the palette's first color when the id is unknown (renderer safety net). */
export function colorHex(palette: PaletteId, colorId: string | undefined): string {
  const p = PALETTES[palette];
  return (colorId ? p.colors.find((x) => x.id === colorId) : undefined)?.hex ?? p.colors[0].hex;
}

/** Id of the color with exactly this hex (used by the legacy migration). */
export function colorIdByHex(palette: PaletteId, hex: string): string | undefined {
  const h = hex.toLowerCase();
  return PALETTES[palette].colors.find((x) => x.hex.toLowerCase() === h)?.id;
}
