import { drawLegPart, pelvisPart, skirtPart, tuckedBelt } from '../engine';
import { registerDrawer } from '../registry';

/** Trousers and shorts: legs + pelvis + belt. */
registerDrawer('bottom.pants', {
  draw(c, it, e) {
    const sit = c.rig.sit;
    e.leg('garment', (i) => drawLegPart(c, i, it));
    e.part(sit ? 36 : -40, () => pelvisPart(c, it));
    e.part(sit ? 37 : -39, () => tuckedBelt(c));
  },
});
registerDrawer('bottom.shorts', {
  draw(c, it, e) {
    const sit = c.rig.sit;
    e.leg('garment', (i) => drawLegPart(c, i, it));
    e.part(sit ? 36 : -40, () => pelvisPart(c, it));
    e.part(sit ? 37 : -39, () => tuckedBelt(c));
  },
});
registerDrawer('bottom.skirt', {
  draw(c, it, e) {
    const sit = c.rig.sit;
    e.leg('garment', (i) => drawLegPart(c, i, it));
    e.part(sit ? 36 : -40, () => pelvisPart(c, it));
    e.part(sit ? 44 : -30, () => skirtPart(c, it));
  },
});
