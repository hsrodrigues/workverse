import Phaser from 'phaser';
import { tileToScreen, type Dir8, type PetFx, type PetState, type PetView, type Point } from '@workverse/shared';
import { PET_AX, PET_AY, PET_FH, PET_FW, PET_ICON_KEYS, buildPetIcons, buildPetSheet } from './petArt';
import { BEAT_MS, PetWalker, beatLook, frameFor, petBox, poseFor } from './petLogic';
import { NAME_PX, TEXT_FONT as FONT, buildBubble, buildTag, crisp, snap } from './text';

const SHEET_KEYS = ['pet:sheet:0', 'pet:sheet:1'] as const;
const SAY_MS = 5000;
/** Altura (px) que o Byte sobe ao ficar sobre um assento (sofa, pufe). */
const SEAT_LIFT = 8;

export interface SortableBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  z0: number;
  z1: number;
}

/** Folhas (LED normal e aceso) e icones, criados uma vez por cena. */
export function ensurePetTextures(scene: Phaser.Scene) {
  SHEET_KEYS.forEach((key, led) => {
    if (scene.textures.exists(key)) return;
    const { canvas, frames } = buildPetSheet(led === 1);
    const tex = scene.textures.addCanvas(key, canvas);
    if (tex) for (const f of frames) tex.add(f.name, 0, f.x, f.y, PET_FW, PET_FH);
  });
  const icons = buildPetIcons();
  for (const k of Object.keys(PET_ICON_KEYS) as Array<keyof typeof PET_ICON_KEYS>) {
    if (!scene.textures.exists(PET_ICON_KEYS[k])) scene.textures.addCanvas(PET_ICON_KEYS[k], icons[k]);
  }
}

interface Particle {
  img: Phaser.GameObjects.Image;
  born: number;
  life: number;
  x: number;
  y: number;
  dx: number;
  dy: number;
  s0: number;
  s1: number;
}

/**
 * O Byte no mundo: sprite (4 vistas por espelho), sombra, nome flutuante com a pilula "pet", baloes e efeitos. O servidor decide
 * tudo; aqui so se anima o que ele manda (`pet`, `pet_path`, `pet_act`). Nao e um jogador e nao entra em nenhuma lista.
 */
export class PetActor {
  readonly sprite: Phaser.GameObjects.Image;
  private readonly shadow: Phaser.GameObjects.Ellipse;
  private label: Phaser.GameObjects.Text;
  private pill: { c: Phaser.GameObjects.Container; w: number; h: number } | null = null;
  private bubbles: { c: Phaser.GameObjects.Container; born: number; h: number; text: string }[] = [];
  private particles: Particle[] = [];
  private ring: Phaser.GameObjects.Graphics;
  private readonly walker: PetWalker;
  private state: PetState;
  private clock = 0;
  private zoom = 0;
  private beatAt = -1e9;
  private nextZ = 0;
  private readonly seed: number;
  name: string;

  constructor(
    private readonly scene: Phaser.Scene,
    view: PetView,
    private readonly uiDepth: number,
    private readonly isSeat: (x: number, y: number) => boolean,
  ) {
    ensurePetTextures(scene);
    this.name = view.name;
    this.seed = (view.name.charCodeAt(0) % 7) / 7;
    this.walker = new PetWalker(view.x, view.y, view.dir);
    this.state = view.state;
    this.sprite = scene.add.image(0, 0, SHEET_KEYS[0], 'front:idle:0').setOrigin(PET_AX / PET_FW, PET_AY / PET_FH);
    this.shadow = scene.add.ellipse(0, 0, 20, 9, 0x000000, 0.28);
    this.ring = scene.add.graphics().setDepth(uiDepth - 3);
    this.label = scene.add.text(0, 0, view.name, { fontFamily: FONT, fontSize: `${NAME_PX}px`, fontStyle: '600', color: '#bfeaff', stroke: '#1d1a24', strokeThickness: 4, padding: { x: 2, y: 2 } }).setOrigin(0, 1).setDepth(uiDepth);
    if (view.path.length) this.walker.setPath({ x: view.x, y: view.y }, view.path);
    this.rebuild(scene.cameras.main.zoom);
  }

