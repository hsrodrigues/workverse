/**
 * Eventos e comemoracoes do escritorio (Halloween, Natal, Carnaval...). Modulo PURO e testavel: so datas e dados.
 * O servidor decide o que esta ativo (data do relogio + controle manual da staff) e avisa todos; o cliente so desenha a
 * decoracao (apps/client/src/game/eventDecor.ts) e o servidor libera os itens `event:<id>` do guarda-roupa enquanto durar.
 *
 * Datas: o calendario local do `Date` recebido (no servidor, o fuso da maquina; no navegador, o do PC). Meses sao 1..12.
 */

export type EventId =
  | 'halloween'
  | 'carnaval'
  | 'anonovo'
  | 'pascoa'
  | 'natal'
  | 'junina'
  | 'namorados'
  | 'criancas'
  | 'trabalho'
  | 'aniversario'
  | 'blackfriday'
  | 'diati';

/** Como o dia "ancora" do evento e calculado em um ano. */
export type DateRule =
  /** Dia e mes fixos (ex.: 31/10). */
  | { kind: 'fixed'; month: number; day: number }
  /** Movel pela Pascoa: `offset` dias depois do domingo de Pascoa (Carnaval = terca, 47 dias antes). */
  | { kind: 'easter'; offset: number }
  /** N-esimo dia da semana de um mes (+`offset` dias). Black Friday = 4a quinta de novembro + 1. weekday: 0 = domingo. */
  | { kind: 'nthWeekday'; month: number; weekday: number; nth: number; offset: number }
  /** Data configuravel pela empresa (aniversario da empresa); sem configuracao o evento nao acontece. */
  | { kind: 'company' };

export interface EventTheme {
  /** Cores da decoracao (#rrggbb). */
  primary: string;
  secondary: string;
  accent: string;
  /** Cor multiplicada sobre a sala (branco = sem mudanca): o "clima" de luz do evento. */
  tint: readonly [number, number, number];
  /** Cor do brilho das luzes decorativas. */
  glow: readonly [number, number, number];
}

export interface EventDef {
  id: EventId;
  /** Nome em pt-BR. */
  name: string;
  /** Frase curta para a staff e para o jogador. */
  blurb: string;
  rule: DateRule;
  /** Dias de decoracao ANTES e DEPOIS do dia ancora (inclusive). */
  before: number;
  after: number;
  /** Maior = vence quando dois eventos coincidem (a decoracao da sala usa so o primeiro; os itens liberam para todos). */
  priority: number;
  /** So acontece quando ligado de proposito (`overrides.optional` ou forcado). */
  optIn?: boolean;
  theme: EventTheme;
}

