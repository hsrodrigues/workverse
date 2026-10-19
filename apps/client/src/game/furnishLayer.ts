import Phaser from 'phaser';
import { TILE_H, TILE_W, footprintTiles, tileToScreen, type Furniture, type Point } from '@workverse/shared';
import { emit, listen } from '../bus';
import { renderFurniture } from './furniture';

const GHOST_DEPTH = 900_000;
const GREEN = 0x4be37a;
const RED = 0xff5a5a;
const GOLD = 0xffe27a;

/**
 * Scene side of the room editor. It holds no rules: the UI decides (with the shared validation) what the ghost is and whether
 * it is valid; this layer reports where the pointer is, and draws the ghost footprint (green / red), a translucent copy of
 * the piece, and the outline of the selected piece.
 */
export class FurnishLayer {
  /** Decorate mode is on: the scene stops walking / sitting on clicks. */
  active = false;
  /** The UI took the current drag (it is moving a piece): the camera must not pan. */
  grabbed = false;
  private grabRequested = false;
  private readonly g: Phaser.GameObjects.Graphics;
  private image: Phaser.GameObjects.Image | null = null;
  private state: { piece: Furniture | null; valid: boolean; selected: Furniture | null } = { piece: null, valid: true, selected: null };
  private readonly off: Array<() => void> = [];

  constructor(private readonly scene: Phaser.Scene) {
    this.g = scene.add.graphics().setDepth(GHOST_DEPTH);
    this.off.push(
      listen('furnishActive', (on) => {
        this.active = on === true;
        if (!this.active) {
          this.state = { piece: null, valid: true, selected: null };
          this.grabbed = false;
          this.draw();
        }
      }),
      listen('furnishGhost', (d) => {
        this.state = d ?? { piece: null, valid: true, selected: null };
        this.draw();
      }),
      listen('furnishGrab', () => {
        this.grabRequested = true;
      }),
    );
    const cleanup = () => {
      this.off.forEach((f) => f());
      this.off.length = 0;
    };
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, cleanup);
    scene.events.once(Phaser.Scenes.Events.DESTROY, cleanup);
  }

  /** Reports the pointer to the UI. On `down` the UI may answer (synchronously) with `furnishGrab`. */
  pointer(type: 'move' | 'down' | 'up', tile: Point, p: Phaser.Input.Pointer, panned = false) {
    const ev = p.event as MouseEvent | undefined;
    if (type === 'down') this.grabRequested = false;
    emit('furnishPointer', { type, x: tile.x, y: tile.y, cx: ev?.clientX ?? p.x, cy: ev?.clientY ?? p.y, panned });
    if (type === 'down') this.grabbed = this.grabRequested;
  }

  /** The room was rebuilt underneath: draw again over the new scenery. */
  refresh() {
    this.draw();
  }

  private diamond(x: number, y: number, color: number, fillAlpha: number, lineAlpha: number) {
    const n = tileToScreen(x, y);
    const pts = [
      new Phaser.Math.Vector2(n.x, n.y),
      new Phaser.Math.Vector2(n.x + TILE_W / 2, n.y + TILE_H / 2),
      new Phaser.Math.Vector2(n.x, n.y + TILE_H),
      new Phaser.Math.Vector2(n.x - TILE_W / 2, n.y + TILE_H / 2),
    ];
    if (fillAlpha > 0) {
      this.g.fillStyle(color, fillAlpha);
      this.g.fillPoints(pts, true);
    }
    this.g.lineStyle(2, color, lineAlpha);
    this.g.strokePoints(pts, true);
  }

  private draw() {
    this.g.clear();
    const { piece, valid, selected } = this.state;
    if (selected) for (const t of footprintTiles(selected)) this.diamond(t.x, t.y, GOLD, 0.18, 1);
    if (!piece) {
      this.image?.setVisible(false);
      return;
    }
    const color = valid ? GREEN : RED;
    for (const t of footprintTiles(piece)) this.diamond(t.x, t.y, color, 0.38, 1);
    const s = renderFurniture({ ...piece, id: 'ghost' }, false);
    if (!this.scene.textures.exists(s.key)) this.scene.textures.addCanvas(s.key, s.canvas);
    const o = tileToScreen(piece.x, piece.y);
    this.image ??= this.scene.add.image(0, 0, s.key).setOrigin(0, 0).setDepth(GHOST_DEPTH - 1);
    this.image.setTexture(s.key).setPosition(o.x - s.ax, o.y - s.ay).setAlpha(valid ? 0.72 : 0.5).setVisible(true);
    if (valid) this.image.clearTint();
    else this.image.setTint(0xff9a9a);
  }
}
