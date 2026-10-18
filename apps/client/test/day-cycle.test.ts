import { describe, expect, it } from 'vitest';
import { dayState, normalizeHour, phaseOf, skySignature, softenTint } from '../src/game/dayCycle';

const lum = (c: readonly number[]) => (c[0] + c[1] + c[2]) / 3;

describe('dayState', () => {
  it('meio-dia: luz neutra, sem lampadas, com feixes de sol e sol no ceu', () => {
    const s = dayState(12);
    expect(s.tint).toEqual([255, 255, 255]);
    expect(s.lights).toBe(0);
    expect(s.beams).toBe(1);
    expect(s.sky.stars).toBe(0);
    expect(s.sky.sun).toBeGreaterThan(0.9);
    expect(s.phase).toBe('dia');
  });
  it('madrugada e noite: azul escuro, luzes acesas, estrelas, sem feixes e nunca preto total', () => {
    for (const h of [0, 3, 22, 23.5]) {
      const s = dayState(h);
      expect(s.lights).toBe(1);
      expect(s.beams).toBe(0);
      expect(s.sky.stars).toBeGreaterThan(0.9);
      expect(s.tint[2]).toBeGreaterThan(s.tint[0]);
      expect(lum(s.tint)).toBeGreaterThan(80);
      expect(lum(s.tint)).toBeLessThan(160);
    }
    expect(dayState(3).sky.moon).toBeGreaterThan(0.9);
  });
  it('amanhecer rosado e entardecer dourado (mais vermelho que azul)', () => {
    expect(dayState(6.2).tint[0]).toBeGreaterThan(dayState(6.2).tint[2]);
    const dusk = dayState(18);
    expect(dusk.tint[0]).toBeGreaterThan(dusk.tint[2] + 40);
    expect(dusk.sky.bottom[0]).toBeGreaterThan(dusk.sky.bottom[2]);
  });
  it('interpola de forma continua (sem saltos) ao longo do dia', () => {
    let prev = dayState(0);
    for (let h = 0.05; h <= 24; h += 0.05) {
      const s = dayState(h);
      for (let i = 0; i < 3; i++) expect(Math.abs(s.tint[i] - prev.tint[i])).toBeLessThan(12);
      expect(Math.abs(s.lights - prev.lights)).toBeLessThan(0.12);
      prev = s;
    }
  });
  it('24h fecha o ciclo em 0h e horas fora da faixa sao normalizadas', () => {
    expect(dayState(24).tint).toEqual(dayState(0).tint);
    expect(normalizeHour(25.5)).toBe(1.5);
    expect(normalizeHour(-1)).toBe(23);
    expect(dayState(NaN).tint).toEqual(dayState(12).tint);
  });
  it('fases por horario', () => {
    expect([2, 6, 12, 18, 20, 22].map(phaseOf)).toEqual(['madrugada', 'amanhecer', 'dia', 'entardecer', 'anoitecer', 'noite']);
  });
  it('lampadas acendem ao entardecer e apagam de manha', () => {
    expect(dayState(17.9).lights).toBeGreaterThan(0.1);
    expect(dayState(19.5).lights).toBeGreaterThan(dayState(17.9).lights);
    expect(dayState(9).lights).toBe(0);
  });
  it('salas sem janela recebem tom mais suave e a assinatura do ceu so muda quando visivel', () => {
    const t = dayState(23).tint;
    expect(lum(softenTint(t))).toBeGreaterThan(lum(t));
    expect(skySignature(dayState(22.5).sky)).toBe(skySignature(dayState(22.6).sky));
    expect(skySignature(dayState(12).sky)).not.toBe(skySignature(dayState(23).sky));
  });
});
