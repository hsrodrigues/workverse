import { describe, expect, it } from 'vitest';
import {
  areaPath,
  barFractions,
  extent,
  formatAgo,
  formatInt,
  formatPercent,
  formatTemp,
  formatUptimeShort,
  gaugeArc,
  gaugeFraction,
  lastPoint,
  linePath,
  linearScale,
  niceAxis,
  niceStep,
  seriesPoints,
  tempZone,
  timeTicks,
} from '../src/ui/noc/nocLogic';
import { LiveSeries, nocLive, sparkPoints } from '../src/game/nocLive';

describe('escalas e ticks', () => {
  it('niceStep usa 1, 2, 5 x 10^n', () => {
    expect(niceStep(10, 5)).toBe(2);
    expect(niceStep(100, 4)).toBe(50);
    expect(niceStep(7, 4)).toBe(2);
    expect(niceStep(0, 4)).toBe(1);
  });
  it('niceAxis arredonda o dominio e gera ticks regulares; floorZero ancora em 0', () => {
    const a = niceAxis(21.3, 26.8, 4);
    expect(a.domain.min).toBeLessThanOrEqual(21.3);
    expect(a.domain.max).toBeGreaterThanOrEqual(26.8);
    const steps = a.ticks.slice(1).map((t, i) => Math.round((t - a.ticks[i]!) * 100) / 100);
    expect(new Set(steps).size).toBe(1);
    const c = niceAxis(2, 9, 4, true);
    expect(c.domain.min).toBe(0);
    expect(c.ticks[0]).toBe(0);
  });
  it('serie constante nao gera dominio vazio', () => {
    const a = niceAxis(5, 5, 4, true);
    expect(a.domain.max).toBeGreaterThan(a.domain.min);
    const b = niceAxis(24, 24, 4);
    expect(b.domain.max - b.domain.min).toBeGreaterThan(0);
  });
  it('linearScale mapeia e permite contra-dominio invertido (eixo Y do SVG)', () => {
    const s = linearScale({ min: 0, max: 10 }, 100, 0);
    expect(s(0)).toBe(100);
    expect(s(10)).toBe(0);
    expect(s(5)).toBe(50);
  });
  it('extent ignora null e devolve null sem dados', () => {
    expect(extent([[1, null, 5], [3]])).toEqual({ min: 1, max: 5 });
    expect(extent([[null], []])).toBeNull();
  });
});

describe('caminhos SVG', () => {
  const box = { x: 0, y: 0, w: 100, h: 50 };
  const dom = { min: 0, max: 10 };
  it('seriesPoints: primeiro no x=0, ultimo no x=w, valor maximo no topo; null vira lacuna', () => {
    const p = seriesPoints([0, null, 10], box, dom);
    expect(p[0]).toEqual([0, 50]);
    expect(p[1]).toBeNull();
    expect(p[2]).toEqual([100, 0]);
    expect(seriesPoints([5], box, dom)[0]![0]).toBe(50);
  });
  it('linePath quebra o traco nas lacunas e faz degraus quando pedido', () => {
    const p = seriesPoints([1, 2, null, 4], box, dom);
    expect(linePath(p).match(/M/g)).toHaveLength(2);
    expect(linePath(p, true)).toContain('L');
    expect(linePath([null, null])).toBe('');
  });
  it('areaPath fecha um poligono por trecho contiguo', () => {
    const p = seriesPoints([1, 2, null, 4, 5], box, dom);
    const d = areaPath(p, 50);
    expect(d.match(/Z/g)).toHaveLength(2);
    expect(areaPath([], 50)).toBe('');
  });
  it('lastPoint acha o ultimo valido', () => {
    expect(lastPoint(seriesPoints([1, 2, null], box, dom))).toEqual([50, 40]);
    expect(lastPoint([null])).toBeNull();
  });
});

