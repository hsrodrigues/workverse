import { describe, expect, it } from 'vitest';
import {
  DEPT_PALETTE,
  MAX_TITLE_LENGTH,
  RECEPTIONIST,
  ROOM_DEFS,
  badgeLabel,
  badgeTextColor,
  buildRoom,
  cleanDeptName,
  cleanTitle,
  deptShort,
  fitText,
  foldText,
  footprintTiles,
  isDeptColor,
  isGeneralDept,
  receptionistSay,
  roleHas,
  safeDeptColor,
  sanitizeAvatar,
  tagBox,
} from '../src';

describe('cargo e setor: validacao e sanitizacao', () => {
  it('aceita cargos comuns e normaliza espacos', () => {
    expect(cleanTitle('Desenvolvedora Sênior')).toBe('Desenvolvedora Sênior');
    expect(cleanTitle('  Gerente   Comercial ')).toBe('Gerente Comercial');
    expect(cleanTitle('Analista (Jr) / Backend')).toBe('Analista (Jr) / Backend');
    expect(cleanTitle('')).toBe('');
    expect(cleanTitle('   ')).toBe('');
  });

  it('recusa controle, zero-width, bidi, emoji, HTML, tamanho e tipos errados', () => {
    const bad: unknown[] = ['a​b', 'a‮b', 'a\u0000b', 'a⁦b', 'a﻿b', 'a؜b', 'Dev 😀', '<b>x</b>', 'x'.repeat(MAX_TITLE_LENGTH + 1), 42, null, {}, '-começa com hífen'];
    for (const b of bad) expect(cleanTitle(b), String(b)).toBeNull();
    expect(cleanTitle('x'.repeat(MAX_TITLE_LENGTH))).toHaveLength(MAX_TITLE_LENGTH);
  });

  it('nome de setor: 2 a 24 caracteres', () => {
    expect(cleanDeptName('TI')).toBe('TI');
    expect(cleanDeptName('Recursos Humanos')).toBe('Recursos Humanos');
    expect(cleanDeptName('R')).toBeNull();
    expect(cleanDeptName('')).toBeNull();
    expect(cleanDeptName('x'.repeat(25))).toBeNull();
    expect(cleanDeptName('R​H')).toBeNull();
  });

  it('paleta fixa: so cores da paleta; cores de desenho sempre validas', () => {
    expect(DEPT_PALETTE.length).toBeGreaterThanOrEqual(8);
    expect(new Set(DEPT_PALETTE.map((c) => c.color)).size).toBe(DEPT_PALETTE.length);
    for (const c of DEPT_PALETTE) expect(isDeptColor(c.color)).toBe(true);
    expect(isDeptColor('#123456')).toBe(false);
    expect(isDeptColor('red')).toBe(false);
    expect(isDeptColor(1)).toBe(false);
    expect(safeDeptColor('#ABCDEF')).toBe('#abcdef');
    expect(safeDeptColor('javascript:1')).toBe(DEPT_PALETTE[0]!.color);
    expect(safeDeptColor(undefined)).toBe(DEPT_PALETTE[0]!.color);
  });

  it('texto da etiqueta legivel: contraste adequado em toda a paleta', () => {
    const lum = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)) as [number, number, number];
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    for (const c of DEPT_PALETTE) {
      const fg = badgeTextColor(c.color);
      const [a, b] = [lum(c.color), lum(fg)].sort((x, y) => y - x) as [number, number];
      expect((a + 0.05) / (b + 0.05), c.id).toBeGreaterThanOrEqual(3);
    }
  });

  it('etiqueta: "Setor · Cargo", so um deles, ou nada; corta com reticencias', () => {
    expect(badgeLabel('TI', 'Dev Sênior')).toBe('TI · Dev Sênior');
    expect(badgeLabel(undefined, 'Dev')).toBe('Dev');
    expect(badgeLabel('TI', undefined)).toBe('TI');
    expect(badgeLabel(undefined, undefined)).toBe('');
    const long = badgeLabel('Recursos Humanos', 'Coordenadora de Pessoas e Cultura', 20);
    expect([...long].length).toBeLessThanOrEqual(20);
    expect(long.endsWith('…')).toBe(true);
    expect(fitText('abc', 3)).toBe('abc');
  });

  it('setor abreviado para a pilula do avatar', () => {
    expect(deptShort('TI')).toBe('TI');
    expect(deptShort('Financeiro')).toBe('Financ.');
    expect(deptShort('Recursos Humanos', 7)).toBe('Recurs.');
    expect([...deptShort('Departamento Comercial')].length).toBeLessThanOrEqual(7);
    expect(deptShort(undefined)).toBe('');
  });

  it('layout da etiqueta: tamanho par e com folga em volta do texto', () => {
    for (const [tw, th] of [
      [41, 11],
      [80, 12],
      [7, 9],
    ] as const) {
      const { w, h } = tagBox(tw, th);
      expect(w % 2).toBe(0);
      expect(h % 2).toBe(0);
      expect(w).toBeGreaterThan(tw);
      expect(h).toBeGreaterThan(th);
    }
  });

  it('busca sem acento nem caixa; "Geral" nao conta como setor', () => {
    expect(foldText('  João ÉVORA ')).toBe('joao evora');
    expect(isGeneralDept({ id: 'default-geral', name: 'qualquer' })).toBe(true);
    expect(isGeneralDept({ id: 'x', name: 'GERAL' })).toBe(true);
    expect(isGeneralDept({ id: 'x', name: 'TI' })).toBe(false);
    expect(isGeneralDept(undefined)).toBe(true);
  });

  it('permissao dir.search: membros sim, visitantes nao', () => {
    expect(roleHas('member', 'dir.search')).toBe(true);
    expect(roleHas('admin', 'dir.search')).toBe(true);
    expect(roleHas('guest', 'dir.search')).toBe(false);
  });
});

