import { describe, expect, it } from 'vitest';
import { FURNI_KINDS, NOC_CAPACITY, NOC_MAX_POINTS, NOC_SAMPLE_MS, ROOM_DEFS, Ring, downsample, nocStation, parseNocQuery, seriesStats, windowSamples, windowSeries, type Furniture } from '../src';

describe('Ring: anel de tamanho fixo', () => {
  it('guarda em ordem e sobrescreve a mais antiga ao passar da capacidade', () => {
    const r = new Ring(4);
    for (let i = 1; i <= 3; i++) r.push(i);
    expect(r.tail()).toEqual([1, 2, 3]);
    for (let i = 4; i <= 9; i++) r.push(i);
    expect(r.length).toBe(4);
    expect(r.tail()).toEqual([6, 7, 8, 9]);
    expect(r.tail(2)).toEqual([8, 9]);
    expect(r.last()).toBe(9);
  });
  it('vazio: ultimo e NaN e tail e vazio; valores invalidos viram NaN', () => {
    const r = new Ring(3);
    expect(Number.isNaN(r.last())).toBe(true);
    expect(r.tail()).toEqual([]);
    r.push(Infinity);
    expect(Number.isNaN(r.last())).toBe(true);
  });
  it('a capacidade padrao e 6 h de amostras de 30 s', () => {
    expect(NOC_CAPACITY * NOC_SAMPLE_MS).toBe(6 * 3600_000);
    expect(new Ring().capacity).toBe(NOC_CAPACITY);
  });
});

describe('janelas e reducao', () => {
  it('quantas amostras cabem em cada janela', () => {
    expect(windowSamples(15)).toBe(30);
    expect(windowSamples(60)).toBe(120);
    expect(windowSamples(360)).toBe(720);
    expect(windowSamples(15, 500)).toBe(1800);
  });
  it('downsample: mantem series curtas, reduz por media e ignora lacunas', () => {
    expect(downsample([1, 2, Number.NaN])).toEqual([1, 2, null]);
    const long = Array.from({ length: 720 }, (_, i) => i);
    const out = downsample(long);
    expect(out.length).toBe(NOC_MAX_POINTS);
    expect(out[0]).toBeCloseTo(2.5, 5);
    expect(out[NOC_MAX_POINTS - 1]).toBeGreaterThan(710);
    expect(downsample([Number.NaN, Number.NaN, 1, 1], 2)).toEqual([null, 1]);
  });
  it('windowSeries recorta a janela do anel', () => {
    const r = new Ring();
    for (let i = 0; i < 300; i++) r.push(i);
    const w15 = windowSeries(r, 15);
    expect(w15.length).toBe(30);
    expect(w15[29]).toBe(299);
    expect(windowSeries(r, 360).length).toBe(NOC_MAX_POINTS);
  });
  it('seriesStats: minimo, maximo, media e ultimo; null sem dados', () => {
    expect(seriesStats([null, 2, 4, null, 6])).toEqual({ min: 2, max: 6, avg: 4, last: 6 });
    expect(seriesStats([null, null])).toBeNull();
  });
});

describe('parseNocQuery', () => {
  it('aceita so as janelas 15, 60 e 360 e nenhum campo extra', () => {
    expect(parseNocQuery({ t: 'noc_query', window: 15 })).toBe(15);
    expect(parseNocQuery({ t: 'noc_query', window: 360 })).toBe(360);
    for (const bad of [{ t: 'noc_query' }, { t: 'noc_query', window: 30 }, { t: 'noc_query', window: '15' }, { t: 'noc_query', window: 15, extra: 1 }, null, 'x', 7]) {
      expect(parseNocQuery(bad)).toBeNull();
    }
  });
});

describe('nocStation: a estacao de frente ao videowall', () => {
  it('na Sala da TI e a mesa de comando central, abaixo do videowall', () => {
    const ti = ROOM_DEFS.find((r) => r.id === 'ti')!;
    const st = nocStation(ti.furniture)!;
    expect(st).toBeTruthy();
    expect(st.kind).toBe('command_desk');
    const wall = ti.furniture.find((f) => f.kind === 'videowall')!;
    // centrada no videowall (o videowall tem 5 de largura, a mesa 3)
    expect(st.x + 1.5).toBeCloseTo(wall.x + 2.5, 5);
    expect(st.y).toBeGreaterThan(wall.y);
  });
  it('a regra e geometrica: sobrevive a mudanca de layout e de ids', () => {
    const f = (id: string, kind: Furniture['kind'], x: number, y: number, dir = 0): Furniture => ({ id, kind, x, y, dir });
    const wall = f('w', 'videowall', 10, 0);
    const near = f('a', 'command_desk', 11, 6);
    const off = f('b', 'command_desk', 2, 3);
    expect(nocStation([off, near, wall])?.id).toBe('a');
    // um computador solto bem centrado tambem serve, se nao houver mesa de comando melhor
    const pc = f('pc', 'computer', 12, 3);
    expect(nocStation([pc, wall])?.id).toBe('pc');
    // atras do painel (sem estar na frente dele) nao conta; sem videowall nao ha estacao
    expect(nocStation([f('x', 'command_desk', 11, -1), wall])).toBeUndefined();
    expect(nocStation([near])).toBeUndefined();
  });
  it('a mesa de comando e usavel (clicavel) no catalogo', () => {
    expect(FURNI_KINDS.command_desk.usable).toBe(true);
  });
});
