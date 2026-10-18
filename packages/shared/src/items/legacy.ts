import { colorIdByHex } from './palettes';
import type { AvatarV2, ItemRef } from './types';

/**
 * The first avatar model: ten indexes into append-only catalogs. It is kept only to read accounts saved
 * before version 2 (`migrateLegacyAvatar`). These arrays must never change.
 */
export interface LegacyAvatarConfig {
  skin: number;
  hairStyle: number;
  hairColor: number;
  top: number;
  topColor: number;
  bottom: number;
  bottomColor: number;
  shoes: number;
  shoeColor: number;
  accessory: number;
}

export const LEGACY_SKIN_TONES = ['#ffdcb9', '#f2c28f', '#d8a070', '#b57a4e', '#8a5634', '#5c3a24', '#fbe6d6', '#3f2818'] as const;
export const LEGACY_HAIR_COLORS = [
  '#1c1410', '#4a2c17', '#8a5a2b', '#c9962f', '#e8d27a', '#b3361f', '#6b6f78', '#3b6fd4',
  '#e9e6df', '#d96aa8', '#2fa89a', '#7a4bc8', '#d9702a',
] as const;
export const LEGACY_CLOTH_COLORS = [
  '#e04848', '#e8873a', '#f0c93a', '#58b858', '#2fa89a', '#3d82d6',
  '#6a55c8', '#c85aa8', '#f4f1ea', '#9aa0a8', '#4a4f5c', '#23252e',
  '#7fd1e8', '#f4a6c0', '#a8d880', '#8a2f45', '#1f3a6e', '#6b4a2f', '#c9b79a',
] as const;
export const LEGACY_SHOE_COLORS = ['#23252e', '#f4f1ea', '#e04848', '#3d82d6', '#8a5634', '#58b858', '#f0c93a', '#6a55c8', '#9aa0a8'] as const;

export const LEGACY_HAIR_STYLES = ['Curto', 'Longo', 'Espetado', 'Coque', 'Careca', 'Black power', 'Rabo de cavalo', 'Chanel', 'Topete'] as const;
export const LEGACY_TOPS = ['Camiseta', 'Camisa social', 'Moletom', 'Blazer', 'Polo', 'Suéter'] as const;
export const LEGACY_BOTTOMS = ['Calça', 'Bermuda', 'Saia', 'Calça social', 'Calça cargo'] as const;
export const LEGACY_SHOES = ['Tênis', 'Sapato', 'Bota', 'Tênis cano alto'] as const;
export const LEGACY_ACCESSORIES = ['Nenhum', 'Óculos', 'Headset', 'Boné', 'Óculos escuros', 'Gorro', 'Fones'] as const;

export const LEGACY_LIMITS: Record<keyof LegacyAvatarConfig, number> = {
  skin: LEGACY_SKIN_TONES.length,
  hairStyle: LEGACY_HAIR_STYLES.length,
  hairColor: LEGACY_HAIR_COLORS.length,
  top: LEGACY_TOPS.length,
  topColor: LEGACY_CLOTH_COLORS.length,
  bottom: LEGACY_BOTTOMS.length,
  bottomColor: LEGACY_CLOTH_COLORS.length,
  shoes: LEGACY_SHOES.length,
  shoeColor: LEGACY_SHOE_COLORS.length,
  accessory: LEGACY_ACCESSORIES.length,
};

export const LEGACY_DEFAULT: LegacyAvatarConfig = {
  skin: 1, hairStyle: 0, hairColor: 1, top: 0, topColor: 5,
  bottom: 0, bottomColor: 10, shoes: 0, shoeColor: 0, accessory: 0,
};

