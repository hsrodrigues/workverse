/**
 * Data model of the avatar item library. This file holds only types and constants:
 * the catalog (`catalog.ts`) and the palettes (`palettes.ts`) are plain data, the drawing
 * lives on the client (`apps/client/src/game/avatar/`), and a drawer is found by the item's `drawer` key.
 */

export type ItemCategory = 'hair' | 'face' | 'clothes' | 'shoes' | 'accessories' | 'special';

/**
 * A slot holds at most one item. Two items conflict when they share a slot, when one of them lists the other's
 * slot in `excludes`, or when one lists the other's id in `conflicts`.
 */
export type ItemSlot =
  | 'hair'
  | 'eyes'
  | 'brows'
  | 'mouth'
  | 'facialHair'
  | 'top'
  | 'outer'
  | 'bottom'
  | 'shoes'
  | 'head' // hats, caps, beanies
  | 'eyewear'
  | 'ears' // headphones and headsets
  | 'back' // backpack
  | 'wrist'
  | 'neck' // scarf, tie, necklace
  | 'aura' // glow around the feet and body
  | 'cheeks' // blush
  | 'freckles'
  | 'lids' // eye shadow
  | 'hand' // held object
  | 'badge'; // corporate badge on the chest

export type Pose = 'idle' | 'walk' | 'sit' | 'wave';
export const POSES: readonly Pose[] = ['idle', 'walk', 'sit', 'wave'];
export type AvatarView = 'front' | 'front34' | 'back' | 'back34';
export const AVATAR_VIEWS: readonly AvatarView[] = ['front', 'front34', 'back', 'back34'];

/**
 * How an item behaves in a pose.
 * - `full`: drawn natively for that pose.
 * - `adapted`: drawn, but in a different position (e.g. the laptop is closed under the arm while standing).
 * - `hidden`: there is no sprite for that pose; the item is not drawn (the fallback is always "hidden", never a broken sprite).
 * The animation set has no "working" or "talking" pose: items never claim support for them.
 */
export type PoseMode = 'full' | 'adapted' | 'hidden';

export type Rarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';
export const RARITIES: readonly Rarity[] = ['common', 'uncommon', 'rare', 'epic', 'legendary'];

/** Where an item comes from. `free` is open to everybody; the other origins check the account's unlock table. */
export type Unlock = 'free' | `achievement:${string}` | `event:${string}` | 'staff';

/**
 * - `available`: can be equipped (when unlocked).
 * - `hidden`: not listed; only usable by accounts that were explicitly granted `item:<id>`.
 * - `retired`: no longer offered; whoever already wears it keeps it, nobody can equip it anew.
 * - `upcoming`: listed as "coming soon", never equippable.
 */
export type Availability = 'available' | 'hidden' | 'retired' | 'upcoming';

export type PaletteId =
  | 'skin'
  | 'hair'
  | 'brow'
  | 'eye'
  | 'cloth'
  | 'shoe'
  | 'hat'
  | 'frame'
  | 'gadget'
  | 'bag'
  | 'strap'
  | 'ceramic'
  | 'lanyard'
  | 'device'
  | 'lip'
  | 'shadow';

export interface PaletteColor {
  /** Stable id; this is what an avatar stores. */
  id: string;
  name: string;
  hex: string;
  /** Family used by the color filter of the editor. */
  group: string;
}

export interface Palette {
  id: PaletteId;
  name: string;
  colors: readonly PaletteColor[];
}

/** Which part of the sprite a thumbnail crops to. */
export type ThumbFocus = 'head' | 'face' | 'torso' | 'legs' | 'feet' | 'full' | 'back' | 'wrist' | 'hand';

export interface ItemDef {
  /** Unique and stable: it is stored in saved avatars. Never rename or reuse an id. */
  id: string;
  name: string;
  category: ItemCategory;
  slot: ItemSlot;
  description: string;
  /** Key of the drawing function registered on the client. */
  drawer: string;
  /** Variant parameters read by the drawer (so several items can share one function). */
  params?: Readonly<Record<string, number | string | boolean>>;
  /** Palette of the item's main material. Absent: the item has fixed colors. */
  palette?: PaletteId;
  /** Subset of the palette that this item allows (default: all of it). */
  colors?: readonly string[];
  defaultColor?: string;
  /** Slots that cannot be filled together with this item. */
  excludes?: readonly ItemSlot[];
  /**
   * One-piece garments (dresses): slots whose items are NOT drawn while this is worn. The covered piece stays in the saved
   * avatar (required fields keep a value) and comes back as soon as the one-piece is taken off.
   */
  covers?: readonly ItemSlot[];
  /** Item ids that cannot be worn together with this one. */
  conflicts?: readonly string[];
  rarity: Rarity;
  unlock: Unlock;
  availability: Availability;
  /** Support per pose (see PoseMode). */
  poses: Readonly<Record<Pose, PoseMode>>;
  /** Views in which the item has art. Absent: all four. A missing view falls back to not drawing the item. */
  views?: readonly AvatarView[];
  /** Short notes about gaps or adaptations, shown in the docs and the dev gallery. */
  notes?: string;
  /** Free tags used by the style filter: casual, corporate, uniform, tech, seasonal, fantasy... */
  tags: readonly string[];
  thumb?: ThumbFocus;
}

/** A reference to an item with its chosen color (a palette color id). */
export interface ItemRef {
  id: string;
  color?: string;
}

/**
 * Saved appearance, version 2: only references to items and colors, never images.
 * Optional parts: `facialHair`, `outer`. Lists: `accessories` (one per slot) and `special`.
 */
export interface AvatarV2 {
  v: 2;
  /** Id of a color of the `skin` palette. */
  skin: string;
  eyes: ItemRef;
  brows: ItemRef;
  mouth: ItemRef;
  facialHair?: ItemRef;
  hair: ItemRef;
  top: ItemRef;
  outer?: ItemRef;
  bottom: ItemRef;
  shoes: ItemRef;
  accessories: ItemRef[];
  special: ItemRef[];
}

export type IssueCode =
  | 'bad_shape'
  | 'unknown_item'
  | 'wrong_slot'
  | 'unknown_skin'
  | 'bad_color'
  | 'unavailable'
  | 'locked'
  | 'conflict'
  | 'duplicate_slot'
  | 'too_many';

export interface AvatarIssue {
  code: IssueCode;
  /** Field of the avatar (`top`, `accessories[1]`...). */
  field: string;
  itemId?: string;
  message: string;
}

export const MAX_ACCESSORIES = 9;
export const MAX_SPECIAL = 6;
export const MAX_OUTFITS = 12;
export const MIN_OUTFIT_NAME = 1;
export const MAX_OUTFIT_NAME = 24;

/** A named set of references. Stored on the account; never contains sprites. */
export interface Outfit {
  id: string;
  name: string;
  avatar: AvatarV2;
  updatedAt: number;
}
