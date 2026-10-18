import { drawShoe } from '../engine';
import { registerDrawer } from '../registry';

for (const key of ['shoes.sneakers', 'shoes.dress', 'shoes.boots']) {
  registerDrawer(key, { draw: (c, it, e) => e.leg('shoe', (i) => drawShoe(c, i, it)) });
}
