import { specOf, styleOf, topDeco, torsoPart } from '../engine';
import { tonesOf } from '../recolor';
import { registerDrawer } from '../registry';

const cuffOf = (style: number) => (style === 1 ? 'shirt' : style === 2 || style === 5 || style === 6 || style === 9 ? 'rib' : 'plain');

const OFF_WHITE = tonesOf('#f4f1ea');

for (const key of ['top.tee', 'top.shirt', 'top.polo', 'top.hoodie', 'top.sweater']) {
  registerDrawer(key, {
    draw: (c, it, e) => e.part(0, () => torsoPart(c, it)),
    sleeve: (it) => {
      const len = specOf(it).sleeve;
      if (len <= 0) return null;
      // contrast sleeves (raglan) and patterned fabrics (plaid, rugby stripes) carry through to the arms
      return { len, cuff: it.item.params?.variant === 'staff' ? 'plain' : cuffOf(styleOf(it)), deco: topDeco(it), ...(it.item.params?.variant === 'raglan' ? { tones: OFF_WHITE } : {}) };
    },
  });
}

/** Jackets worn over the top: they repaint the torso above it and bring their own sleeves. */
registerDrawer('outer.blazer', {
  draw: (c, it, e) => e.part(0.05, () => torsoPart(c, it)),
  sleeve: () => ({ len: 1, cuff: 'plain' }),
});
