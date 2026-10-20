/**
 * "Meu perfil": o que a propria pessoa pode editar na conta (nome de exibicao, "sobre mim", pronomes, aniversario,
 * preferencias). Tudo opcional e validado AQUI e no servidor (a mesma funcao). Cargo, setor, e-mail e nivel de staff
 * nao fazem parte do perfil editavel. Ver docs/profile.md.
 */
import { MAX_NAME_LENGTH, MIN_NAME_LENGTH, NAME_PATTERN } from './protocol';
import { isForbiddenChar } from './directory';

/** Normaliza o nome de exibicao (mesma regra do cadastro). `null` = invalido. */
export function cleanDisplayName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const name = raw.normalize('NFKC').replace(/\s+/g, ' ').trim();
  if (name.length < MIN_NAME_LENGTH || name.length > MAX_NAME_LENGTH) return null;
  if (!NAME_PATTERN.test(name)) return null;
  // Homoglifos ("Аdmin" com A cirilico): latim nao mistura com cirilico/grego.
  if (/\p{Script=Latin}/u.test(name) && /[\p{Script=Cyrillic}\p{Script=Greek}]/u.test(name)) return null;
  return name;
}

export const MAX_ABOUT_LENGTH = 80;

/** Texto livre curto ("Sobre mim"): sem caracteres de controle/bidi, espacos colapsados, sem quebra de linha. `''` = vazio; `null` = invalido. */
export function cleanAbout(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > MAX_ABOUT_LENGTH * 4) return null;
  for (const ch of raw) if (isForbiddenChar(ch.codePointAt(0)!)) return null;
  const s = raw.normalize('NFKC').replace(/\s+/g, ' ').trim();
  return [...s].length > MAX_ABOUT_LENGTH ? null : s;
}

export const PRONOUN_OPTIONS = [
  { id: 'ela', label: 'ela/dela' },
  { id: 'ele', label: 'ele/dele' },
  { id: 'elu', label: 'elu/delu' },
  { id: 'outro', label: 'outro' },
] as const;
export type PronounId = (typeof PRONOUN_OPTIONS)[number]['id'];
export const isPronounId = (v: unknown): v is PronounId => PRONOUN_OPTIONS.some((o) => o.id === v);
export const pronounLabel = (id: PronounId | undefined): string => PRONOUN_OPTIONS.find((o) => o.id === id)?.label ?? '';

export interface Birthday {
  /** 1-12 */
  m: number;
  /** 1-31 (29/02 vale) */
  d: number;
}
const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
export function cleanBirthday(raw: unknown): Birthday | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const { m, d } = raw as { m?: unknown; d?: unknown };
  if (!Number.isInteger(m) || !Number.isInteger(d)) return null;
  const mm = m as number;
  const dd = d as number;
  if (mm < 1 || mm > 12 || dd < 1 || dd > DAYS_IN_MONTH[mm - 1]!) return null;
  return { m: mm, d: dd };
}
export const formatBirthday = (b: Birthday): string => `${String(b.d).padStart(2, '0')}/${String(b.m).padStart(2, '0')}`;

export const DEFAULT_TIMEZONE = 'America/Sao_Paulo';
export const LANGUAGES = [{ id: 'pt-BR', label: 'Português (Brasil)' }] as const;
export type LangId = (typeof LANGUAGES)[number]['id'];
export const isLangId = (v: unknown): v is LangId => LANGUAGES.some((l) => l.id === v);

/** Fusos comuns oferecidos na lista; o servidor aceita qualquer nome IANA valido. */
export const COMMON_TIMEZONES = [
  'America/Sao_Paulo',
  'America/Manaus',
  'America/Fortaleza',
  'America/Cuiaba',
  'America/Noronha',
  'America/Rio_Branco',
  'America/New_York',
  'America/Chicago',
  'America/Los_Angeles',
  'America/Argentina/Buenos_Aires',
  'Europe/Lisbon',
  'Europe/London',
  'Europe/Madrid',
  'UTC',
] as const;

export function isTimeZone(v: unknown): v is string {
  if (typeof v !== 'string' || v.length === 0 || v.length > 64 || !/^[A-Za-z0-9_+\-/]+$/.test(v)) return false;
  try {
    new Intl.DateTimeFormat('pt-BR', { timeZone: v });
    return true;
  } catch {
    return false;
  }
}

