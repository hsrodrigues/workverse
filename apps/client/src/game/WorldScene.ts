import Phaser from 'phaser';
import {
  FURNI_KINDS,
  STEP_MS,
  TILE_H,
  TILE_W,
  avatarKey,
  buildRoom,
  dirFromDelta,
  heldOf,
  footprint,
  furniDirToDir8,
  interactiveAt,
  screenToTile,
  tileToScreen,
  isWalkable,
  type Activity,
  type AvatarConfig,
  type BuiltRoom,
  type HeldItem,
  type Dir8,
  type Furniture,
  type PlayerView,
  type Point,
  type RoomDef,
  type RoomSnapshot,
  type StaffLevel,
  type ServerMessage,
  type ClimateView,
  AC_MODE_LIST,
  isAcUnit,
} from '@workverse/shared';
import { net } from '../net';
import { stageUi } from '../stage/stageUi';
import { emit, listen } from '../bus';
import { ClimateFx } from './climateFx';
import { FurnishLayer } from './furnishLayer';
import { ANCHOR_X, ANCHOR_Y, FH, FRAMES_DRINK, FRAMES_IDLE, FRAMES_SIT, FRAMES_TYPE, FRAMES_WALK, FRAMES_WAVE, FRAME_COUNT, FW, SIT_LIFT, VIEWS, buildAvatarSheet, type View } from './avatarRenderer';
import { renderFurniture } from './furniture';
import { wearsBadge } from './avatar';
import { WORK_BALLOON_KEYS, ensureActivityTextures } from './activityArt';
import { THEMES, WALL_H, renderFloor, renderWalls } from './roomArt';
import { MediaBadges } from './mediaBadges';
import { StageScreen } from './stageScreen';
import { DoorSigns } from './doorSigns';
import { DayLighting } from './dayLighting';
import { EventDecor } from './eventDecor';
import { PetActor } from './petActor';
import { shouldSendPlay } from './petLogic';

import { DEPT_PX, NAME_PX, STAFF_PX, TEXT_FONT as FONT, buildBubble, buildTag, crisp, snap, texelOf } from './text';
import { RECEPTIONIST, badgeTextColor, deptShort, safeDeptColor, type ProfileTag } from '@workverse/shared';
/** Which sprite view (and mirroring) represents each of the eight facing directions. */
const VIEW_FOR_DIR: ReadonlyArray<{ view: View; flip: boolean }> = [
  { view: 'front34', flip: false }, // 0  +x   south-east
  { view: 'front', flip: false }, //   1  +x+y south
  { view: 'front34', flip: true }, //  2  +y   south-west
  { view: 'front34', flip: true }, //  3  -x+y west
  { view: 'back34', flip: true }, //   4  -x   north-west
  { view: 'back', flip: false }, //    5  -x-y north
  { view: 'back34', flip: false }, //  6  -y   north-east
  { view: 'front34', flip: false }, // 7  +x-y east
];
/** Key-press rhythm while typing: index of the typing frame (0 = left hand down, 1 = right hand down). */
const TYPING = [0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1];
// 0.5 and 0.75 only appear on small screens (fitCamera), so a whole room fits a phone; wheel/pinch steps through them too
const ZOOMS = [0.375, 0.5, 0.75, 1, 1.5, 2, 3];
const UI_DEPTH = 1_000_000;
const BUBBLE_MS = 8000;
/** Pieces picked by their drawn pixels (they are tall or hang on the wall, so the floor tile under the pointer is the wrong one). */
const SPRITE_PICK: ReadonlySet<string> = new Set(['tv_stand', 'ac_split', 'ac_floor', 'thermostat', 'light_switch', 'server_rack', 'noc_console']);
const MAX_BUBBLES = 4;

interface Box3 {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  z0: number;
  z1: number;
}

interface Sortable {
  box(): Box3;
  setDepth(d: number): void;
}

/** Short signature of a layout, to version the textures that depend on it. */
/** Stable 0..1 value from a string (blink offsets). */
function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return ((h >>> 0) % 1000) / 1000;
}

function layoutSig(list: readonly Furniture[]): string {
  let h = 5381;
  for (const f of list) for (const ch of `${f.id}${f.kind}${f.x},${f.y},${f.dir};`) h = ((h << 5) + h + ch.charCodeAt(0)) | 0;
  return (h >>> 0).toString(36);
}

const separated = (a: Box3, b: Box3) => a.x1 <= b.x0 + 1e-6 || a.y1 <= b.y0 + 1e-6 || a.z1 <= b.z0 + 1e-6;

/** Orders sprites so that anything in front of another paints later (topological sort). */
function assignDepths(items: Sortable[]) {
  const n = items.length;
  const boxes = items.map((i) => i.box());
  const out: number[][] = Array.from({ length: n }, () => []);
  const indeg = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const ab = separated(boxes[i], boxes[j]);
      const ba = separated(boxes[j], boxes[i]);
      if (ab && !ba) {
        out[i].push(j);
        indeg[j]++;
      } else if (ba && !ab) {
        out[j].push(i);
        indeg[i]++;
      }
    }
  }
  const key = (i: number) => boxes[i].x0 + boxes[i].y0 + boxes[i].x1 + boxes[i].y1;
  const ready: number[] = [];
  for (let i = 0; i < n; i++) if (indeg[i] === 0) ready.push(i);
  const placed = new Set<number>();
  let rank = 0;
  while (placed.size < n) {
    if (ready.length === 0) {
      // Cycle (should not happen): fall back to the smallest remaining key.
      let best = -1;
      for (let i = 0; i < n; i++) if (!placed.has(i) && (best < 0 || key(i) < key(best))) best = i;
      indeg[best] = 0;
      ready.push(best);
    }
    let bi = 0;
    for (let k = 1; k < ready.length; k++) if (key(ready[k]) < key(ready[bi])) bi = k;
    const i = ready.splice(bi, 1)[0];
    if (placed.has(i)) continue;
    placed.add(i);
    items[i].setDepth(10 + rank * 4);
    rank++;
    for (const j of out[i]) if (--indeg[j] === 0) ready.push(j);
  }
}

// ---------------------------------------------------------------------------

class Actor implements Sortable {
  readonly sprite: Phaser.GameObjects.Image;
  readonly shadow: Phaser.GameObjects.Ellipse;
  readonly label: Phaser.GameObjects.Text;
  /** Selo dourado 'STAFF' ao lado do nome: so existe quando o servidor marcou o jogador como staff em servico. */
  private staffTag: Phaser.GameObjects.Text | null = null;
  /** Pilula minuscula com o SETOR (cor do setor) ao lado do nome. O cargo so aparece na ficha ao clicar na pessoa. */
  private roleTag: Phaser.GameObjects.Text | null = null;
  private profile: ProfileTag = {};
  private bubbles: { c: Phaser.GameObjects.Container; born: number; h: number; text: string }[] = [];
  /** Zoom da camera com o qual os textos foram rasterizados (ver text.ts). */
  private zoom = 1;
  tx: number;
  ty: number;
  dir: Dir8 = 2;
  sitting = false;
  waveUntil = 0;
  /** What the server says this avatar is doing (working at a PC, holding a cup...). */
  activity: Activity = 'idle';
  private avatarCfg: AvatarConfig;
  private workBalloon: Phaser.GameObjects.Image | null = null;
  /** Start of the next sip (ms, performance clock); 0 = schedule one. */
  private drinkAt = 0;
  private queue: Point[] = [];
  private seg: { fx: number; fy: number; to: Point; t: number } | null = null;
  private clock = 0;
  private texKey = '';