describe('atendente NPC da recepcao', () => {
  const def = ROOM_DEFS.find((r) => r.id === RECEPTIONIST.roomId)!;
  const room = buildRoom(def);

  it('fica na cadeira atras do balcao, olhando para ele', () => {
    const chair = def.furniture.find((f) => f.kind === 'chair' && f.x === RECEPTIONIST.x && f.y === RECEPTIONIST.y);
    const desk = def.furniture.find((f) => f.kind === 'reception_desk')!;
    expect(chair).toBeTruthy();
    // o balcao esta logo a frente (+y) da cadeira
    expect(footprintTiles(desk).some((t) => t.x === RECEPTIONIST.x && t.y === RECEPTIONIST.y + 1)).toBe(true);
    expect(RECEPTIONIST.dir).toBe(1);
  });

  it('nao bloqueia caminho nem porta: fora das portas, do spawn e de qualquer peca que bloqueia', () => {
    const { x, y } = RECEPTIONIST;
    expect(def.portals.some((p) => p.x === x && p.y === y)).toBe(false);
    expect(def.spawn.x === x && def.spawn.y === y).toBe(false);
    for (const p of def.portals) expect(Math.abs(p.x - x) + Math.abs(p.y - y)).toBeGreaterThan(1);
    expect(room.grid.floor[y * room.grid.width + x]).toBeTruthy();
    const here = room.furniAt.get(y * room.grid.width + x) ?? [];
    expect(here.every((f) => f.kind === 'chair')).toBe(true);
  });

  it('a aparencia e um avatar valido e sem item de staff', () => {
    const av = sanitizeAvatar(RECEPTIONIST.avatar);
    expect(av.top.id).toBe(RECEPTIONIST.avatar.top.id);
    expect(av.hair.id).toBe(RECEPTIONIST.avatar.hair.id);
    expect(av.outer?.id).toBe('outer.blazer');
    expect(av.special.some((s) => s.id.includes('staff'))).toBe(false);
  });

  it('falas em pt-BR conforme o ponto da conversa', () => {
    const base = { picked: false, busy: false, count: 0, truncated: false, deptChosen: false, notice: null };
    expect(receptionistSay(base)).toBe('Olá! Em qual setor você procura alguém?');
    expect(receptionistSay({ ...base, picked: true, busy: true })).toMatch(/Já vejo/);
    expect(receptionistSay({ ...base, picked: true, deptChosen: true })).toBe('Não encontrei ninguém com esse nome nesse setor.');
    expect(receptionistSay({ ...base, picked: true })).toBe('Não encontrei ninguém com esse nome.');
    expect(receptionistSay({ ...base, picked: true, count: 1 })).toMatch(/uma pessoa/);
    expect(receptionistSay({ ...base, picked: true, count: 20, truncated: true })).toMatch(/20 primeiras/);
    expect(receptionistSay({ ...base, notice: 'Calma!' })).toBe('Calma!');
  });
});