describe('eixo de tempo e formatacao', () => {
  it('formatAgo', () => {
    expect(formatAgo(0)).toBe('agora');
    expect(formatAgo(5 * 60_000)).toBe('-5 min');
    expect(formatAgo(60 * 60_000)).toBe('-1 h');
    expect(formatAgo(90 * 60_000)).toBe('-1 h 30');
  });
  it('timeTicks: o ultimo e "agora" na posicao 1 e as posicoes crescem', () => {
    const t = timeTicks(15 * 60_000, 4);
    expect(t[t.length - 1]).toEqual({ at: 1, label: 'agora' });
    for (let i = 1; i < t.length; i++) expect(t[i]!.at).toBeGreaterThan(t[i - 1]!.at);
    expect(t[0]!.at).toBeGreaterThanOrEqual(0);
    expect(timeTicks(0)).toEqual([{ at: 1, label: 'agora' }]);
    expect(timeTicks(6 * 3600_000, 4).length).toBeGreaterThanOrEqual(3);
  });
  it('numeros em pt-BR', () => {
    expect(formatTemp(24.46)).toBe('24,5 °C');
    expect(formatPercent(70)).toBe('70%');
    expect(formatPercent(70.55)).toBe('70,6%');
    expect(formatInt(1234)).toMatch(/^1[.\s ]?234$/);
    expect(formatUptimeShort(45)).toBe('45 s');
    expect(formatUptimeShort(3725)).toBe('1 h 02 min');
    expect(formatUptimeShort(90_000)).toBe('1 d 1 h');
  });
});

describe('gauge e barras', () => {
  it('gaugeFraction limita a 0..1', () => {
    expect(gaugeFraction(0)).toBe(0);
    expect(gaugeFraction(100)).toBe(1);
    expect(gaugeFraction(26)).toBeCloseTo(0.5, 5);
  });
  it('gaugeArc devolve um arco, vazio se nao ha extensao, e usa o flag de arco grande acima de 180 graus', () => {
    expect(gaugeArc(50, 50, 40, 0.3, 0.3)).toBe('');
    expect(gaugeArc(50, 50, 40, 0, 1)).toMatch(/^M[\d.\- ]+A40 40 0 1 1 /);
    expect(gaugeArc(50, 50, 40, 0, 0.2)).toMatch(/A40 40 0 0 1 /);
  });
  it('tempZone: normal, quente e superaquecimento', () => {
    expect(tempZone(23, 22, true)).toBe('ok');
    expect(tempZone(26, 22, true)).toBe('warm');
    expect(tempZone(27, 22, false)).toBe('ok');
    expect(tempZone(28.5, 22, false)).toBe('warm');
    expect(tempZone(30, 22, true)).toBe('hot');
  });
  it('barFractions: proporcional ao maior, e quem tem gente sempre aparece', () => {
    expect(barFractions([10, 5, 0])).toEqual([1, 0.5, 0]);
    expect(barFractions([1000, 1])[1]).toBeGreaterThan(0);
    expect(barFractions([])).toEqual([]);
  });
});

describe('sparklines vivas do mundo (nocLive)', () => {
  it('LiveSeries guarda so as ultimas N amostras e mantem a versao so quando muda', () => {
    const s = new LiveSeries(4);
    const v0 = s.version;
    for (let i = 1; i <= 6; i++) s.push(i);
    expect(s.values()).toEqual([3, 4, 5, 6]);
    expect(s.version).not.toBe(v0);
    const v1 = s.version;
    s.push(6);
    s.push(6);
    s.push(6);
    s.push(6);
    // 4 valores iguais empurraram todos os antigos: a forma mudou uma vez e depois fica estavel
    const v2 = s.version;
    s.push(6);
    expect(s.version).toBe(v2);
    expect(v2).not.toBe(v1);
  });
  it('sparkPoints escala para a caixa e centraliza series constantes ou de um ponto', () => {
    const p = sparkPoints([0, 5, 10], 21, 11);
    expect(p).toEqual([[0, 0], [10, 5], [20, 10]]);
    expect(sparkPoints([3, 3, 3], 21, 11).every((q) => q[1] === 5)).toBe(true);
    expect(sparkPoints([], 21, 11)).toEqual([]);
    expect(sparkPoints([7], 21, 11)).toEqual([[10, 5]]);
  });
});

describe('nocLive.observe: usa so o que o cliente ja recebe', () => {
  it('soma a populacao visivel e le a temperatura do clima; a primeira leitura ja vira amostra', () => {
    const before = nocLive.online.length;
    nocLive.observe({ t: 'population', population: { office: 3, ti: 2 } });
    nocLive.observe({ t: 'climate', on: true, target: 22, temp: 24.46, overheat: false, mode: 'cool', fan: 'auto', swing: true, timerLeftMs: 0 });
    expect(nocLive.online.last()).toBeGreaterThanOrEqual(0);
    expect(nocLive.online.length).toBeGreaterThanOrEqual(Math.min(1, before + 1));
    nocLive.commit();
    expect(nocLive.online.last()).toBe(5);
    expect(nocLive.temp.last()).toBe(24.5);
    expect(nocLive.opt()).toBeGreaterThanOrEqual(1_000_000);
  });
});