  // ---- mensagens do servidor ------------------------------------------------------------------------------------

  rename(name: string) {
    if (name === this.name) return;
    this.name = name;
    this.label.setText(name);
  }

  setPath(from: Point, path: Point[]) {
    this.walker.setPath(from, path);
    if (path.length) this.state = 'walk';
  }

  act(m: { state: PetState; x: number; y: number; dir: Dir8; fx?: PetFx; say?: string }) {
    if (m.state !== 'walk') {
      this.state = m.state;
      if (!this.walker.moving()) {
        if (Math.round(this.walker.tx) !== m.x || Math.round(this.walker.ty) !== m.y || this.walker.tx !== m.x || this.walker.ty !== m.y) this.walker.snap(m.x, m.y);
        this.walker.dir = m.dir;
      }
    }
    if (m.fx === 'hearts') this.hearts();
    else if (m.fx === 'beat') {
      this.beatAt = performance.now();
      this.spawn(PET_ICON_KEYS.beat, BEAT_MS - 100, 0, -14, 0.9, 1.1, 0, -30);
    }
    else if (m.fx === 'eat') this.sparkle();
    if (m.say) this.say(m.say);
  }

  // ---- efeitos ----------------------------------------------------------------------------------------------------

  private spawn(key: string, life: number, dx: number, dy: number, s0: number, s1: number, ox = 0, oy = 0) {
    const img = this.scene.add.image(0, 0, key).setDepth(this.uiDepth - 2).setOrigin(0.5, 1);
    this.particles.push({ img, born: performance.now(), life, x: ox, y: oy, dx, dy, s0, s1 });
    while (this.particles.length > 14) this.particles.shift()!.img.destroy();
  }

  private hearts() {
    for (let i = 0; i < 4; i++) this.spawn(PET_ICON_KEYS.heart, 1500 + i * 120, (i - 1.5) * 7, -26 - i * 4, 1, 1.15, (i - 1.5) * 4, -i * 3);
  }

  private sparkle() {
    this.spawn(PET_ICON_KEYS.spark, 700, -8, -10, 1, 0.6, 6, -4);
    this.spawn(PET_ICON_KEYS.spark, 800, 8, -12, 1, 0.6, -6, -2);
  }

  say(text: string) {
    const z = this.zoom;
    const c = this.scene.add.container(0, 0).setDepth(this.uiDepth + 1).setScale(1 / z);
    const h = buildBubble(this.scene, c, text, z);
    this.bubbles.push({ c, born: performance.now(), h: (h + 8) / z, text });
    while (this.bubbles.length > 2) this.bubbles.shift()!.c.destroy();
  }

  // ---- ordenacao e clique ---------------------------------------------------------------------------------------

  box(): SortableBox {
    return petBox(this.walker.tx, this.walker.ty, poseFor(this.state, this.walker.moving()), this.onSeat());
  }

  setDepth(d: number) {
    this.sprite.setDepth(d);
    this.shadow.setDepth(d - 1);
  }

  private onSeat() {
    return !this.walker.moving() && this.state === 'sit' && this.isSeat(Math.round(this.walker.tx), Math.round(this.walker.ty));
  }

  /** Estado para testes no navegador (so em desenvolvimento). */
  debug() {
    return { x: this.walker.tx, y: this.walker.ty, dir: this.walker.dir, state: this.state, moving: this.walker.moving(), pose: poseFor(this.state, this.walker.moving()), name: this.name, sx: this.sprite.x, sy: this.sprite.y, depth: this.sprite.depth };
  }

  /** Tile logico (para o marcador de foco). */
  tile(): Point {
    return { x: Math.round(this.walker.tx), y: Math.round(this.walker.ty) };
  }

  hit(wx: number, wy: number): boolean {
    return Math.abs(wx - this.sprite.x) <= 16 && wy >= this.sprite.y - 30 && wy <= this.sprite.y + 6;
  }

  // ---- texto: rasteriza de novo quando o zoom muda --------------------------------------------------------------

