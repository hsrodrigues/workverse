/**
 * Quando entrar e quando sair da chamada (sala do LiveKit). Logica PURA, sem rede nem DOM: o MediaClient so alimenta isto com o
 * estado atual e executa a decisao. Veja docs/media-economy.md.
 *
 * Cada minuto conectado conta na cota do LiveKit, mesmo calado. Por isso, com a economia ligada, a pessoa so fica na chamada quando:
 *  (a) ela transmite (ou acabou de ligar mic/camera/tela);
 *  (b) alguem da MESMA sala esta publicando (o servidor avisa por `media_active`, sem depender de a pessoa estar na chamada);
 *  (c) ha palco/TV ativo na sala.
 * Fora isso, sai depois de `idleDisconnectSeconds`. Aba em segundo plano ha muito tempo ou pessoa ausente (e sem transmitir) tambem saem.
 */

export interface GateInputs {
  /** Esta numa sala do mundo. */
  inRoom: boolean;
  /** Regras de economia valendo (politica do servidor). Falso = comportamento antigo: conecta ao entrar na sala. */
  economy: boolean;
  /** Cota mensal estourada: nao ha token. */
  quotaExceeded: boolean;
  /** Eu transmito (mic/camera/tela ligados) ou acabei de pedir para ligar. */
  publishing: boolean;
  /** Outra pessoa da sala esta publicando. */
  othersPublishing: boolean;
  /** Palco/TV da sala em uso (alguem apresentando). */
  stageLive: boolean;
  /** Ha quanto tempo a aba esta em segundo plano (0 = visivel). */
  hiddenForMs: number;
  hiddenLimitMs: number;
  /** Status `ausente` (manual ou automatico). */
  away: boolean;
}

export type DemandReason = 'always' | 'publish' | 'others' | 'stage';
export type Suspension = 'quota' | 'hidden' | 'away';

export interface Demand {
  /** A pessoa precisa da chamada agora. */
  want: boolean;
  reason: DemandReason | null;
  /** Por que a chamada esta pausada apesar de talvez haver gente falando. */
  suspended: Suspension | null;
  /** Reavaliar depois deste tempo (aba escondida chegando ao limite). */
  recheckInMs: number | null;
}

export function evaluateDemand(i: GateInputs): Demand {
  const none = (suspended: Suspension | null = null, recheckInMs: number | null = null): Demand => ({ want: false, reason: null, suspended, recheckInMs });
  if (!i.inRoom) return none();
  if (i.quotaExceeded) return none('quota');
  if (!i.economy) return { want: true, reason: 'always', suspended: null, recheckInMs: null };
  // quem transmite nunca e pausado (esta apresentando ou falando: a aba escondida nao importa)
  if (i.publishing) return { want: true, reason: 'publish', suspended: null, recheckInMs: null };
  let recheck: number | null = null;
  if (i.hiddenForMs > 0) {
    if (i.hiddenForMs >= i.hiddenLimitMs) return none('hidden');
    recheck = i.hiddenLimitMs - i.hiddenForMs;
  }
  if (i.away) return none('away', recheck);
  if (i.othersPublishing) return { want: true, reason: 'others', suspended: null, recheckInMs: recheck };
  if (i.stageLive) return { want: true, reason: 'stage', suspended: null, recheckInMs: recheck };
  return none(null, recheck);
}

export interface GateDecision {
  /** Deve estar conectado. */
  connect: boolean;
  /** Chamar `decide` de novo depois deste tempo (fim da tolerancia de ociosidade, limite da aba escondida). */
  recheckInMs: number | null;
}

/**
 * Acrescenta a tolerancia de ociosidade: depois que ninguem precisa mais da chamada, ela fica aberta por `idleMs` (padrao 20 s)
 * para nao desconectar/reconectar a cada pausa de uma conversa. Pausas por aba escondida/ausencia/cota saem na hora.
 */
export class ConnectGate {
  private lastNeed = Number.NEGATIVE_INFINITY;

  constructor(private idleMs: number) {}

  setIdleMs(ms: number) {
    this.idleMs = Math.max(0, ms);
  }

  reset() {
    this.lastNeed = Number.NEGATIVE_INFINITY;
  }

  decide(d: Demand, connected: boolean, now: number): GateDecision {
    if (d.want) {
      this.lastNeed = now;
      return { connect: true, recheckInMs: d.recheckInMs };
    }
    if (d.suspended) {
      this.lastNeed = Number.NEGATIVE_INFINITY;
      return { connect: false, recheckInMs: d.recheckInMs };
    }
    if (connected) {
      const left = this.idleMs - (now - this.lastNeed);
      if (left > 0) return { connect: true, recheckInMs: d.recheckInMs === null ? left : Math.min(left, d.recheckInMs) };
    }
    return { connect: false, recheckInMs: d.recheckInMs };
  }
}

/** Direitos que a camera/tela tem de ser negados no cliente, com a causa mais provavel (para a mensagem). */
export function videoDenialReason(opts: { strict: boolean; videoPublishers: number; maxVideo: number; iPublishVideo: boolean }): 'strict' | 'limit' | null {
  if (opts.strict) return 'strict';
  if (opts.maxVideo > 0 && !opts.iPublishVideo && opts.videoPublishers >= opts.maxVideo) return 'limit';
  return null;
}
