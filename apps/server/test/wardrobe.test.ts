import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_AVATAR, MAX_OUTFITS, ITEMS, cloneAvatar, equipItem, getItem, type AvatarV2, type ServerMessage } from '@workverse/shared';
import { World, type Connection } from '../src/world';
import { JsonFileAccountStore, MemoryAccountStore, sanitizeOutfits } from '../src/store';
import { canUse, validateFor } from '../src/wardrobe';

class FakeConn implements Connection {
  strikes = 0;
  accountId?: string;
  player?: Connection['player'];
  inbox: ServerMessage[] = [];
  send(msg: ServerMessage) {
    this.inbox.push(msg);
  }
  close() {}
  last<T extends ServerMessage['t']>(t: T) {
    return [...this.inbox].reverse().find((m) => m.t === t) as Extract<ServerMessage, { t: T }> | undefined;
  }
}

let now = 1_000_000;
let world: World;
let store: MemoryAccountStore;
const tick = () => (now += 1000); // refills the per-player rate bucket

function login(name: string, w = world): FakeConn {
  const c = new FakeConn();
  w.handle(c, { t: 'hello', name });
  w.handle(c, { t: 'join' });
  return c;
}
const send = (w: World, c: FakeConn, msg: Record<string, unknown>) => {
  tick();
  w.handle(c, msg as never);
};
const result = (c: FakeConn) => c.last('avatar_result')!;
const withLook = (patch: Partial<AvatarV2>): AvatarV2 => ({ ...cloneAvatar(DEFAULT_AVATAR), ...patch });

beforeEach(() => {
  now = 1_000_000;
  store = new MemoryAccountStore();
  world = new World({ store, allowDevLogin: true, clock: () => now });
});

describe('avatar_save', () => {
  it('saves a valid v2 look, answers ok and broadcasts to the room', () => {
    const a = login('Ana');
    const b = login('Beto');
    const look = withLook({ hair: { id: 'hair.curly', color: 'red' }, accessories: [{ id: 'acc.cap', color: 'blue' }] });
    send(world, a, { t: 'avatar_save', rid: 7, avatar: look });
    const res = result(a);
    expect(res.ok).toBe(true);
    expect(res.rid).toBe(7);
    expect(store.getByName('Ana')!.avatar.hair).toEqual({ id: 'hair.curly', color: 'red' });
    const seen = b.last('avatar')!;
    expect(seen.id).toBe(a.player!.id);
    expect(seen.avatar.accessories[0].id).toBe('acc.cap');
  });

  it('rejects unknown items, bad colors, wrong slots and incompatible items with a clear message', () => {
    const a = login('Ana');
    const before = store.getByName('Ana')!.avatar;
    const cases: [Partial<AvatarV2>, string][] = [
      [{ hair: { id: 'hair.inexistente' } }, 'unknown_item'],
      [{ hair: { id: 'hair.curly', color: 'verde-neon' } }, 'bad_color'],
      [{ hair: { id: 'top.tee', color: 'blue' } }, 'wrong_slot'],
      [{ accessories: [{ id: 'acc.cap', color: 'blue' }, { id: 'acc.headphones', color: 'red' }] }, 'conflict'],
      [{ skin: 'azul' }, 'unknown_skin'],
    ];
    for (const [patch, code] of cases) {
      send(world, a, { t: 'avatar_save', rid: 1, avatar: withLook(patch) });
      const res = result(a);
      expect(res.ok, code).toBe(false);
      if (!res.ok) {
        expect(res.code).toBe(code);
        expect(res.message.length).toBeGreaterThan(5);
      }
    }
    expect(store.getByName('Ana')!.avatar).toBe(before); // nothing invalid was persisted
  });

  it('rejects locked, upcoming and staff items; unlocks open them', () => {
    const a = login('Ana');
    for (const id of ['sp.mug_gold', 'sp.santa_hat', 'sp.badge_staff']) {
      send(world, a, { t: 'avatar_save', avatar: withLook({ special: [{ id, ...(getItem(id)!.palette ? { color: getItem(id)!.defaultColor } : {}) }] }) });
      const res = result(a);
      expect(res.ok, id).toBe(false);
      if (!res.ok) expect(['locked', 'unavailable']).toContain(res.code);
    }
    const acc = store.getByName('Ana')!;
    expect(canUse(acc, getItem('sp.badge_staff')!)).toBe(false);
    // a chave 'staff' em unlocks nao vale mais: o cracha so abre para Account.staff, definido pelo servidor
    acc.unlocks = ['staff', 'item:sp.badge_staff'];
    expect(canUse(acc, getItem('sp.badge_staff')!)).toBe(false);
    acc.staff = 'helper';
    expect(canUse(acc, getItem('sp.badge_staff')!)).toBe(true);
    send(world, a, { t: 'avatar_save', avatar: withLook({ special: [{ id: 'sp.badge_staff' }] }) });
    expect(result(a).ok).toBe(true);
  });

  it('everything free is usable by default and nothing else is', () => {
    const acc = new MemoryAccountStore().create({ email: 'a@b.co', displayName: 'Zed', passwordHash: 'x' });
    for (const item of ITEMS) {
      expect(canUse(acc, item), item.id).toBe(item.unlock === 'free' && item.availability === 'available');
    }
  });

  it('keeps the legacy `avatar` message working (migrated, validated, broadcast)', () => {
    const a = login('Ana');
    const b = login('Beto');
    send(world, a, { t: 'avatar', avatar: { skin: 2, hairStyle: 3, hairColor: 1, top: 1, topColor: 2, bottom: 0, bottomColor: 0, shoes: 0, shoeColor: 0, accessory: 0 } });
    expect(b.last('avatar')!.avatar.v).toBe(2);
    expect(result(a).ok).toBe(true);
    send(world, a, { t: 'avatar', avatar: { v: 2, skin: 'peach', hair: { id: 'nope' } } });
    expect(result(a).ok).toBe(false);
  });

  it('loads the saved look on the next login', () => {
    const a = login('Ana');
    send(world, a, { t: 'avatar_save', avatar: withLook({ shoes: { id: 'shoes.boots', color: 'brown' } }) });
    const again = login('Ana');
    expect(again.last('session')!.avatar.shoes).toEqual({ id: 'shoes.boots', color: 'brown' });
  });
});

