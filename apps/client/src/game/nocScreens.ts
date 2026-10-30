import type { Plane } from './pixel';
import { wallText } from './eventArt';
import { nocLive, sparkPoints } from './nocLive';

/**
 * Telas vivas da Sala da TI (videowall e estacao de frente a ele): desenham os numeros reais de `nocLive` (pessoas online e
 * temperatura) em pixel art. So rodam quando o desenho e refeito (a cada ~30 s, quando o digest muda), nunca por quadro.
 */

export type LiveKind = 'online' | 'temp' | 'bars' | 'numbers';

const CYAN = '#35d8ff';
const CYAN_DK = '#1a8fb5';
const AMBER = '#ffb347';
const GRID = '#10233a';

/** Linha com area e ponto final de `values` na caixa (a0..a1 x z0..z1); `hot` pinta em ambar. */
function lineBox(p: Plane, a0: number, a1: number, z0: number, z1: number, values: readonly number[], hot: boolean, ph: number, S: (c: string) => string) {
  for (let a = a0 + 3; a < a1 - 1; a += 6) p.rect(a, a + 1, z0 + 1, z1 - 1, S(GRID));
  for (let z = z0 + 3; z < z1 - 1; z += 6) p.rect(a0 + 1, a1 - 1, z, z + 1, S(GRID));
  const w = Math.max(2, a1 - a0 - 4);
  const h = Math.max(2, z1 - z0 - 5);
  const pts = sparkPoints(values, w, h);
  const line = hot ? AMBER : CYAN;
  let prev: [number, number] | null = null;
  for (const [x, y] of pts) {
    const a = a0 + 2 + x;
    const z = z0 + 2 + y;
    p.rect(a, a + 1, z0 + 2, z, S(hot ? '#3a2a12' : '#0c2c3e'));
    if (prev) p.line(prev[0], prev[1], a, z, S(line));
    else p.px(a, z, S(line));
    prev = [a, z];
  }
  if (prev && ph === 1) p.rect(prev[0] - 1, prev[0] + 2, prev[1] - 1, prev[1] + 2, S('#e9fcff'));
}

const fmtTemp = (t: number) => `${Math.round(t)}C`;

/** Desenha uma tela viva. `kind` escolhe a serie; sem amostra ainda, mostra a linha de espera. */
export function liveScreen(p: Plane, a0: number, a1: number, z0: number, z1: number, kind: LiveKind, ph: number, S: (c: string) => string) {
  p.rect(a0, a1, z0, z1, S('#07101e'));
  const people = nocLive.online.values();
  const temps = nocLive.temp.values();
  const curP = nocLive.online.last();
  const curT = nocLive.temp.last();
  const small = a1 - a0 < 40 || z1 - z0 < 20;
  if (kind === 'online') {
    lineBox(p, a0, a1, z0, z1, people, false, ph, S);
    if (!small && curP !== null) wallText(p, a1 - 4 - String(Math.round(curP)).length * 4, z1 - 8, String(Math.round(curP)), S('#e9fcff'), 1);
  } else if (kind === 'temp') {
    const hot = curT !== null && curT >= 30;
    lineBox(p, a0, a1, z0, z1, temps, hot, ph, S);
    if (!small && curT !== null) wallText(p, a1 - 4 - fmtTemp(curT).length * 4, z1 - 8, fmtTemp(curT), S(hot ? AMBER : '#e9fcff'), 1);
  } else if (kind === 'bars') {
    const n = Math.max(3, Math.floor((a1 - a0 - 3) / 3));
    const vals = people.slice(-n);
    const pts = sparkPoints(vals.length ? vals : [0], Math.max(2, n), z1 - z0 - 4);
    vals.forEach((_, i) => {
      const a = a0 + 2 + i * 3;
      const top = z0 + 2 + (pts[i]?.[1] ?? 0);
      p.rect(a, a + 2, z0 + 2, top + 1, S(i === vals.length - 1 ? CYAN : CYAN_DK));
    });
  } else {
    // numeros grandes: pessoas e temperatura
    wallText(p, a0 + 3, z1 - 9, 'ON', S('#8fdcf0'), 1);
    wallText(p, a0 + 3, z1 - 18, curP === null ? '--' : String(Math.round(curP)), S('#e9fcff'), 2);
    if (curT !== null) wallText(p, a0 + 3, z0 + 3, fmtTemp(curT), S(curT >= 30 ? AMBER : CYAN), 1);
  }
  p.rect(a0, a0 + 1, z0, z1, 'rgba(255,255,255,0.07)');
  p.rect(a0, a1, z1 - 1, z1, 'rgba(255,255,255,0.08)');
}
