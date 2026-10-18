import { ACCESS_MESSAGES, accessOf, type AccessContext } from './access';
import { ITEMS, defaultColorOf, getItem, itemColors } from './catalog';
import { isLegacyAvatar, migrateLegacyAvatar } from './legacy';
import { PALETTES } from './palettes';
import {
  MAX_ACCESSORIES,
  MAX_SPECIAL,
  type AvatarIssue,
  type AvatarV2,
  type IssueCode,
  type ItemDef,
  type ItemRef,
  type ItemSlot,
} from './types';

export type SingleField = 'eyes' | 'brows' | 'mouth' | 'facialHair' | 'hair' | 'top' | 'outer' | 'bottom' | 'shoes';

const SINGLE_SLOT: Readonly<Record<SingleField, ItemSlot>> = {
  eyes: 'eyes',
  brows: 'brows',
  mouth: 'mouth',
  facialHair: 'facialHair',
  hair: 'hair',
  top: 'top',
  outer: 'outer',
  bottom: 'bottom',
  shoes: 'shoes',
};
const SINGLE_FIELDS = Object.keys(SINGLE_SLOT) as SingleField[];
const REQUIRED: readonly SingleField[] = ['eyes', 'brows', 'mouth', 'hair', 'top', 'bottom', 'shoes'];
export const isRequiredField = (f: string) => (REQUIRED as readonly string[]).includes(f);

/** The default look; identical to the old default after migration (tested). */
export const DEFAULT_AVATAR: AvatarV2 = {
  v: 2,
  skin: 'peach',
  eyes: { id: 'eyes.dots', color: 'ink' },
  brows: { id: 'brows.none' },
  mouth: { id: 'mouth.smile' },
  hair: { id: 'hair.short', color: 'dark-brown' },
  top: { id: 'top.tee', color: 'blue' },
  bottom: { id: 'bottom.pants', color: 'slate' },
  shoes: { id: 'shoes.sneakers', color: 'black' },
  accessories: [],
  special: [],
};

export const cloneAvatar = (a: AvatarV2): AvatarV2 => ({
  ...a,
  eyes: { ...a.eyes },
  brows: { ...a.brows },
  mouth: { ...a.mouth },
  hair: { ...a.hair },
  top: { ...a.top },
  bottom: { ...a.bottom },
  shoes: { ...a.shoes },
  ...(a.facialHair ? { facialHair: { ...a.facialHair } } : {}),
  ...(a.outer ? { outer: { ...a.outer } } : {}),
  accessories: a.accessories.map((r) => ({ ...r })),
  special: a.special.map((r) => ({ ...r })),
});

export const isAvatarV2 = (x: unknown): x is AvatarV2 =>
  typeof x === 'object' && x !== null && (x as { v?: unknown }).v === 2;

// ---------------------------------------------------------------------------
// Reading

export interface Equipped {
  /** `hair`, `top`, `accessories[1]`... */
  field: string;
  ref: ItemRef;
  item: ItemDef;
}

/** Every equipped reference with its definition, in render order. References to unknown ids are skipped. */
export function equippedOf(a: AvatarV2): Equipped[] {
  const out: Equipped[] = [];
  const add = (field: string, ref: ItemRef | undefined) => {
    if (!ref) return;
    const item = getItem(ref.id);
    if (item) out.push({ field, ref, item });
  };
  for (const f of SINGLE_FIELDS) add(f, a[f]);
  a.accessories.forEach((r, i) => add(`accessories[${i}]`, r));
  a.special.forEach((r, i) => add(`special[${i}]`, r));
  return out;
}

export const wornIds = (a: AvatarV2): Set<string> => new Set(equippedOf(a).map((e) => e.item.id));

/** Stable key of an appearance (texture cache key). */
export function avatarKey(a: AvatarV2): string {
  return `${a.skin}|${equippedOf(a).map((e) => `${e.ref.id}:${e.ref.color ?? ''}`).join('|')}`;
}

