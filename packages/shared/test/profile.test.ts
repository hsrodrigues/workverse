import { describe, expect, it } from 'vitest';
import {
  DEFAULT_NAME_LIMITS,
  DEFAULT_PREFS,
  cleanAbout,
  cleanBirthday,
  cleanDisplayName,
  isBirthdayToday,
  isTimeZone,
  localDate,
  nextNameChangeAt,
  parseProfilePatch,
  prefsOf,
} from '../src';

describe('nome de exibicao', () => {
  it('usa a mesma regra do cadastro', () => {
    expect(cleanDisplayName('  Ana   Maria ')).toBe('Ana Maria');
    expect(cleanDisplayName('A')).toBeNull();
    expect(cleanDisplayName('x'.repeat(17))).toBeNull();
    expect(cleanDisplayName('<b>oi</b>')).toBeNull();
    expect(cleanDisplayName('Аdmin')).toBeNull(); // A cirilico misturado com latim
    expect(cleanDisplayName(42)).toBeNull();
  });
});

describe('sobre mim', () => {
  it('aceita ate 80 caracteres, colapsa espacos e recusa invisiveis/controle', () => {
    expect(cleanAbout('  Cafe   e codigo ')).toBe('Cafe e codigo');
    expect(cleanAbout('')).toBe('');
    expect(cleanAbout('a'.repeat(80))).toBe('a'.repeat(80));
    expect(cleanAbout('a'.repeat(81))).toBeNull();
    expect(cleanAbout('oi​mundo')).toBeNull();
    expect(cleanAbout('oi‮mundo')).toBeNull();
    expect(cleanAbout('linha1\nlinha2')).toBeNull(); // quebra de linha e controle: recusada
    expect(cleanAbout({})).toBeNull();
  });
});

describe('aniversario', () => {
  it('valida dia e mes (29/02 vale, 31/04 nao)', () => {
    expect(cleanBirthday({ m: 2, d: 29 })).toEqual({ m: 2, d: 29 });
    expect(cleanBirthday({ m: 4, d: 31 })).toBeNull();
    expect(cleanBirthday({ m: 13, d: 1 })).toBeNull();
    expect(cleanBirthday({ m: 1.5, d: 1 })).toBeNull();
    expect(cleanBirthday('01/02')).toBeNull();
  });
  it('compara no fuso da pessoa e trata 29/02 em ano comum', () => {
    const t = Date.UTC(2026, 5, 15, 2, 0, 0); // 15/06 02:00 UTC = 14/06 23:00 em Sao Paulo
    expect(localDate(t, 'America/Sao_Paulo').key).toBe('2026-06-14');
    expect(isBirthdayToday({ m: 6, d: 14 }, t, 'America/Sao_Paulo')).toBe(true);
    expect(isBirthdayToday({ m: 6, d: 15 }, t, 'America/Sao_Paulo')).toBe(false);
    expect(isBirthdayToday({ m: 6, d: 15 }, t, 'UTC')).toBe(true);
    expect(isBirthdayToday({ m: 2, d: 29 }, Date.UTC(2026, 1, 28, 15), 'UTC')).toBe(true); // 2026 nao e bissexto
    expect(isBirthdayToday({ m: 2, d: 29 }, Date.UTC(2028, 1, 28, 15), 'UTC')).toBe(false);
    expect(isBirthdayToday(undefined, t, 'UTC')).toBe(false);
  });
});

describe('fuso e preferencias', () => {
  it('valida nomes IANA', () => {
    expect(isTimeZone('America/Sao_Paulo')).toBe(true);
    expect(isTimeZone('Europe/Lisbon')).toBe(true);
    expect(isTimeZone('Mars/Olympus')).toBe(false);
    expect(isTimeZone('../etc/passwd')).toBe(false);
    expect(isTimeZone('')).toBe(false);
  });
  it('prefsOf completa os padroes e ignora lixo', () => {
    expect(prefsOf(undefined)).toEqual(DEFAULT_PREFS);
    expect(prefsOf({ prefs: { tz: 'x/y', sound: false } as never }).tz).toBe(DEFAULT_PREFS.tz);
    expect(prefsOf({ prefs: { sound: false } }).sound).toBe(false);
  });
});

describe('cooldown de troca de nome', () => {
  const H = 3600_000;
  it('sem trocas, pode agora; com troca recente, espera 24 h', () => {
    expect(nextNameChangeAt(undefined, 1000)).toBe(0);
    const now = 100 * H;
    expect(nextNameChangeAt([now - 2 * H], now)).toBe(now - 2 * H + 24 * H);
    expect(nextNameChangeAt([now - 25 * H], now)).toBe(0);
  });
  it('respeita o maximo por janela', () => {
    const limits = { ...DEFAULT_NAME_LIMITS, cooldownMs: H, maxChanges: 2 };
    const now = 1000 * H;
    const changes = [now - 100 * H, now - 50 * H]; // 2 na janela de 30 dias
    expect(nextNameChangeAt(changes, now, limits)).toBe(changes[0]! + limits.windowMs);
  });
});

describe('parseProfilePatch', () => {
  it('recusa campos que a pessoa nao pode editar', () => {
    for (const k of ['email', 'title', 'dept', 'teamId', 'staff', 'role', 'passwordHash', 'id']) {
      const r = parseProfilePatch({ [k]: 'x' });
      expect(r.ok).toBe(false);
    }
  });
  it('aceita campos validos e limpa com null', () => {
    const r = parseProfilePatch({ displayName: ' Bia ', about: '', pronouns: 'ela', birthday: null, prefs: { tz: 'UTC', sound: false } });
    expect(r).toEqual({ ok: true, patch: { displayName: 'Bia', about: null, pronouns: 'ela', birthday: null, prefs: { tz: 'UTC', sound: false } } });
  });
  it('erros indicam o campo', () => {
    expect(parseProfilePatch({ displayName: '!' })).toMatchObject({ ok: false, issue: { field: 'displayName', code: 'bad_name' } });
    expect(parseProfilePatch({ about: 'a'.repeat(90) })).toMatchObject({ ok: false, issue: { code: 'bad_about' } });
    expect(parseProfilePatch({ pronouns: 'xyz' })).toMatchObject({ ok: false, issue: { code: 'bad_pronouns' } });
    expect(parseProfilePatch({ birthday: { m: 2, d: 30 } })).toMatchObject({ ok: false, issue: { code: 'bad_birthday' } });
    expect(parseProfilePatch({ prefs: { tz: 'Nope/Nope' } })).toMatchObject({ ok: false, issue: { code: 'bad_prefs' } });
    expect(parseProfilePatch({ prefs: { sound: 'sim' } })).toMatchObject({ ok: false, issue: { code: 'bad_prefs' } });
    expect(parseProfilePatch({ prefs: { lang: 'en' } })).toMatchObject({ ok: false, issue: { code: 'bad_prefs' } });
    expect(parseProfilePatch({ prefs: { novo: true } })).toMatchObject({ ok: false });
    expect(parseProfilePatch({})).toMatchObject({ ok: false });
    expect(parseProfilePatch([])).toMatchObject({ ok: false });
  });
});