describe('wardrobe and outfits', () => {
  it('saves named outfits, lists them, applies and deletes', () => {
    const a = login('Ana');
    const b = login('Beto');
    const work = withLook({ top: { id: 'top.shirt', color: 'off-white' }, outer: { id: 'outer.blazer', color: 'charcoal' } });
    send(world, a, { t: 'outfit_save', rid: 1, name: '  Trabalho ', avatar: work });
    let st = a.last('wardrobe')!;
    expect(st.rid).toBe(1);
    expect(st.state.outfits.map((o) => o.name)).toEqual(['Trabalho']);
    expect(st.state.outfits[0].usable).toBe(true);
    expect(st.state.maxOutfits).toBe(MAX_OUTFITS);

    send(world, a, { t: 'outfit_save', name: 'Casual', avatar: withLook({ top: { id: 'top.hoodie', color: 'blue' } }) });
    st = a.last('wardrobe')!;
    expect(st.state.outfits).toHaveLength(2);

    const id = st.state.outfits.find((o) => o.name === 'Trabalho')!.id;
    send(world, a, { t: 'outfit_apply', rid: 5, id });
    expect(result(a).ok).toBe(true);
    expect(store.getByName('Ana')!.avatar.outer?.id).toBe('outer.blazer');
    expect(b.last('avatar')!.avatar.outer?.id).toBe('outer.blazer');

    // Same name overwrites instead of duplicating.
    send(world, a, { t: 'outfit_save', name: 'trabalho', avatar: withLook({ top: { id: 'top.polo', color: 'navy' } }) });
    expect(a.last('wardrobe')!.state.outfits).toHaveLength(2);
    expect(a.last('wardrobe')!.state.outfits.find((o) => o.id === id)!.avatar.top.id).toBe('top.polo');

    send(world, a, { t: 'outfit_delete', id });
    expect(a.last('wardrobe')!.state.outfits.map((o) => o.name)).toEqual(['Casual']);
    send(world, a, { t: 'outfit_apply', id });
    const res = result(a);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('not_found');
  });

  it('sanitizes names (1-24 chars) and rejects empty ones', () => {
    const a = login('Ana');
    send(world, a, { t: 'outfit_save', name: '<b>Evento</b> especial muito muito longo mesmo', avatar: DEFAULT_AVATAR });
    const names = a.last('wardrobe')!.state.outfits.map((o) => o.name);
    expect(names[0].length).toBeLessThanOrEqual(24);
    expect(names[0]).not.toMatch(/[<>]/);
    send(world, a, { t: 'outfit_save', name: '<<>>', avatar: DEFAULT_AVATAR });
    const res = result(a);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('bad_name');
    send(world, a, { t: 'outfit_save', name: 42, avatar: DEFAULT_AVATAR });
    expect(result(a).ok).toBe(false);
  });

  it(`limits an account to ${MAX_OUTFITS} outfits`, () => {
    const a = login('Ana');
    for (let i = 0; i < MAX_OUTFITS; i++) send(world, a, { t: 'outfit_save', name: `Conjunto ${i}`, avatar: DEFAULT_AVATAR });
    expect(a.last('wardrobe')!.state.outfits).toHaveLength(MAX_OUTFITS);
    send(world, a, { t: 'outfit_save', name: 'Um a mais', avatar: DEFAULT_AVATAR });
    const res = result(a);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('too_many_outfits');
    // Overwriting an existing one is still fine.
    send(world, a, { t: 'outfit_save', name: 'Conjunto 3', avatar: withLook({ hair: { id: 'hair.long', color: 'black' } }) });
    expect(a.last('wardrobe')!.state.outfits).toHaveLength(MAX_OUTFITS);
  });

  it('refuses to store invalid or locked looks in an outfit', () => {
    const a = login('Ana');
    send(world, a, { t: 'outfit_save', name: 'Ruim', avatar: withLook({ special: [{ id: 'sp.mug_gold' }] }) });
    expect(result(a).ok).toBe(false);
    send(world, a, { t: 'outfit_save', name: 'Ruim', avatar: { v: 2 } });
    expect(result(a).ok).toBe(false);
    expect(store.getByName('Ana')!.outfits ?? []).toHaveLength(0);
  });

  it('outfits only keep references, and a later lock marks them unusable', () => {
    const a = login('Ana');
    const acc = store.getByName('Ana')!;
    acc.unlocks = ['achievement:coffee-lover'];
    send(world, a, { t: 'outfit_save', name: 'Café', avatar: withLook({ special: [{ id: 'sp.mug_gold' }] }) });
    expect(JSON.stringify(acc.outfits)).not.toMatch(/data:image|png|base64/);
    acc.unlocks = [];
    send(world, a, { t: 'wardrobe_get', rid: 2 });
    const view = a.last('wardrobe')!.state.outfits[0];
    expect(view.usable).toBe(false);
    expect(view.problems[0]).toMatch(/Caneca dourada/);
  });

  it('wardrobe_get answers with the saved look', () => {
    const a = login('Ana');
    send(world, a, { t: 'wardrobe_get', rid: 9 });
    const w = a.last('wardrobe')!;
    expect(w.rid).toBe(9);
    expect(w.state.avatar.v).toBe(2);
    expect(w.state.devAccount).toBe(true);
  });
});