export interface ProfilePrefs {
  /** Fuso IANA para exibir horas. */
  tz: string;
  lang: LangId;
  /** Sons de notificacao. */
  sound: boolean;
  /** Aviso quando alguem menciona o meu nome. */
  mentions: boolean;
  /** Decoracao dos eventos sazonais. */
  eventDecor: boolean;
  /** Modo economia de dados de audio/video (preferencia do cliente). */
  dataSaver: boolean;
  /** Mostrar aos colegas que estou "trabalhando". */
  showWorking: boolean;
}
export const DEFAULT_PREFS: ProfilePrefs = { tz: DEFAULT_TIMEZONE, lang: 'pt-BR', sound: true, mentions: true, eventDecor: true, dataSaver: false, showWorking: true };
const BOOL_PREFS = ['sound', 'mentions', 'eventDecor', 'dataSaver', 'showWorking'] as const;

/** O que fica guardado na conta (tudo opcional; contas antigas nao tem nada disso). */
export interface AccountProfile {
  about?: string;
  pronouns?: PronounId;
  birthday?: Birthday;
  /** Mostra o icone de aniversario na ficha no dia (so com `birthday`). */
  birthdayVisible?: boolean;
  /** Permite a mensagem de parabens no chat da sala (opt-in). */
  birthdayChat?: boolean;
  prefs?: Partial<ProfilePrefs>;
  /** Ultimas trocas de nome (epoch ms, mais antigas primeiro), para cooldown e limite. */
  nameChanges?: number[];
  /** Dia (AAAA-MM-DD no fuso da pessoa) em que o parabens ja foi dado. */
  lastBdayGreet?: string;
}

export const prefsOf = (p: AccountProfile | undefined): ProfilePrefs => {
  const o = p?.prefs ?? {};
  return {
    tz: isTimeZone(o.tz) ? o.tz : DEFAULT_PREFS.tz,
    lang: isLangId(o.lang) ? o.lang : DEFAULT_PREFS.lang,
    sound: typeof o.sound === 'boolean' ? o.sound : DEFAULT_PREFS.sound,
    mentions: typeof o.mentions === 'boolean' ? o.mentions : DEFAULT_PREFS.mentions,
    eventDecor: typeof o.eventDecor === 'boolean' ? o.eventDecor : DEFAULT_PREFS.eventDecor,
    dataSaver: typeof o.dataSaver === 'boolean' ? o.dataSaver : DEFAULT_PREFS.dataSaver,
    showWorking: typeof o.showWorking === 'boolean' ? o.showWorking : DEFAULT_PREFS.showWorking,
  };
};

// ---- limites de troca de nome ------------------------------------------------------------------------

export interface NameChangeLimits {
  /** Tempo minimo entre duas trocas. */
  cooldownMs: number;
  /** Maximo de trocas dentro de `windowMs`. */
  maxChanges: number;
  windowMs: number;
}
export const DEFAULT_NAME_LIMITS: NameChangeLimits = { cooldownMs: 24 * 3600_000, maxChanges: 5, windowMs: 30 * 24 * 3600_000 };

/** Quando a proxima troca de nome sera permitida (epoch ms); `0` = agora. */
export function nextNameChangeAt(changes: readonly number[] | undefined, now: number, limits: NameChangeLimits = DEFAULT_NAME_LIMITS): number {
  const list = (changes ?? []).filter((t) => typeof t === 'number' && t <= now + 60_000);
  if (list.length === 0) return 0;
  let at = list[list.length - 1]! + limits.cooldownMs;
  const recent = list.filter((t) => t > now - limits.windowMs);
  if (recent.length >= limits.maxChanges) at = Math.max(at, recent[recent.length - limits.maxChanges]! + limits.windowMs);
  return at <= now ? 0 : at;
}

// ---- aniversario ---------------------------------------------------------------------------------------

/** Data local (AAAA-MM-DD, mes, dia) de um instante em um fuso. */
export function localDate(now: number, tz: string): { key: string; m: number; d: number } {
  const zone = isTimeZone(tz) ? tz : DEFAULT_TIMEZONE;
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(now));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const y = get('year');
  const m = get('month');
  const d = get('day');
  return { key: `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`, m, d };
}

/** Hoje e o aniversario? (29/02 e comemorado em 28/02 nos anos nao bissextos.) */
export function isBirthdayToday(b: Birthday | undefined, now: number, tz: string): boolean {
  if (!b) return false;
  const t = localDate(now, tz);
  if (t.m === b.m && t.d === b.d) return true;
  if (b.m === 2 && b.d === 29 && t.m === 2 && t.d === 28) {
    const y = Number(t.key.slice(0, 4));
    const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
    return !leap;
  }
  return false;
}

// ---- API -----------------------------------------------------------------------------------------------

/** Corpo do PATCH /api/profile. Campos ausentes nao mudam; `null` limpa (campos opcionais). */
export interface ProfilePatch {
  displayName?: string;
  about?: string | null;
  pronouns?: PronounId | null;
  birthday?: Birthday | null;
  birthdayVisible?: boolean;
  birthdayChat?: boolean;
  prefs?: Partial<ProfilePrefs>;
}

