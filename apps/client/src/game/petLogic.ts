import { STEP_MS, dirFromDelta, petFacing, petViewOf, type Dir8, type PetState, type Point } from '@workverse/shared';
import { PET_FRAMES, hasBackPose, petFrameName, type PetPose, type PetSide } from './petArt';

/** Logica pura do Byte no cliente (sem Phaser): caminhada, escolha do quadro, batida de coracao, menu. Testada em test/pet-logic.test.ts. */

/** Anda ao longo do caminho que o servidor mandou, no mesmo ritmo (STEP_MS por tile) dos jogadores. */
export class PetWalker {
  tx: number;
  ty: number;
  dir: Dir8 = 2;
  private queue: Point[] = [];
  private seg: { fx: number; fy: number; to: Point; t: number } | null = null;

  constructor(x: number, y: number, dir: Dir8 = 2) {
    this.tx = x;
    this.ty = y;
    this.dir = dir;
  }

  moving() {
    return this.seg !== null || this.queue.length > 0;
  }

  snap(x: number, y: number) {
    this.tx = x;
    this.ty = y;
    this.seg = null;
    this.queue = [];
  }

  /** Novo caminho: `from` e o tile logico do servidor; continua do ponto atual se ele esta no caminho. */
  setPath(from: Point, path: Point[]) {
    const q: Point[] = [from, ...path];
    const cur: Point = this.seg ? this.seg.to : { x: Math.round(this.tx), y: Math.round(this.ty) };
    while (q.length && q[0]!.x === cur.x && q[0]!.y === cur.y) q.shift();
    if (q.length && (Math.abs(q[0]!.x - cur.x) > 1 || Math.abs(q[0]!.y - cur.y) > 1)) {
      this.snap(from.x, from.y);
      q.splice(0, q.length, ...path);
    }
    this.queue = q;
  }

  update(dt: number) {
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
  }
}

/** Postura desenhada: andando de verdade manda; o estado `walk` do servidor sem movimento vira parado. */
export function poseFor(state: PetState, moving: boolean): PetPose {
  if (moving) return 'walk';
  return state === 'walk' ? 'idle' : state;
}

/** Pisca por ~140 ms a cada ~3,6 s, com fase diferente por pet. */
export function blinking(clockMs: number, seed = 0): boolean {
  const period = 3600;
  return (clockMs + seed * 1700) % period < 140;
}

export interface PetFrame {
  side: PetSide;
  flip: boolean;
  name: string;
}

/** Quadro (vista de frente/costas, espelho e nome) para uma postura, direcao e tempo. */
export function frameFor(pose: PetPose, dir: Dir8, clockMs: number, seed = 0): PetFrame {
  const v = petViewOf(petFacing(dir));
  // sentado/dormindo/comendo/feliz de costas: so a vista de frente existe para sono, alegria e comida
  const side: PetSide = v.back && hasBackPose(pose) ? 'back' : 'front';
  const n = PET_FRAMES[side][pose]!;
  let i = 0;
  if (pose === 'walk') i = Math.floor(clockMs / (STEP_MS / n)) % n;
  else if (pose === 'happy') i = Math.floor(clockMs / 180) % n;
  else if (pose === 'eat') i = Math.floor(clockMs / 260) % n;
  else if (pose === 'sleep') i = Math.floor(clockMs / 1600) % n;
  else {
    i = Math.floor(clockMs / 1100) % 2; // respirar
    if (side === 'front' && n >= 3 && blinking(clockMs, seed)) i = 2;
  }
  return { side, flip: v.flip, name: petFrameName(side, pose, i) };
}

// ---- batida de coracao (autoping) -----------------------------------------------------------------------------

export const BEAT_MS = 1100;

export interface BeatLook {
  /** Escala do corpo (pulso "lub-dub"). */
  scale: number;
  /** LEDs acesos. */
  led: boolean;
  /** Anel que se expande no chao (0..1) ou null. */
  ring: number | null;
  /** Coracaozinho ciano acima da cabeca (0..1) ou null. */
  heart: number | null;
}

/** Duas pulsacoes curtas (lub-dub) e um anel suave; discreto, ~1 s. `age` em ms desde a batida. */
export function beatLook(age: number): BeatLook {
  if (age < 0 || age >= BEAT_MS) return { scale: 1, led: false, ring: null, heart: null };
  const pulse = (a: number, w: number) => (a >= 0 && a < w ? Math.sin((a / w) * Math.PI) : 0);
  const k = pulse(age, 220) * 0.1 + pulse(age - 260, 260) * 0.14;
  return { scale: 1 + k, led: age < 620, ring: age / BEAT_MS, heart: age / BEAT_MS };
}

// ---- brincar: ponteiro ------------------------------------------------------------------------------------------

/** Envia a posicao do ponteiro no maximo a cada `gapMs` e so se mudou de tile (o servidor limita de qualquer jeito). */
export function shouldSendPlay(last: { at: number; x: number; y: number } | null, now: number, x: number, y: number, gapMs = 900): boolean {
  if (!last) return true;
  return now - last.at >= gapMs && (last.x !== x || last.y !== y);
}

// ---- menu ---------------------------------------------------------------------------------------------------------

/** Mantem o menu dentro da janela (com folga), preferindo abrir para baixo/direita do clique. */
export function clampMenu(x: number, y: number, w: number, h: number, vw: number, vh: number, pad = 8): { left: number; top: number } {
  const left = Math.max(pad, Math.min(x + 6, vw - w - pad));
  const top = Math.max(pad, Math.min(y + 6, vh - h - pad));
  return { left, top };
}

/** Caixa (em tiles/alturas) para ordenar o Byte entre moveis e pessoas. Sentado num assento fica um pouco acima do chao. */
export function petBox(tx: number, ty: number, pose: PetPose, onSeat: boolean) {
  const cx = tx + 0.5;
  const cy = ty + 0.5;
  const r = pose === 'sleep' ? 0.22 : 0.16;
  const z0 = onSeat ? 10 : 0;
  return { x0: cx - r, y0: cy - r, x1: cx + r, y1: cy + r, z0, z1: z0 + (pose === 'sleep' ? 12 : 26) };
}