const HAIR_ITEMS = ['hair.short', 'hair.long', 'hair.spiky', 'hair.bun', 'hair.bald', 'hair.afro', 'hair.ponytail', 'hair.bob', 'hair.pompadour'] as const;
const BOTTOM_ITEMS = ['bottom.pants', 'bottom.shorts', 'bottom.skirt', 'bottom.dress', 'bottom.cargo'] as const;
const SHOE_ITEMS = ['shoes.sneakers', 'shoes.dress', 'shoes.boots', 'shoes.hightop'] as const;
/** Legacy accessory index to [item, color id] (the colors that were hard-coded in the old renderer). */
const ACCESSORY_ITEMS: ReadonlyArray<readonly [string, string] | null> = [
  null,
  ['acc.glasses', 'black'],
  ['acc.headset', 'blue'],
  ['acc.cap', 'brick'],
  ['acc.sunglasses', 'ink'],
  ['acc.beanie', 'blue'],
  ['acc.headphones', 'red'],
];

/** True for an object that looks like the old index-based config (no `v: 2`). */
export function isLegacyAvatar(x: unknown): x is Partial<LegacyAvatarConfig> {
  if (typeof x !== 'object' || x === null) return false;
  const o = x as Record<string, unknown>;
  return o.v === undefined && ('skin' in o || 'hairStyle' in o || 'top' in o || 'accessory' in o);
}

const idx = (v: unknown, key: keyof LegacyAvatarConfig): number => {
  const d = LEGACY_DEFAULT[key];
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < LEGACY_LIMITS[key] ? v : d;
};

/**
 * Converts an index-based avatar to version 2 without losing anything: every old catalog entry maps to an item and
 * a palette color with the same hex. The old Blazer was a jacket over a white shirt and becomes `outer.blazer` +
 * `top.shirt`. Invalid indexes fall back to the old defaults, as the old sanitizer did.
 */
export function migrateLegacyAvatar(input: unknown): AvatarV2 {
  const src = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>;
  const L = {
    skin: idx(src.skin, 'skin'),
    hairStyle: idx(src.hairStyle, 'hairStyle'),
    hairColor: idx(src.hairColor, 'hairColor'),
    top: idx(src.top, 'top'),
    topColor: idx(src.topColor, 'topColor'),
    bottom: idx(src.bottom, 'bottom'),
    bottomColor: idx(src.bottomColor, 'bottomColor'),
    shoes: idx(src.shoes, 'shoes'),
    shoeColor: idx(src.shoeColor, 'shoeColor'),
    accessory: idx(src.accessory, 'accessory'),
  };
  const cloth = (i: number) => colorIdByHex('cloth', LEGACY_CLOTH_COLORS[i])!;
  const ref = (id: string, color?: string): ItemRef => (color === undefined ? { id } : { id, color });

  const out: AvatarV2 = {
    v: 2,
    skin: colorIdByHex('skin', LEGACY_SKIN_TONES[L.skin])!,
    eyes: ref('eyes.dots', 'ink'),
    brows: ref('brows.none'),
    mouth: ref('mouth.smile'),
    hair: L.hairStyle === 4 ? ref('hair.bald') : ref(HAIR_ITEMS[L.hairStyle], colorIdByHex('hair', LEGACY_HAIR_COLORS[L.hairColor])!),
    top: ref('top.tee'),
    bottom: ref(BOTTOM_ITEMS[L.bottom], cloth(L.bottomColor)),
    shoes: ref(SHOE_ITEMS[L.shoes], colorIdByHex('shoe', LEGACY_SHOE_COLORS[L.shoeColor])!),
    accessories: [],
    special: [],
  };
  switch (L.top) {
    case 1: out.top = ref('top.shirt', cloth(L.topColor)); break;
    case 2: out.top = ref('top.hoodie', cloth(L.topColor)); break;
    case 3:
      out.top = ref('top.shirt', 'off-white');
      out.outer = ref('outer.blazer', cloth(L.topColor));
      break;
    case 4: out.top = ref('top.polo', cloth(L.topColor)); break;
    case 5: out.top = ref('top.sweater', cloth(L.topColor)); break;
    default: out.top = ref('top.tee', cloth(L.topColor));
  }
  const acc = ACCESSORY_ITEMS[L.accessory];
  if (acc) out.accessories.push(ref(acc[0], acc[1]));
  return out;
}
