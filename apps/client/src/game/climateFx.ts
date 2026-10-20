import Phaser from 'phaser';
import { FAN_SPEED, furniFront, tileToScreen, type ClimateView, type Furniture } from '@workverse/shared';

/**
 * Efeitos do ar-condicionado ligado (so visual, sem audio): brisa fria em linhas azul-claro que descem em faixas nitidas (sem
 * desfoque nem dithering), aletas que balancam e "ondas de som" que pulsam ao lado do split. Tudo e desenhado em pixels inteiros num
 * Graphics por unidade, acima do desenho da peca; o estado (ligado ou nao) vem do servidor (mensagem `furni`).
 */

interface Unit {
  f: Furniture;
  sprite: Phaser.GameObjects.Image;
  g: Phaser.GameObjects.Graphics;
  /** Defasagem estavel para as unidades nao ficarem sincronizadas. */
  offset: number;
  on: boolean;
}

/** Faixas de cor da brisa: do mais claro (perto da saida) ao mais fraco (some). */
const BANDS: ReadonlyArray<readonly [number, number]> = [
  [0.3, 0xeaf8ff],
  [0.6, 0xb8e5ff],
  [0.85, 0x8ccaf2],
];

const NEUTRAL: ReadonlyArray<readonly [number, number]> = [
  [0.3, 0xffffff],
  [0.6, 0xe3e8f0],
  [0.85, 0xc4cbd8],
];

export class ClimateFx {
  private units: Unit[] = [];
  private last = 0;
  /** Ventilador (velocidade da brisa), aletas e modo da sala. */
  private fan = 1;
  private swing = true;
  private mode: ClimateView['mode'] = 'cool';

  constructor(private readonly scene: Phaser.Scene) {}

  clear() {
    for (const u of this.units) u.g.destroy();
    this.units = [];
  }

  /** Cria um Graphics para cada unidade de ar-condicionado da sala. `isOn` diz se a unidade esta ligada agora. */
  load(units: Array<{ f: Furniture; sprite: Phaser.GameObjects.Image }>, isOn: (id: string) => boolean) {
    this.clear();
    for (const [i, u] of units.entries()) {
      const g = this.scene.add.graphics().setDepth(u.sprite.depth + 1);
      this.units.push({ f: u.f, sprite: u.sprite, g, offset: (i * 0.23) % 1, on: isOn(u.f.id) });
    }
  }

  setClimate(c: ClimateView) {
    this.fan = FAN_SPEED[c.fan];
    this.swing = c.swing;
    this.mode = c.mode;
  }

  setOn(id: string, on: boolean) {
    const u = this.units.find((x) => x.f.id === id);
    if (!u) return;
    u.on = on;
    if (!on) u.g.clear();
  }

  tick(now: number) {
    if (now - this.last < 60) return;
    this.last = now;
    for (const u of this.units) {
      if (!u.on) continue;
      u.g.setDepth(u.sprite.depth + 1);
      u.g.clear();
      if (u.f.kind === 'ac_split') this.drawSplit(u, now);
      else this.drawFloor(u, now);
    }
  }

  /** Modo Ventilar: brisa em tom neutro (nao e ar frio); Eco: mais fraca (menos linhas visiveis). */
  private band(t: number): number | null {
    if (this.mode === 'eco' && t > 0.6) return null;
    for (const [limit, color] of this.mode === 'fan' ? NEUTRAL : BANDS) if (t < limit) return color;
    return null;
  }

  /** Split de parede: brisa descendo da saida de ar, aletas balancando e ondas de som. */
  private drawSplit(u: Unit, now: number) {
    const { f, g } = u;
    const north = f.dir % 2 === 0;
    const o = tileToScreen(f.x, f.y);
    // ponto do plano da parede (a ao longo, z altura) em pixels de tela, igual ao do desenho da peca
    const at = (a: number, z: number): [number, number] => [north ? o.x + a : o.x - 1 - a, o.y + ((a + 1) >> 1) - 1 - z];
    const time = now / 1000;
    // aletas: tres tracos inclinados que balancam dentro da fenda
    const sway = this.swing ? Math.floor(time * 1.6 * this.fan + u.offset * 4) % 4 : 0;
    g.fillStyle(0x9fd8ff, 1);
    for (let a = 10; a < 40; a += 4) {
      for (let k = 0; k < 3; k++) {
        const [x, y] = at(a + k, 64 + (sway === 0 ? 0 : sway === 1 ? (k > 0 ? 1 : 0) : sway === 2 ? k : (k > 1 ? 1 : 0)));
        g.fillRect(x, y, 1, 1);
      }
    }
    // brisa
    for (let j = 0; j < 14; j++) {
      const t = (time * 0.62 * this.fan + u.offset + j * 0.371) % 1;
      const color = this.band(t);
      if (color === null) continue;
      const a = 9 + Math.round(j * 3.6);
      const z = 60 - Math.round(36 * t);
      const out = 0.06 + 0.6 * t;
      const [bx, by] = at(a, z);
      const x = Math.round(bx + (north ? -out * 32 : out * 32));
      const y = Math.round(by + out * 16);
      g.fillStyle(color, 1);
      g.fillRect(x, y, 1, t < 0.3 ? 5 : t < 0.6 ? 4 : 3);
    }
    // ondas de som: tres barras que acendem em sequencia, a esquerda da unidade
    const beat = Math.floor(time * 2.2 + u.offset * 3) % 4;
    for (let k = 0; k < 3; k++) {
      if (k >= beat) continue;
      const a = 1 - k * 3;
      const h = 3 + k * 2;
      const [x, y] = at(a, 72 - (h >> 1));
      g.fillStyle(0xcdeeff, 1);
      g.fillRect(x, y, 1, h);
    }
  }

  /** Torre de piso: brisa saindo do topo para a frente e caindo. */
  private drawFloor(u: Unit, now: number) {
    const { f, g } = u;
    const fv = ([[1, 0], [0, 1], [-1, 0], [0, -1]] as const)[furniFront(f)];
    const perp = [-fv[1], fv[0]] as const;
    const time = now / 1000;
    for (let j = 0; j < 7; j++) {
      const t = (time * 0.6 * this.fan + u.offset + j * 0.41) % 1;
      const color = this.band(t);
      if (color === null) continue;
      const lat = (j - 3) * 0.075;
      const out = 0.5 + 0.55 * t;
      const p = tileToScreen(f.x + 0.5 + fv[0] * out + perp[0] * lat, f.y + 0.5 + fv[1] * out + perp[1] * lat);
      const z = 62 - Math.round(34 * t);
      g.fillStyle(color, 1);
      g.fillRect(Math.round(p.x), Math.round(p.y - z), 1, t < 0.3 ? 4 : t < 0.6 ? 3 : 2);
    }
  }
}