  constructor(
    private readonly scene: WorldScene,
    readonly id: string,
    public name: string,
    avatar: AvatarConfig,
    x: number,
    y: number,
    readonly isYou: boolean,
  ) {
    this.tx = x;
    this.ty = y;
    this.avatarCfg = avatar;
    this.texKey = scene.avatarTexture(avatar);
    this.sprite = scene.add.image(0, 0, this.texKey, 'front0').setOrigin(ANCHOR_X / FW, ANCHOR_Y / FH);
    this.shadow = scene.add.ellipse(0, 0, 30, 13, 0x000000, 0.28);
    this.zoom = scene.cameras.main.zoom;
    this.label = crisp(
      scene.add
        .text(0, 0, name, { fontFamily: FONT, fontSize: `${NAME_PX}px`, fontStyle: '600', color: isYou ? '#ffe27a' : '#ffffff', stroke: '#1d1a24', strokeThickness: 4, padding: { x: 2, y: 2 } })
        .setOrigin(0, 1)
        .setDepth(UI_DEPTH),
      this.zoom,
    );
    this.place();
  }

  setStaff(level: StaffLevel | null) {
    if (!level) {
      this.staffTag?.destroy();
      this.staffTag = null;
      return;
    }
    const text = level === 'admin' ? 'STAFF ADM' : level === 'moderator' ? 'STAFF MOD' : 'STAFF';
    if (!this.staffTag) {
      this.staffTag = crisp(
        this.scene.add
          .text(0, 0, text, { fontFamily: FONT, fontSize: `${STAFF_PX}px`, fontStyle: '600', color: '#3b2600', backgroundColor: '#ffd24a', padding: { x: 4, y: 2 } })
          .setOrigin(0, 1)
          .setDepth(UI_DEPTH),
        this.zoom,
      );
    } else this.staffTag.setText(text);
    this.place();
  }

  setProfile(p: ProfileTag) {
    this.profile = p;
    // the badge item on the sprite follows the sector color
    this.texKey = this.scene.avatarTexture(this.avatarCfg, heldOf(this.activity), p.dept ? p.deptColor : undefined);
    this.refreshTag();
    this.place();
  }

  /** Right edge of the name plus the tags after it (STAFF seal, sector pill); media icons are drawn past it. */
  badgeRight(): number {
    let r = this.label.x + (1 - this.label.originX) * this.label.displayWidth;
    for (const t of [this.staffTag, this.roleTag]) if (t) r = Math.max(r, t.x + (1 - t.originX) * t.displayWidth);
    return r;
  }

  private refreshTag() {
    const text = deptShort(this.profile.dept);
    if (!text) {
      this.roleTag?.destroy();
      this.roleTag = null;
      return;
    }
    const bg = safeDeptColor(this.profile.deptColor);
    if (!this.roleTag) {
      this.roleTag = crisp(
        this.scene.add.text(0, 0, text, { fontFamily: FONT, fontSize: `${DEPT_PX}px`, fontStyle: '600', color: badgeTextColor(bg), backgroundColor: bg, padding: { x: 3, y: 0 } }).setOrigin(0, 1).setDepth(UI_DEPTH),
        this.zoom,
      );
    } else this.roleTag.setText(text).setColor(badgeTextColor(bg)).setBackgroundColor(bg);
  }

  setAvatar(avatar: AvatarConfig) {
    this.avatarCfg = avatar;
    this.texKey = this.scene.avatarTexture(avatar, heldOf(this.activity), this.profile.dept ? this.profile.deptColor : undefined);
  }

  setActivity(activity: Activity) {
    if (activity === this.activity) {
      if (heldOf(activity)) this.drinkAt = 0; // a fresh cup: first sip soon
      return;
    }
    this.activity = activity;
    this.drinkAt = 0;
    // the cup lives in the sprite sheet (the cup is part of the hand), so the sheet follows what is held
    this.texKey = this.scene.avatarTexture(this.avatarCfg, heldOf(activity), this.profile.dept ? this.profile.deptColor : undefined);
  }

  private holding(): HeldItem | null {
    return heldOf(this.activity);
  }

  isHolding(): boolean {
    return this.holding() !== null;
  }

  private pos() {
    return tileToScreen(this.tx + 0.5, this.ty + 0.5);
  }

  private place() {
    const p = this.pos();
    const lift = this.sitting ? SIT_LIFT : 0;
    this.sprite.setPosition(p.x, p.y - lift);
    this.shadow.setPosition(p.x, p.y).setVisible(!this.sitting);
    // texto em pixels de tela (ver text.ts): posicoes na grade de 1 / zoom, largura em pixels inteiros
    const z = this.zoom;
    const lw = Math.round(this.label.width);
    const lx = snap(p.x, z) - Math.round(lw / 2) / z;
    const base = p.y - lift - (this.sitting ? 66 : 94);
    this.label.setPosition(lx, snap(base, z));
    this.staffTag?.setPosition(lx + (lw + 2) / z, snap(this.label.y - 1 / z, z));
    // the sector pill sits right after the name (and after the STAFF seal, when there is one), without growing the name box
    if (this.roleTag) {
      const after = this.staffTag ? lx + (lw + 2 + Math.round(this.staffTag.width) + 2) / z : lx + (lw + 2) / z;
      this.roleTag.setPosition(after, snap(this.label.y - 2 / z, z));
    }
  }

  /** O zoom da camera mudou: re-rasteriza os textos na resolucao nova e reconstroi os baloes. */
  private applyZoom(z: number) {
    this.zoom = z;
    crisp(this.label, z);
    if (this.staffTag) crisp(this.staffTag, z);
    if (this.roleTag) crisp(this.roleTag, z);
    for (const b of this.bubbles) {
      b.h = (buildBubble(this.scene, b.c, b.text, z) + 8) / z;
      b.c.setScale(1 / z);
    }
  }

  snap(x: number, y: number) {
    this.tx = x;
    this.ty = y;
    this.seg = null;
    this.queue = [];
  }

  /** Direction to take once the walk in progress ends (the speaker turning to the audience). */
  private faceDir: Dir8 | null = null;

  face(dir: Dir8) {
    this.faceDir = dir;
  }

  setPath(from: Point, path: Point[]) {
    this.sitting = false;
    this.faceDir = null;
    // getting up ends the work (the server sends the same, this just avoids a flash of typing while standing)
    if (this.activity === 'working') this.activity = 'idle';
    const q: Point[] = [from, ...path];
    const cur: Point = this.seg ? this.seg.to : { x: Math.round(this.tx), y: Math.round(this.ty) };
    while (q.length && q[0].x === cur.x && q[0].y === cur.y) q.shift();
    if (q.length && (Math.abs(q[0].x - cur.x) > 1 || Math.abs(q[0].y - cur.y) > 1)) {
      this.snap(from.x, from.y);
      q.splice(0, q.length, ...path);
    }
    this.queue = q;
  }

