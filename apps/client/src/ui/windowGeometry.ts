/** Geometria pura das janelas arrastáveis (sem DOM, testável em node). */

export interface Pos {
  x: number;
  y: number;
}
export interface Size {
  w: number;
  h: number;
}

/** Limita a posição à viewport: a janela fica inteira visível; se for maior que a tela, fica no topo/esquerda (barra de título sempre à mostra). */
export function clampPos(p: Pos, size: Size, vw: number, vh: number): Pos {
  const maxX = Math.max(0, vw - size.w);
  const maxY = Math.max(0, vh - size.h);
  return { x: Math.round(Math.min(Math.max(0, p.x), maxX)), y: Math.round(Math.min(Math.max(0, p.y), maxY)) };
}

/** Lê uma posição salva; qualquer coisa inválida vira null. */
export function parsePos(raw: string | null): Pos | null {
  if (!raw) return null;
  try {
    const v: unknown = JSON.parse(raw);
    if (v && typeof v === 'object') {
      const { x, y } = v as Record<string, unknown>;
      if (typeof x === 'number' && typeof y === 'number' && Number.isFinite(x) && Number.isFinite(y)) return { x, y };
    }
  } catch {
    /* ignora */
  }
  return null;
}