export function sameAvatar(a: AvatarV2, b: AvatarV2): boolean {
  return avatarKey(a) === avatarKey(b);
}

/** True when the two items cannot be worn together (same slot, or an explicit exclusion). */
export function itemsConflict(a: ItemDef, b: ItemDef): boolean {
  if (a.id === b.id) return false;
  if (a.slot === b.slot) return true;
  if (a.excludes?.includes(b.slot) || b.excludes?.includes(a.slot)) return true;
  return !!(a.conflicts?.includes(b.id) || b.conflicts?.includes(a.id));
}

// ---------------------------------------------------------------------------
// Strict validation (server)

/** Decides whether an item may be equipped right now. Returns an issue to refuse it. */
export type ItemPolicy = (item: ItemDef, field: string) => AvatarIssue | null;

export function makePolicy(ctx: AccessContext): ItemPolicy {
  return (item, field) => {
    const acc = accessOf(item, ctx);
    if (acc === 'ok') return null;
    const code: IssueCode = acc === 'locked' ? 'locked' : 'unavailable';
    return { code, field, itemId: item.id, message: `"${item.name}" ${ACCESS_MESSAGES[acc]}.` };
  };
}

export type ValidationResult = { ok: true; avatar: AvatarV2 } | { ok: false; issues: AvatarIssue[] };

const issue = (code: IssueCode, field: string, message: string, itemId?: string): AvatarIssue => ({ code, field, message, ...(itemId ? { itemId } : {}) });
const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

function readRef(x: unknown, field: string, issues: AvatarIssue[]): ItemRef | null {
  if (!isRecord(x) || typeof x.id !== 'string' || x.id.length === 0 || x.id.length > 64) {
    issues.push(issue('bad_shape', field, 'Referência de item inválida.'));
    return null;
  }
  if (x.color !== undefined && (typeof x.color !== 'string' || x.color.length > 32)) {
    issues.push(issue('bad_shape', field, 'Cor inválida.', x.id));
    return null;
  }
  return x.color === undefined ? { id: x.id } : { id: x.id, color: x.color };
}

/**
 * Validates an untrusted appearance against the catalog and, optionally, the account's policy.
 * Rejects unknown items, items in the wrong slot, colors outside the item's palette, incompatible
 * combinations and (with a policy) locked/unavailable items. Never trust the client: the server calls this.
 */
