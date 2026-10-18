import { describe, expect, it } from 'vitest';
import {
  DEFAULT_AVATAR,
  ITEMS,
  ITEMS_BY_ID,
  LEGACY_ACCESSORIES,
  LEGACY_BOTTOMS,
  LEGACY_CLOTH_COLORS,
  LEGACY_DEFAULT,
  LEGACY_HAIR_COLORS,
  LEGACY_HAIR_STYLES,
  LEGACY_LIMITS,
  LEGACY_SHOES,
  LEGACY_SHOE_COLORS,
  LEGACY_SKIN_TONES,
  LEGACY_TOPS,
  MAX_ACCESSORIES,
  PALETTES,
  POSES,
  accessOf,
  avatarKey,
  blockersOf,
  cloneAvatar,
  colorHex,
  equipItem,
  equippedOf,
  getItem,
  itemColors,
  itemsConflict,
  makePolicy,
  migrateLegacyAvatar,
  randomAvatar,
  recolorItem,
  sanitizeAvatar,
  sanitizeOutfitName,
  unequipItem,
  validateAvatar,
  type AvatarV2,
  type ItemCategory,
  type LegacyAvatarConfig,
} from '../src';

const issuesOf = (r: ReturnType<typeof validateAvatar>) => (r.ok ? [] : r.issues);
const withAcc = (...ids: string[]): AvatarV2 => ({
  ...cloneAvatar(DEFAULT_AVATAR),
  accessories: ids.map((id) => ({ id, color: getItem(id)!.defaultColor })),
});

