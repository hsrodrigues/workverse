import { shade } from '../../pixel';
import { AUX, SIDE, armDepth, levelY, limbPt, surfLine, torsoPoint, type P2 } from '../engine';
import { tonesOf } from '../recolor';
import { registerDrawer } from '../registry';
import { body, button, done } from './outers2';

/**
 * The WorkVerse staff set (black and gold): the jacket lives here, the shirt, trousers, shoes, tie, watch, glasses, hat, cape
 * and aura reuse the shared drawers with gold details (see `staff.*` in the catalog).
 */

const GOLD = '#d9b24a';
const GOLD_LT = '#f2cf63';
const GOLD_DK = '#a87a1a';

registerDrawer('staff.jacket', {
  draw: (c, it, e) => {
    e.part(0.05, () => {
      const col = it.t;
      const hem = -3.2;
      body(c, col, { hem, grow: 0.5, open: [8.6, 26, 0.03, 0.4] });
      surfLine(c, -1.45, hem + 0.8, 1.45, hem + 0.8, GOLD, 0.7);
      if (!c.back) {
        // gold-edged lapels
        for (const sg of SIDE) {
          const pts: P2[] = [
            c.P(sg * 5.4, levelY(c, 22.6), c.rig.bz + 1.6),
            c.P(sg * 2.4, levelY(c, 24), c.rig.bz + 3.2),
            c.P(sg * 0.6, levelY(c, 9), c.rig.bz + 5.9),
            c.P(sg * 4.6, levelY(c, 11.4), c.rig.bz + 5.5),
            c.P(sg * 6.8, levelY(c, 17.4), c.rig.bz + 4.1),
          ].map((p) => [p[0], p[1]] as P2);
          AUX.clear();
          AUX.poly(pts);
          c.paint(AUX, tonesOf(shade(col.base, 0.12)), { lw: 1, sw: 2 });
          AUX.clear();
          for (let k = 0; k + 1 < pts.length; k++) if (k !== 1) c.line(pts[k][0], pts[k][1], pts[k + 1][0], pts[k + 1][1], k === 0 ? GOLD_LT : GOLD);
        }
        for (const yy of [7.4, 3.4]) button(c, 0.0, yy, GOLD_LT, 1.0);
        // gold chest star pin and pocket line
        const pin = torsoPoint(c, 0.62, 14.4, 1.0);
        if (pin[2] > 0.3) {
          c.px(pin[0], pin[1], '#fff3b8');
          c.px(pin[0] - 1, pin[1], GOLD_LT);
          c.px(pin[0] + 1, pin[1], GOLD_LT);
          c.px(pin[0], pin[1] - 1, GOLD_LT);
          c.px(pin[0], pin[1] + 1, GOLD_DK);
        }
        surfLine(c, -0.95, 8.2, -0.45, 8.6, GOLD_DK, 0.8);
      } else {
        surfLine(c, Math.PI, 20, Math.PI, hem + 2, GOLD_DK, 0.7);
        surfLine(c, Math.PI - 0.5, 3, Math.PI - 0.45, hem + 0.6, col.sh, 0.7);
        // star emblem across the shoulder blades
        const s = torsoPoint(c, Math.PI, 14, 0.8);
        for (const [dx, dy] of [[0, -3], [0, -2], [-3, 0], [-2, 0], [-1, 0], [0, 0], [1, 0], [2, 0], [3, 0], [-1, 1], [1, 1], [-2, 2], [2, 2], [0, -1], [0, 1]] as const) c.px(s[0] + dx, s[1] + dy, dx === 0 && dy === 0 ? '#fff3b8' : GOLD_LT);
      }
      // gold epaulettes
      for (const sg of SIDE) {
        surfLine(c, sg * 1.0, 20.8, sg * 1.2, 19.2, GOLD_LT, 0.75);
        surfLine(c, sg * 1.0, 20.0, sg * 1.2, 18.4, GOLD, 0.75);
      }
      done(c);
    });
    // gold cuff bands on both sleeves, drawn with each arm
    for (const i of [0, 1] as const) {
      e.part(armDepth(c, i) + 0.03, () => {
        const el = c.Pv(c.rig.elbow[i]);
        const wr = c.Pv(c.rig.wrist[i]);
        const elS: P2 = [el[0], el[1]];
        const wrS: P2 = [wr[0], wr[1]];
        for (const [t, hex] of [[0.7, GOLD_LT], [0.78, GOLD]] as const) {
          const a = limbPt(elS, wrS, t, -1, 3.2);
          const b = limbPt(elS, wrS, t, 1, 3.2);
          c.line(a[0], a[1], b[0], b[1], hex);
        }
        c.clip = null;
      });
    }
  },
  sleeve: () => ({ len: 1, cuff: 'plain' }),
});