export function validateAvatar(input: unknown, policy?: ItemPolicy): ValidationResult {
  const issues: AvatarIssue[] = [];
  if (!isRecord(input) || input.v !== 2) return { ok: false, issues: [issue('bad_shape', 'avatar', 'Aparência inválida (versão não suportada).')] };

  const skinOk = typeof input.skin === 'string' && PALETTES.skin.colors.some((c) => c.id === input.skin);
  if (!skinOk) issues.push(issue('unknown_skin', 'skin', 'Tom de pele inexistente.'));

  const out: Record<string, unknown> = { v: 2, skin: input.skin };
  const placed: Equipped[] = [];

  const place = (field: string, ref: ItemRef, expect: (item: ItemDef) => boolean): ItemRef | null => {
    const item = getItem(ref.id);
    if (!item) {
      issues.push(issue('unknown_item', field, `Item inexistente: ${ref.id}.`, ref.id));
      return null;
    }
    if (!expect(item)) {
      issues.push(issue('wrong_slot', field, `"${item.name}" não pode ser usado em ${field}.`, ref.id));
      return null;
    }
    let color = ref.color;
    if (item.palette) {
      if (color === undefined) color = defaultColorOf(item);
      else if (!itemColors(item).some((c) => c.id === color)) {
        issues.push(issue('bad_color', field, `A cor "${color}" não existe na paleta de "${item.name}".`, ref.id));
        return null;
      }
    } else if (color !== undefined) {
      issues.push(issue('bad_color', field, `"${item.name}" não aceita cor.`, ref.id));
      return null;
    }
    const blocked = policy?.(item, field);
    if (blocked) {
      issues.push(blocked);
      return null;
    }
    const clean: ItemRef = color === undefined ? { id: item.id } : { id: item.id, color };
    placed.push({ field, ref: clean, item });
    return clean;
  };

  for (const f of SINGLE_FIELDS) {
    const raw = input[f];
    if (raw === undefined || raw === null) {
      if (isRequiredField(f)) issues.push(issue('bad_shape', f, `Falta o campo ${f}.`));
      continue;
    }
    const ref = readRef(raw, f, issues);
    if (!ref) continue;
    const placedRef = place(f, ref, (item) => item.slot === SINGLE_SLOT[f]);
    if (placedRef) out[f] = placedRef;
  }

  for (const [key, max, category] of [
    ['accessories', MAX_ACCESSORIES, 'accessories'],
    ['special', MAX_SPECIAL, 'special'],
  ] as const) {
    const raw = input[key];
    if (!Array.isArray(raw)) {
      issues.push(issue('bad_shape', key, `Lista inválida: ${key}.`));
      continue;
    }
    if (raw.length > max) {
      issues.push(issue('too_many', key, `No máximo ${max} itens em ${key}.`));
      continue;
    }
    const list: ItemRef[] = [];
    raw.forEach((r, i) => {
      const field = `${key}[${i}]`;
      const ref = readRef(r, field, issues);
      if (!ref) return;
      const placedRef = place(field, ref, (item) => item.category === category);
      if (placedRef) list.push(placedRef);
    });
    out[key] = list;
  }

  // Combinations.
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      const a = placed[i];
      const b = placed[j];
      if (a.item.id === b.item.id) {
        issues.push(issue('duplicate_slot', b.field, `"${b.item.name}" foi repetido.`, b.item.id));
      } else if (itemsConflict(a.item, b.item)) {
        const same = a.item.slot === b.item.slot;
        issues.push(
          issue(
            same ? 'duplicate_slot' : 'conflict',
            b.field,
            same ? `"${a.item.name}" e "${b.item.name}" ocupam o mesmo lugar.` : `"${a.item.name}" não combina com "${b.item.name}".`,
            b.item.id,
          ),
        );
      }
    }
  }

  return issues.length > 0 ? { ok: false, issues } : { ok: true, avatar: out as unknown as AvatarV2 };
}

// ---------------------------------------------------------------------------
// Lenient repair (never throws; used for stored data and for legacy input)

function repairRef(ref: unknown, accept: (item: ItemDef) => boolean): ItemRef | null {
  if (!isRecord(ref) || typeof ref.id !== 'string') return null;
  const item = getItem(ref.id);
  if (!item || !accept(item)) return null;
  const color = typeof ref.color === 'string' && itemColors(item).some((c) => c.id === ref.color) ? ref.color : defaultColorOf(item);
  return color === undefined ? { id: item.id } : { id: item.id, color };
}

/**
 * Turns anything into a valid appearance: legacy index configs are migrated, invalid parts fall back to
 * the default, conflicting optional pieces are dropped. It does NOT check unlocks (that is the server policy).
 */
