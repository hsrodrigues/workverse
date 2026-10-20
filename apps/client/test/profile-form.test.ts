import { describe, expect, it } from 'vitest';
import { DEFAULT_PREFS, type ProfileView } from '@workverse/shared';
import { buildPatch, fieldOfError, formFromProfile, isDirty, nameCooldownText, validateForm } from '../src/ui/profile/profileForm';

const base: ProfileView = {
  displayName: 'Ana',
  email: 'ana@x.com',
  birthdayVisible: false,
  birthdayChat: false,
  prefs: { ...DEFAULT_PREFS },
  prefsSet: [],
  nameChangeAt: 0,
  nameCooldownHours: 24,
};
const NOW = 1_000_000_000;

describe('formulario do perfil', () => {
  it('perfil intocado nao tem alteracoes nem erros', () => {
    const f = formFromProfile(base);
    expect(isDirty(f, base)).toBe(false);
    expect(buildPatch(f, base)).toEqual({});
    expect(validateForm(f, base, NOW)).toEqual({});
  });

  it('o patch traz so o que mudou', () => {
    const f = { ...formFromProfile(base), about: '  Cafe  ', pronouns: 'ela' as const, prefs: { ...base.prefs, sound: false } };
    expect(buildPatch(f, base)).toEqual({ about: 'Cafe', pronouns: 'ela', prefs: { sound: false } });
    expect(isDirty(f, base)).toBe(true);
  });

  it('esvaziar um campo opcional envia null; voltar ao valor salvo desfaz a alteracao', () => {
    const p = { ...base, about: 'Oi', pronouns: 'ele' as const };
    const f = { ...formFromProfile(p), about: '', pronouns: '' as const };
    expect(buildPatch(f, p)).toEqual({ about: null, pronouns: null });
    expect(isDirty(formFromProfile(p), p)).toBe(false);
  });

  it('valida nome, sobre mim, aniversario e fuso', () => {
    const f = formFromProfile(base);
    expect(validateForm({ ...f, displayName: 'A' }, base, NOW).displayName).toMatch(/2 a 16/);
    expect(validateForm({ ...f, displayName: '<b>' }, base, NOW).displayName).toBeTruthy();
    expect(validateForm({ ...f, about: 'a'.repeat(81) }, base, NOW).about).toMatch(/80/);
    expect(validateForm({ ...f, about: 'a\nb' }, base, NOW).about).toBeTruthy();
    expect(validateForm({ ...f, bdayDay: '31' }, base, NOW).birthday).toMatch(/dia e o mês/);
    expect(validateForm({ ...f, bdayDay: '31', bdayMonth: '4' }, base, NOW).birthday).toMatch(/não existe/);
    expect(validateForm({ ...f, bdayDay: '29', bdayMonth: '2' }, base, NOW).birthday).toBeUndefined();
    expect(validateForm({ ...f, prefs: { ...f.prefs, tz: 'Marte/Base' } }, base, NOW).tz).toBeTruthy();
  });

  it('aniversario: aplica opcoes so com data e limpa tudo ao remover', () => {
    const withBday = { ...formFromProfile(base), bdayDay: '10', bdayMonth: '6', birthdayVisible: true, birthdayChat: true };
    expect(buildPatch(withBday, base)).toEqual({ birthday: { m: 6, d: 10 }, birthdayVisible: true, birthdayChat: true });
    const saved: ProfileView = { ...base, birthday: { m: 6, d: 10 }, birthdayVisible: true, birthdayChat: true };
    const removed = { ...formFromProfile(saved), bdayDay: '', bdayMonth: '', birthdayVisible: false, birthdayChat: false };
    expect(buildPatch(removed, saved)).toEqual({ birthday: null });
  });

  it('cooldown: bloqueia trocar o nome (mas nao os outros campos) e explica o tempo', () => {
    const p = { ...base, nameChangeAt: NOW + 5 * 3600_000 };
    const f = formFromProfile(p);
    expect(validateForm(f, p, NOW)).toEqual({}); // mesmo nome: sem erro
    expect(validateForm({ ...f, displayName: 'Ana Lima' }, p, NOW).displayName).toBe('A próxima troca de nome fica disponível em 5 horas.');
    expect(validateForm({ ...f, displayName: 'Ana Lima' }, p, NOW + 5 * 3600_000).displayName).toBeUndefined();
    expect(nameCooldownText(NOW + 30 * 60_000, NOW)).toBe('A próxima troca de nome fica disponível em 30 min.');
    expect(nameCooldownText(NOW + 3600_000, NOW)).toBe('A próxima troca de nome fica disponível em 1 hora.');
    expect(nameCooldownText(0, NOW)).toBe('');
  });

  it('erros do servidor caem no campo certo', () => {
    expect(fieldOfError('name_taken')).toBe('displayName');
    expect(fieldOfError('name_cooldown', 'displayName')).toBe('displayName');
    expect(fieldOfError('bad_about')).toBe('about');
    expect(fieldOfError('bad_birthday')).toBe('birthday');
    expect(fieldOfError('bad_prefs', 'prefs.tz')).toBe('tz');
    expect(fieldOfError('rate_limited')).toBeNull();
  });
});