  sit(x: number, y: number, dir: Dir8) {
    this.snap(x, y);
    this.sitting = true;
    this.dir = dir;
  }

  wave() {
    this.waveUntil = performance.now() + 2200;
  }

  say(text: string) {
    const z = this.zoom;
    const c = this.scene.add.container(0, 0).setDepth(UI_DEPTH + 1).setScale(1 / z);
    const h = buildBubble(this.scene, c, text, z);
    this.bubbles.push({ c, born: performance.now(), h: (h + 8) / z, text });
    while (this.bubbles.length > MAX_BUBBLES) this.bubbles.shift()!.c.destroy();
  }

  moving() {
    return this.seg !== null || this.queue.length > 0;
  }

  update(dt: number) {
    const camZoom = this.scene.cameras.main.zoom;
    if (camZoom !== this.zoom) this.applyZoom(camZoom);
    let remaining = dt;
    let guard = 0;
    while (remaining > 0 && guard++ < 8) {
      if (!this.seg) {
        const next = this.queue.shift();
        if (!next) break;
        const dx = next.x - this.tx;
        const dy = next.y - this.ty;
        if (Math.abs(dx) > 1.5 || Math.abs(dy) > 1.5) {
          this.snap(next.x, next.y);
          continue;
        }
        this.dir = dirFromDelta(dx, dy, this.dir);
        this.seg = { fx: this.tx, fy: this.ty, to: next, t: 0 };
      }
      const seg = this.seg;
      seg.t += remaining / STEP_MS;
      if (seg.t >= 1) {
        remaining = (seg.t - 1) * STEP_MS;
        this.tx = seg.to.x;
        this.ty = seg.to.y;
        this.seg = null;
      } else {
        this.tx = seg.fx + (seg.to.x - seg.fx) * seg.t;
        this.ty = seg.fy + (seg.to.y - seg.fy) * seg.t;
        remaining = 0;
      }
    }

    if (this.faceDir !== null && !this.seg && this.queue.length === 0) {
      this.dir = this.faceDir;
      this.faceDir = null;
    }

    const moving = this.seg !== null;
    this.clock += dt;
    let frame = 0;
    const breath = Math.floor(this.clock / 1100) % 2;
    const t = performance.now();
    const working = this.sitting && this.activity === 'working';
    if (moving || this.sitting) this.drinkAt = 0;
    if (working) frame = FRAMES_TYPE.start + TYPING[Math.floor(this.clock / 130) % TYPING.length];
    else if (this.sitting) frame = FRAMES_SIT.start + breath;
    else if (moving) frame = FRAMES_WALK.start + (Math.floor(this.clock / (STEP_MS / FRAMES_WALK.count)) % FRAMES_WALK.count);
    else if (performance.now() < this.waveUntil) frame = FRAMES_WAVE.start + [0, 1, 2, 1][Math.floor(this.clock / 170) % 4];
    else {
      frame = FRAMES_IDLE.start + breath;
      // a held cup is sipped from time to time: raise (0.35s), hold at the mouth (1.1s), lower (0.3s)
      if (this.holding()) {
        if (this.drinkAt === 0) this.drinkAt = t + 1200;
        const k = t - this.drinkAt;
        if (k >= 0) {
          if (k < 350) frame = FRAMES_DRINK.start;
          else if (k < 1450) frame = FRAMES_DRINK.start + 1;
          else if (k < 1750) frame = FRAMES_DRINK.start;
          else this.drinkAt = t + 6500 + (this.id.charCodeAt(0) % 5) * 600;
        }
      }
    }

    const { view, flip } = VIEW_FOR_DIR[this.dir];
    this.sprite.setTexture(this.texKey, `${view}${Math.min(frame, FRAME_COUNT - 1)}`);
    this.sprite.setFlipX(flip);
    this.place();

    // "working" balloon right above the name (pixel art in whole screen pixels per texel, see text.ts)
    const z = this.zoom;
    const cx = snap(this.pos().x, z);
    const nameTop = this.label.y - this.label.height / z;
    let top = nameTop - 2 / z;
    if (working) {
      const k = texelOf(z);
      if (!this.workBalloon) this.workBalloon = this.scene.add.image(0, 0, WORK_BALLOON_KEYS[0]).setOrigin(0, 1).setDepth(UI_DEPTH);
      this.workBalloon
        .setTexture(WORK_BALLOON_KEYS[Math.floor(t / 320) % WORK_BALLOON_KEYS.length])
        .setScale(k / z)
        .setPosition(cx - Math.round((15 * k) / 2) / z, snap(top, z))
        .setVisible(true);
      top -= (10 * k + 4) / z;
    } else this.workBalloon?.setVisible(false);

    // bubbles stack above the name, newest at the bottom
    const now = performance.now();
    this.bubbles = this.bubbles.filter((b) => {
      if (now - b.born > BUBBLE_MS) {
        b.c.destroy();
        return false;
      }
      return true;
    });
    let y = top;
    for (let i = this.bubbles.length - 1; i >= 0; i--) {
      const b = this.bubbles[i];
      b.c.setPosition(cx, snap(y - b.h / 2, z));
      b.c.setAlpha(Math.min(1, (BUBBLE_MS - (now - b.born)) / 800));
      y -= b.h + 2 / z;
    }
  }

  box(): Box3 {
    const cx = this.tx + 0.5;
    const cy = this.ty + 0.5;
    const r = this.sitting ? 0.2 : 0.26;
    return { x0: cx - r, y0: cy - r, x1: cx + r, y1: cy + r, z0: this.sitting ? 20 : 0, z1: this.sitting ? 80 : 86 };
  }

  setDepth(d: number) {
    this.sprite.setDepth(d);
    this.shadow.setDepth(d - 1);
  }

  hit(wx: number, wy: number): boolean {
    return Math.abs(wx - this.sprite.x) <= 16 && wy >= this.sprite.y - (this.sitting ? 62 : 90) && wy <= this.sprite.y + (this.sitting ? 14 : 4);
  }

  destroy() {
    this.sprite.destroy();
    this.shadow.destroy();
    this.label.destroy();
    this.staffTag?.destroy();
    this.roleTag?.destroy();
    this.workBalloon?.destroy();
    this.bubbles.forEach((b) => b.c.destroy());
  }
}

/**
 * A atendente NPC sentada atras do balcao da recepcao (ver shared/receptionist.ts). So existe aqui no cliente: nao e jogador,
 * nao entra em populacao, presenca nem listas. Clicar nela abre o painel "Atendimento"; de tempos em tempos aparece um "?".
 */
class Receptionist implements Sortable {
  private readonly sprite: Phaser.GameObjects.Image;
  private readonly shadow: Phaser.GameObjects.Ellipse;
  private tag: { c: Phaser.GameObjects.Container; h: number } | null = null;
  private ask: { c: Phaser.GameObjects.Container; h: number } | null = null;
  private zoom = 0;
  private clock = 0;

