import Phaser from 'phaser';
import type { Portal, RoomDef } from '@workverse/shared';
import { tileToScreen } from '@workverse/shared';
import { TEXT_FONT, snap } from './text';

/**
 * Placas de identificacao nas portas: cada porta mostra o NOME da sala para onde leva.
 * A placa e desenhada ja INCLINADA no plano da parede (cisalhamento isometrico 2:1), com moldura dourada,
 * fundo verde, sombra e parafusos, e fica centralizada sobre a porta, como se estivesse fixada na parede.
 * A textura e rasterizada em "pixels de tela" (escala = zoom x DPR) para o texto continuar nitido em qualquer zoom.
 */

/** Nomes curtos para caberem nas portas vizinhas da recepcao (≈ 2 tiles de largura). */
const SHORT: Record<string, string> = {
  office: 'ESCRITÓRIO',
  lounge: 'COPA',
  auditorium: 'AUDITÓRIO',
  reception: 'RECEPÇÃO',
  team: 'EQUIPE',
  meeting1: 'REUNIÃO 1',
  meeting2: 'REUNIÃO 2',
  private: 'PRIVADA',
  focus: 'CONCENTRAÇÃO',
  ti: 'TI',
};

export const doorLabel = (p: Pick<Portal, 'toRoom' | 'label'>): string => SHORT[p.toRoom] ?? p.label.toUpperCase().slice(0, 14);

/** Altura (px do mundo) do centro da placa: entre o topo da porta (~80) e a sanca da parede (~100). */
const SIGN_Z = 91;
const FONT_PX = 9;
const PAD_X = 7;
const PAD_Y = 3.5;
/** Inclinacao das paredes na projecao isometrica 2:1 (norte desce para a direita; oeste desce para a esquerda). */
const SHEAR = 0.5;

const BRASS = '#e0bb62';
const BRASS_DK = '#9a7a2e';
const GREEN = '#1f7a5c';
const GREEN_LT = '#58e08a';
const INK = '#14161d';

interface Sign {
  portal: Portal;
  img: Phaser.GameObjects.Image;
}

/** Desenha a placa (ja cisalhada para a parede `side`) num canvas com `s` pixels de textura por pixel do mundo. */
function drawSign(label: string, side: 'n' | 'w', s: number): HTMLCanvasElement {
  const probe = document.createElement('canvas').getContext('2d')!;
  probe.font = `600 ${FONT_PX * s}px ${TEXT_FONT}`;
  const tw = Math.ceil(probe.measureText(label).width);
  const W = tw + Math.round(PAD_X * 2 * s);
  const H = Math.round(FONT_PX * s + PAD_Y * 2 * s);
  const shear = side === 'n' ? SHEAR : -SHEAR;
  const margin = Math.ceil(2 * s);
  const cw = W + margin * 2;
  const ch = Math.ceil(H + Math.abs(shear) * W + margin * 2);
  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  // y sobe com x quando shear < 0 (parede oeste): desloca a origem para a placa caber
  const oy = shear < 0 ? Math.abs(shear) * W + margin : margin;
  ctx.setTransform(1, shear, 0, 1, margin, oy);

  const px = Math.max(1, Math.round(s)); // 1 "pixel" da pixel art em pixels de textura
  const rect = (x: number, y: number, w: number, h: number, c: string) => {
    ctx.fillStyle = c;
    ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  };
  // sombra projetada na parede
  rect(px, px * 1.5, W, H, 'rgba(10,12,18,0.38)');
  // moldura dourada
  rect(0, 0, W, H, BRASS_DK);
  rect(0, 0, W, H - px, BRASS);
  // fundo verde
  rect(px * 1.5, px * 1.5, W - px * 3, H - px * 3, INK);
  rect(px * 2, px * 2, W - px * 4, H - px * 4, GREEN);
  rect(px * 2, px * 2, W - px * 4, px, GREEN_LT);
  // parafusos
  for (const [x, y] of [
    [px * 0.5, px * 0.5],
    [W - px * 1.5, px * 0.5],
    [px * 0.5, H - px * 1.5],
    [W - px * 1.5, H - px * 1.5],
  ] as const)
    rect(x, y, px, px, '#fff3c4');
  // texto com sombra de 1 pixel
  ctx.font = `600 ${FONT_PX * s}px ${TEXT_FONT}`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  const cx = W / 2;
  const cy = H / 2 + px * 0.5;
  ctx.fillStyle = INK;
  ctx.fillText(label, cx + px * 0.6, cy + px * 0.8);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(label, cx, cy);
  return canvas;
}

export class DoorSigns {
  private signs: Sign[] = [];
  private zoom = 1;
  private def: RoomDef | null = null;

  constructor(private readonly scene: Phaser.Scene) {}

  /** Recria as placas da sala atual. */
  build(def: RoomDef, zoom: number) {
    this.destroy();
    this.def = def;
    this.zoom = zoom;
    this.layout();
  }

  /** O zoom da camera mudou: re-rasteriza as placas na resolucao nova. */
  setZoom(zoom: number) {
    if (zoom === this.zoom || !this.def) return;
    this.zoom = zoom;
    this.destroyImages();
    this.layout();
  }

  private layout() {
    if (!this.def) return;
    const z = this.zoom;
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    // texels por pixel do mundo: 1 texel = 1 pixel de tela
    const s = Math.max(1, z * dpr);
    for (const portal of this.def.portals) {
      const north = portal.y === 0;
      const side = north ? 'n' : 'w';
      const label = doorLabel(portal);
      const key = `sign:${label}:${side}:${s.toFixed(2)}`;
      if (!this.scene.textures.exists(key)) this.scene.textures.addCanvas(key, drawSign(label, side, s));
      // porta na parede norte (y = 0): centro em x + 0.5; na parede oeste (x = 0): centro em y + 0.5
      const p = north ? tileToScreen(portal.x + 0.5, 0) : tileToScreen(0, portal.y + 0.5);
      const img = this.scene.add
        .image(snap(p.x, z), snap(p.y - SIGN_Z, z), key)
        .setOrigin(0.5, 0.5)
        .setScale(1 / s)
        .setDepth(3);
      this.signs.push({ portal, img });
    }
  }

  private destroyImages() {
    for (const s of this.signs) s.img.destroy();
    this.signs = [];
  }

  destroy() {
    this.destroyImages();
  }
}
