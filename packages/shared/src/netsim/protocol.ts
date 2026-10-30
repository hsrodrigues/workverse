import type { NetOp } from './ops';
import type { ObjectiveResult, ScoreBreakdown } from './challenges';
import type { SimResult, Topology } from './types';

/** Mensagens do simulador de rede (docs/netsim.md). Todas as chaves comecam com `netsim_`. */

export const NETSIM_MAX_OPS = 8;
export const NETSIM_ACTIONS = ['ping', 'traceroute', 'browse', 'nslookup', 'internet'] as const;
export type NetsimAction = (typeof NETSIM_ACTIONS)[number];
export const isNetsimAction = (v: unknown): v is NetsimAction => typeof v === 'string' && (NETSIM_ACTIONS as readonly string[]).includes(v);
export const NETSIM_IT_ONLY_MESSAGE = 'Somente a equipe de TI pode alterar a rede. Você pode ver e testar em modo leitura.';
export const isNetsimMessageType = (t: unknown): t is string => typeof t === 'string' && t.startsWith('netsim_');

export type NetsimErrorCode = 'it_only' | 'conflict' | 'invalid' | 'rate_limited' | 'not_found' | 'nothing_to_undo' | 'guest' | 'no_session';

export type NetsimClientMessage =
  /** Abre/assina o projeto de rede da organizacao (qualquer membro; visitantes nao). */
  | { t: 'netsim_get' }
  /** Edicoes atomicas (so TI). `base` = versao que o cliente viu; diferente => conflito e o estado atual volta. */
  | { t: 'netsim_edit'; rid: number; base: number; ops: NetOp[] }
  | { t: 'netsim_undo'; rid: number; base: number }
  | { t: 'netsim_reset'; rid: number; base: number }
  /** Executa ping/traceroute/navegar/nslookup/testar internet (so le; qualquer membro). */
  | { t: 'netsim_run'; rid: number; action: NetsimAction; src: string; target?: string }
  /** Desafios "Conserte a rede": lista com o progresso da conta e o placar. Qualquer membro (nao visitante). */
  | { t: 'netsim_challenges' }
  /** Comeca (ou recomeca) um desafio em uma topologia SEPARADA (sandbox em memoria); a rede real nunca e tocada. */
  | { t: 'netsim_challenge_start'; rid: number; id: string; resume?: boolean }
  /** Edicoes no sandbox (qualquer membro). `base` = versao do sandbox vista pelo cliente. */
  | { t: 'netsim_challenge_edit'; rid: number; base: number; ops: NetOp[] }
  /** Verifica os objetivos (autoritativo no servidor); se todos passam, calcula e grava a pontuacao. */
  | { t: 'netsim_challenge_check'; rid: number }
  | { t: 'netsim_challenge_hint'; rid: number }
  | { t: 'netsim_challenge_quit'; rid: number };

export interface ChallengeProgressView {
  id: string;
  /** Melhor pontuacao (0..100). */
  best: number;
  attempts: number;
  solved: boolean;
  /** Dicas usadas na melhor execucao. */
  hints: number;
}

export interface ChallengeBoardRow {
  rank: number;
  /** Nome de exibicao (nada alem disso). */
  name: string;
  solved: number;
  points: number;
  me: boolean;
}

export interface ChallengeSessionPayload {
  id: string;
  /** Versao do sandbox (cresce a cada edicao). */
  version: number;
  topology: Topology;
  /** Dicas ja reveladas (texto). */
  hints: string[];
  /** Custo em pontos da proxima dica (null = acabaram). */
  nextHintCost: number | null;
  failedChecks: number;
  elapsedSec: number;
  /** true depois que todos os objetivos passaram (a sessao fica so para consulta). */
  solved: boolean;
}

export interface ChallengeCheckPayload {
  results: ObjectiveResult[];
  solved: boolean;
  /** So quando resolvido. */
  breakdown?: ScoreBreakdown;
  newBest?: boolean;
  best?: number;
  totalPoints?: number;
}

export interface NetsimStatePayload {
  /** 0 = ainda e o modelo padrao gerado do inventario (nunca editado). */
  version: number;
  topology: Topology;
  canEdit: boolean;
  canUndo: boolean;
  updatedAt: number;
  updatedBy: string;
  /** Estacoes do inventario que nao couberam nos limites ao gerar o modelo padrao. */
  omitted: number;
}

export type NetsimServerMessage =
  | { t: 'netsim_open' }
  | ({ t: 'netsim_state'; rid?: number } & NetsimStatePayload)
  | { t: 'netsim_result'; rid: number; action: NetsimAction; src: string; target?: string; result: SimResult }
  | { t: 'netsim_challenges_state'; rid?: number; progress: ChallengeProgressView[]; board: ChallengeBoardRow[]; activeId: string | null; totalPoints: number }
  | { t: 'netsim_challenge_session'; rid?: number; session: ChallengeSessionPayload }
  | ({ t: 'netsim_challenge_result'; rid: number } & ChallengeCheckPayload)
  | { t: 'netsim_error'; rid?: number; code: NetsimErrorCode; message: string };