  private rebuild(z: number) {
    this.zoom = z;
    crisp(this.label, z);
    this.pill?.c.destroy();
    const c = this.scene.add.container(0, 0).setDepth(this.uiDepth).setScale(1 / z);
    const { w, h } = buildTag(this.scene, c, 'pet', '#7d8fb3', '#10182b', z);
    this.pill = { c, w, h };
    for (const b of this.bubbles) {
      b.h = (buildBubble(this.scene, b.c, b.text, z) + 8) / z;
      b.c.setScale(1 / z);
    }
  }

  // ---- quadro a quadro ---------------------------------------------------------------------------------------------

  update(dt: number) {
    const z = this.scene.cameras.main.zoom;
    if (z !== this.zoom) this.rebuild(z);
    this.walker.update(dt);
    this.clock += dt;
    const now = performance.now();
    const moving = this.walker.moving();
    const pose = poseFor(this.state, moving);
    const frame = frameFor(pose, this.walker.dir, this.clock, this.seed);
    const beat = beatLook(now - this.beatAt);
    this.sprite.setTexture(SHEET_KEYS[beat.led ? 1 : 0], frame.name);
    this.sprite.setFlipX(frame.flip);
    const base = tileToScreen(this.walker.tx + 0.5, this.walker.ty + 0.5);
    const lift = this.onSeat() ? SEAT_LIFT : 0;
    this.sprite.setPosition(Math.round(base.x), Math.round(base.y - lift));
    this.sprite.setScale(1, beat.scale);
    this.shadow.setPosition(base.x, base.y + 1).setVisible(!this.onSeat()).setSize(pose === 'sleep' ? 26 : 20, 9);

    // anel da batida de coracao: elipse isometrica que se expande no chao
    this.ring.clear();
    if (beat.ring !== null) {
      const k = beat.ring;
      this.ring.lineStyle(2, 0x2fe0f8, (1 - k) * 0.85);
      this.ring.strokeEllipse(base.x, base.y + 1, 16 + k * 44, 8 + k * 22);
    }
    // Zzz enquanto dorme
    if (pose === 'sleep' && now > this.nextZ) {
      this.nextZ = now + 1300;
      this.spawn(PET_ICON_KEYS.z, 2000, 10, -22, 0.7, 1.1, 6, -14);
    }

    this.particles = this.particles.filter((p) => {
      const k = (now - p.born) / p.life;
      if (k >= 1) {
        p.img.destroy();
        return false;
      }
      p.img.setPosition(Math.round(base.x + p.x + p.dx * k), Math.round(base.y - lift + p.y - 8 + p.dy * k));
      p.img.setScale((p.s0 + (p.s1 - p.s0) * k) / 1);
      p.img.setAlpha(k < 0.7 ? 1 : (1 - k) / 0.3);
      return true;
    });

    // nome + pilula "pet", centralizados sobre o bicho; baloes empilham em cima
    const cx = base.x;
    const top = base.y - lift - (pose === 'sleep' ? 22 : pose === 'sit' ? 34 : 38);
    const lw = Math.round(this.label.width);
    const pw = this.pill?.w ?? 0;
    const total = lw + 3 + pw;
    const lx = snap(cx, z) - Math.round(total / 2) / z;
    this.label.setPosition(lx, snap(top, z));
    this.pill?.c.setPosition(lx + (lw + 3 + pw / 2) / z, snap(top - this.label.height / z / 2 + 1 / z, z));
    let y = top - this.label.height / z - 2 / z;
    this.bubbles = this.bubbles.filter((b) => {
      if (now - b.born > SAY_MS) {
        b.c.destroy();
        return false;
      }
      return true;
    });
    for (let i = this.bubbles.length - 1; i >= 0; i--) {
      const b = this.bubbles[i]!;
      b.c.setPosition(snap(cx, z), snap(y - b.h / 2, z));
      b.c.setAlpha(Math.min(1, (SAY_MS - (now - b.born)) / 600));
      y -= b.h + 2 / z;
    }
  }

  destroy() {
    this.sprite.destroy();
    this.shadow.destroy();
    this.label.destroy();
    this.ring.destroy();
    this.pill?.c.destroy();
    this.bubbles.forEach((b) => b.c.destroy());
    this.particles.forEach((p) => p.img.destroy());
  }
}
