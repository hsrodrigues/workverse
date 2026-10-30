import type { NetOp } from './ops';
import type { SimResult, Topology } from './types';

/** Mensagens do simulador de rede (docs/netsim.md). Todas as chaves comecam com `netsim_`. */

export const NETSIM_MAX_OPS = 8;
export const NETSIM_ACTIONS = ['ping', 'traceroute', 'browse', 'nslookup', 'internet'] as const;
export type NetsimAction = (typeof NETSIM_ACTIONS)[number];
export const isNetsimAction = (v: unknown): v is NetsimAction => typeof v === 'string' && (NETSIM_ACTIONS as readonly string[]).includes(v);
export const NETSIM_IT_ONLY_MESSAGE = 'Somente a equipe de TI pode alterar a rede. Você pode ver e testar em modo leitura.';
export const isNetsimMessageType = (t: unknown): t is string => typeof t === 'string' && t.startsWith('netsim_');

export type NetsimErrorCode = 'it_only' | 'conflict' | 'invalid' | 'rate_limited' | 'not_found' | 'nothing_to_undo' | 'guest';

export type NetsimClientMessage =
  /** Abre/assina o projeto de rede da organizacao (qualquer membro; visitantes nao). */
  | { t: 'netsim_get' }
  /** Edicoes atomicas (so TI). `base` = versao que o cliente viu; diferente => conflito e o estado atual volta. */
  | { t: 'netsim_edit'; rid: number; base: number; ops: NetOp[] }
  | { t: 'netsim_undo'; rid: number; base: number }
  | { t: 'netsim_reset'; rid: number; base: number }
  /** Executa ping/traceroute/navegar/nslookup/testar internet (so le; qualquer membro). */
  | { t: 'netsim_run'; rid: number; action: NetsimAction; src: string; target?: string };

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
  | { t: 'netsim_error'; rid?: number; code: NetsimErrorCode; message: string };