export const EVENT_DEFS: readonly EventDef[] = [
  {
    id: 'halloween',
    name: 'Halloween',
    blurb: 'Abóboras com luz, teias, morcegos e uma luz roxa e laranja.',
    rule: { kind: 'fixed', month: 10, day: 31 },
    before: 7,
    after: 1,
    priority: 60,
    theme: { primary: '#ff8a1f', secondary: '#6a3d9a', accent: '#b6f23a', tint: [236, 214, 255], glow: [255, 150, 40] },
  },
  {
    id: 'carnaval',
    name: 'Carnaval',
    blurb: 'Serpentinas, confete, máscaras e bandeirolas.',
    rule: { kind: 'easter', offset: -47 },
    before: 4,
    after: 0,
    priority: 70,
    theme: { primary: '#ffcf1f', secondary: '#1fbf6a', accent: '#e83c8a', tint: [255, 244, 236], glow: [255, 220, 90] },
  },
  {
    id: 'anonovo',
    name: 'Ano Novo',
    blurb: 'Balões, faixa FELIZ ANO NOVO, contagem para 00:00 e fogos pela janela.',
    rule: { kind: 'fixed', month: 12, day: 31 },
    before: 0,
    after: 2,
    priority: 80,
    theme: { primary: '#f4d35e', secondary: '#c9d6e8', accent: '#7aa8ff', tint: [236, 238, 255], glow: [255, 232, 150] },
  },
  {
    id: 'pascoa',
    name: 'Páscoa',
    blurb: 'Ovos coloridos e coelhinhos decorativos.',
    rule: { kind: 'easter', offset: 0 },
    before: 7,
    after: 1,
    priority: 50,
    theme: { primary: '#ff9ccf', secondary: '#9be0ff', accent: '#ffe27a', tint: [255, 246, 252], glow: [255, 200, 230] },
  },
  {
    id: 'natal',
    name: 'Natal',
    blurb: 'Árvore com pisca-pisca, guirlandas e luzinhas.',
    rule: { kind: 'fixed', month: 12, day: 25 },
    before: 1,
    after: 1,
    priority: 90,
    theme: { primary: '#d03a3a', secondary: '#2f8f4e', accent: '#ffd95a', tint: [255, 238, 232], glow: [255, 214, 120] },
  },
  {
    id: 'junina',
    name: 'Festa Junina',
    blurb: 'Bandeirinhas, balões de papel e fogueira.',
    rule: { kind: 'fixed', month: 6, day: 24 },
    before: 23,
    after: 6,
    priority: 40,
    theme: { primary: '#e8452c', secondary: '#f2c230', accent: '#3a8fd0', tint: [255, 240, 224], glow: [255, 170, 70] },
  },
  {
    id: 'namorados',
    name: 'Dia dos Namorados',
    blurb: 'Corações, buquê e uma luz rosada.',
    rule: { kind: 'fixed', month: 6, day: 12 },
    before: 2,
    after: 1,
    priority: 65,
    theme: { primary: '#ff4d7e', secondary: '#ffb3c7', accent: '#ffffff', tint: [255, 230, 238], glow: [255, 130, 170] },
  },
  {
    id: 'criancas',
    name: 'Dia das Crianças',
    blurb: 'Balões, estrelas e blocos de montar.',
    rule: { kind: 'fixed', month: 10, day: 12 },
    before: 3,
    after: 1,
    priority: 45,
    theme: { primary: '#3aa0ff', secondary: '#ffcc2e', accent: '#ff5d73', tint: [250, 250, 255], glow: [255, 240, 150] },
  },
  {
    id: 'trabalho',
    name: 'Dia do Trabalho',
    blurb: 'Faixa de homenagem e balões para quem faz o escritório acontecer.',
    rule: { kind: 'fixed', month: 5, day: 1 },
    before: 1,
    after: 0,
    priority: 30,
    theme: { primary: '#2f6fd0', secondary: '#f2c230', accent: '#ffffff', tint: [248, 250, 255], glow: [255, 232, 160] },
  },
  {
    id: 'aniversario',
    name: 'Aniversário da empresa',
    blurb: 'Balões, bolo de festa e a faixa de parabéns (a data é configurável).',
    rule: { kind: 'company' },
    before: 3,
    after: 3,
    priority: 55,
    theme: { primary: '#7a5af0', secondary: '#ffc83d', accent: '#ff6fa8', tint: [250, 244, 255], glow: [255, 220, 120] },
  },
  {
    id: 'diati',
    name: 'Dia do Profissional de TI',
    blurb: "Ponte de comando, hologramas, robozinhos, DON'T PANIC, o número 42 e neon azul, ciano e verde-matriz (a Sala da TI vira o palco).",
    rule: { kind: 'fixed', month: 10, day: 19 },
    before: 1,
    after: 1,
    priority: 66,
    theme: { primary: '#27d9ff', secondary: '#2a6bff', accent: '#39ff88', tint: [226, 240, 255], glow: [60, 210, 255] },
  },
  {
    id: 'blackfriday',
    name: 'Black Friday',
    blurb: 'Balões pretos e dourados e faixa de ofertas (evento opcional).',
    rule: { kind: 'nthWeekday', month: 11, weekday: 4, nth: 4, offset: 1 },
    before: 3,
    after: 3,
    priority: 20,
    optIn: true,
    theme: { primary: '#1c1c24', secondary: '#f0b429', accent: '#ffffff', tint: [236, 236, 244], glow: [255, 200, 80] },
  },
];

