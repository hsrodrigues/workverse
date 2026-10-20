import { describe, expect, it } from 'vitest';
import {
  MAX_PET_NAME,
  PET_ACTS,
  PET_ACT_LINES,
  PET_LINES,
  ROOM_DEFS,
  cleanPetName,
  isPetAct,
  isPetState,
  petFacing,
  petRoomAllowed,
  petViewOf,
  pickLine,
  roomAccessOf,
  type Dir8,
  type PetZoneInfo,
} from '../src';

const open: PetZoneInfo = { type: 'office', access: 'org', state: 'open', stageActive: false, reserved: false };

describe('petRoomAllowed (zonas do Byte)', () => {
  it('permite salas abertas a organizacao', () => {
    expect(petRoomAllowed(open)).toBe(true);
    expect(petRoomAllowed({ ...open, type: 'lounge' })).toBe(true);
    expect(petRoomAllowed({ ...open, type: 'auditorium' })).toBe(true);
  });

  it('nega acesso por equipe, convite ou privado', () => {
    for (const access of ['team', 'invited', 'private'] as const) expect(petRoomAllowed({ ...open, access })).toBe(false);
  });

  it('nega sala trancada, fechada, reservada ou com palco ativo', () => {
    expect(petRoomAllowed({ ...open, state: 'locked' })).toBe(false);
    expect(petRoomAllowed({ ...open, state: 'closed' })).toBe(false);
    expect(petRoomAllowed({ ...open, reserved: true })).toBe(false);
    expect(petRoomAllowed({ ...open, type: 'auditorium', stageActive: true })).toBe(false);
  });

  it('nega salas privadas e de foco mesmo abertas', () => {
    expect(petRoomAllowed({ ...open, type: 'private' })).toBe(false);
    expect(petRoomAllowed({ ...open, type: 'focus' })).toBe(false);
  });

  it('nas salas do catalogo: nunca na privada nem no foco; ha varias salas permitidas', () => {
    const allowed = ROOM_DEFS.filter((d) => petRoomAllowed({ type: d.type, access: roomAccessOf(d), state: 'open', stageActive: false, reserved: false })).map((d) => d.id);
    expect(allowed).not.toContain('private');
    expect(allowed).not.toContain('focus');
    expect(allowed).toEqual(expect.arrayContaining(['office', 'lounge', 'reception']));
  });
});

describe('nome e falas', () => {
  it('cleanPetName aceita nomes simples e recusa o resto', () => {
    expect(cleanPetName('Byte')).toBe('Byte');
    expect(cleanPetName('  Mini   Bit ')).toBe('Mini Bit');
    expect(cleanPetName('Ação-2')).toBe('Ação-2');
    expect(cleanPetName('nome‮')).toBe('nome'); // caractere de controle de direcao vira espaco e some
    for (const bad of ['', 'a', 'x'.repeat(MAX_PET_NAME + 1), '<b>', '-nome', 5, null, undefined, {}]) expect(cleanPetName(bad as never), String(bad)).toBeNull();
  });

  it('todas as acoes tem falas em pt-BR e pickLine nunca sai da lista', () => {
    for (const a of PET_ACTS) expect(PET_ACT_LINES[a].length).toBeGreaterThan(1);
    expect(PET_LINES.random.some((l) => /miau\.exe/.test(l))).toBe(true);
    for (const r of [0, 0.5, 0.999999, 1, -1]) expect(PET_LINES.random).toContain(pickLine(PET_LINES.random, r));
  });

  it('guards de tipo', () => {
    expect(isPetAct('pat')).toBe(true);
    expect(isPetAct('bite')).toBe(false);
    expect(isPetState('sleep')).toBe(true);
    expect(isPetState('dead')).toBe(false);
  });
});

describe('4 vistas com espelho', () => {
  it('as 8 direcoes caem em 4 vistas; SE e NE sao o espelho de SW e NW', () => {
    const seen = new Set<string>();
    for (let d = 0 as Dir8; d < 8; d = (d + 1) as Dir8) seen.add(petFacing(d));
    expect([...seen].sort()).toEqual(['ne', 'nw', 'se', 'sw']);
    expect(petViewOf('sw')).toEqual({ back: false, flip: false });
    expect(petViewOf('se')).toEqual({ back: false, flip: true });
    expect(petViewOf('nw')).toEqual({ back: true, flip: false });
    expect(petViewOf('ne')).toEqual({ back: true, flip: true });
    expect(petFacing(0)).toBe('se'); // +x e o sudeste da tela
    expect(petFacing(2)).toBe('sw');
    expect(petFacing(4)).toBe('nw');
    expect(petFacing(6)).toBe('ne');
  });
});
