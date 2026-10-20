import { describe, expect, it } from 'vitest';
import { STEP_MS } from '@workverse/shared';
import { PET_FRAMES, hasBackPose } from '../src/game/petArt';
import { BEAT_MS, PetWalker, beatLook, blinking, clampMenu, frameFor, petBox, poseFor, shouldSendPlay } from '../src/game/petLogic';

describe('PetWalker', () => {
  it('anda um tile por STEP_MS e vira para o lado certo', () => {
    const w = new PetWalker(2, 2);
    w.setPath({ x: 2, y: 2 }, [{ x: 3, y: 2 }, { x: 3, y: 3 }]);
    expect(w.moving()).toBe(true);
    w.update(STEP_MS / 2);
    expect(w.tx).toBeCloseTo(2.5, 5);
    expect(w.dir).toBe(0); // +x
    w.update(STEP_MS / 2 + 1);
    expect(w.tx).toBeCloseTo(3, 1);
    w.update(STEP_MS * 2);
    expect(w.moving()).toBe(false);
    expect([w.tx, w.ty]).toEqual([3, 3]);
    expect(w.dir).toBe(2); // +y
  });

  it('um caminho distante do ponto atual teleporta para o inicio (sincroniza com o servidor)', () => {
    const w = new PetWalker(0, 0);
    w.setPath({ x: 5, y: 5 }, [{ x: 6, y: 5 }]);
    w.update(STEP_MS * 2);
    expect([w.tx, w.ty]).toEqual([6, 5]);
  });

  it('um caminho novo continua do ponto atual sem pulo', () => {
    const w = new PetWalker(1, 1);
    w.setPath({ x: 1, y: 1 }, [{ x: 2, y: 1 }, { x: 3, y: 1 }]);
    w.update(STEP_MS * 0.5);
    w.setPath({ x: 2, y: 1 }, [{ x: 2, y: 2 }]);
    w.update(STEP_MS * 3);
    expect([w.tx, w.ty]).toEqual([2, 2]);
  });
});

describe('quadros', () => {
  it('poseFor: andar de verdade manda; walk do servidor sem movimento vira parado', () => {
    expect(poseFor('walk', true)).toBe('walk');
    expect(poseFor('walk', false)).toBe('idle');
    expect(poseFor('sleep', false)).toBe('sleep');
    expect(poseFor('sit', true)).toBe('walk');
  });

  it('frameFor usa costas so nas posturas que existem de costas e espelha SE/NE', () => {
    // dir 6 = nordeste (costas, espelhado); dir 4 = noroeste (costas, normal)
    expect(frameFor('idle', 6, 0)).toMatchObject({ flip: true, name: expect.stringMatching(/^back:idle:/) });
    expect(frameFor('walk', 4, 0)).toMatchObject({ flip: false, name: expect.stringMatching(/^back:walk:/) });
    expect(frameFor('idle', 2, 0)).toMatchObject({ flip: false, name: expect.stringMatching(/^front:idle:/) });
    expect(frameFor('idle', 0, 0)).toMatchObject({ flip: true });
    // dormir/comer/feliz nao tem costas: sempre de frente
    for (const pose of ['sleep', 'eat', 'happy'] as const) {
      expect(hasBackPose(pose)).toBe(false);
      expect(frameFor(pose, 6, 500).name).toMatch(/^front:/);
    }
  });

  it('todo quadro pedido existe na folha (nenhum indice sai da contagem)', () => {
    for (const pose of ['idle', 'walk', 'sit', 'sleep', 'happy', 'eat'] as const) {
      for (let dir = 0; dir < 8; dir++) {
        for (let t = 0; t < 20_000; t += 137) {
          const f = frameFor(pose, dir as never, t, 0.3);
          const [side, p, i] = f.name.split(':');
          expect(p).toBe(pose);
          expect(Number(i)).toBeLessThan(PET_FRAMES[side as 'front' | 'back'][pose]!);
        }
      }
    }
  });

  it('o piscar e curto e periodico', () => {
    expect(blinking(0)).toBe(true);
    expect(blinking(500)).toBe(false);
    expect(blinking(3600 + 50)).toBe(true);
  });
});

describe('batida de coracao', () => {
  it('discreta: pulso pequeno, LED aceso so no comeco, e some depois de ~1 s', () => {
    expect(beatLook(-5)).toEqual({ scale: 1, led: false, ring: null, heart: null });
    expect(beatLook(BEAT_MS + 1).ring).toBeNull();
    let max = 1;
    for (let a = 0; a < BEAT_MS; a += 10) max = Math.max(max, beatLook(a).scale);
    expect(max).toBeGreaterThan(1.05);
    expect(max).toBeLessThan(1.2);
    expect(beatLook(100).led).toBe(true);
    expect(beatLook(900).led).toBe(false);
  });
});

describe('menu e brincar', () => {
  it('clampMenu mantem o menu na janela', () => {
    expect(clampMenu(10, 10, 190, 196, 1000, 800)).toEqual({ left: 16, top: 16 });
    expect(clampMenu(990, 790, 190, 196, 1000, 800)).toEqual({ left: 802, top: 596 });
    expect(clampMenu(-50, -50, 190, 196, 1000, 800)).toEqual({ left: 8, top: 8 });
  });

  it('shouldSendPlay limita a taxa e ignora o mesmo tile', () => {
    expect(shouldSendPlay(null, 0, 1, 1)).toBe(true);
    expect(shouldSendPlay({ at: 0, x: 1, y: 1 }, 500, 2, 2)).toBe(false);
    expect(shouldSendPlay({ at: 0, x: 1, y: 1 }, 1000, 1, 1)).toBe(false);
    expect(shouldSendPlay({ at: 0, x: 1, y: 1 }, 1000, 2, 1)).toBe(true);
  });

  it('petBox: sentado num assento fica acima do chao; dormindo e mais baixo', () => {
    expect(petBox(3, 3, 'idle', false).z0).toBe(0);
    expect(petBox(3, 3, 'sit', true).z0).toBeGreaterThan(0);
    expect(petBox(3, 3, 'sleep', false).z1).toBeLessThan(petBox(3, 3, 'idle', false).z1);
  });
});