  constructor(private readonly scene: WorldScene) {
    const key = scene.avatarTexture(RECEPTIONIST.avatar);
    this.sprite = scene.add.image(0, 0, key, 'front0').setOrigin(ANCHOR_X / FW, ANCHOR_Y / FH);
    this.shadow = scene.add.ellipse(0, 0, 26, 11, 0x000000, 0.2).setVisible(false);
    const p = this.pos();
    this.sprite.setPosition(p.x, p.y - SIT_LIFT);
  }

  private pos() {
    return tileToScreen(RECEPTIONIST.x + 0.5, RECEPTIONIST.y + 0.5);
  }

  /** Same box as a seated avatar, so the desk in front of her sorts correctly. */
  box(): Box3 {
    const cx = RECEPTIONIST.x + 0.5;
    const cy = RECEPTIONIST.y + 0.5;
    return { x0: cx - 0.2, y0: cy - 0.2, x1: cx + 0.2, y1: cy + 0.2, z0: 20, z1: 80 };
  }

  setDepth(d: number) {
    this.sprite.setDepth(d);
    this.shadow.setDepth(d - 1);
  }

  hit(wx: number, wy: number): boolean {
    return Math.abs(wx - this.sprite.x) <= 16 && wy >= this.sprite.y - 62 && wy <= this.sprite.y + 14;
  }

  atTile(x: number, y: number): boolean {
    return x === RECEPTIONIST.x && y === RECEPTIONIST.y;
  }

  private rebuild(z: number) {
    this.zoom = z;
    this.tag?.c.destroy();
    this.ask?.c.destroy();
    const c = this.scene.add.container(0, 0).setDepth(UI_DEPTH).setScale(1 / z);
    this.tag = { c, h: buildTag(this.scene, c, RECEPTIONIST.name, '#6c8cff', badgeTextColor('#6c8cff'), z).h };
    const a = this.scene.add.container(0, 0).setDepth(UI_DEPTH + 1).setScale(1 / z).setVisible(false);
    this.ask = { c: a, h: buildBubble(this.scene, a, '?', z) };
  }

  update(dt: number) {
    const z = this.scene.cameras.main.zoom;
    if (z !== this.zoom) this.rebuild(z);
    this.clock += dt;
    // breathing, like a seated avatar
    const breath = Math.floor(this.clock / 1100) % 2;
    this.sprite.setTexture(this.scene.avatarTexture(RECEPTIONIST.avatar), `front${FRAMES_SIT.start + breath}`);
    const p = this.pos();
    this.sprite.setPosition(p.x, p.y - SIT_LIFT);
    const top = p.y - SIT_LIFT - 66;
    const cx = snap(p.x, z);
    if (this.tag) this.tag.c.setPosition(cx, snap(top - this.tag.h / 2 / z, z));
    if (this.ask) {
      // "?" for 2.4 s every 7 s, floating a little
      const phase = this.clock % 7000;
      const on = phase > 4600;
      this.ask.c.setVisible(on);
      if (on) this.ask.c.setPosition(cx, snap(top - this.tag!.h / z - 4 / z - this.ask.h / 2 / z - Math.round(Math.sin(this.clock / 220) * 2) / z, z));
    }
  }

  destroy() {
    this.sprite.destroy();
    this.shadow.destroy();
    this.tag?.c.destroy();
    this.ask?.c.destroy();
  }
}

class FurniActor implements Sortable {
  constructor(
    readonly f: Furniture,
    readonly sprite: Phaser.GameObjects.Image,
    private readonly boxData: Box3,
    readonly overlay?: Phaser.GameObjects.Image,
    private readonly overlayBox?: Box3,
  ) {}
  box() {
    return this.boxData;
  }
  setDepth(d: number) {
    this.sprite.setDepth(d);
    this.overlay?.setDepth(d + 2);
  }
  overlaySortable(): Sortable | null {
    if (!this.overlay || !this.overlayBox) return null;
    const ob = this.overlayBox;
    const ov = this.overlay;
    return { box: () => ob, setDepth: (d) => ov.setDepth(d) };
  }
}

// ---------------------------------------------------------------------------

export class WorldScene extends Phaser.Scene {
  private built: BuiltRoom | null = null;
  private actors = new Map<string, Actor>();
  /** Atendente NPC (so na recepcao). */
  private receptionist: Receptionist | null = null;
  /** Byte, o pet do escritorio (NPC do servidor; ver petActor.ts). */
  private pet: PetActor | null = null;
  /** "Brincar": ate quando o ponteiro e enviado ao servidor, e o ultimo envio. */
  private playUntil = 0;
  private playSent: { at: number; x: number; y: number } | null = null;
  private furni: FurniActor[] = [];
  private roomObjects: Phaser.GameObjects.GameObject[] = [];
  private sortables: Sortable[] = [];
  private youId = '';
  private hover!: Phaser.GameObjects.Graphics;
  private marker!: Phaser.GameObjects.Graphics;
  private markerAt: { x: number; y: number; born: number } | null = null;
  private zoomIndex = 5;
  private userMoved = false;
  private downAt: { x: number; y: number } | null = null;
  private dragged = false;
  private unsubscribe?: () => void;
  /** Mic / camera / speaking / stage icons beside the avatars, and the slide shown on the auditorium screen. */
  private badges!: MediaBadges;
  private screens: StageScreen[] = [];
  /** Placas com o nome da sala sobre cada porta. */
  private doorSigns: DoorSigns | null = null;
  private dayLight!: DayLighting;
  /** Decoracao de eventos (Halloween, Natal...): so visual, ver eventDecor.ts. */
  private eventDecor!: EventDecor;
  /** Pieces with LEDs and live screens (IT room): two sprites each, swapped every few hundred ms (`on` = phase). */
  private blinkers: Array<{ fa: FurniActor; period: number; offset: number; last: number }> = [];
  /** Ar-condicionado e temperatura da sala atual (servidor), brisa e aletas animadas, e o marcador de "Localizar". */
  private climate: ClimateView | null = null;
  private climateFx!: ClimateFx;
  private locator!: Phaser.GameObjects.Graphics;
  private locateAt: { x: number; y: number; until: number; label: string } | null = null;
  private pendingLocate: { roomId: string; x: number; y: number; label: string; until: number } | null = null;
  /** Room editor (ghost, selection, pointer capture); idle unless the UI turns the decorate mode on. */
  private furn!: FurnishLayer;
  /** Lit/unlit state of the furniture of the current room (the layout can be rebuilt without a new snapshot). */
  private furniOn: Record<string, boolean> = {};
  /** Textures of the walls/floor of the current layout, dropped when the layout changes. */
  private artKeys: string[] = [];

  constructor() {
    super('world');
  }

