import { EVENT_DEFS, activeEvents, getEventDef, isEventId, type EventMode, type EventOverrides, type EventsView, type MonthDay } from '@workverse/shared';

/**
 * Eventos e comemoracoes (Halloween, Natal, Carnaval...): o servidor e a fonte unica do que esta ativo, para todos verem
 * a mesma decoracao. O estado e a DATA do relogio do servidor mais os controles manuais da staff (forcar ligado/desligado,
 * `staff_event`). Os controles ficam em memoria (como as salas trancadas): reiniciar o servidor volta tudo ao automatico.
 *
 * Configuracao por ambiente:
 *   WORKVERSE_COMPANY_DATE      dia do aniversario da empresa: `DD/MM` (ex.: 15/03), `MM-DD` ou `AAAA-MM-DD`.
 *   WORKVERSE_OPTIONAL_EVENTS   eventos opcionais que acontecem pela data (ex.: `blackfriday`).
 */

/** `DD/MM`, `MM-DD` ou `AAAA-MM-DD` -> dia e mes; null quando invalido. */
export function parseCompanyDate(raw: string | undefined): MonthDay | null {
  const s = (raw ?? '').trim();
  if (!s) return null;
  let month: number;
  let day: number;
  let m = /^(\d{1,2})\/(\d{1,2})$/.exec(s);
  if (m) {
    day = Number(m[1]);
    month = Number(m[2]);
  } else if ((m = /^(?:\d{4}-)?(\d{1,2})-(\d{1,2})$/.exec(s))) {
    month = Number(m[1]);
    day = Number(m[2]);
  } else return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  // dias que nao existem naquele mes (31/04) nao valem
  if (day > new Date(Date.UTC(2024, month, 0)).getUTCDate()) return null;
  return { month, day };
}

/** `a,b,c` -> ids de evento conhecidos. */
export function parseOptionalEvents(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(/[,;\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => isEventId(s));
}

export interface EventsConfig {
  companyDate?: MonthDay | null;
  optional?: readonly string[];
}

export class EventsService {
  private readonly forced = new Set<string>();
  private readonly disabled = new Set<string>();
  private lastSig = '';

  constructor(
    private readonly clock: () => number,
    private readonly cfg: EventsConfig = {},
  ) {}

  private overrides(): EventOverrides {
    return { forced: this.forced, disabled: this.disabled, companyDate: this.cfg.companyDate ?? null, optional: this.cfg.optional ?? [] };
  }

  /** Ids ativos agora (do de maior prioridade para o de menor). */
  activeIds(now = this.clock()): string[] {
    return activeEvents(now, this.overrides()).map((e) => e.id);
  }

  view(now = this.clock()): EventsView {
    return {
      active: this.activeIds(now) as EventsView['active'],
      forced: [...this.forced] as EventsView['forced'],
      disabled: [...this.disabled] as EventsView['disabled'],
    };
  }

  modeOf(id: string): EventMode {
    return this.forced.has(id) ? 'on' : this.disabled.has(id) ? 'off' : 'auto';
  }

  /** Liga, desliga ou devolve ao automatico. Retorna false se nada mudou (ou o id nao existe). */
  setMode(id: string, mode: EventMode): boolean {
    if (!getEventDef(id)) return false;
    if (this.modeOf(id) === mode) return false;
    this.forced.delete(id);
    this.disabled.delete(id);
    if (mode === 'on') this.forced.add(id);
    else if (mode === 'off') this.disabled.add(id);
    return true;
  }

  /**
   * True quando a lista ativa mudou desde a ultima chamada (virada do dia, evento forcado...). Chamado no tick do mundo;
   * quem recebe `true` deve avisar todos. A primeira chamada so memoriza (a sessao nova recebe o estado no login).
   */
  changed(now = this.clock()): boolean {
    const sig = `${this.activeIds(now).join(',')}|${[...this.forced].sort().join(',')}|${[...this.disabled].sort().join(',')}`;
    const first = this.lastSig === '';
    const diff = sig !== this.lastSig;
    this.lastSig = sig;
    return diff && !first;
  }

  /** Nomes de todos os eventos (para respostas de staff). */
  static name(id: string): string {
    return getEventDef(id)?.name ?? id;
  }

  static get all() {
    return EVENT_DEFS;
  }
}