/** Visao do proprio perfil (GET/PATCH /api/profile). So o dono recebe isto. */
export interface ProfileView {
  displayName: string;
  /** Somente leitura: so a staff altera. */
  email: string;
  title?: string;
  dept?: string;
  about?: string;
  pronouns?: PronounId;
  birthday?: Birthday;
  birthdayVisible: boolean;
  birthdayChat: boolean;
  prefs: ProfilePrefs;
  /** Preferencias que a pessoa ja salvou de fato (as demais mostram o padrao). Permite migrar valores antigos do navegador. */
  prefsSet: string[];
  /** Proxima troca de nome permitida (epoch ms); 0 = ja pode. */
  nameChangeAt: number;
  nameCooldownHours: number;
}

export interface ProfileIssue {
  field: string;
  code: 'bad_request' | 'bad_name' | 'bad_about' | 'bad_pronouns' | 'bad_birthday' | 'bad_prefs';
  message: string;
}

const PATCH_KEYS = ['displayName', 'about', 'pronouns', 'birthday', 'birthdayVisible', 'birthdayChat', 'prefs'];

/** Validacao estrita do corpo: chaves desconhecidas (cargo, setor, e-mail, staff...) sao RECUSADAS. */
export function parseProfilePatch(body: unknown): { ok: true; patch: ProfilePatch } | { ok: false; issue: ProfileIssue } {
  const bad = (field: string, code: ProfileIssue['code'], message: string) => ({ ok: false as const, issue: { field, code, message } });
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return bad('', 'bad_request', 'Corpo inválido.');
  const b = body as Record<string, unknown>;
  for (const k of Object.keys(b)) if (!PATCH_KEYS.includes(k)) return bad(k, 'bad_request', `O campo "${k}" não pode ser alterado por aqui.`);
  const patch: ProfilePatch = {};
  if ('displayName' in b) {
    const n = cleanDisplayName(b.displayName);
    if (!n) return bad('displayName', 'bad_name', `O nome deve ter de ${MIN_NAME_LENGTH} a ${MAX_NAME_LENGTH} letras, números, espaço, _ ou -.`);
    patch.displayName = n;
  }
  if ('about' in b) {
    if (b.about === null) patch.about = null;
    else {
      const a = cleanAbout(b.about);
      if (a === null) return bad('about', 'bad_about', `O texto "sobre mim" aceita até ${MAX_ABOUT_LENGTH} caracteres, sem caracteres especiais invisíveis.`);
      patch.about = a === '' ? null : a;
    }
  }
  if ('pronouns' in b) {
    if (b.pronouns === null || b.pronouns === '') patch.pronouns = null;
    else if (isPronounId(b.pronouns)) patch.pronouns = b.pronouns;
    else return bad('pronouns', 'bad_pronouns', 'Pronome inválido.');
  }
  if ('birthday' in b) {
    if (b.birthday === null) patch.birthday = null;
    else {
      const bd = cleanBirthday(b.birthday);
      if (!bd) return bad('birthday', 'bad_birthday', 'Data de aniversário inválida (informe dia e mês).');
      patch.birthday = bd;
    }
  }
  for (const k of ['birthdayVisible', 'birthdayChat'] as const) {
    if (k in b) {
      if (typeof b[k] !== 'boolean') return bad(k, 'bad_request', 'Valor inválido.');
      patch[k] = b[k] as boolean;
    }
  }
  if ('prefs' in b) {
    const p = b.prefs;
    if (typeof p !== 'object' || p === null || Array.isArray(p)) return bad('prefs', 'bad_prefs', 'Preferências inválidas.');
    const out: Partial<ProfilePrefs> = {};
    for (const [k, v] of Object.entries(p as Record<string, unknown>)) {
      if (k === 'tz') {
        if (!isTimeZone(v)) return bad('prefs.tz', 'bad_prefs', 'Fuso horário inválido.');
        out.tz = v;
      } else if (k === 'lang') {
        if (!isLangId(v)) return bad('prefs.lang', 'bad_prefs', 'Idioma indisponível.');
        out.lang = v;
      } else if ((BOOL_PREFS as readonly string[]).includes(k)) {
        if (typeof v !== 'boolean') return bad(`prefs.${k}`, 'bad_prefs', 'Valor inválido.');
        (out as Record<string, boolean>)[k] = v;
      } else return bad(`prefs.${k}`, 'bad_prefs', 'Preferência desconhecida.');
    }
    patch.prefs = out;
  }
  if (Object.keys(patch).length === 0) return bad('', 'bad_request', 'Nada para alterar.');
  return { ok: true, patch };
}
