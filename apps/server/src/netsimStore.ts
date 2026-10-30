import { validateTopology, type Topology } from '@workverse/shared';

/**
 * Projeto de rede do simulador (docs/netsim.md): UMA topologia por organizacao, versionada, e o progresso dos desafios por conta.
 * Dados puros em memoria, espelhados pelos stores persistentes (JSON/PostgreSQL) por `onOp`, como o BookingStore.
 * Tudo e indexado por organizacao: outra org nunca le estas linhas.
 */

export interface NetsimRow {
  orgId: string;
  /** 1 na primeira gravacao; cresce a cada edicao (controle de conflito). */
  version: number;
  topology: Topology;
  updatedBy: string;
  updatedAt: number;
}

export interface NetsimProgressRow {
  orgId: string;
  accountId: string;
  challengeId: string;
  /** Melhor pontuacao (0..100). */
  best: number;
  attempts: number;
  /** Quando resolveu pela primeira vez; null enquanto nao resolveu. */
  solvedAt: number | null;
  updatedAt: number;
}

export interface NetsimData {
  netsim?: NetsimRow[];
  netsimProgress?: NetsimProgressRow[];
}

export type NetsimOp = { kind: 'netsim'; row: NetsimRow } | { kind: 'netsim_progress'; row: NetsimProgressRow } | { kind: 'netsim_delete'; orgId: string };

const progKey = (orgId: string, accountId: string, challengeId: string) => `${orgId} ${accountId} ${challengeId}`;

export class NetsimStore {
  private readonly rows = new Map<string, NetsimRow>();
  private readonly progress = new Map<string, NetsimProgressRow>();
  /** Definido pelo store persistente; nao e chamado ao carregar. */
  onOp: ((op: NetsimOp) => void) | null = null;

  get(orgId: string): NetsimRow | undefined {
    return this.rows.get(orgId);
  }
  put(row: NetsimRow): void {
    this.rows.set(row.orgId, row);
    this.onOp?.({ kind: 'netsim', row });
  }
  delete(orgId: string): void {
    if (this.rows.delete(orgId)) this.onOp?.({ kind: 'netsim_delete', orgId });
  }

  getProgress(orgId: string, accountId: string, challengeId: string): NetsimProgressRow | undefined {
    return this.progress.get(progKey(orgId, accountId, challengeId));
  }
  progressOfOrg(orgId: string): NetsimProgressRow[] {
    return [...this.progress.values()].filter((r) => r.orgId === orgId);
  }
  progressOf(orgId: string, accountId: string): NetsimProgressRow[] {
    return this.progressOfOrg(orgId).filter((r) => r.accountId === accountId);
  }
  putProgress(row: NetsimProgressRow): void {
    this.progress.set(progKey(row.orgId, row.accountId, row.challengeId), row);
    this.onOp?.({ kind: 'netsim_progress', row });
  }

  snapshot(): Required<NetsimData> {
    return { netsim: [...this.rows.values()], netsimProgress: [...this.progress.values()] };
  }

  /** Carrega linhas sem avisar `onOp`. Topologia invalida em arquivo e descartada (a org volta ao modelo padrao). */
  load(data: NetsimData): void {
    for (const r of data.netsim ?? []) {
      if (!r || typeof r.orgId !== 'string' || !Number.isInteger(r.version) || r.version < 1) continue;
      const v = validateTopology(r.topology);
      if (!v.ok) continue;
      this.rows.set(r.orgId, { orgId: r.orgId, version: r.version, topology: v.value, updatedBy: typeof r.updatedBy === 'string' ? r.updatedBy : '', updatedAt: Number.isFinite(r.updatedAt) ? r.updatedAt : 0 });
    }
    for (const r of data.netsimProgress ?? []) {
      if (!r || typeof r.orgId !== 'string' || typeof r.accountId !== 'string' || typeof r.challengeId !== 'string') continue;
      this.progress.set(progKey(r.orgId, r.accountId, r.challengeId), {
        orgId: r.orgId,
        accountId: r.accountId,
        challengeId: r.challengeId,
        best: Number.isFinite(r.best) ? Math.max(0, Math.min(100, Math.round(r.best))) : 0,
        attempts: Number.isInteger(r.attempts) && r.attempts >= 0 ? r.attempts : 0,
        solvedAt: Number.isFinite(r.solvedAt) ? (r.solvedAt as number) : null,
        updatedAt: Number.isFinite(r.updatedAt) ? r.updatedAt : 0,
      });
    }
  }
}
