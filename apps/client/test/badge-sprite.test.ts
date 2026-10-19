import { describe, expect, it } from 'vitest';
import { DEFAULT_AVATAR, colorHex, equipItem, type AvatarV2 } from '@workverse/shared';
import { renderFrame } from '../src/game/avatar/compose';
import { wearsBadge } from '../src/game/avatar';

const withBadge = (base: AvatarV2 = DEFAULT_AVATAR, id = 'sp.badge'): AvatarV2 => {
  const r = equipItem(base, id);
  if (!r.ok) throw new Error('cannot equip');
  return r.avatar;
};

/** Pixel (ABGR in a Uint32Array) of a #rrggbb color. */
const abgr = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return (0xff000000 | ((n & 0xff) << 16) | (n & 0xff00) | ((n >> 16) & 0xff)) >>> 0;
};
const count = (buf: Uint32Array, hex: string) => buf.reduce((n, p) => n + (p === abgr(hex) ? 1 : 0), 0);

describe('cracha no sprite: faixa na cor do setor e mini retrato', () => {
  it('so quem veste o cracha muda de sprite com a cor do setor', () => {
    expect(wearsBadge(DEFAULT_AVATAR)).toBe(false);
    expect(wearsBadge(withBadge())).toBe(true);
    expect(wearsBadge(withBadge(DEFAULT_AVATAR, 'sp.badge_staff'))).toBe(true);
  });

  it('a faixa do cracha toma a cor do setor (e a mesma pessoa sem setor continua com a cor do cordao)', () => {
    const av = withBadge();
    const stripe = renderFrame(av, 'front', 0, null, '#e8608f');
    const none = renderFrame(av, 'front', 0, null, null);
    expect(count(stripe, '#e8608f')).toBeGreaterThan(count(none, '#e8608f'));
    expect(count(stripe, '#e8608f')).toBeGreaterThanOrEqual(8); // faixa de 7x3 menos cantos e brilho
    expect(Array.from(stripe)).not.toEqual(Array.from(none));
    // o extra nao vaza para o proximo quadro
    expect(Array.from(renderFrame(av, 'front', 0))).toEqual(Array.from(none));
  });

  it('o mini retrato usa a pele e o cabelo da propria pessoa', () => {
    const av = withBadge({ ...DEFAULT_AVATAR, skin: 'peach' });
    const dark = withBadge({ ...DEFAULT_AVATAR, skin: 'brown' });
    const a = renderFrame(av, 'front', 0);
    const b = renderFrame(dark, 'front', 0);
    // a cor de pele aparece em mais pixels que so rosto/maos: o retrato soma pontos; e muda com a pessoa
    expect(Array.from(a)).not.toEqual(Array.from(b));
    expect(count(a, colorHex('skin', 'peach'))).toBeGreaterThan(0);
  });

  it('crachas de staff e comum continuam diferentes entre si', () => {
    const a = renderFrame(withBadge(), 'front', 0);
    const b = renderFrame(withBadge(DEFAULT_AVATAR, 'sp.badge_staff'), 'front', 0);
    expect(Array.from(a)).not.toEqual(Array.from(b));
  });

  it('desenha nas quatro vistas sem erro (de costas so o cordao)', () => {
    for (const v of ['front', 'front34', 'back', 'back34'] as const) expect(renderFrame(withBadge(), v, 0, null, '#3fb67a').length).toBeGreaterThan(0);
  });
});