describe('persistence', () => {
  it('outfits and looks survive a restart of the JSON store; legacy avatars migrate', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wv-wardrobe-'));
    try {
      const file = join(dir, 'accounts.json');
      const s1 = new JsonFileAccountStore(file);
      const w1 = new World({ store: s1, allowDevLogin: true, clock: () => now });
      const a = login('Ana', w1);
      send(w1, a, { t: 'avatar_save', avatar: withLook({ hair: { id: 'hair.afro', color: 'black' } }) });
      send(w1, a, { t: 'outfit_save', name: 'Sexta-feira', avatar: withLook({ top: { id: 'top.hoodie', color: 'red' } }) });
      s1.flush();

      const s2 = new JsonFileAccountStore(file);
      const acc = s2.getByName('Ana')!;
      expect(acc.avatar.hair.id).toBe('hair.afro');
      expect(acc.outfits!.map((o) => o.name)).toEqual(['Sexta-feira']);

      // A legacy index-based avatar in the file is migrated on load.
      acc.avatar = { skin: 1, hairStyle: 2, hairColor: 0, top: 0, topColor: 0, bottom: 0, bottomColor: 0, shoes: 0, shoeColor: 0, accessory: 0 } as never;
      s2.flush();
      const s3 = new JsonFileAccountStore(file);
      expect(s3.getByName('Ana')!.avatar.v).toBe(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('sanitizeOutfits drops garbage, dedupes ids and caps the list', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ id: `o${i}`, name: `N${i}`, avatar: DEFAULT_AVATAR, updatedAt: 1 }));
    expect(sanitizeOutfits(many)).toHaveLength(MAX_OUTFITS);
    expect(sanitizeOutfits([{ id: 'x', name: '', avatar: {} }, null, 5, { id: 'a', name: 'A', avatar: 'lixo' }])).toHaveLength(1);
    expect(sanitizeOutfits([many[0], many[0]])).toHaveLength(1);
    expect(sanitizeOutfits('x')).toEqual([]);
  });
});

describe('editor combinations', () => {
  it('equipping any usable item on the default look validates strictly', () => {
    const acc = new MemoryAccountStore().create({ email: 'c@d.co', displayName: 'Cat', passwordHash: 'x' });
    let checked = 0;
    for (const item of ITEMS.filter((i) => canUse(acc, i))) {
      const r = equipItem(DEFAULT_AVATAR, item.id);
      if (!r.ok) continue; // blocked by a required piece; the editor refuses it too
      const v = validateFor(acc, r.avatar);
      expect(v.ok, item.id + (v.ok ? '' : ' ' + v.issues.map((i) => i.message).join(';'))).toBe(true);
      checked++;
    }
    expect(checked).toBeGreaterThan(60);
  });
});