export const EVENT_IDS: readonly EventId[] = EVENT_DEFS.map((e) => e.id);
export const EVENTS_BY_ID: ReadonlyMap<string, EventDef> = new Map(EVENT_DEFS.map((e) => [e.id, e]));
export const isEventId = (v: unknown): v is EventId => typeof v === 'string' && EVENTS_BY_ID.has(v);
export const getEventDef = (id: string): EventDef | undefined => EVENTS_BY_ID.get(id);

/** Chave de desbloqueio do guarda-roupa de um evento (`event:<id>`, ver items/access.ts). */
export const eventUnlockKey = (id: string): string => `event:${id}`;

// ---- controle manual e configuracao -------------------------------------------------------------------------------

export interface MonthDay {
  month: number;
  day: number;
}

export interface EventOverrides {
  /** Eventos forcados LIGADOS pela staff (valem mesmo fora da data e mesmo sendo opcionais). */
  forced?: Iterable<string>;
  /** Eventos forcados DESLIGADOS pela staff (vencem a data; se um id estiver nas duas listas, desligar vence). */
  disabled?: Iterable<string>;
  /** Dia e mes do aniversario da empresa (o evento `aniversario`). Ausente: sem aniversario. */
  companyDate?: MonthDay | null;
  /** Eventos opcionais (`optIn`) habilitados para acontecer pela data (ex.: blackfriday). */
  optional?: Iterable<string>;
}

/** Estado de um evento para a staff: seguir a data, forcar ligado ou forcar desligado. */
export type EventMode = 'auto' | 'on' | 'off';
export const EVENT_MODES: readonly EventMode[] = ['auto', 'on', 'off'];
export const isEventMode = (v: unknown): v is EventMode => v === 'auto' || v === 'on' || v === 'off';

/** O que o servidor manda a todos (mensagem `events`): lista ativa ja resolvida + os controles manuais. */
export interface EventsView {
  active: EventId[];
  forced: EventId[];
  disabled: EventId[];
}

// ---- calendario ---------------------------------------------------------------------------------------------------

const DAY_MS = 86_400_000;
/** Numero do dia (UTC) de uma data civil: contas de dias sem erro de fuso nem de horario de verao. */
export const dayNumber = (year: number, month: number, day: number): number => Math.floor(Date.UTC(year, month - 1, day) / DAY_MS);
const fromDayNumber = (n: number): { year: number; month: number; day: number } => {
  const d = new Date(n * DAY_MS);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
};

/** Domingo de Pascoa (calendario gregoriano, algoritmo de Meeus/Jones/Butcher). */
export function easterSunday(year: number): { month: number; day: number } {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { month, day };
}

/** Terca de Carnaval (47 dias antes da Pascoa). */
export function carnivalTuesday(year: number): { month: number; day: number } {
  const e = easterSunday(year);
  const n = fromDayNumber(dayNumber(year, e.month, e.day) - 47);
  return { month: n.month, day: n.day };
}

const validMonthDay = (m: MonthDay | null | undefined): m is MonthDay =>
  !!m && Number.isInteger(m.month) && Number.isInteger(m.day) && m.month >= 1 && m.month <= 12 && m.day >= 1 && m.day <= 31;

/** Numero do dia "ancora" do evento no ano, ou null quando a regra nao se aplica (aniversario sem data). */
export function eventAnchor(def: EventDef, year: number, overrides: EventOverrides = {}): number | null {
  const r = def.rule;
  switch (r.kind) {
    case 'fixed':
      return dayNumber(year, r.month, r.day);
    case 'easter': {
      const e = easterSunday(year);
      return dayNumber(year, e.month, e.day) + r.offset;
    }
    case 'nthWeekday': {
      const first = new Date(Date.UTC(year, r.month - 1, 1)).getUTCDay();
      const day = 1 + ((r.weekday - first + 7) % 7) + (r.nth - 1) * 7;
      return dayNumber(year, r.month, day) + r.offset;
    }
    case 'company': {
      const c = overrides.companyDate;
      if (!validMonthDay(c)) return null;
      // 29/02 em ano comum cai em 28/02
      const last = new Date(Date.UTC(year, c.month, 0)).getUTCDate();
      return dayNumber(year, c.month, Math.min(c.day, last));
    }
  }
}