export function sanitizeAvatar(input: unknown): AvatarV2 {
  if (isLegacyAvatar(input)) input = migrateLegacyAvatar(input);
  if (!isRecord(input)) return cloneAvatar(DEFAULT_AVATAR);

  const skin = typeof input.skin === 'string' && PALETTES.skin.colors.some((c) => c.id === input.skin) ? input.skin : DEFAULT_AVATAR.skin;
  const out: AvatarV2 = cloneAvatar({ ...DEFAULT_AVATAR, skin });
  delete out.facialHair;
  for (const f of SINGLE_FIELDS) {
    const ref = repairRef(input[f], (item) => item.slot === SINGLE_SLOT[f]);
    if (ref) (out as unknown as Record<string, ItemRef>)[f] = ref;
  }
  const taken: ItemDef[] = [];
  const room = (item: ItemDef) => !taken.some((t) => itemsConflict(t, item) || t.id === item.id);
  for (const f of SINGLE_FIELDS) {
    const ref = out[f];
    const item = ref && getItem(ref.id);
    if (item) taken.push(item);
  }
  // Drop optional pieces that conflict with something else already kept.
  for (const f of ['outer', 'facialHair'] as const) {
    const ref = out[f];
    const item = ref && getItem(ref.id);
    if (!item) continue;
    if (taken.some((t) => t !== item && itemsConflict(t, item))) delete out[f];
  }
  for (const [key, max, category] of [
    ['accessories', MAX_ACCESSORIES, 'accessories'],
    ['special', MAX_SPECIAL, 'special'],
  ] as const) {
    out[key] = [];
    const raw = Array.isArray(input[key]) ? (input[key] as unknown[]) : [];
    for (const r of raw) {
      if (out[key].length >= max) break;
      const ref = repairRef(r, (item) => item.category === category);
      const item = ref && getItem(ref.id);
      if (!ref || !item || !room(item)) continue;
      out[key].push(ref);
      taken.push(item);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Editing helpers (used by the editor and by tests)

export function fieldOfItem(item: ItemDef): SingleField | 'accessories' | 'special' {
  if (item.category === 'accessories') return 'accessories';
  if (item.category === 'special') return 'special';
  return (SINGLE_FIELDS.find((f) => SINGLE_SLOT[f] === item.slot) ?? 'hair') as SingleField;
}

/** The reference currently in the slot of `item` (single fields and lists), if any. */
export function currentRefOfSlot(a: AvatarV2, item: ItemDef): ItemRef | undefined {
  const f = fieldOfItem(item);
  if (f === 'accessories' || f === 'special') return a[f].find((r) => getItem(r.id)?.slot === item.slot);
  return a[f];
}

export type EquipResult = { ok: true; avatar: AvatarV2; removed: ItemDef[] } | { ok: false; reason: string; blockedBy: ItemDef[] };

/** Required items (hair, top...) that would conflict with `item`. They cannot be removed automatically. */
export function blockersOf(a: AvatarV2, item: ItemDef): ItemDef[] {
  return equippedOf(a)
    .filter((e) => isRequiredField(e.field) && e.item.slot !== item.slot && itemsConflict(e.item, item))
    .map((e) => e.item);
}

/**
 * Equips `itemId`. The item replaces whatever is in its slot (keeping the color when the new item accepts it) and
 * removes optional pieces that conflict with it (reported in `removed`). Fails if a required piece conflicts.
 */
export function equipItem(a: AvatarV2, itemId: string, colorId?: string): EquipResult {
  const item = getItem(itemId);
  if (!item) return { ok: false, reason: 'Item inexistente.', blockedBy: [] };
  const blockers = blockersOf(a, item);
  if (blockers.length > 0) {
    return { ok: false, reason: `"${item.name}" não combina com "${blockers.map((b) => b.name).join('", "')}".`, blockedBy: blockers };
  }
  const prev = currentRefOfSlot(a, item);
  let color = colorId;
  if (color === undefined && item.palette) {
    color = prev && itemColors(item).some((c) => c.id === prev.color) ? prev.color : defaultColorOf(item);
  }
  if (color !== undefined && (!item.palette || !itemColors(item).some((c) => c.id === color))) color = defaultColorOf(item);
  const ref: ItemRef = color === undefined ? { id: item.id } : { id: item.id, color };

  const out = cloneAvatar(a);
  const removed: ItemDef[] = [];
  const f = fieldOfItem(item);
  // Remove optional conflicts first.
  for (const e of equippedOf(out)) {
    if (e.item.slot === item.slot) continue;
    if (!itemsConflict(e.item, item)) continue;
    removed.push(e.item);
  }
  const removedIds = new Set(removed.map((r) => r.id));
  if (removedIds.size > 0) {
    out.accessories = out.accessories.filter((r) => !removedIds.has(r.id));
    out.special = out.special.filter((r) => !removedIds.has(r.id));
    if (out.outer && removedIds.has(out.outer.id)) delete out.outer;
    if (out.facialHair && removedIds.has(out.facialHair.id)) delete out.facialHair;
  }
  if (f === 'accessories' || f === 'special') {
    out[f] = out[f].filter((r) => getItem(r.id)?.slot !== item.slot);
    out[f].push(ref);
  } else {
    (out as unknown as Record<string, ItemRef>)[f] = ref;
  }
  return { ok: true, avatar: out, removed };
}

/** Removes an optional piece (outer, facial hair, accessory or special) by item id. Required pieces are ignored. */
export function unequipItem(a: AvatarV2, itemId: string): AvatarV2 {
  const out = cloneAvatar(a);
  if (out.outer?.id === itemId) delete out.outer;
  if (out.facialHair?.id === itemId) delete out.facialHair;
  out.accessories = out.accessories.filter((r) => r.id !== itemId);
  out.special = out.special.filter((r) => r.id !== itemId);
  return out;
}

/** Changes the color of the equipped item `itemId` (no-op when it is not worn or the color is not in its palette). */
export function recolorItem(a: AvatarV2, itemId: string, colorId: string): AvatarV2 {
  const item = getItem(itemId);
  if (!item?.palette || !itemColors(item).some((c) => c.id === colorId)) return a;
  const out = cloneAvatar(a);
  const lists: ItemRef[][] = [out.accessories, out.special];
  for (const f of SINGLE_FIELDS) {
    const r = out[f];
    if (r?.id === itemId) r.color = colorId;
  }
  for (const l of lists) for (const r of l) if (r.id === itemId) r.color = colorId;
  return out;
}

export function setSkin(a: AvatarV2, skinId: string): AvatarV2 {
  return PALETTES.skin.colors.some((c) => c.id === skinId) ? { ...cloneAvatar(a), skin: skinId } : a;
}

/** A random look made only of free, available items (never locked ones). */
export function randomAvatar(rand: () => number = Math.random): AvatarV2 {
  const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)];
  const usable = (slot: ItemSlot, category?: string) =>
    ITEMS.filter((i) => i.slot === slot && i.unlock === 'free' && i.availability === 'available' && (!category || i.category === category));
  const ref = (item: ItemDef): ItemRef => {
    const colors = itemColors(item);
    return colors.length > 0 ? { id: item.id, color: pick(colors).id } : { id: item.id };
  };
  const out = cloneAvatar(DEFAULT_AVATAR);
  out.skin = pick(PALETTES.skin.colors).id;
  for (const f of ['eyes', 'brows', 'mouth', 'hair', 'top', 'bottom', 'shoes'] as const) out[f] = ref(pick(usable(SINGLE_SLOT[f])));
  if (rand() < 0.25) out.outer = ref(pick(usable('outer')));
  if (rand() < 0.15) out.facialHair = ref(pick(usable('facialHair')));
  if (rand() < 0.4) {
    out.accessories.push(ref(pick(ITEMS.filter((i) => i.category === 'accessories' && i.unlock === 'free' && i.availability === 'available'))));
  }
  if (rand() < 0.12) out.special.push(ref(pick(ITEMS.filter((i) => i.category === 'special' && i.unlock === 'free' && i.availability === 'available'))));
  return sanitizeAvatar(out);
}

// ---------------------------------------------------------------------------
// Outfit names

const NAME_FORBIDDEN = /[^\p{L}\p{N} _\-.'!&+()]/gu;

/** Normalizes an outfit name: NFKC, strips control/odd characters, collapses spaces. Returns null if nothing is left. */
export function sanitizeOutfitName(raw: unknown, max = 24): string | null {
  if (typeof raw !== 'string') return null;
  const name = raw.normalize('NFKC').replace(/\s+/g, ' ').replace(NAME_FORBIDDEN, '').replace(/ +/g, ' ').trim().slice(0, max).trim();
  return name.length >= 1 ? name : null;
}

/** Suggested names for new outfits. */
export const OUTFIT_SUGGESTIONS = ['Trabalho', 'Casual', 'Reunião', 'Sexta-feira', 'Evento especial'] as const;
