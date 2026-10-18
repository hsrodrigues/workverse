import Phaser from 'phaser';
import { createCanvas } from './pixel';
import { mediaIndicators } from '../media/indicators';
import { worldStore } from '../worldStore';

/** What the badges need from an avatar actor (the scene's Actor has all of it). */
export interface BadgeTarget {
  id: string;
  label: Phaser.GameObjects.Text;
  shadow: Phaser.GameObjects.Ellipse;
}

const FONT = '"Pixelify Sans", "Segoe UI Emoji", "Courier New", monospace';
const UI_DEPTH = 1_000_000;

type Palette = Record<string, string>;

/** Paints a small pixel-art icon from rows of characters; '.' is transparent. */
function pixelIcon(rows: string[], palette: Palette): HTMLCanvasElement {
  const { canvas, ctx } = createCanvas(rows[0].length, rows.length);
  rows.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      const color = palette[ch];
      if (!color) return;
      ctx.fillStyle = color;
      ctx.fillRect(x, y, 1, 1);
    });
  });
  return canvas;
}

const MIC = [
  '....####....',
  '...#aaaa#...',
  '...#abba#...',
  '...#abba#...',
  '...#abba#...',
  '...#aaaa#...',
  '.#.#aaaa#.#.',
  '.#..####..#.',
  '..#......#..',
  '...######...',
  '.....##.....',
  '....####....',
];
const MIC_SLASH = [
  '#...........',
  '.#..........',
  '..#.........',
  '...#........',
  '....#.......',
  '.....#......',
  '......#.....',
  '.......#....',
  '........#...',
  '.........#..',
  '..........#.',
  '...........#',
];
const CAM = [
  '............',
  '..........#.',
  '.########.##',
  '.#aaaaaa#a#.',
  '.#abbbaa#a#.',
  '.#abbbaa##..',
  '.#aaaaaa#...',
  '.########...',
  '............',
];

function addIcon(scene: Phaser.Scene, key: string, rows: string[], palette: Palette, overlay?: string[]) {
  if (scene.textures.exists(key)) return;
  const canvas = pixelIcon(rows, palette);
  if (overlay) {
    const top = pixelIcon(overlay, { '#': '#ffffff' });
    const ctx = canvas.getContext('2d')!;
    // dark halo first so the slash reads on any background
    const halo = pixelIcon(overlay, { '#': '#14161d' });
    for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) ctx.drawImage(halo, dx, dy);
    ctx.drawImage(top, 0, 0);
  }
  scene.textures.addCanvas(key, canvas);
}

interface Entry {
  mic?: Phaser.GameObjects.Image;
  cam?: Phaser.GameObjects.Image;
  tag?: Phaser.GameObjects.Text;
}

/**
 * Small icons beside each avatar's name: microphone (on / muted), camera, a pulse ring while someone speaks, a
 * microphone tag over whoever holds the stage and a raised hand for the audience queue. People who never connected
 * media have no entry in `mediaIndicators`, so nothing is drawn for them.
 */
export class MediaBadges {
  private entries = new Map<string, Entry>();
  private readonly ring: Phaser.GameObjects.Graphics;

  constructor(private readonly scene: Phaser.Scene) {
    const ink = '#14161d';
    addIcon(scene, 'ind:mic-on', MIC, { '#': ink, a: '#58e08a', b: '#d6ffe4' });
    addIcon(scene, 'ind:mic-off', MIC, { '#': ink, a: '#e04848', b: '#ffb4b4' }, MIC_SLASH);
    addIcon(scene, 'ind:cam-on', CAM, { '#': ink, a: '#6fb7ea', b: '#d9f1fb' });
    addIcon(scene, 'ind:cam-off', CAM, { '#': ink, a: '#8f94a0', b: '#c9ced8' }, MIC_SLASH);
    this.ring = scene.add.graphics().setDepth(9);
  }

  update(targets: Iterable<BadgeTarget>, now: number) {
    const stage = worldStore.get().stage;
    this.ring.clear();
    const seen = new Set<string>();
    for (const t of targets) {
      seen.add(t.id);
      let e = this.entries.get(t.id);
      if (!e) this.entries.set(t.id, (e = {}));
      const ind = mediaIndicators.get(t.id);
      const lx = t.label.x;
      const ly = t.label.y - t.label.height / 2;
      const right = lx + t.label.width / 2 + 3;

      let x = right;
      const show = (name: 'mic' | 'cam', visible: boolean, key: string) => {
        let img = e![name];
        if (!visible) {
          img?.setVisible(false);
          return;
        }
        if (!img) {
          img = this.scene.add.image(0, 0, key).setOrigin(0, 0.5).setDepth(UI_DEPTH);
          e![name] = img;
        }
        if (img.texture.key !== key) img.setTexture(key);
        img.setVisible(true).setPosition(x, ly);
        x += img.width + 2;
      };
      show('mic', !!ind?.micPublished, ind?.micOn ? 'ind:mic-on' : 'ind:mic-off');
      show('cam', !!ind?.camPublished, ind?.camOn ? 'ind:cam-on' : 'ind:cam-off');

      // tag on the left of the name: stage holder or raised hand
      const isSpeaker = !!stage && stage.speakerId === t.id;
      const isVoice = !!stage && stage.voices.includes(t.id);
      const hand = !!stage && stage.hands.some((h) => h.id === t.id);
      const glyph = isSpeaker ? '🎤' : isVoice ? '🗣' : hand ? '✋' : '';
      if (glyph) {
        if (!e.tag) e.tag = this.scene.add.text(0, 0, glyph, { fontFamily: FONT, fontSize: '10px' }).setOrigin(1, 0.5).setDepth(UI_DEPTH);
        if (e.tag.text !== glyph) e.tag.setText(glyph);
        e.tag.setVisible(true).setPosition(lx - t.label.width / 2 - 2, ly);
      } else e.tag?.setVisible(false);

      if (ind?.speaking) {
        const g = this.ring;
        const p = t.shadow;
        for (const off of [0, 0.5]) {
          const ph = ((now / 900 + off) % 1 + 1) % 1;
          g.lineStyle(2, 0x7dffa8, 0.85 * (1 - ph));
          g.strokeEllipse(p.x, p.y, 22 + ph * 22, 10 + ph * 10);
        }
      }
    }
    for (const [id, e] of this.entries) {
      if (seen.has(id)) continue;
      e.mic?.destroy();
      e.cam?.destroy();
      e.tag?.destroy();
      this.entries.delete(id);
    }
  }

  clear() {
    for (const e of this.entries.values()) {
      e.mic?.destroy();
      e.cam?.destroy();
      e.tag?.destroy();
    }
    this.entries.clear();
    this.ring.clear();
  }

  destroy() {
    this.clear();
    this.ring.destroy();
  }
}
