import { describe, expect, it } from 'vitest';
import { clampPos, parsePos } from '../src/ui/windowGeometry';

describe('clampPos', () => {
  const size = { w: 300, h: 400 };
  it('mantém posições válidas', () => {
    expect(clampPos({ x: 100, y: 50 }, size, 1280, 800)).toEqual({ x: 100, y: 50 });
  });
  it('não deixa sair pela esquerda/topo', () => {
    expect(clampPos({ x: -500, y: -20 }, size, 1280, 800)).toEqual({ x: 0, y: 0 });
  });
  it('não deixa sair pela direita', () => {
    expect(clampPos({ x: 5000, y: 0 }, size, 1280, 800).x).toBe(980);
  });
  it('não deixa sair por baixo: a janela inteira fica na tela', () => {
    expect(clampPos({ x: 0, y: 5000 }, size, 1280, 800).y).toBe(400);
  });
  it('janela mais alta que a tela fica no topo, com a barra de título visível', () => {
    expect(clampPos({ x: 0, y: 300 }, { w: 300, h: 900 }, 1280, 800).y).toBe(0);
  });
  it('janela maior que a tela fica em 0', () => {
    expect(clampPos({ x: 200, y: 10 }, { w: 2000, h: 400 }, 1280, 800).x).toBe(0);
  });
});

describe('parsePos', () => {
  it('lê json válido', () => expect(parsePos('{"x":10,"y":20}')).toEqual({ x: 10, y: 20 }));
  it('rejeita lixo', () => {
    expect(parsePos(null)).toBeNull();
    expect(parsePos('nope')).toBeNull();
    expect(parsePos('{"x":"a","y":1}')).toBeNull();
    expect(parsePos('{"x":null,"y":1}')).toBeNull();
  });
});
