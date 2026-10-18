import { specOf, styleOf, torsoPart } from '../engine';
import { registerDrawer } from '../registry';

const cuffOf = (style: number) => (style === 1 ? 'shirt' : style === 2 || style === 5 ? 'rib' : 'plain');

for (const key of ['top.tee', 'top.shirt', 'top.polo', 'top.hoodie', 'top.sweater']) {
  registerDrawer(key, {
    draw: (c, it, e) => e.part(0, () => torsoPart(c, it)),
    sleeve: (it) => {
      const len = specOf(it).sleeve;
      return len > 0 ? { len, cuff: cuffOf(styleOf(it)) } : null;
    },
  });
}

/** Jackets worn over the top: they repaint the torso above it and bring their own sleeves. */
registerDrawer('outer.blazer', {
  draw: (c, it, e) => e.part(0.05, () => torsoPart(c, it)),
  sleeve: () => ({ len: 1, cuff: 'plain' }),
});
