import type { Furniture, FurniKind } from '@workverse/shared';
import { Plane, boxPlane, hash2, shade, type Box, type Ctx } from './pixel';
import { wallText } from './eventArt';
import type { Builder, Parts } from './furniture';

/**
 * Ar-condicionado (split de parede, torre de piso), termostato e console de monitoramento (NOC) da Sala da TI. Pixel art
 * ORIGINAL desenhada por codigo. O parametro `opt` do desenho carrega o estado do clima da sala:
 *  - ar-condicionado: temperatura-alvo (18..26), mostrada no display quando ligado (`on`);
 *  - termostato: `temperatura ambiente * 100 + alvo` (ex.: 2423 = 24 °C ambiente, meta 23).
 * A brisa e as aletas animadas ficam em climateFx.ts (Phaser), por cima destas pecas.
 */

const CYAN = '#7ff3ff';
const CYAN_OFF = '#35505a';
const GREEN = '#58e08a';

const side = (f: Furniture): 'n' | 'w' => (f.dir % 2 === 0 ? 'n' : 'w');
const tone = (s: 'n' | 'w', c: string) => (s === 'w' ? shade(c, -0.13) : c);
const isBack = (f: Furniture) => ((f.dir % 4) + 4) % 4 >= 2;

function withDetail(b: Box, fn: (ctx: Ctx, ox: number, oy: number, b: Box) => void): Box {
  b.detail = (ctx, ox, oy) => fn(ctx, ox, oy, b);
  return b;
}

const onWall = (f: Furniture, fn: (p: Plane, s: 'n' | 'w') => void) => (ctx: Ctx, ox: number, oy: number) => fn(new Plane(ctx, side(f), ox, oy), side(f));
const wallShadow = (p: Plane, a0: number, a1: number, z0: number, z1: number) => p.rect(a0 + 2, a1 + 2, z0 - 2, z1 - 2, 'rgba(25,20,45,0.22)');

/** Retangulo com os quatro cantos cortados (pixel art "arredondado"). */
function rounded(p: Plane, a0: number, a1: number, z0: number, z1: number, color: string) {
  p.rect(a0 + 1, a1 - 1, z0, z0 + 1, color);
  p.rect(a0, a1, z0 + 1, z1 - 1, color);
  p.rect(a0 + 1, a1 - 1, z1 - 1, z1, color);
}

/** Digitos do display: dois caracteres 3x5 (7 px) + o pontinho de grau. */
function lcd(p: Plane, a: number, z: number, text: string, color: string) {
  wallText(p, a, z, text, color, 1, p.side === 'w');
}

/** Flocos de neve de 5x5 px (modo frio). */
function snowflake(p: Plane, a: number, z: number, color: string) {
  p.rect(a + 2, a + 3, z, z + 5, color);
  p.rect(a, a + 5, z + 2, z + 3, color);
  for (const [da, dz] of [[1, 1], [3, 1], [1, 3], [3, 3]] as const) p.px(a + da, z + dz, color);
}

/** opt dos aparelhos: indice do modo * 100 + meta (modo 0 Frio, 1 Eco, 2 Ventilar, 3 Auto). */
const targetOf = (opt: number | undefined) => {
  const t = (opt ?? 0) % 100;
  return t >= 18 && t <= 26 ? t : 23;
};
const modeOf = (opt: number | undefined) => Math.floor((opt ?? 0) / 100) % 4;
/** Cor do LED de estado por modo: Frio azul, Eco verde, Ventilar branco, Auto ambar. */
const MODE_LED = ['#4aa8ff', '#58e08a', '#f4f6fa', '#ffd24a'] as const;