  create() {
    this.hover = this.add.graphics().setDepth(5);
    this.marker = this.add.graphics().setDepth(6);
    this.locator = this.add.graphics().setDepth(UI_DEPTH - 1);
    this.climateFx = new ClimateFx(this);
    this.cameras.main.setBackgroundColor('#1b1830');
    this.badges = new MediaBadges(this);
    this.dayLight = new DayLighting(this);
    this.eventDecor = new EventDecor(this);
    this.furn = new FurnishLayer(this);
    ensureActivityTextures(this);

    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      this.downAt = { x: p.x, y: p.y };
      this.dragged = false;
      if (this.furn.active && p.button === 0) this.furn.pointer('down', this.tileAt(p), p);
    });
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => this.onMove(p));
    this.input.on('pointerup', (p: Phaser.Input.Pointer) => {
      if (this.furn.active) {
        // decorating: the click belongs to the editor (place / drop), never to walking or sitting
        if (p.button === 0) this.furn.pointer('up', this.tileAt(p), p, this.dragged);
        this.furn.grabbed = false;
        this.downAt = null;
        return;
      }
      if (!this.dragged && p.button === 0) this.onClick(p);
      this.downAt = null;
    });
    this.input.on('wheel', (_p: unknown, _o: unknown, _dx: number, dy: number) => {
      this.zoomIndex = Phaser.Math.Clamp(this.zoomIndex + (dy < 0 ? 1 : -1), 0, ZOOMS.length - 1);
      this.cameras.main.setZoom(ZOOMS[this.zoomIndex]);
    });
    this.scale.on('resize', () => {
      if (!this.userMoved) this.fitCamera();
    });

    this.unsubscribe = net.on((m) => this.onNet(m));
    const offLocate = listen('locateHost', (d) => d && this.requestLocate(d.roomId, d.x, d.y, d.label));
    const offPlay = listen('petPlay', () => {
      this.playUntil = performance.now() + 5200;
      this.playSent = null;
    });
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, offPlay);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, offLocate);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.unsubscribe?.());
    this.events.once(Phaser.Scenes.Events.DESTROY, () => this.unsubscribe?.());
    if (import.meta.env?.DEV) {
      // Dev-only helper for browser tests: canvas position of a tile centre.
      (window as unknown as { __wv: unknown }).__wv = {
        // Dev-only: the Phaser game and scene, for leak measurements (textures, display list) in browser tests.
        game: this.game,
        scene: this,
        tileToCanvas: (x: number, y: number) => {
          const c = this.cameras.main;
          const p = tileToScreen(x + 0.5, y + 0.5);
          return { x: (p.x - c.worldView.x) * c.zoom, y: (p.y - c.worldView.y) * c.zoom };
        },
        // Dev-only: current camera zoom / jump to a zoom level (index in ZOOMS).
        zoom: () => this.cameras.main.zoom,
        setZoom: (i: number) => {
          this.zoomIndex = Phaser.Math.Clamp(i, 0, ZOOMS.length - 1);
          this.userMoved = true;
          this.cameras.main.setZoom(ZOOMS[this.zoomIndex]);
        },
        // Dev-only: state of Byte, the office pet (tile, pose, sprite position on screen).
        pet: () => this.pet?.debug() ?? null,
        // Dev-only: tile and facing of your own avatar.
        you: () => {
          const a = this.actors.get(this.youId);
          return a ? { x: a.tx, y: a.ty, dir: a.dir, moving: a.moving() } : null;
        },
      };
    }
    this.game.events.emit('scene-ready');
  }

  // ---- textures ---------------------------------------------------------

  avatarTexture(cfg: AvatarConfig, held: HeldItem | null = null, stripe?: string): string {
    // the sector color only matters to the sprite when it wears the corporate badge
    const s = stripe && wearsBadge(cfg) ? safeDeptColor(stripe) : null;
    const key = `av:${avatarKey(cfg)}${held ? `~${held}` : ''}${s ? `#${s.slice(1)}` : ''}`;
    if (this.textures.exists(key)) return key;
    const tex = this.textures.addCanvas(key, buildAvatarSheet(cfg, held, s));
    if (tex) {
      VIEWS.forEach((view, row) => {
        for (let f = 0; f < FRAME_COUNT; f++) tex.add(`${view}${f}`, 0, f * FW, row * FH, FW, FH);
      });
    }
    return key;
  }

  private canvasTexture(key: string, canvas: HTMLCanvasElement): string {
    if (this.textures.exists(key)) return key;
    this.textures.addCanvas(key, canvas);
    return key;
  }

  // ---- network ----------------------------------------------------------

  private onNet(m: ServerMessage) {
    switch (m.t) {
      case 'room':
        this.loadRoom(m.room);
        break;
      case 'joined':
        this.addActor(m.player);
        break;
      case 'left':
        this.removeActor(m.id);
        break;
      case 'path':
        this.actors.get(m.id)?.setPath(m.from, m.path);
        break;
      case 'face':
        this.actors.get(m.id)?.face(m.dir);
        break;
      case 'sit':
        this.actors.get(m.id)?.sit(m.x, m.y, m.dir);
        break;
      case 'emote':
        this.actors.get(m.id)?.wave();
        break;
      case 'avatar':
        this.actors.get(m.id)?.setAvatar(m.avatar);
        break;
      case 'staff_flag':
        this.actors.get(m.id)?.setStaff(m.staff);
        break;
      case 'profile':
        this.actors.get(m.id)?.setProfile({ title: m.title, dept: m.dept, deptColor: m.deptColor });
        break;
      case 'activity':
        this.actors.get(m.id)?.setActivity(m.activity);
        break;
      case 'chat':
        if (m.kind === 'say' && m.id) this.actors.get(m.id)?.say(m.text);
        break;
      case 'furni':
        this.setFurniState(m.id, m.on);
        break;
      case 'climate':
        this.setClimate({ on: m.on, target: m.target, temp: m.temp, overheat: m.overheat, mode: m.mode, fan: m.fan, swing: m.swing, timerLeftMs: m.timerLeftMs });
        break;
      case 'furniture_changed':
        this.applyFurniture(m.furniture);
        break;
      case 'pet':
        this.setPet(m.pet);
        break;
      case 'pet_path':
        this.pet?.setPath(m.from, m.path);
        break;
      case 'pet_act':
        this.pet?.act(m);
        break;
    }
  }

  /** O servidor mostra (ou tira) o Byte desta sala. */
  private setPet(view: Extract<ServerMessage, { t: 'pet' }>['pet']) {
    if (!view) {
      this.pet?.destroy();
      this.pet = null;
      return;
    }
    if (this.pet) {
      // mesmo pet (ex.: renomeado): so atualiza o nome
      this.pet.rename(view.name);
      return;
    }
    const g = this.built?.grid;
    this.pet = new PetActor(this, view, UI_DEPTH, (x, y) => !!g && (this.built!.furniAt.get(y * g.width + x) ?? []).some((f) => FURNI_KINDS[f.kind].seat));
  }

  private addActor(p: PlayerView) {
    this.actors.get(p.id)?.destroy();
    const actor = new Actor(this, p.id, p.name, p.avatar, p.x, p.y, p.id === this.youId);
    actor.dir = p.dir;
    actor.setActivity(p.activity ?? 'idle');
    actor.setStaff(p.staff ?? null);
    actor.setProfile({ title: p.title, dept: p.dept, deptColor: p.deptColor });
    if (p.sitting) actor.sit(p.x, p.y, p.dir);
    else if (p.path.length) actor.setPath({ x: p.x, y: p.y }, p.path);
    this.actors.set(p.id, actor);
  }

  private removeActor(id: string) {
    this.actors.get(id)?.destroy();
    this.actors.delete(id);
  }

  // ---- room -------------------------------------------------------------

  private loadRoom(snap: RoomSnapshot) {
    for (const a of this.actors.values()) a.destroy();
    this.actors.clear();
    this.badges.clear();
    this.doorSigns ??= new DoorSigns(this);
    this.doorSigns.build(snap.def, this.cameras?.main?.zoom ?? 1);
    this.youId = snap.youId;
    this.furniOn = { ...snap.furniState };
    this.climate = snap.climate ?? null;
    this.buildStatic(snap.def, this.furniOn);

    this.pet?.destroy();
    this.pet = null;
    this.receptionist?.destroy();
    this.receptionist = snap.def.id === RECEPTIONIST.roomId ? new Receptionist(this) : null;
    for (const p of snap.players) this.addActor(p);
    this.userMoved = false;
    this.fitCamera();
    const pend = this.pendingLocate;
    if (pend && pend.roomId === snap.def.id && performance.now() < pend.until) {
      this.pendingLocate = null;
      this.locate(pend.x, pend.y, pend.label);
    }
  }

  /** Floor, walls, furniture and lighting of a room definition. People, camera and media badges are not touched. */
  private buildStatic(def: RoomDef, furniState: Record<string, boolean>) {
    this.roomObjects.forEach((o) => o.destroy());
    this.roomObjects = [];
    this.furni = [];
    this.screens.forEach((s) => s.destroy());
    this.screens = [];
    this.climateFx.clear();
    const built = buildRoom(def);
    this.built = built;
    const theme = THEMES[def.id] ?? THEMES.office;
    const key = `room:${def.id}`;

    // the walls are cut by the wall pieces: a texture per layout (the previous ones are dropped once the new ones stand)
    const sig = layoutSig(def.furniture);
    const floor = renderFloor(built, theme);
    const walls = renderWalls(built, theme);
    const oldArt = this.artKeys;
    this.artKeys = [`${key}:floor:${sig}`, `${key}:walls:${sig}`];
    this.roomObjects.push(
      this.add.image(-floor.ox, -floor.oy, this.canvasTexture(this.artKeys[0], floor.canvas)).setOrigin(0, 0).setDepth(0),
      this.add.image(-walls.ox, -walls.oy, this.canvasTexture(this.artKeys[1], walls.canvas)).setOrigin(0, 0).setDepth(1),
    );
    for (const k of oldArt) if (!this.artKeys.includes(k) && this.textures.exists(k)) this.textures.remove(k);

    for (const f of def.furniture) {
      const on = furniState[f.id] === true;
      const s = renderFurniture(f, on, this.optOf(f));
      const tkey = this.canvasTexture(s.key, s.canvas);
      const o = tileToScreen(f.x, f.y);
      const img = this.add.image(o.x - s.ax, o.y - s.ay, tkey).setOrigin(0, 0);
      this.roomObjects.push(img);
      const fp = footprint(f);
      if (f.kind === 'rug' || f.kind === 'stage') {
        img.setDepth(2);
        continue;
      }
      const box: Box3 = { x0: f.x, y0: f.y, x1: f.x + fp.w, y1: f.y + fp.d, z0: s.z0, z1: s.z1 };
      if (FURNI_KINDS[f.kind].wall) {
        // hangs on the wall: only a thin slab against it takes part in sorting, so avatars always walk in front
        if (f.dir % 2 === 0) box.y1 = f.y + 0.08;
        else box.x1 = f.x + 0.08;
      }
      let overlay: Phaser.GameObjects.Image | undefined;
      let overlayBox: Box3 | undefined;
      if (s.front) {
        const fkey = this.canvasTexture(s.front.key, s.front.canvas);
        overlay = this.add.image(o.x - s.ax, o.y - s.ay, fkey).setOrigin(0, 0);
        this.roomObjects.push(overlay);
        const t = 0.26;
        overlayBox = f.dir % 4 === 2 ? { ...box, x0: box.x1 - t, z0: 12 } : { ...box, y0: box.y1 - t, z0: 12 };
        box.z1 = 12;
      } else if (FURNI_KINDS[f.kind].seat) {
        box.z1 = 12;
      }
      const fa = new FurniActor(f, img, box, overlay, overlayBox);
      this.furni.push(fa);
      if (f.kind === 'screen' || f.kind === 'tv_stand') this.screens.push(new StageScreen(this, f, () => img.depth + 1));
    }
    const BLINK: Partial<Record<Furniture['kind'], number>> = { server_rack: 520, videowall: 1500, command_desk: 1100, snack_machine: 1100, soda_machine: 1500, noc_console: 700 };
    this.blinkers = this.furni
      .filter((fa) => BLINK[fa.f.kind])
      .map((fa) => ({ fa, period: BLINK[fa.f.kind]!, offset: Math.floor(hashStr(fa.f.id) * 1000), last: 0 }));
    this.rebuildSortables();
    this.climateFx.load(
      this.furni.filter((fa) => isAcUnit(fa.f.kind)).map((fa) => ({ f: fa.f, sprite: fa.sprite })),
      (id) => furniState[id] === true,
    );
    if (this.climate) this.climateFx.setClimate(this.climate);
    this.dayLight.load(built, theme, def.furniture, furniState, floor, walls, key);
    this.eventDecor.load(built, def.furniture, this.furniOn);
  }

  /** The layout of the current room changed (someone decorated it): rebuild the static scenery, keep everybody where they are. */
  private applyFurniture(furniture: Furniture[]) {
    if (!this.built) return;
    this.buildStatic({ ...this.built.def, furniture }, this.furniOn);
    this.furn.refresh();
  }

  private blinkTick(now: number) {
    for (const b of this.blinkers) {
      const phase = Math.floor((now + b.offset) / b.period) % 2;
      if (phase === b.last) continue;
      b.last = phase;
      const s = renderFurniture(b.fa.f, phase === 1, this.optOf(b.fa.f));
      b.fa.sprite.setTexture(this.canvasTexture(s.key, s.canvas));
    }
  }

  /** Estado extra do desenho de uma peca (ver Builder em furniture.ts): alvo do ar, leitura do termostato, alerta dos racks. */
  private optOf(f: Furniture): number {
    const c = this.climate;
    if (!c) return 0;
    if (f.kind === 'ac_split' || f.kind === 'ac_floor') return AC_MODE_LIST.indexOf(c.mode) * 100 + c.target;
    if (f.kind === 'thermostat') return Math.round(c.temp) * 100 + c.target;
    if (f.kind === 'server_rack') return c.overheat ? 1 : 0;
    return 0;
  }

  /** O servidor mandou um clima novo: redesenha so as pecas que o mostram (display, termostato, racks). */
  private setClimate(c: ClimateView) {
    const before = this.climate;
    this.climate = c;
    this.climateFx.setClimate(c);
    for (const fa of this.furni) {
      const k = fa.f.kind;
      if (k !== 'ac_split' && k !== 'ac_floor' && k !== 'thermostat' && k !== 'server_rack') continue;
      if (before && this.optOf(fa.f) === this.optWith(before, fa.f)) continue;
      const s = renderFurniture(fa.f, this.blinkOn(fa) ?? this.furniOn[fa.f.id] === true, this.optOf(fa.f));
      const o = tileToScreen(fa.f.x, fa.f.y);
      fa.sprite.setTexture(this.canvasTexture(s.key, s.canvas)).setPosition(o.x - s.ax, o.y - s.ay);
    }
  }

  private optWith(c: ClimateView, f: Furniture): number {
    const now = this.climate;
    this.climate = c;
    const v = this.optOf(f);
    this.climate = now;
    return v;
  }

  /** Fase atual de uma peca que pisca (racks): para o redesenho de clima manter o mesmo quadro. */
  private blinkOn(fa: FurniActor): boolean | undefined {
    const b = this.blinkers.find((x) => x.fa === fa);
    return b ? b.last === 1 : undefined;
  }

  private rebuildSortables() {
    this.sortables = [];
    for (const fa of this.furni) {
      this.sortables.push(fa);
      const o = fa.overlaySortable();
      if (o) this.sortables.push(o);
    }
  }

  private setFurniState(id: string, on: boolean) {
    this.furniOn[id] = on;
    const fa = this.furni.find((x) => x.f.id === id);
    if (!fa) return;
    const s = renderFurniture(fa.f, on, this.optOf(fa.f));
    const tkey = this.canvasTexture(s.key, s.canvas);
    this.climateFx.setOn(id, on);
    // the lit sprite can have a different size/anchor than the dark one: place it like loadRoom does
    const o = tileToScreen(fa.f.x, fa.f.y);
    fa.sprite.setTexture(tkey).setPosition(o.x - s.ax, o.y - s.ay);
    this.dayLight.setOn(id, on);
  }

  private fitCamera() {
    const cam = this.cameras.main;
    if (!this.built) return;
    const { width: W, height: H } = this.built.grid;
    const bw = (W + H) * (TILE_W / 2);
    const bh = (W + H) * (TILE_H / 2) + WALL_H + 12;
    // phones: the bottom bar wraps into several rows and the top cards take room, so measure instead of guessing
    const bar = typeof document !== 'undefined' ? document.querySelector('.bar') : null;
    const barH = bar ? Math.ceil(bar.getBoundingClientRect().height) : 52;
    const small = this.scale.width <= 640;
    const availW = this.scale.width - (small ? 12 : 40);
    const availH = this.scale.height - barH - (small ? 64 : 138);
    let idx = 0;
    ZOOMS.forEach((z, i) => {
      if (bw * z <= availW && bh * z <= availH) idx = i;
    });
    this.zoomIndex = idx;
    cam.setZoom(ZOOMS[idx]);
    const cx = ((W - H) * (TILE_W / 2)) / 2;
    const cy = ((W + H) * (TILE_H / 2)) / 2 - WALL_H / 2 + 10;
    cam.centerOn(cx, cy);
  }

  // ---- input ------------------------------------------------------------

  private tileAt(p: Phaser.Input.Pointer): Point {
    const t = screenToTile(p.worldX, p.worldY);
    return { x: Math.floor(t.x), y: Math.floor(t.y) };
  }

  private onMove(p: Phaser.Input.Pointer) {
    if (this.furn.active && (this.furn.grabbed || !p.isDown)) {
      this.hover.clear();
      this.furn.pointer('move', this.tileAt(p), p);
      return;
    }
    if (p.isDown && this.downAt) {
      if (this.dragged || Math.hypot(p.x - this.downAt.x, p.y - this.downAt.y) > 6) {
        this.dragged = true;
        this.userMoved = true;
        const cam = this.cameras.main;
        cam.scrollX -= (p.x - p.prevPosition.x) / cam.zoom;
        cam.scrollY -= (p.y - p.prevPosition.y) / cam.zoom;
      }
      return;
    }
    const built = this.built;
    this.hover.clear();
    if (!built) return;
    const t = this.tileAt(p);
    const overActor = this.pickActor(p);
    const overPet = !!this.pet?.hit(p.worldX, p.worldY);
    if (this.playUntil > performance.now() && isWalkable(built.grid, t.x, t.y)) {
      const now = performance.now();
      if (shouldSendPlay(this.playSent, now, t.x, t.y)) {
        this.playSent = { at: now, x: t.x, y: t.y };
        net.send({ t: 'pet_do', act: 'play', x: t.x, y: t.y });
      }
    }
    const npc = !overActor && !overPet && this.receptionist && (this.receptionist.hit(p.worldX, p.worldY) || this.receptionist.atTile(t.x, t.y));
    const sprite = npc || overActor || overPet ? undefined : this.spriteUnder(p);
    const furni = npc ? undefined : (sprite ?? interactiveAt(built, t.x, t.y));
    this.input.setDefaultCursor(overActor || overPet || furni || npc ? 'pointer' : 'default');
    if (overPet && this.pet) {
      const pt = this.pet.tile();
      this.drawDiamond(this.hover, pt.x, pt.y, 0x9fe8ff, 0.9);
    } else if (npc) {
      this.drawDiamond(this.hover, RECEPTIONIST.x, RECEPTIONIST.y, 0xffe27a, 0.9);
    } else if (furni) {
      this.drawDiamond(this.hover, sprite ? sprite.x : t.x, sprite ? sprite.y : t.y, 0xffe27a, 0.9);
    } else if (isWalkable(built.grid, t.x, t.y)) {
      this.drawDiamond(this.hover, t.x, t.y, 0xffffff, 0.8);
    }
  }

  private pickActor(p: Phaser.Input.Pointer): Actor | undefined {
    let best: Actor | undefined;
    for (const a of this.actors.values()) {
      if (a.hit(p.worldX, p.worldY) && (!best || a.sprite.depth > best.sprite.depth)) best = a;
    }
    return best;
  }

  private onClick(p: Phaser.Input.Pointer) {
    const built = this.built;
    if (!built) return;
    const actor = this.pickActor(p);
    if (this.pet?.hit(p.worldX, p.worldY) && (!actor || this.pet.sprite.depth > actor.sprite.depth)) {
      const pt = this.pet.tile();
      emit('petClick', { name: this.pet.name, x: p.event instanceof MouseEvent ? p.event.clientX : p.x, y: p.event instanceof MouseEvent ? p.event.clientY : p.y });
      this.markerAt = { x: pt.x, y: pt.y, born: performance.now() };
      return;
    }
    if (actor?.isYou && actor.isHolding()) {
      // clicking yourself puts the cup down (the server confirms with an `activity` message)
      net.send({ t: 'activity', activity: 'idle' });
      return;
    }
    if (actor && !actor.isYou) {
      emit('avatarClick', { id: actor.id, name: actor.name, x: p.event instanceof MouseEvent ? p.event.clientX : p.x, y: p.event instanceof MouseEvent ? p.event.clientY : p.y });
      return;
    }
    emit('closeMenus');
    const tile0 = this.tileAt(p);
    if (this.receptionist && (this.receptionist.hit(p.worldX, p.worldY) || this.receptionist.atTile(tile0.x, tile0.y))) {
      emit('receptionistClick');
      this.markerAt = { x: RECEPTIONIST.x, y: RECEPTIONIST.y, born: performance.now() };
      return;
    }
    // tall and wall-mounted pieces (TV, air conditioning, thermostat, switch, racks): a click on the drawn pixels lands on a floor
    // tile behind them, so test the sprites first
    const hit = this.spriteUnder(p);
    if (hit) {
      net.send({ t: 'interact', furniId: hit.id, x: hit.x, y: hit.y });
      if (hit.kind === 'tv_stand') stageUi.set('open');
      this.markerAt = { x: hit.x, y: hit.y, born: performance.now() };
      return;
    }
    const t = this.tileAt(p);
    const f = interactiveAt(built, t.x, t.y);
    if (f) {
      if (f.kind === 'tv_stand') stageUi.set('open');
      net.send({ t: 'interact', furniId: f.id, x: t.x, y: t.y });
      this.markerAt = { x: t.x, y: t.y, born: performance.now() };
      return;
    }
    if (isWalkable(built.grid, t.x, t.y)) {
      net.send({ t: 'move', x: t.x, y: t.y });
      this.markerAt = { x: t.x, y: t.y, born: performance.now() };
    }
  }

  /** The usable piece (of the ones that are drawn tall or on the wall) whose drawn pixels are under the pointer; the nearest one wins. */
  private spriteUnder(p: Phaser.Input.Pointer): Furniture | undefined {
    let best: FurniActor | undefined;
    for (const fa of this.furni) {
      if (!SPRITE_PICK.has(fa.f.kind)) continue;
      const b = fa.sprite.getBounds();
      if (!b.contains(p.worldX, p.worldY)) continue;
      const alpha = this.textures.getPixelAlpha(Math.floor(p.worldX - b.x), Math.floor(p.worldY - b.y), fa.sprite.texture.key);
      if (alpha && alpha > 0 && (!best || fa.sprite.depth > best.sprite.depth)) best = fa;
    }
    return best?.f;
  }

  // ---- "Localizar" (inventario de PCs): camera e marcador piscante ----------------------------------------------------

  /** Pede para localizar uma estacao; se for de outra sala espera a entrada nela (ate 20 s). */
  private requestLocate(roomId: string, x: number, y: number, label: string) {
    if (this.built?.def.id === roomId) this.locate(x, y, label);
    else this.pendingLocate = { roomId, x, y, label, until: performance.now() + 20000 };
  }

  private locate(x: number, y: number, label: string) {
    const c = tileToScreen(x + 0.5, y + 0.5);
    this.userMoved = true;
    this.cameras.main.pan(c.x, c.y - 20, 650, 'Sine.easeInOut');
    this.locateAt = { x, y, until: performance.now() + 7000, label };
  }

  private drawLocator(now: number) {
    const g = this.locator;
    g.clear();
    const l = this.locateAt;
    if (!l) return;
    if (now > l.until) {
      this.locateAt = null;
      return;
    }
    const blink = Math.floor(now / 260) % 2 === 0;
    const color = blink ? 0xffe27a : 0x6fe0ff;
    const n = tileToScreen(l.x, l.y);
    for (const [grow, w] of [[0, 3], [5, 2]] as const) {
      g.lineStyle(w, color, blink ? 1 : 0.85);
      g.strokePoints(
        [
          new Phaser.Math.Vector2(n.x, n.y - grow / 2),
          new Phaser.Math.Vector2(n.x + TILE_W / 2 + grow, n.y + TILE_H / 2),
          new Phaser.Math.Vector2(n.x, n.y + TILE_H + grow / 2),
          new Phaser.Math.Vector2(n.x - TILE_W / 2 - grow, n.y + TILE_H / 2),
        ],
        true,
      );
    }
    // seta que quica acima da estacao
    const bob = Math.round(Math.sin(now / 160) * 4);
    const ax = Math.round(n.x);
    const ay = Math.round(n.y - 46 + bob);
    g.fillStyle(0x1d1a24, 1);
    g.fillTriangle(ax - 9, ay - 1, ax + 9, ay - 1, ax, ay + 12);
    g.fillStyle(color, 1);
    g.fillTriangle(ax - 7, ay, ax + 7, ay, ax, ay + 9);
  }

  /** Logical tile of any avatar in the room, including your own (proximity audio reads it ~5 times a second). */
  getTilePosition(id: string): { x: number; y: number } | undefined {
    const a = this.actors.get(id);
    return a ? { x: a.tx, y: a.ty } : undefined;
  }

  /** Walks next to another avatar (used by the context menu). */
  walkNear(id: string) {
    const a = this.actors.get(id);
    const built = this.built;
    if (!a || !built) return;
    const tx = Math.round(a.tx);
    const ty = Math.round(a.ty);
    const me = this.actors.get(this.youId);
    const options = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]
      .map(([dx, dy]) => ({ x: tx + dx, y: ty + dy }))
      .filter((t) => isWalkable(built.grid, t.x, t.y));
    if (!options.length) return;
    const from = me ? { x: Math.round(me.tx), y: Math.round(me.ty) } : { x: tx, y: ty };
    options.sort((a1, b1) => Math.hypot(a1.x - from.x, a1.y - from.y) - Math.hypot(b1.x - from.x, b1.y - from.y));
    net.send({ t: 'move', x: options[0].x, y: options[0].y });
  }

  private drawDiamond(g: Phaser.GameObjects.Graphics, x: number, y: number, color: number, alpha: number) {
    const n = tileToScreen(x, y);
    g.lineStyle(2, color, alpha);
    g.strokePoints(
      [
        new Phaser.Math.Vector2(n.x, n.y),
        new Phaser.Math.Vector2(n.x + TILE_W / 2, n.y + TILE_H / 2),
        new Phaser.Math.Vector2(n.x, n.y + TILE_H),
        new Phaser.Math.Vector2(n.x - TILE_W / 2, n.y + TILE_H / 2),
      ],
      true,
    );
  }

  // ---- frame loop -------------------------------------------------------

  update(_time: number, delta: number) {
    this.doorSigns?.setZoom(this.cameras.main.zoom);
    const dt = Math.min(delta, 100);
    for (const a of this.actors.values()) a.update(dt);
    this.receptionist?.update(dt);
    this.pet?.update(dt);
    if (this.sortables.length || this.actors.size || this.receptionist || this.pet) {
      assignDepths([...this.sortables, ...this.eventDecor.sortables, ...this.actors.values(), ...(this.receptionist ? [this.receptionist] : []), ...(this.pet ? [this.pet] : [])]);
    }
    this.badges.update(this.actors.values(), performance.now());
    for (const s of this.screens) s.tick(performance.now());
    this.dayLight.tick(performance.now());
    this.eventDecor.tick(performance.now());
    this.blinkTick(performance.now());
    this.climateFx.tick(performance.now());
    this.drawLocator(performance.now());
    this.marker.clear();
    if (this.markerAt) {
      const age = performance.now() - this.markerAt.born;
      if (age > 700) this.markerAt = null;
      else this.drawDiamond(this.marker, this.markerAt.x, this.markerAt.y, 0x6fe0ff, 1 - age / 700);
    }
  }
}
