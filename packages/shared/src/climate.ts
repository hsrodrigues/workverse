import type { FurniKind } from './rooms';

/**
 * Ar-condicionado e temperatura das salas. Tudo PURO (sem I/O): o servidor e dono do estado por sala (RoomInstance) e o
 * cliente so desenha. O ar liga/desliga em conjunto na sala (todas as unidades mostram o mesmo estado) e o controle remoto
 * (modo, meta, ventilador, aletas, timer) e um so por sala. A temperatura ambiente e simulada a cada `CLIMATE_STEP_MS`.
 */

/** Pecas que sao uma unidade de ar-condicionado (liga/desliga a sala). */
export const AC_UNIT_KINDS: readonly FurniKind[] = ['ac_split', 'ac_floor'];
export const isAcUnit = (kind: FurniKind): boolean => AC_UNIT_KINDS.includes(kind);
/** O termostato abre o mesmo controle remoto. */
export const THERMOSTAT_KIND: FurniKind = 'thermostat';
/** Pecas que usam o clima da sala (as que mostram temperatura no desenho). */
export const CLIMATE_KINDS: readonly FurniKind[] = ['ac_split', 'ac_floor', 'thermostat'];

export const TARGET_MIN = 18;
export const TARGET_MAX = 26;
export const DEFAULT_TARGET = 23;

/** Modos do controle: Frio, Eco (meta +2 e puxa mais devagar), Ventilar (so brisa, nao esfria) e Auto. */
export type AcMode = 'cool' | 'eco' | 'fan' | 'auto';
export const AC_MODE_LIST: readonly AcMode[] = ['cool', 'eco', 'fan', 'auto'];
export const AC_MODE_LABELS: Readonly<Record<AcMode, string>> = { cool: 'Frio', eco: 'Eco', fan: 'Ventilar', auto: 'Auto' };
export type AcFan = 'low' | 'mid' | 'high' | 'auto';
export const AC_FAN_LIST: readonly AcFan[] = ['low', 'mid', 'high', 'auto'];
export const AC_FAN_LABELS: Readonly<Record<AcFan, string>> = { low: 'Baixa', mid: 'Média', high: 'Alta', auto: 'Auto' };
/** Opcoes do timer de desligamento, em minutos (0 = sem timer). */
export const AC_TIMER_OPTIONS: readonly number[] = [0, 30, 60, 120];

export const isAcMode = (v: unknown): v is AcMode => typeof v === 'string' && (AC_MODE_LIST as readonly string[]).includes(v);
export const isAcFan = (v: unknown): v is AcFan => typeof v === 'string' && (AC_FAN_LIST as readonly string[]).includes(v);

/** Temperatura de fora/base de todas as salas, em graus Celsius. */
export const BASE_TEMP = 24;
/** Acima disso, sem ar, os racks da Sala da TI mostram o alerta de superaquecimento. */
export const OVERHEAT_TEMP = 30;
/** O alerta so some abaixo disso (histerese, evita piscar). */
export const OVERHEAT_CLEAR = 29;
/** Intervalo da simulacao no servidor. */
export const CLIMATE_STEP_MS = 5000;
/** Calor por pessoa e por rack ligado; o ambiente tende a `BASE_TEMP + carga`. */
export const HEAT_PER_PERSON = 0.22;
export const HEAT_PER_RACK = 0.7;
/** Fracao da diferenca ate o equilibrio que a sala percorre por passo. */
const ENV_RATE = 0.06;
/** Quanto cada unidade esfria por passo (a de piso e mais forte). */
export const COOL_PER_UNIT: Readonly<Record<string, number>> = { ac_split: 0.22, ac_floor: 0.4 };
/** Multiplicador do ventilador (a velocidade da brisa no desenho usa o mesmo numero). */
export const FAN_SPEED: Readonly<Record<AcFan, number>> = { low: 0.6, mid: 1, high: 1.6, auto: 1 };
/** O Eco puxa mais devagar. */
export const ECO_RATE = 0.6;
export const ECO_OFFSET = 2;

export interface ClimateView {
  /** Ar-condicionado ligado (vale para todas as unidades da sala). */
  on: boolean;
  /** Temperatura-alvo (TARGET_MIN..TARGET_MAX). */
  target: number;
  /** Temperatura ambiente, uma casa decimal. */
  temp: number;
  /** Racks superaquecendo: o desenho mostra LEDs vermelhos. */
  overheat: boolean;
  mode: AcMode;
  fan: AcFan;
  /** Aletas balancando. */
  swing: boolean;
  /** Tempo que falta para o timer desligar o ar, em ms (0 = sem timer). Relativo ao momento do envio. */
  timerLeftMs: number;
}