export const CLIMATE_BUILDERS: Record<Extract<FurniKind, 'ac_split' | 'ac_floor' | 'thermostat' | 'noc_console'>, Builder> = {
  /** Split de parede: 2 tiles de largura, bem alto na parede, com aletas, display de LED e LED de estado. */
  ac_split: (_fw, _fd, f, on, opt): Parts => ({
    boxes: [],
    z0: 56,
    z1: 90,
    shadow: null,
    post: onWall(f, (p, s) => {
      const S = (c: string) => tone(s, c);
      const A0 = 4;
      const A1 = 60;
      const Z0 = 60;
      const Z1 = 82;
      wallShadow(p, A0, A1, Z0, Z1);
      rounded(p, A0, A1, Z0, Z1, S('#8b93a4'));
      rounded(p, A0 + 1, A1 - 1, Z0 + 1, Z1 - 1, S('#eef1f6'));
      p.rect(A0 + 2, A1 - 2, Z1 - 3, Z1 - 2, S('#ffffff'));
      p.rect(A0 + 1, A0 + 2, Z0 + 2, Z1 - 2, S('#ffffff'));
      p.rect(A1 - 4, A1 - 1, Z0 + 2, Z1 - 2, S('#d3d8e3'));
      p.rect(A0 + 2, A1 - 2, Z0 + 1, Z0 + 2, S('#bcc3d1'));
      // saida de ar: fenda escura embaixo; ligada mostra as aletas abertas, desligada a aleta fechada
      p.rect(A0 + 5, A1 - 20, Z0 + 3, Z0 + 8, S('#262b36'));
      if (on) {
        for (let a = A0 + 6; a < A1 - 21; a += 4) {
          p.rect(a, a + 3, Z0 + 4, Z0 + 5, S('#9fd8ff'));
          p.rect(a + 1, a + 4, Z0 + 6, Z0 + 7, S('#6fb8ee'));
        }
      } else {
        p.rect(A0 + 5, A1 - 20, Z0 + 3, Z0 + 8, S('#d6dbe6'));
        p.rect(A0 + 5, A1 - 20, Z0 + 3, Z0 + 4, S('#a9b0c0'));
        p.rect(A0 + 5, A1 - 20, Z0 + 7, Z0 + 8, S('#ffffff'));
      }
      // painel de LED: temperatura-alvo (ou traços quando desligado)
      p.rect(A1 - 20, A1 - 5, Z0 + 9, Z1 - 4, S('#0b1118'));
      p.rect(A1 - 19, A1 - 6, Z0 + 10, Z1 - 5, S('#101c26'));
      lcd(p, A1 - 18, Z0 + 11, on ? String(targetOf(opt)) : '--', on ? CYAN : CYAN_OFF);
      p.px(A1 - 8, Z0 + 11, on ? CYAN : CYAN_OFF); // grau
      p.px(A1 - 8, Z0 + 12, on ? CYAN : CYAN_OFF);
      // LED de estado (verde ligado, vermelho em espera) e o sensor do controle remoto
      p.rect(A1 - 25, A1 - 22, Z0 + 12, Z0 + 14, on ? S(MODE_LED[modeOf(opt)]) : S('#d4574a'));
      if (on) p.rect(A1 - 26, A1 - 21, Z0 + 11, Z0 + 15, 'rgba(160,210,255,0.28)');
      p.rect(A1 - 31, A1 - 28, Z0 + 12, Z0 + 14, S('#3a3f4c'));
      // modo frio: floco de neve azul
      snowflake(p, A0 + 7, Z0 + 12, on && modeOf(opt) !== 2 ? S('#4aa8ff') : S('#a9b0c0'));
      // costura do painel frontal
      p.rect(A0 + 2, A1 - 2, Z0 + 9, Z0 + 10, S('#c3c9d6'));
    }),
  }),

  /** Torre de piso para a sala de servidores: grade no topo, display, LED e venezianas de entrada. */
  ac_floor: (_fw, _fd, f, on, opt): Parts => {
    // appliance convention (see furniture.ts faceOf): the front shows on the +x face for dir 0 and on the +y face for dir 1
    const s: 'n' | 'w' = f.dir % 2 === 0 ? 'w' : 'n';
    const H = 66;
    const body = withDetail({ x: 0.14, y: 0.16, z: 0, w: 0.72, d: 0.68, h: H, top: '#f2f4f8', left: '#dfe3ec', right: '#b3bac9' }, (ctx, ox, oy, b) => {
      const p = boxPlane(ctx, ox, oy, b, s);
      const W = Math.round((s === 'n' ? b.w : b.d) * 32);
      const t = (c: string) => tone(s, c);
      if (isBack(f)) {
        p.rect(0, W, 0, H, t('#d3d8e3'));
        p.rectFn(3, W - 3, 6, H - 8, (a, z) => (z % 4 === 0 && a % 6 < 4 ? t('#a9b0c0') : null));
        return;
      }
      p.rect(0, W, 0, H, t('#edf0f6'));
      p.rect(0, 1, 0, H, t('#ffffff'));
      p.rect(W - 2, W, 0, H, t('#c3c9d6'));
      p.rect(0, W, 0, 4, t('#2b2f3a'));
      // grade de saida de ar no topo (aletas) e a faixa azul
      p.rect(2, W - 2, H - 12, H - 4, t('#262b36'));
      for (let z = H - 11; z < H - 4; z += 2) p.rect(3, W - 3, z, z + 1, on ? t('#8fd2ff') : t('#4a5162'));
      p.rect(0, W, H - 3, H - 2, t('#4aa8ff'));
      // display de LED e LED de estado
      p.rect(2, W - 2, H - 25, H - 15, t('#0b1118'));
      lcd(p, 5, H - 23, on ? String(targetOf(opt)) : '--', on ? CYAN : CYAN_OFF);
      p.px(W - 5, H - 17, on ? CYAN : CYAN_OFF);
      p.px(W - 5, H - 18, on ? CYAN : CYAN_OFF);
      p.rect(2, 4, H - 28, H - 26, on ? t(MODE_LED[modeOf(opt)]) : t('#d4574a'));
      p.rect(6, 8, H - 28, H - 26, t('#3a3f4c'));
      // venezianas de entrada de ar
      for (let z = 8; z < H - 32; z += 3) p.rect(3, W - 3, z, z + 1, t('#b3bac9'));
      p.rect(2, W - 2, 5, 6, t('#9aa3b4'));
    });
    const grille = { x: 0.16, y: 0.18, z: H, w: 0.68, d: 0.64, h: 2, top: '#3a4052', left: '#2b2f3a', right: '#1d2029', noOutline: true } satisfies Box;
    return { z1: H + 3, shadow: { alpha: 0.3 }, boxes: [body, grille] };
  },

  /** Termostato de parede com tela: temperatura ambiente (grande) e meta (em laranja). */
  thermostat: (_fw, _fd, f, _on, opt): Parts => {
    const temp = opt ? Math.floor(opt / 100) : 24;
    const goal = opt ? opt % 100 : 23;
    const hot = temp >= 30;
    return {
      boxes: [],
      z0: 34,
      z1: 64,
      shadow: null,
      post: onWall(f, (p, s) => {
        const S = (c: string) => tone(s, c);
        const A0 = 8;
        const A1 = 24;
        const Z0 = 36;
        const Z1 = 60;
        wallShadow(p, A0, A1, Z0, Z1);
        p.rect(A0, A1, Z0, Z1, S('#59606e'));
        p.rect(A0 + 1, A1 - 1, Z0 + 1, Z1 - 1, S('#f5f3ec'));
        p.rect(A0 + 1, A0 + 2, Z0 + 1, Z1 - 1, S('#ffffff'));
        // tela
        p.rect(A0 + 2, A1 - 2, Z0 + 6, Z1 - 2, S('#0b1118'));
        p.rect(A0 + 3, A1 - 3, Z0 + 7, Z1 - 3, S('#0f2530'));
        lcd(p, A0 + 5, Z0 + 15, String(temp), hot ? '#ff6a5a' : CYAN);
        p.px(A0 + 13, Z0 + 19, hot ? '#ff6a5a' : CYAN);
        lcd(p, A0 + 5, Z0 + 8, String(goal), '#ffb347');
        p.px(A1 - 4, Z0 + 8, '#ffb347');
        // botoes e LED
        p.rect(A0 + 4, A0 + 7, Z0 + 2, Z0 + 4, S('#bcc3d1'));
        p.rect(A1 - 7, A1 - 4, Z0 + 2, Z0 + 4, S('#bcc3d1'));
        p.px(A0 + 8, Z0 + 3, hot ? S('#d4574a') : S(GREEN));
      }),
    };
  },

  /** Console de monitoramento (NOC): duas telas verde-matriz, teclado e leds. `on` = fase da animacao (ver WorldScene `blinkers`). */
  noc_console: (fw, fd, f, on): Parts => {
    const ph = on ? 1 : 0;
    const alongX = fw >= fd;
    const s: 'n' | 'w' = alongX ? 'n' : 'w';
    const mk = (l0: number, l1: number, s0: number, s1: number, z: number, h: number, top: string, left?: string, right?: string, extra: Partial<Box> = {}): Box =>
      alongX ? { x: l0, y: s0, w: l1 - l0, d: s1 - s0, z, h, top, left, right, ...extra } : { x: s0, y: l0, w: s1 - s0, d: l1 - l0, z, h, top, left, right, ...extra };
    const L = alongX ? fw : fd;
    const base = withDetail(mk(0.04, L - 0.04, 0.12, 0.88, 0, 22, '#2a3350', '#1a2138', '#10152a'), (ctx, ox, oy, b) => {
      const p = boxPlane(ctx, ox, oy, b, s);
      const W = Math.round((alongX ? b.w : b.d) * 32);
      const t = (c: string) => tone(s, c);
      p.rect(0, W, 0, 22, t('#1a2138'));
      p.rect(0, W, 0, 2, t('#0b0e18'));
      p.rect(0, W, 4, 5, t('#35d8ff'));
      p.rect(0, W, 5, 6, 'rgba(53,216,255,0.28)');
      for (let a = 4; a < W - 4; a += 12) {
        p.rect(a, a + 8, 9, 16, t('#10152a'));
        p.rect(a, a + 8, 15, 16, t('#2f3a60'));
        p.px(a + 2, 11, hash2(a, f.x + f.y, 5 + ph) < 0.5 ? GREEN : '#ffb347');
        p.px(a + 5, 11, hash2(a, f.x * 3 + f.y, 7 + ph) < 0.5 ? '#35d8ff' : '#2a3350');
      }
    });
    const top = mk(0, L, 0.08, 0.92, 22, 2, '#59606e', '#3a3f4c', '#2b2f3a');
    const screens: Box[] = [];
    const span = (L - 0.3) / 2;
    for (let i = 0; i < 2; i++) {
      const l0 = 0.1 + i * (span + 0.1);
      screens.push(
        withDetail(mk(l0, l0 + span, 0.3, 0.4, 28, 18, '#2b3350', '#141a2c', '#0c101c', { flat: true }), (ctx, ox, oy, b) => {
          if (isBack(f)) return;
          const p = boxPlane(ctx, ox, oy, b, s);
          const W = Math.round((alongX ? b.w : b.d) * 32);
          const t = (c: string) => tone(s, c);
          p.rect(0, W, 0, 18, t('#10152a'));
          p.rect(1, W - 1, 1, 17, t('#030b06'));
          // chuva de caracteres verde-matriz
          p.rectFn(2, W - 2, 2, 16, (a, z) => {
            if (a % 2 !== 0) return null;
            const v = hash2(a + i * 31, Math.floor((z + ph * 3 + (a % 7)) / 3), f.x + f.y);
            if (v > 0.55) return null;
            return v < 0.12 ? t('#d8ffe4') : v < 0.35 ? t('#3dd06a') : t('#1a7a3c');
          });
          p.rect(1, W - 1, 16, 17, 'rgba(255,255,255,0.08)');
          p.rect(1, 2, 1, 17, 'rgba(255,255,255,0.06)');
        }),
      );
      screens.push(mk(l0 + span / 2 - 0.05, l0 + span / 2 + 0.05, 0.32, 0.38, 24, 4, '#2b2f3a', '#1d2029', '#14161d', { noOutline: true }));
    }
    const keyboard = mk(0.35, L - 0.35, 0.55, 0.78, 24, 1, '#cfd5e0', '#a9b0c0', '#7d8594', { noOutline: true });
    return { z1: 50, shadow: { alpha: 0.28 }, boxes: [base, top, ...screens, keyboard] };
  },
};