export interface EventSpan {
  /** Primeiro e ultimo dia (inclusive) da decoracao, como `{ year, month, day }`. */
  start: { year: number; month: number; day: number };
  end: { year: number; month: number; day: number };
  anchor: { year: number; month: number; day: number };
}

/** Janela do evento no ano (a janela pode invadir o ano vizinho: Ano Novo vai de 31/12 a 02/01). */
export function eventSpan(def: EventDef, year: number, overrides: EventOverrides = {}): EventSpan | null {
  const a = eventAnchor(def, year, overrides);
  if (a === null) return null;
  return { start: fromDayNumber(a - def.before), end: fromDayNumber(a + def.after), anchor: fromDayNumber(a) };
}

const toSet = (v: Iterable<string> | undefined): Set<string> => new Set(v ?? []);
const dayOf = (date: Date | number): number => {
  const d = typeof date === 'number' ? new Date(date) : date;
  return dayNumber(d.getFullYear(), d.getMonth() + 1, d.getDate());
};

/** Esse evento acontece na data (so pela data e pelo opt-in; sem olhar forcados/desligados)? */
export function eventOnDate(def: EventDef, date: Date | number, overrides: EventOverrides = {}): boolean {
  if (def.optIn && !toSet(overrides.optional).has(def.id)) return false;
  const day = dayOf(date);
  const year = (typeof date === 'number' ? new Date(date) : date).getFullYear();
  // a janela de um evento de dezembro cai em janeiro e vice-versa: testa os anos vizinhos tambem
  for (const y of [year - 1, year, year + 1]) {
    const a = eventAnchor(def, y, overrides);
    if (a !== null && day >= a - def.before && day <= a + def.after) return true;
  }
  return false;
}

/**
 * Eventos ativos agora, do de maior prioridade para o de menor. Pela data (e pelos opcionais ligados), mais os
 * `forced`; menos os `disabled`. Ordem estavel: prioridade, depois a ordem da tabela.
 */
export function activeEvents(date: Date | number, overrides: EventOverrides = {}): EventDef[] {
  const forced = toSet(overrides.forced);
  const disabled = toSet(overrides.disabled);
  return EVENT_DEFS.filter((def) => !disabled.has(def.id) && (forced.has(def.id) || eventOnDate(def, date, overrides))).sort(
    (a, b) => b.priority - a.priority,
  );
}

/** Proxima janela (ou a atual) do evento a partir de `date`, para a staff ver quando acontece. Null: sem data. */
export function nextEventSpan(def: EventDef, date: Date | number, overrides: EventOverrides = {}): EventSpan | null {
  const day = dayOf(date);
  const year = (typeof date === 'number' ? new Date(date) : date).getFullYear();
  for (const y of [year - 1, year, year + 1, year + 2]) {
    const s = eventSpan(def, y, overrides);
    if (!s) continue;
    if (dayNumber(s.end.year, s.end.month, s.end.day) >= day) return s;
  }
  return null;
}

export const formatDayMonth = (d: { month: number; day: number }): string => `${String(d.day).padStart(2, '0')}/${String(d.month).padStart(2, '0')}`;

/** Ids de evento cujos itens de avatar estao liberados agora (a chave `event:<id>` do guarda-roupa). */
export const eventUnlockKeys = (active: Iterable<{ id: string }>): string[] => [...active].map((e) => eventUnlockKey(e.id));

/** Ano exibido nos acessorios de Ano Novo: a partir de julho, o ano que vem; senao o corrente (1 e 2 de janeiro). */
export const newYearNumber = (date: Date | number): number => {
  const d = typeof date === 'number' ? new Date(date) : date;
  return d.getMonth() >= 6 ? d.getFullYear() + 1 : d.getFullYear();
};
