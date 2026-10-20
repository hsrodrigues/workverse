import {
  MAX_ABOUT_LENGTH,
  cleanAbout,
  cleanBirthday,
  cleanDisplayName,
  isTimeZone,
  type PronounId,
  type ProfilePatch,
  type ProfilePrefs,
  type ProfileView,
  isPronounId,
} from '@workverse/shared';

/** Estado do formulario "Meu perfil" (tudo texto/boolean, como os campos). Logica pura: testada em apps/client/test. */
export interface ProfileForm {
  displayName: string;
  about: string;
  pronouns: '' | PronounId;
  bdayDay: string;
  bdayMonth: string;
  birthdayVisible: boolean;
  birthdayChat: boolean;
  prefs: ProfilePrefs;
}

export type FormErrors = Partial<Record<'displayName' | 'about' | 'birthday' | 'tz', string>>;

export function formFromProfile(p: ProfileView): ProfileForm {
  return {
    displayName: p.displayName,
    about: p.about ?? '',
    pronouns: p.pronouns ?? '',
    bdayDay: p.birthday ? String(p.birthday.d) : '',
    bdayMonth: p.birthday ? String(p.birthday.m) : '',
    birthdayVisible: p.birthdayVisible,
    birthdayChat: p.birthdayChat,
    prefs: { ...p.prefs },
  };
}

/** Mensagem de cooldown ("a proxima troca fica disponivel em 5 horas"), ou '' quando ja pode trocar. */
export function nameCooldownText(nameChangeAt: number, now: number): string {
  const ms = nameChangeAt - now;
  if (ms <= 0) return '';
  const mins = Math.ceil(ms / 60_000);
  if (mins < 60) return `A próxima troca de nome fica disponível em ${mins} min.`;
  const hours = Math.ceil(mins / 60);
  return `A próxima troca de nome fica disponível em ${hours} ${hours === 1 ? 'hora' : 'horas'}.`;
}

/** Erros que o proprio formulario consegue ver (o servidor valida de novo). Nome em uso so o servidor sabe. */
export function validateForm(f: ProfileForm, p: ProfileView, now: number): FormErrors {
  const errors: FormErrors = {};
  const name = cleanDisplayName(f.displayName);
  if (!name) errors.displayName = 'O nome deve ter de 2 a 16 letras, números, espaço, _ ou -.';
  else if (name !== p.displayName && p.nameChangeAt > now) errors.displayName = nameCooldownText(p.nameChangeAt, now);
  const about = cleanAbout(f.about);
  if (about === null) errors.about = [...f.about].length > MAX_ABOUT_LENGTH ? `Use até ${MAX_ABOUT_LENGTH} caracteres.` : 'Esse texto tem caracteres que não podem ser usados (quebra de linha ou invisíveis).';
  const hasDay = f.bdayDay.trim() !== '';
  const hasMonth = f.bdayMonth.trim() !== '';
  if (hasDay !== hasMonth) errors.birthday = 'Informe o dia e o mês, ou deixe os dois em branco.';
  else if (hasDay && !cleanBirthday({ m: Number(f.bdayMonth), d: Number(f.bdayDay) })) errors.birthday = 'Essa data não existe.';
  if (!isTimeZone(f.prefs.tz)) errors.tz = 'Fuso horário inválido.';
  return errors;
}

/** So o que mudou em relacao ao perfil salvo. Vazio = nada para salvar. Pressupoe `validateForm` sem erros. */
export function buildPatch(f: ProfileForm, p: ProfileView): ProfilePatch {
  const patch: ProfilePatch = {};
  const name = cleanDisplayName(f.displayName);
  if (name && name !== p.displayName) patch.displayName = name;
  const about = cleanAbout(f.about) ?? '';
  if (about !== (p.about ?? '')) patch.about = about === '' ? null : about;
  const pr = f.pronouns === '' || !isPronounId(f.pronouns) ? null : f.pronouns;
  if (pr !== (p.pronouns ?? null)) patch.pronouns = pr;
  const bd = f.bdayDay.trim() === '' ? null : cleanBirthday({ m: Number(f.bdayMonth), d: Number(f.bdayDay) });
  if ((bd?.m ?? 0) !== (p.birthday?.m ?? 0) || (bd?.d ?? 0) !== (p.birthday?.d ?? 0)) patch.birthday = bd;
  if (bd) {
    if (f.birthdayVisible !== p.birthdayVisible) patch.birthdayVisible = f.birthdayVisible;
    if (f.birthdayChat !== p.birthdayChat) patch.birthdayChat = f.birthdayChat;
  }
  const prefs: Partial<ProfilePrefs> = {};
  for (const k of Object.keys(f.prefs) as (keyof ProfilePrefs)[]) if (f.prefs[k] !== p.prefs[k]) (prefs as Record<string, unknown>)[k] = f.prefs[k];
  if (Object.keys(prefs).length > 0) patch.prefs = prefs;
  return patch;
}

export const isDirty = (f: ProfileForm, p: ProfileView): boolean => Object.keys(buildPatch(f, p)).length > 0;

/** Dia/mes digitados -> opcoes para os seletores. */
export const DAYS = Array.from({ length: 31 }, (_, i) => i + 1);
export const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

/** Erro do servidor -> campo do formulario (usa o `field` da resposta quando existe). */
export function fieldOfError(code: string, field?: string): keyof FormErrors | null {
  if (field === 'displayName' || code === 'bad_name' || code === 'name_taken' || code === 'name_cooldown') return 'displayName';
  if (field === 'about' || code === 'bad_about') return 'about';
  if (field === 'birthday' || code === 'bad_birthday') return 'birthday';
  if (field === 'prefs.tz') return 'tz';
  return null;
}