describe('item catalog', () => {
  it('has unique, well-formed entries', () => {
    expect(new Set(ITEMS.map((i) => i.id)).size).toBe(ITEMS.length);
    for (const i of ITEMS) {
      expect(i.id, i.id).toMatch(/^[a-z]+\.[a-z_]+$/);
      expect(i.name.length, i.id).toBeGreaterThan(0);
      expect(i.description.length, i.id).toBeGreaterThan(0);
      expect(i.drawer, i.id).toMatch(/^[a-z_]+\.[a-z_]+$/);
      expect(i.tags.length, i.id).toBeGreaterThan(0);
      if (i.palette) {
        expect(PALETTES[i.palette], i.id).toBeDefined();
        expect(itemColors(i).length, i.id).toBeGreaterThan(0);
        expect(itemColors(i).some((c) => c.id === (i.defaultColor ?? itemColors(i)[0].id)), `${i.id} default color`).toBe(true);
        for (const c of i.colors ?? []) expect(PALETTES[i.palette].colors.some((x) => x.id === c), `${i.id}/${c}`).toBe(true);
      } else {
        expect(i.defaultColor, i.id).toBeUndefined();
      }
      for (const c of i.conflicts ?? []) expect(ITEMS_BY_ID.has(c), `${i.id} conflicts with ${c}`).toBe(true);
      for (const p of POSES) expect(['full', 'adapted', 'hidden']).toContain(i.poses[p]);
    }
  });

  it('flags every pose without art and never claims working/talking poses', () => {
    for (const i of ITEMS) {
      expect(Object.keys(i.poses).sort(), i.id).toEqual([...POSES].sort());
      if (Object.values(i.poses).some((m) => m !== 'full')) expect(i.notes, `${i.id} needs a note about the gap`).toBeTruthy();
    }
    for (const id of ['sp.notebook', 'sp.tablet']) {
      expect(getItem(id)!.poses).toMatchObject({ walk: 'hidden', wave: 'hidden', idle: 'full', sit: 'full' });
    }
    expect(getItem('sp.mug')!.poses.walk).toBe('adapted');
  });

  it('covers every requested category with a generous set', () => {
    const count = (c: ItemCategory) => ITEMS.filter((i) => i.category === c).length;
    expect(count('hair')).toBeGreaterThanOrEqual(10);
    expect(count('face')).toBeGreaterThanOrEqual(18);
    expect(count('clothes')).toBeGreaterThanOrEqual(20);
    expect(count('shoes')).toBeGreaterThanOrEqual(5);
    expect(count('accessories')).toBeGreaterThanOrEqual(10);
    expect(count('special')).toBeGreaterThanOrEqual(6);
    const slotCount = (s: string) => ITEMS.filter((i) => i.slot === s).length;
    for (const s of ['top', 'outer', 'bottom']) expect(slotCount(s), s).toBeGreaterThanOrEqual(3);
    expect(ITEMS.some((i) => i.unlock !== 'free')).toBe(true);
    expect(ITEMS.some((i) => i.availability === 'upcoming')).toBe(true);
  });

  it('palettes have unique ids and hex colors', () => {
    for (const p of Object.values(PALETTES)) {
      expect(new Set(p.colors.map((c) => c.id)).size, p.id).toBe(p.colors.length);
      for (const c of p.colors) expect(c.hex, `${p.id}/${c.id}`).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});

describe('legacy migration', () => {
  it('maps the legacy default to the v2 default', () => {
    expect(migrateLegacyAvatar(LEGACY_DEFAULT)).toEqual(DEFAULT_AVATAR);
    expect(validateAvatar(DEFAULT_AVATAR).ok).toBe(true);
  });

  const check = (legacy: LegacyAvatarConfig) => {
    const v2 = migrateLegacyAvatar(legacy);
    const res = validateAvatar(v2);
    expect(issuesOf(res), JSON.stringify(legacy)).toEqual([]);
    // skin and colors keep their exact hex
    expect(colorHex('skin', v2.skin)).toBe(LEGACY_SKIN_TONES[legacy.skin]);
    if (legacy.hairStyle !== 4) expect(colorHex('hair', v2.hair.color)).toBe(LEGACY_HAIR_COLORS[legacy.hairColor]);
    expect(colorHex('cloth', v2.bottom.color)).toBe(LEGACY_CLOTH_COLORS[legacy.bottomColor]);
    expect(colorHex('shoe', v2.shoes.color)).toBe(LEGACY_SHOE_COLORS[legacy.shoeColor]);
    const blazer = legacy.top === 3;
    expect(colorHex('cloth', (blazer ? v2.outer! : v2.top).color)).toBe(LEGACY_CLOTH_COLORS[legacy.topColor]);
    expect(Boolean(v2.outer)).toBe(blazer);
    expect(v2.accessories.length).toBe(legacy.accessory === 0 ? 0 : 1);
    return v2;
  };

  it('converts every legacy catalog entry without loss', () => {
    for (const key of Object.keys(LEGACY_LIMITS) as (keyof LegacyAvatarConfig)[]) {
      for (let i = 0; i < LEGACY_LIMITS[key]; i++) {
        check({ ...LEGACY_DEFAULT, skin: 3, hairColor: 7, topColor: 9, bottomColor: 3, shoeColor: 5, [key]: i });
      }
    }
  });

  it('converts a large sample of random legacy avatars, all valid', () => {
    let seed = 99;
    const rnd = (n: number) => (seed = (seed * 16807) % 2147483647) % n;
    for (let n = 0; n < 3000; n++) {
      const l = Object.fromEntries((Object.keys(LEGACY_LIMITS) as (keyof LegacyAvatarConfig)[]).map((k) => [k, rnd(LEGACY_LIMITS[k])])) as unknown as LegacyAvatarConfig;
      check(l);
    }
  });

  it('keeps the style identity of each legacy entry', () => {
    const hair = LEGACY_HAIR_STYLES.map((_, i) => migrateLegacyAvatar({ ...LEGACY_DEFAULT, hairStyle: i }).hair.id);
    expect(hair).toEqual(['hair.short', 'hair.long', 'hair.spiky', 'hair.bun', 'hair.bald', 'hair.afro', 'hair.ponytail', 'hair.bob', 'hair.pompadour']);
    expect(LEGACY_TOPS.map((_, i) => migrateLegacyAvatar({ ...LEGACY_DEFAULT, top: i }).top.id)).toEqual([
      'top.tee', 'top.shirt', 'top.hoodie', 'top.shirt', 'top.polo', 'top.sweater',
    ]);
    expect(migrateLegacyAvatar({ ...LEGACY_DEFAULT, top: 3 }).outer?.id).toBe('outer.blazer');
    expect(LEGACY_BOTTOMS.map((_, i) => migrateLegacyAvatar({ ...LEGACY_DEFAULT, bottom: i }).bottom.id)).toEqual([
      'bottom.pants', 'bottom.shorts', 'bottom.skirt', 'bottom.dress', 'bottom.cargo',
    ]);
    expect(LEGACY_SHOES.map((_, i) => migrateLegacyAvatar({ ...LEGACY_DEFAULT, shoes: i }).shoes.id)).toEqual([
      'shoes.sneakers', 'shoes.dress', 'shoes.boots', 'shoes.hightop',
    ]);
    expect(LEGACY_ACCESSORIES.map((_, i) => migrateLegacyAvatar({ ...LEGACY_DEFAULT, accessory: i }).accessories[0]?.id)).toEqual([
      undefined, 'acc.glasses', 'acc.headset', 'acc.cap', 'acc.sunglasses', 'acc.beanie', 'acc.headphones',
    ]);
  });

  it('migrates the real account shapes found in the data file', () => {
    const real = { skin: 1, hairStyle: 0, hairColor: 1, top: 3, topColor: 10, bottom: 0, bottomColor: 10, shoes: 1, shoeColor: 0, accessory: 0 };
    const v2 = sanitizeAvatar(real);
    expect(v2.outer).toEqual({ id: 'outer.blazer', color: 'slate' });
    expect(v2.shoes).toEqual({ id: 'shoes.dress', color: 'black' });
    expect(validateAvatar(v2).ok).toBe(true);
  });

  it('sanitizeAvatar is idempotent on v2 and tolerant to garbage', () => {
    const a = sanitizeAvatar(DEFAULT_AVATAR);
    expect(sanitizeAvatar(a)).toEqual(a);
    const junkList: unknown[] = [undefined, null, 0, 'x', [], {}, { v: 2 }, { v: 3 }, { v: 2, hair: 'nope', accessories: 'x', special: [null, 1, { id: 5 }] }];
    for (const junk of junkList) {
      const r = sanitizeAvatar(junk);
      expect(validateAvatar(r).ok, JSON.stringify(junk)).toBe(true);
    }
  });
});

describe('validation', () => {
  const base = () => cloneAvatar(DEFAULT_AVATAR);
  const codes = (a: unknown) => issuesOf(validateAvatar(a)).map((i) => i.code);

  it('accepts a rich, compatible combination (jacket over shirt)', () => {
    const a = base();
    a.top = { id: 'top.shirt', color: 'off-white' };
    a.outer = { id: 'outer.bomber', color: 'olive' };
    a.facialHair = { id: 'facial.beard', color: 'black' };
    a.accessories = [
      { id: 'acc.glasses', color: 'black' },
      { id: 'acc.cap', color: 'navy' },
      { id: 'acc.backpack', color: 'navy' },
      { id: 'acc.watch', color: 'brown' },
    ];
    a.special = [{ id: 'sp.mug', color: 'red' }, { id: 'sp.badge', color: 'blue' }];
    expect(issuesOf(validateAvatar(a))).toEqual([]);
  });

  it('rejects unknown items, wrong slots and bad colors', () => {
    let a = base();
    a.hair = { id: 'hair.nope', color: 'black' };
    expect(codes(a)).toContain('unknown_item');
    a = base();
    a.hair = { id: 'top.tee', color: 'blue' };
    expect(codes(a)).toContain('wrong_slot');
    a = base();
    a.top = { id: 'top.tee', color: 'neon' };
    expect(codes(a)).toContain('bad_color');
    a = base();
    a.hair = { id: 'hair.short', color: 'denim' }; // a cloth color is not in the hair palette
    expect(codes(a)).toContain('bad_color');
    a = base();
    a.mouth = { id: 'mouth.smile', color: 'red' }; // item without palette
    expect(codes(a)).toContain('bad_color');
    a = base();
    a.special = [{ id: 'sp.party_hat', color: 'black' }]; // colors restricted by the item
    expect(issuesOf(validateAvatar(a)).some((i) => i.code === 'bad_color' && i.itemId === 'sp.party_hat')).toBe(true);
    a = base();
    a.skin = 'purple';
    expect(codes(a)).toContain('unknown_skin');
  });

  it('rejects incompatible combinations', () => {
    expect(codes(withAcc('acc.cap', 'acc.beanie'))).toContain('duplicate_slot');
    expect(codes(withAcc('acc.headset', 'acc.cap'))).toContain('conflict');
    expect(codes(withAcc('acc.headphones', 'acc.fedora'))).toContain('conflict');
    const a = base();
    a.special = [{ id: 'sp.party_hat', color: 'pink' }];
    a.accessories = [{ id: 'acc.beanie', color: 'blue' }];
    expect(codes(a)).toContain('duplicate_slot'); // hats share the head slot
    const t = base();
    t.special = [{ id: 'sp.notebook', color: 'silver' }, { id: 'sp.mug', color: 'white' }];
    expect(codes(t)).toContain('duplicate_slot'); // one held object
    const same = base();
    same.accessories = [{ id: 'acc.cap', color: 'brick' }, { id: 'acc.cap', color: 'blue' }];
    expect(validateAvatar(same).ok).toBe(false);
  });

  it('rejects malformed shapes without throwing', () => {
    const junkList: unknown[] = [
      null, 5, 'x', [], {}, { v: 1 },
      { ...DEFAULT_AVATAR, accessories: 'x' },
      { ...DEFAULT_AVATAR, hair: 'x' },
      { ...DEFAULT_AVATAR, hair: { id: 5 } },
      { ...DEFAULT_AVATAR, eyes: undefined },
    ];
    for (const junk of junkList) expect(validateAvatar(junk).ok, JSON.stringify(junk)).toBe(false);
    const many = { ...cloneAvatar(DEFAULT_AVATAR), accessories: Array.from({ length: MAX_ACCESSORIES + 1 }, () => ({ id: 'acc.cap', color: 'blue' })) };
    expect(codes(many)).toContain('too_many');
  });

  it('applies the access policy: locked, upcoming and staff items', () => {
    const none = makePolicy({ unlocks: new Set() });
    const a = base();
    a.special = [{ id: 'sp.mug_gold' }];
    expect(issuesOf(validateAvatar(a, none)).map((i) => i.code)).toEqual(['locked']);
    expect(validateAvatar(a, makePolicy({ unlocks: new Set(['achievement:coffee-lover']) })).ok).toBe(true);
    const santa = base();
    santa.special = [{ id: 'sp.santa_hat' }];
    expect(issuesOf(validateAvatar(santa, makePolicy({ unlocks: new Set(['event:natal']) }))).map((i) => i.code)).toEqual(['unavailable']);
    const staff = base();
    staff.special = [{ id: 'sp.badge_staff' }];
    expect(validateAvatar(staff, none).ok).toBe(false);
    expect(validateAvatar(staff, makePolicy({ unlocks: new Set(['staff']) })).ok).toBe(true);
  });
});

describe('access', () => {
  const retired = { ...getItem('top.tee')!, availability: 'retired' as const };
  const hidden = { ...getItem('top.tee')!, availability: 'hidden' as const };

  it('follows the unlock table', () => {
    expect(accessOf(getItem('top.tee')!, { unlocks: new Set() })).toBe('ok');
    expect(accessOf(getItem('sp.badge_staff')!, { unlocks: new Set() })).toBe('locked');
    expect(accessOf(getItem('sp.badge_staff')!, { unlocks: new Set(['staff']) })).toBe('ok');
    expect(accessOf(getItem('sp.party_hat')!, { unlocks: new Set(['event:aniversario']) })).toBe('ok');
    expect(accessOf(getItem('sp.party_hat')!, { unlocks: new Set(['event:natal']) })).toBe('locked');
    expect(accessOf(getItem('sp.santa_hat')!, { unlocks: new Set(['event:natal', 'staff']) })).toBe('upcoming');
  });

  it('grandfathers retired items and hides hidden ones', () => {
    expect(accessOf(retired, { unlocks: new Set() })).toBe('retired');
    expect(accessOf(retired, { unlocks: new Set(), wearing: new Set(['top.tee']) })).toBe('ok');
    expect(accessOf(hidden, { unlocks: new Set() })).toBe('hidden');
    expect(accessOf(hidden, { unlocks: new Set(['item:top.tee']) })).toBe('ok');
  });
});

describe('editing helpers', () => {
  it('replaces an item keeping the color when possible', () => {
    const r = equipItem(DEFAULT_AVATAR, 'top.hoodie');
    expect(r.ok && r.avatar.top).toEqual({ id: 'top.hoodie', color: 'blue' });
    const h = equipItem(DEFAULT_AVATAR, 'hair.long');
    expect(h.ok && h.avatar.hair).toEqual({ id: 'hair.long', color: 'dark-brown' });
  });

  it('removes optional conflicting pieces and reports them', () => {
    const r = equipItem(withAcc('acc.cap', 'acc.watch'), 'acc.headphones');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.removed.map((i) => i.id)).toEqual(['acc.cap']);
    expect(r.avatar.accessories.map((x) => x.id).sort()).toEqual(['acc.headphones', 'acc.watch']);
    expect(validateAvatar(r.avatar).ok).toBe(true);
  });

  it('swaps the item of the same slot', () => {
    const r = equipItem(withAcc('acc.cap'), 'acc.beanie');
    expect(r.ok && r.avatar.accessories.map((x) => x.id)).toEqual(['acc.beanie']);
    expect(blockersOf(DEFAULT_AVATAR, getItem('acc.cap')!)).toEqual([]);
  });

  it('unequips and recolors', () => {
    expect(unequipItem(withAcc('acc.cap'), 'acc.cap').accessories).toEqual([]);
    expect(recolorItem(DEFAULT_AVATAR, 'top.tee', 'red').top.color).toBe('red');
    expect(recolorItem(DEFAULT_AVATAR, 'top.tee', 'nonexistent')).toBe(DEFAULT_AVATAR);
  });

  it('item conflict rules are symmetric', () => {
    for (const a of ITEMS) for (const b of ITEMS) expect(itemsConflict(a, b), `${a.id}/${b.id}`).toBe(itemsConflict(b, a));
  });

  it('random avatars are valid and use only free items', () => {
    let seed = 5;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const keys = new Set<string>();
    for (let i = 0; i < 400; i++) {
      const a = randomAvatar(rand);
      expect(issuesOf(validateAvatar(a, makePolicy({ unlocks: new Set() })))).toEqual([]);
      keys.add(avatarKey(a));
    }
    expect(keys.size).toBeGreaterThan(380);
    expect(equippedOf(DEFAULT_AVATAR).length).toBe(7);
  });
});

describe('outfit names', () => {
  it('sanitizes to 1-24 safe characters', () => {
    expect(sanitizeOutfitName('  Sexta-feira  ')).toBe('Sexta-feira');
    expect(sanitizeOutfitName('A\u0000B\n\tC')).toBe('AB C');
    expect(sanitizeOutfitName('<script>x</script>')).toBe('scriptxscript');
    expect(sanitizeOutfitName('x'.repeat(60))?.length).toBe(24);
    expect(sanitizeOutfitName('   ')).toBeNull();
    expect(sanitizeOutfitName('<>')).toBeNull();
    expect(sanitizeOutfitName(42)).toBeNull();
    expect(sanitizeOutfitName('Reunião de diretoria 2')).toBe('Reunião de diretoria 2');
  });
});
