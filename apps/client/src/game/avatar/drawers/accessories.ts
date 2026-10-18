import { drawAccessory, headCenter } from '../engine';
import { registerDrawer } from '../registry';

/** Glasses, hats and headphones from the first version of the renderer (`styleOf(item)` selects the shape). */
for (const key of ['acc.glasses', 'acc.sunglasses', 'acc.headset', 'acc.headphones', 'acc.cap', 'acc.beanie']) {
  registerDrawer(key, (c, it, e) => {
    const [cx, cy] = headCenter(c);
    e.part(20.5, () => drawAccessory(c, cx, cy, it));
  });
}
