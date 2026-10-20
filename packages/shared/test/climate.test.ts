import { describe, expect, it } from 'vitest';
import {
  formatCountdown,
  parseClimateSet,
  isCooling,
  effectiveTarget,
  BASE_TEMP,
  FURNI_KINDS,
  KIND_ROOM_TYPES,
  OVERHEAT_TEMP,
  ROOM_DEFS,
  TARGET_MAX,
  TARGET_MIN,
  categoryOf,
  checkOps,
  equilibriumTemp,
  isAcUnit,
  newPieceId,
  overheating,
  stepTemperature,
  validateLayout,
  type Furniture,
  type FurniKind,
} from '../src';

const office = ROOM_DEFS.find((r) => r.id === 'office')!;
const ti = ROOM_DEFS.find((r) => r.id === 'ti')!;
const piece = (kind: FurniKind, x: number, y: number, dir = 0): Furniture => ({ id: newPieceId(), kind, x, y, dir });

describe('catálogo do ar-condicionado e do console', () => {
  it('split e termostato são peças de parede usáveis que não bloqueiam; a torre e o console bloqueiam', () => {
    expect(FURNI_KINDS.ac_split).toMatchObject({ w: 2, d: 1, wall: true, usable: true, blocks: false });
    expect(FURNI_KINDS.thermostat).toMatchObject({ wall: true, usable: true, blocks: false });
    expect(FURNI_KINDS.ac_floor).toMatchObject({ usable: true, blocks: true });
    expect(FURNI_KINDS.noc_console).toMatchObject({ usable: true, blocks: true });
    expect(FURNI_KINDS.server_rack.usable).toBe(true);
  });

  it('entram no editor: categoria Clima, console só na Sala da TI', () => {
    for (const k of ['ac_split', 'ac_floor', 'thermostat'] as const) expect(categoryOf(k)).toBe('climate');
    expect(KIND_ROOM_TYPES.noc_console).toEqual(['it']);
    const r = checkOps(office, office.furniture, [{ op: 'add', piece: piece('noc_console', 12, 9) }]);
    expect(r.errors.map((e) => e.code)).toContain('room_type');
    expect(checkOps(ti, ti.furniture, [{ op: 'add', piece: piece('noc_console', 6, 9) }]).ok).toBe(true);
  });

  it('o split de parede não pode ficar no meio da sala nem sobre a porta', () => {
    expect(checkOps(office, office.furniture, [{ op: 'add', piece: piece('ac_split', 5, 5) }]).errors.map((e) => e.code)).toContain('wall_only');
    expect(checkOps(office, office.furniture, [{ op: 'add', piece: piece('thermostat', 7, 0) }]).errors.map((e) => e.code)).toContain('wall_covers_door');
  });

  it('as salas padrão continuam válidas e cada split fica numa parede, longe das portas', () => {
    for (const def of ROOM_DEFS) {
      const r = validateLayout(def, def.furniture, { noWarnings: true });
      expect(r.errors, def.id).toEqual([]);
      for (const f of def.furniture.filter((x) => x.kind === 'ac_split' || x.kind === 'thermostat')) {
        expect((f.dir % 2 === 0 ? f.y : f.x) === 0, `${def.id}/${f.id}`).toBe(true);
        const w = f.kind === 'ac_split' ? 2 : 1;
        for (let i = 0; i < w; i++) {
          const x = f.dir % 2 === 0 ? f.x + i : f.x;
          const y = f.dir % 2 === 0 ? f.y : f.y + i;
          expect(def.portals.some((p) => p.x === x && p.y === y), `${def.id} porta`).toBe(false);
        }
      }
    }
  });
});