export const defaultClimate = (): ClimateView => ({ on: false, target: DEFAULT_TARGET, temp: BASE_TEMP, overheat: false, mode: 'cool', fan: 'auto', swing: true, timerLeftMs: 0 });

export const clampTarget = (n: number): number => (Number.isFinite(n) ? Math.min(TARGET_MAX, Math.max(TARGET_MIN, Math.round(n))) : DEFAULT_TARGET);

/** Pedido do controle remoto (`climate_set`): todos os campos sao opcionais. */
export interface ClimateSet {
  power?: boolean;
  target?: number;
  mode?: AcMode;
  fan?: AcFan;
  swing?: boolean;
  timerMin?: number;
}

/** Valida estritamente um `climate_set`: devolve o pedido limpo ou null (campo desconhecido, tipo errado, fora dos limites ou vazio). */
export function parseClimateSet(raw: unknown): ClimateSet | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const out: ClimateSet = {};
  for (const k of Object.keys(r)) {
    if (k === 't') continue;
    const v = r[k];
    if (k === 'power' && typeof v === 'boolean') out.power = v;
    else if (k === 'swing' && typeof v === 'boolean') out.swing = v;
    else if (k === 'target' && typeof v === 'number' && Number.isInteger(v) && v >= TARGET_MIN && v <= TARGET_MAX) out.target = v;
    else if (k === 'mode' && isAcMode(v)) out.mode = v;
    else if (k === 'fan' && isAcFan(v)) out.fan = v;
    else if (k === 'timerMin' && typeof v === 'number' && AC_TIMER_OPTIONS.includes(v)) out.timerMin = v;
    else return null;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** Meta efetiva da simulacao: o Eco aceita 2 graus a mais. */
export const effectiveTarget = (mode: AcMode, target: number): number => (mode === 'eco' ? target + ECO_OFFSET : target);
/** O ar esta esfriando de fato (ligado e fora do modo Ventilar)? */
export const isCooling = (on: boolean, mode: AcMode): boolean => on && mode !== 'fan';

/** Temperatura de equilibrio de uma sala com `people` pessoas e `racks` racks de servidor ligados (sem ar). */
export const equilibriumTemp = (people: number, racks: number): number => BASE_TEMP + Math.max(0, people) * HEAT_PER_PERSON + Math.max(0, racks) * HEAT_PER_RACK;

export interface ClimateInput {
  temp: number;
  people: number;
  racks: number;
  on: boolean;
  target: number;
  mode?: AcMode;
  fan?: AcFan;
  /** Unidades de ar na sala por tipo (ex.: { ac_split: 2, ac_floor: 1 }). */
  units: Readonly<Record<string, number>>;
}

/** Um passo da simulacao: o ambiente tende ao equilibrio; com o ar esfriando a temperatura desce ate a meta efetiva (nunca abaixo dela). */
export function stepTemperature(i: ClimateInput): number {
  const mode = i.mode ?? 'cool';
  const fan = i.fan ?? 'auto';
  const eq = equilibriumTemp(i.people, i.racks);
  let t = i.temp + (eq - i.temp) * ENV_RATE;
  if (isCooling(i.on, mode)) {
    let cool = 0;
    for (const [k, n] of Object.entries(i.units)) cool += (COOL_PER_UNIT[k] ?? 0) * n;
    cool *= FAN_SPEED[fan] * (mode === 'eco' ? ECO_RATE : 1);
    const goal = effectiveTarget(mode, i.target);
    if (cool > 0 && t > goal) t = Math.max(goal, t - cool);
  }
  return Math.round(t * 100) / 100;
}

/** Superaquecimento com histerese: so vale com racks e sem ar esfriando (`cooling`). */
export function overheating(prev: boolean, temp: number, racks: number, cooling: boolean): boolean {
  if (racks <= 0 || cooling) return false;
  return prev ? temp >= OVERHEAT_CLEAR : temp > OVERHEAT_TEMP;
}

export const roundTemp = (t: number): number => Math.round(t * 10) / 10;
/** "22" para o display e para o chip do HUD. */
export const tempDigits = (t: number): string => String(Math.round(t));

/** "29:12" a partir de milissegundos. */
export function formatCountdown(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(s / 60);
  return `${m >= 60 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}` : String(m)}:${String(s % 60).padStart(2, '0')}`;
}
