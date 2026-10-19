import { describe, expect, it } from 'vitest';
import { FURNI_HOLDS, ITEMS, ROOM_DEFS, accessOf, activeEvents, auditRoomLayout, buildRoom, deptUnlockKeyOf, describeUnlock, findPath, FURNI_KINDS, footprintTiles, getItem, validateLayout } from '../src';

const ti = ROOM_DEFS.find((r) => r.id === 'ti')!;

describe('Sala da TI', () => {
  it('existe, e aberta por padrao, sem visitantes, com porta na recepcao e volta', () => {
    expect(ti.type).toBe('it');
    expect(ti.access).toBe('org');
    expect(ti.guestAllowed).toBeFalsy();
    const reception = ROOM_DEFS.find((r) => r.id === 'reception')!;
    expect(reception.portals.some((p) => p.toRoom === 'ti')).toBe(true);
    expect(ti.portals.some((p) => p.toRoom === 'reception')).toBe(true);
    expect(ROOM_DEFS.length).toBe(10);
  });

  it('tem racks, mesa de comando em ferradura, videowall, bancada, cafe premium e interruptor', () => {
    const count = (k: string) => ti.furniture.filter((f) => f.kind === k).length;
    expect(count('server_rack')).toBeGreaterThanOrEqual(8);
    expect(count('command_desk')).toBe(3);
    expect(count('ergo_chair')).toBeGreaterThanOrEqual(3);
    for (const k of ['videowall', 'arch_board', 'hardware_bench', 'espresso', 'light_switch']) expect(count(k), k).toBe(1);
    expect(FURNI_HOLDS.espresso).toBe('coffee');
  });

  it('respeita as regras de layout e alcance', () => {
    expect(auditRoomLayout(ti)).toEqual([]);
    const r = validateLayout(ti, ti.furniture);
    expect(r.errors).toEqual([]);
    const room = buildRoom(ti);
    for (const f of ti.furniture.filter((x) => FURNI_KINDS[x.kind].seat)) for (const t of footprintTiles(f)) expect(findPath(room.grid, ti.spawn, t, { allowBlockedGoal: true }), f.id).not.toBeNull();
  });
});

describe('Dia do Profissional de TI e uniforme da TI', () => {
  it('esta ativo de 18 a 20/10 e fora disso nao', () => {
    for (const d of [18, 19, 20]) expect(activeEvents(new Date(2026, 9, d)).map((e) => e.id)).toContain('diati');
    expect(activeEvents(new Date(2026, 9, 17)).map((e) => e.id)).not.toContain('diati');
    expect(activeEvents(new Date(2026, 9, 21)).map((e) => e.id)).not.toContain('diati');
  });

  it('o set ti.* e exclusivo do setor (dept:ti), visivel e bloqueado para os demais', () => {
    const set = ITEMS.filter((i) => i.id.startsWith('ti.'));
    expect(set.length).toBeGreaterThanOrEqual(8);
    expect(getItem('ti.badge')?.slot).toBe('badge');
    for (const i of set) {
      expect(i.unlock).toBe('dept:ti');
      expect(['rare', 'epic']).toContain(i.rarity);
      expect(accessOf(i, { unlocks: new Set() })).toBe('locked');
      expect(accessOf(i, { unlocks: new Set(['dept:ti']) })).toBe('ok');
    }
    expect(describeUnlock('dept:ti')).toBe('Exclusivo do setor TI');
    expect(deptUnlockKeyOf(' Ti ')).toBe('dept:ti');
    expect(deptUnlockKeyOf('Tecnologia da Informação')).toBe('dept:ti');
    expect(deptUnlockKeyOf('Financeiro')).toBeNull();
  });
});