describe('controle remoto: validação do climate_set', () => {
  it('aceita campos válidos e devolve só o pedido limpo', () => {
    expect(parseClimateSet({ t: 'climate_set', power: true, target: 22, mode: 'eco', fan: 'high', swing: false, timerMin: 60 })).toEqual({ power: true, target: 22, mode: 'eco', fan: 'high', swing: false, timerMin: 60 });
    expect(parseClimateSet({ t: 'climate_set', target: TARGET_MIN })).toEqual({ target: 18 });
    expect(parseClimateSet({ t: 'climate_set', timerMin: 0 })).toEqual({ timerMin: 0 });
  });

  it('recusa vazio, fora dos limites, tipos errados e campos desconhecidos', () => {
    const bad: unknown[] = [null, 'x', {}, { t: 'climate_set' }, { target: 17 }, { target: 27 }, { target: 22.5 }, { target: '22' }, { target: NaN }, { mode: 'heat' }, { fan: 'turbo' }, { swing: 1 }, { power: 'yes' }, { timerMin: 45 }, { timerMin: -1 }, { power: true, extra: 1 }, { __proto__: { power: true } }];
    for (const b of bad) expect(parseClimateSet(b), JSON.stringify(b)).toBeNull();
  });

  it('modo Ventilar não esfria; Eco usa meta +2; contagem do timer', () => {
    expect(isCooling(true, 'fan')).toBe(false);
    expect(isCooling(true, 'cool') && isCooling(true, 'eco') && isCooling(true, 'auto')).toBe(true);
    expect(isCooling(false, 'cool')).toBe(false);
    expect(effectiveTarget('eco', 22)).toBe(24);
    expect(effectiveTarget('cool', 22)).toBe(22);
    expect(formatCountdown(29 * 60_000 + 12_000)).toBe('29:12');
    expect(formatCountdown(3_600_000)).toBe('1:00:00');
    expect(formatCountdown(-5)).toBe('0:00');
  });
});

describe('simulação da temperatura', () => {
  const units = { ac_split: 2, ac_floor: 1 };
  it('equilíbrio: base + pessoas + racks; a Sala da TI passa do limite sem ar', () => {
    expect(equilibriumTemp(0, 0)).toBe(BASE_TEMP);
    expect(equilibriumTemp(10, 0)).toBeGreaterThan(equilibriumTemp(2, 0));
    const racks = ti.furniture.filter((f) => f.kind === 'server_rack').length;
    expect(equilibriumTemp(0, racks)).toBeGreaterThan(OVERHEAT_TEMP);
    expect(equilibriumTemp(0, 0)).toBeLessThan(OVERHEAT_TEMP);
  });

  it('esfria até a meta e para nela; sem ar tende ao equilíbrio', () => {
    let t = 31;
    for (let i = 0; i < 200; i++) t = stepTemperature({ temp: t, people: 0, racks: 10, on: true, target: 22, units });
    expect(t).toBeCloseTo(22, 1);
    for (let i = 0; i < 300; i++) t = stepTemperature({ temp: t, people: 0, racks: 10, on: false, target: 22, units });
    expect(t).toBeCloseTo(equilibriumTemp(0, 10), 0);
    expect(isAcUnit('ac_split') && isAcUnit('ac_floor') && !isAcUnit('thermostat')).toBe(true);
  });

  it('modos: Ventilar não esfria, Eco para 2 graus acima e é mais lento, ventilador alto esfria mais rápido', () => {
    const run = (mode: 'cool' | 'eco' | 'fan', fan: 'low' | 'high', n: number) => {
      let t = 28;
      for (let i = 0; i < n; i++) t = stepTemperature({ temp: t, people: 0, racks: 0, on: true, target: 22, mode, fan, units });
      return t;
    };
    expect(run('fan', 'high', 50)).toBeGreaterThan(23.9);
    expect(run('eco', 'high', 200)).toBeCloseTo(24, 1);
    expect(run('cool', 'high', 200)).toBeCloseTo(22, 1);
    expect(run('cool', 'high', 3)).toBeLessThan(run('cool', 'low', 3));
    expect(run('eco', 'high', 3)).toBeGreaterThan(run('cool', 'high', 3));
  });

  it('superaquecimento tem histerese e só vale com racks e ar desligado', () => {
    expect(overheating(false, 30.5, 10, false)).toBe(true);
    expect(overheating(false, 29.5, 10, false)).toBe(false);
    expect(overheating(true, 29.5, 10, false)).toBe(true);
    expect(overheating(true, 28.5, 10, false)).toBe(false);
    expect(overheating(false, 35, 0, false)).toBe(false);
    expect(overheating(true, 35, 10, true)).toBe(false);
  });
});
