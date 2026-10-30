import type { Topology } from '@workverse/shared';
import type { NetsimData, NetsimOp } from '../netsimStore';

/** Mapeamento NetsimStore <-> tabelas netsim_topologies / netsim_progress (migracoes 0010 e 0011). */

export interface NetsimRows {
  topologies: Array<{ org_id: string; version: number; topology: unknown; updated_by: string | null; updated_at: Date }>;
  progress: Array<{ org_id: string; account_id: string; challenge_id: string; best: number; attempts: number; hints: number; solved_at: Date | null; updated_at: Date }>;
}

export function netsimDataFromRows(r: NetsimRows): NetsimData {
  return {
    netsim: r.topologies.map((t) => ({ orgId: t.org_id, version: t.version, topology: t.topology as Topology, updatedBy: t.updated_by ?? '', updatedAt: t.updated_at.getTime() })),
    netsimProgress: r.progress.map((p) => ({ orgId: p.org_id, accountId: p.account_id, challengeId: p.challenge_id, best: p.best, attempts: p.attempts, hints: p.hints ?? 0, solvedAt: p.solved_at ? p.solved_at.getTime() : null, updatedAt: p.updated_at.getTime() })),
  };
}

export const UPSERT_NETSIM_SQL = `INSERT INTO netsim_topologies (org_id, version, topology, updated_by, updated_at) VALUES ($1, $2, $3::jsonb, $4, $5)
  ON CONFLICT (org_id) DO UPDATE SET version = EXCLUDED.version, topology = EXCLUDED.topology, updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at`;
export const DELETE_NETSIM_SQL = 'DELETE FROM netsim_topologies WHERE org_id = $1';
export const UPSERT_NETSIM_PROGRESS_SQL = `INSERT INTO netsim_progress (org_id, account_id, challenge_id, best, attempts, hints, solved_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
  ON CONFLICT (org_id, account_id, challenge_id) DO UPDATE SET best = EXCLUDED.best, attempts = EXCLUDED.attempts, hints = EXCLUDED.hints, solved_at = EXCLUDED.solved_at, updated_at = EXCLUDED.updated_at`;

export function netsimOpToSql(op: NetsimOp): { sql: string; params: unknown[]; key?: string } {
  switch (op.kind) {
    case 'netsim': {
      const r = op.row;
      return { sql: UPSERT_NETSIM_SQL, params: [r.orgId, r.version, JSON.stringify(r.topology), r.updatedBy || null, new Date(r.updatedAt)], key: `netsim:${r.orgId}` };
    }
    case 'netsim_delete':
      return { sql: DELETE_NETSIM_SQL, params: [op.orgId] };
    case 'netsim_progress': {
      const r = op.row;
      return { sql: UPSERT_NETSIM_PROGRESS_SQL, params: [r.orgId, r.accountId, r.challengeId, r.best, r.attempts, r.hints, r.solvedAt === null ? null : new Date(r.solvedAt), new Date(r.updatedAt)], key: `netsim_progress:${r.orgId}:${r.accountId}:${r.challengeId}` };
    }
  }
}
