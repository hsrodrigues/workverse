import type Phaser from 'phaser';
import { createCanvas } from './pixel';

/** Texture keys of the small "working" balloon (three frames: the raised dot walks along the three). */
export const WORK_BALLOON_KEYS = ['act:work0', 'act:work1', 'act:work2'] as const;

const INK = '#1d1a24';
const FILL = '#ffffff';
const DOT = '#3b82c4';
const DOT_LIT = '#7fc4ff';

// 15 x 10 balloon body + 3 px tail, drawn from rows; '#' ink outline, 'o' fill, '.' transparent.
const BODY = [
  '..###########..',
  '.#ooooooooooo#.',
  '#ooooooooooooo#',
  '#ooooooooooooo#',
  '#ooooooooooooo#',
  '#ooooooooooooo#',
  '.#ooooooooooo#.',
  '..###oo#######.',
  '.....#o#.......',
  '......#........',
];

/** Builds the balloon textures once per scene. Pixel art, no text and no emoji. */
export function ensureActivityTextures(scene: Phaser.Scene) {
  WORK_BALLOON_KEYS.forEach((key, frame) => {
    if (scene.textures.exists(key)) return;
    const { canvas, ctx } = createCanvas(15, 10);
    BODY.forEach((row, y) =>
      [...row].forEach((ch, x) => {
        if (ch === '.') return;
        ctx.fillStyle = ch === '#' ? INK : FILL;
        ctx.fillRect(x, y, 1, 1);
      }),
    );
    // three dots on the middle row; the lit one is lifted by a pixel, like a typing indicator
    for (let i = 0; i < 3; i++) {
      const x = 4 + i * 3;
      const lit = i === frame;
      ctx.fillStyle = lit ? DOT_LIT : DOT;
      ctx.fillRect(x, lit ? 3 : 4, 2, 2);
    }
    scene.textures.addCanvas(key, canvas);
  });
}
