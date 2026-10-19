import Phaser from 'phaser';
import { tagBox } from '@workverse/shared';

/**
 * Nitidez dos textos no mundo. A camera amplia tudo pelo zoom (1, 1.5, 2, 3) com `pixelArt`, entao um Text comum
 * (rasterizado em 1x) fica borrado. Aqui o texto e desenhado em "pixels de tela": o tamanho da fonte e o do balao
 * sao os que o usuario ve, a textura e rasterizada com `resolution = zoom` e o objeto recebe `scale = 1 / zoom`;
 * assim cada pixel da textura cai em exatamente um pixel da tela, em qualquer zoom, e o texto nao encolhe ao afastar.
 */

export const TEXT_FONT = '"Pixelify Sans", "Courier New", monospace';
export const INK = '#1d1a24';

/** Tamanhos em pixels de tela. */
export const NAME_PX = 12;
export const STAFF_PX = 10;
export const BUBBLE_PX = 12;
export const TAG_PX = 10;
export const DEPT_PX = 8;
const BUBBLE_WRAP = 168;

/** Arredonda um valor do mundo para a grade de pixels da tela (1 / zoom), evitando meio pixel. */
export const snap = (v: number, zoom: number) => Math.round(v * zoom) / zoom;

/** Aplica resolucao e escala inversa ao zoom: o texto passa a ocupar exatamente `width x height` pixels de tela. */
export function crisp<T extends Phaser.GameObjects.Text>(t: T, zoom: number): T {
  if ((t as unknown as { resolution: number }).resolution !== zoom) t.setResolution(zoom);
  return t.setScale(1 / zoom) as T;
}

/** Quantos pixels de tela vale cada pixel do balao 'trabalhando' (inteiro, para a pixel art continuar nitida). */
export const texelOf = (zoom: number) => Math.max(2, Math.round(zoom));

/**
 * Preenche `c` (origem no centro do balao) com um balao de fala em unidades de tela e devolve a altura (tela).
 * O container deve ter `scale = 1 / zoom`. Largura e altura sao pares, para o centro cair num pixel inteiro.
 */
export function buildBubble(scene: Phaser.Scene, c: Phaser.GameObjects.Container, text: string, zoom: number): number {
  c.removeAll(true);
  const t = crisp(
    scene.add
      .text(0, 0, text, {
        fontFamily: TEXT_FONT,
        fontSize: `${BUBBLE_PX}px`,
        fontStyle: '600',
        color: INK,
        wordWrap: { width: BUBBLE_WRAP, useAdvancedWrap: true },
        align: 'center',
        lineSpacing: 3,
      })
      .setOrigin(0, 0),
    zoom,
  );
  // o container ja esta em 1/zoom: o texto volta para 1 unidade = 1 pixel de tela
  t.setScale(1);
  const w = Math.ceil(t.width / 2) * 2 + 16;
  const h = Math.ceil(t.height / 2) * 2 + 10;
  const g = scene.add.graphics();
  g.fillStyle(0x1d1a24, 1).fillRoundedRect(-w / 2 - 1, -h / 2 - 1, w + 2, h + 2, 6);
  g.fillStyle(0xffffff, 1).fillRoundedRect(-w / 2, -h / 2, w, h, 5);
  g.fillStyle(0x1d1a24, 1).fillTriangle(-5, h / 2 + 1, 5, h / 2 + 1, 0, h / 2 + 7);
  g.fillStyle(0xffffff, 1).fillTriangle(-4, h / 2 - 1, 4, h / 2 - 1, 0, h / 2 + 5);
  t.setPosition(-Math.round(t.width / 2), -Math.round(t.height / 2));
  c.add([g, t]);
  return h;
}

const hexNum = (hex: string) => parseInt(hex.slice(1), 16);

/**
 * Etiqueta de cargo/setor sobre o avatar: placa com contorno escuro, cor do setor e brilho de 1 pixel no topo (pixel art).
 * Preenche `c` (origem no centro; o container deve ter `scale = 1 / zoom`) e devolve o tamanho em pixels de tela.
 */
export function buildTag(scene: Phaser.Scene, c: Phaser.GameObjects.Container, text: string, bg: string, fg: string, zoom: number): { w: number; h: number } {
  c.removeAll(true);
  const t = crisp(
    scene.add.text(0, 0, text, { fontFamily: TEXT_FONT, fontSize: `${TAG_PX}px`, fontStyle: '600', color: fg }).setOrigin(0, 0),
    zoom,
  );
  t.setScale(1);
  const { w, h } = tagBox(t.width, t.height);
  const g = scene.add.graphics();
  g.fillStyle(0x1d1a24, 1).fillRoundedRect(-w / 2 - 1, -h / 2 - 1, w + 2, h + 2, 3);
  g.fillStyle(hexNum(bg), 1).fillRoundedRect(-w / 2, -h / 2, w, h, 2);
  g.fillStyle(0xffffff, 0.28).fillRect(-w / 2 + 2, -h / 2, w - 4, 1);
  t.setPosition(-Math.round(t.width / 2), -Math.round(t.height / 2));
  c.add([g, t]);
  return { w, h };
}
