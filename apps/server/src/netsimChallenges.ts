import { randomUUID } from 'node:crypto';
import {
  HINT_COST,
  MAX_HINTS,
  NETSIM_MAX_OPS,
  allPassed,
  applyOp,
  evaluateObjectives,
  getChallenge,
  scoreChallenge,
  type Challenge,
  type ChallengeBoardRow,
  type ChallengeProgressView,
  type ChallengeSessionPayload,
  type ClientMessage,
  type NetOp,
  type NetsimErrorCode,
  type Topology,
} from '@workverse/shared';
import { TokenBucket } from './limiter';
import type { NetsimProgressRow } from './netsimStore';
import type { Player } from './room';
import type { AccountStore } from './store';

/**
 * Desafios "Conserte a rede" (docs/netsim.md). Cada pessoa tem NO MAXIMO um sandbox em memoria, com uma COPIA da topologia do
 * desafio: a rede real da organizacao nunca e lida nem alterada aqui. Qualquer membro (nao visitante) joga; o servidor e quem
 * confere os objetivos e calcula a pontuacao (o cliente so mostra). Progresso por conta em `netsim_progress`.
 */

export interface ChallengeHost {
  store: AccountStore;
  clock: () => number;
  log: (event: string, data?: Record<string, unknown>) => void;
}

interface Session {
  orgId: string;
  challenge: Challenge;
  topo: Topology;
  version: number;
  startedAt: number;
  hints: number;
  failed: number;
  solved: boolean;
}

const CHALLENGE_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 1e9;
const BOARD_SIZE = 10;
const MAX_SESSIONS = 2000;

export class ChallengeService {
  private readonly sessions = new Map<string, Session>();
  private readonly buckets = new Map<string, TokenBucket>();

  constructor(private readonly host: ChallengeHost) {}

  /** Devolve false se a mensagem for malformada (vira strike no mundo). Visitantes ja foram barrados por quem chama. */
  handle(p: Player, msg: ClientMessage, now: number): boolean {
    switch (msg.t) {
      case 'netsim_challenges':
        if (!this.take(p, 'list', now)) return this.limited(p, undefined);
        this.sendList(p);
        return true;
      case 'netsim_challenge_start':
        if (!isInt(msg.rid) || typeof msg.id !== 'string' || !CHALLENGE_ID.test(msg.id)) return false;
        if (msg.resume !== undefined && typeof msg.resume !== 'boolean') return false;
        return this.start(p, msg.rid, msg.id, now, msg.resume === true);
      case 'netsim_challenge_edit':
        if (!isInt(msg.rid) || !isInt(msg.base) || !Array.isArray(msg.ops) || msg.ops.length < 1 || msg.ops.length > NETSIM_MAX_OPS) return false;
        if (msg.ops.some((o) => typeof o !== 'object' || o === null || typeof (o as { op?: unknown }).op !== 'string')) return false;
        return this.edit(p, msg.rid, msg.base, msg.ops as NetOp[], now);
      case 'netsim_challenge_check':
        if (!isInt(msg.rid)) return false;
        return this.check(p, msg.rid, now);
      case 'netsim_challenge_hint':
        if (!isInt(msg.rid)) return false;
        return this.hint(p, msg.rid, now);
      case 'netsim_challenge_quit':
        if (!isInt(msg.rid)) return false;
        if (!this.take(p, 'ctl', now)) return this.limited(p, msg.rid);
        this.sessions.delete(p.accountId);
        this.sendList(p, msg.rid);
        return true;
      default:
        return false;
    }
  }

  forget(accountId: string) {
    this.sessions.delete(accountId);
    for (const k of this.buckets.keys()) if (k.endsWith(` ${accountId}`)) this.buckets.delete(k);
  }

  // ---------------------------------------------------------------- util

  private take(p: Player, kind: 'list' | 'ctl' | 'edit' | 'check', now: number): boolean {
    const k = `${kind} ${p.accountId}`;
    let b = this.buckets.get(k);
    if (!b) {
      if (this.buckets.size > 4000) for (const [key, v] of this.buckets) if (v.isIdle(now)) this.buckets.delete(key);
      b = kind === 'edit' ? new TokenBucket(10, 3, now) : kind === 'check' ? new TokenBucket(6, 0.5, now) : new TokenBucket(8, 1, now);
      this.buckets.set(k, b);
    }
    return b.take(now);
  }

  private limited(p: Player, rid: number | undefined): boolean {
    this.err(p, rid, 'rate_limited', 'Calma! Muitas ações seguidas nos desafios.');
    return true;
  }

  private err(p: Player, rid: number | undefined, code: NetsimErrorCode, message: string) {
    p.send({ t: 'netsim_error', ...(rid !== undefined ? { rid } : {}), code, message });
  }

  private session(p: Player, rid: number): Session | null {
    const s = this.sessions.get(p.accountId);
    if (!s || s.orgId !== p.orgId) {
      this.err(p, rid, 'no_session', 'Você não tem um desafio em andamento. Escolha um na lista.');
      return null;
    }
    return s;
  }

  private payload(s: Session, now: number): ChallengeSessionPayload {
    return {
      id: s.challenge.id,
      version: s.version,
      topology: s.topo,
      hints: s.challenge.hints.slice(0, s.hints),
      nextHintCost: s.hints < MAX_HINTS ? HINT_COST[s.hints]! : null,
      failedChecks: s.failed,
      elapsedSec: Math.max(0, Math.floor((now - s.startedAt) / 1000)),
      solved: s.solved,
    };
  }

  private sendSession(p: Player, s: Session, now: number, rid?: number) {
    p.send({ t: 'netsim_challenge_session', ...(rid !== undefined ? { rid } : {}), session: this.payload(s, now) });
  }

  // ---------------------------------------------------------------- progresso e placar

  private progressOf(p: Player): NetsimProgressRow[] {
    return this.host.store.netsim.progressOf(p.orgId, p.accountId).filter((r) => getChallenge(r.challengeId));
  }

  private view(r: NetsimProgressRow): ChallengeProgressView {
    return { id: r.challengeId, best: r.best, attempts: r.attempts, solved: r.solvedAt !== null, hints: r.hints };
  }

  private board(p: Player): ChallengeBoardRow[] {
    const byAcc = new Map<string, { solved: number; points: number }>();
    for (const r of this.host.store.netsim.progressOfOrg(p.orgId)) {
      if (r.solvedAt === null || !getChallenge(r.challengeId)) continue;
      const m = this.host.store.orgs.getMember(p.orgId, r.accountId);
      if (!m || m.status !== 'active' || m.role === 'guest') continue;
      const cur = byAcc.get(r.accountId) ?? { solved: 0, points: 0 };
      cur.solved++;
      cur.points += r.best;
      byAcc.set(r.accountId, cur);
    }
    const all = [...byAcc.entries()]
      .map(([id, v]) => ({ id, name: this.host.store.getById(id)?.displayName ?? '', ...v }))
      .filter((r) => r.name)
      .sort((a, b) => b.points - a.points || b.solved - a.solved || a.name.localeCompare(b.name, 'pt-BR'))
      .map((r, k) => ({ ...r, rank: k + 1 }));
    const top = all.slice(0, BOARD_SIZE);
    const mine = all.find((r) => r.id === p.accountId);
    if (mine && mine.rank > BOARD_SIZE) top.push(mine);
    return top.map((r) => ({ rank: r.rank, name: r.name, solved: r.solved, points: r.points, me: r.id === p.accountId }));
  }

  private sendList(p: Player, rid?: number) {
    const progress = this.progressOf(p);
    const s = this.sessions.get(p.accountId);
    p.send({
      t: 'netsim_challenges_state',
      ...(rid !== undefined ? { rid } : {}),
      progress: progress.map((r) => this.view(r)),
      board: this.board(p),
      activeId: s && s.orgId === p.orgId ? s.challenge.id : null,
      totalPoints: progress.reduce((a, r) => a + (r.solvedAt !== null ? r.best : 0), 0),
    });
  }

  // ---------------------------------------------------------------- acoes

  private start(p: Player, rid: number, id: string, now: number, resume: boolean): boolean {
    if (!this.take(p, 'ctl', now)) return this.limited(p, rid);
    const cur = this.sessions.get(p.accountId);
    if (resume && cur && cur.orgId === p.orgId && cur.challenge.id === id) {
      this.sendSession(p, cur, now, rid);
      return true;
    }
    const ch = getChallenge(id);
    if (!ch) {
      this.err(p, rid, 'not_found', 'Desafio não encontrado.');
      return true;
    }
    if (this.sessions.size >= MAX_SESSIONS && !this.sessions.has(p.accountId)) {
      this.err(p, rid, 'rate_limited', 'Muitos desafios em andamento no servidor. Tente novamente em instantes.');
      return true;
    }
    const s: Session = { orgId: p.orgId, challenge: ch, topo: ch.build(), version: 1, startedAt: now, hints: 0, failed: 0, solved: false };
    this.sessions.set(p.accountId, s);
    const prev = this.host.store.netsim.getProgress(p.orgId, p.accountId, id);
    this.host.store.netsim.putProgress({
      orgId: p.orgId,
      accountId: p.accountId,
      challengeId: id,
      best: prev?.best ?? 0,
      attempts: Math.min(1_000_000, (prev?.attempts ?? 0) + 1),
      hints: prev?.hints ?? 0,
      solvedAt: prev?.solvedAt ?? null,
      updatedAt: now,
    });
    this.sendSession(p, s, now, rid);
    return true;
  }

  private edit(p: Player, rid: number, base: number, ops: NetOp[], now: number): boolean {
    if (!this.take(p, 'edit', now)) return this.limited(p, rid);
    const s = this.session(p, rid);
    if (!s) return true;
    if (s.solved) {
      this.err(p, rid, 'invalid', 'Este desafio já foi resolvido. Volte à lista para começar outro.');
      return true;
    }
    if (s.version !== base) {
      this.err(p, rid, 'conflict', 'O desafio foi atualizado em outra aba. Atualizei com a versão mais recente; refaça a alteração.');
      this.sendSession(p, s, now, rid);
      return true;
    }
    let topo = s.topo;
    for (const op of ops) {
      const r = applyOp(topo, op);
      if (!r.ok) {
        this.err(p, rid, 'invalid', r.error);
        return true;
      }
      topo = r.topo;
    }
    s.topo = topo;
    s.version++;
    this.sendSession(p, s, now, rid);
    return true;
  }

  private check(p: Player, rid: number, now: number): boolean {
    if (!this.take(p, 'check', now)) return this.limited(p, rid);
    const s = this.session(p, rid);
    if (!s) return true;
    if (s.solved) {
      this.err(p, rid, 'invalid', 'Este desafio já foi resolvido.');
      return true;
    }
    const results = evaluateObjectives(s.topo, s.challenge);
    if (!allPassed(results)) {
      s.failed++;
      p.send({ t: 'netsim_challenge_result', rid, results, solved: false });
      this.sendSession(p, s, now);
      return true;
    }
    s.solved = true;
    const elapsedSec = Math.max(0, Math.floor((now - s.startedAt) / 1000));
    const breakdown = scoreChallenge({ difficulty: s.challenge.difficulty, hints: s.hints, failedChecks: s.failed, elapsedSec, parSec: s.challenge.parSec });
    const prev = this.host.store.netsim.getProgress(p.orgId, p.accountId, s.challenge.id);
    const newBest = breakdown.score > (prev?.best ?? 0);
    const row: NetsimProgressRow = {
      orgId: p.orgId,
      accountId: p.accountId,
      challengeId: s.challenge.id,
      best: newBest ? breakdown.score : (prev?.best ?? 0),
      attempts: prev?.attempts ?? 1,
      hints: newBest ? s.hints : (prev?.hints ?? 0),
      solvedAt: prev?.solvedAt ?? now,
      updatedAt: now,
    };
    this.host.store.netsim.putProgress(row);
    this.audit(p, s.challenge, breakdown.score, s.hints);
    const totalPoints = this.progressOf(p).reduce((a, r) => a + (r.solvedAt !== null ? r.best : 0), 0);
    p.send({ t: 'netsim_challenge_result', rid, results, solved: true, breakdown, newBest, best: row.best, totalPoints });
    this.sendSession(p, s, now);
    return true;
  }

  private hint(p: Player, rid: number, now: number): boolean {
    if (!this.take(p, 'ctl', now)) return this.limited(p, rid);
    const s = this.session(p, rid);
    if (!s) return true;
    if (s.solved || s.hints >= MAX_HINTS) {
      this.err(p, rid, 'invalid', s.solved ? 'Este desafio já foi resolvido.' : 'Você já usou todas as dicas deste desafio.');
      return true;
    }
    s.hints++;
    this.sendSession(p, s, now, rid);
    return true;
  }

  private audit(p: Player, ch: Challenge, score: number, hints: number) {
    this.host.store.appendAudit({
      id: randomUUID(),
      at: this.host.clock(),
      actorId: p.accountId,
      actor: p.name,
      level: p.staff && p.onDuty ? p.staff : null,
      action: 'netsim.challenge',
      targetId: `${p.orgId}/netsim/${ch.id}`,
      target: `Desafio de rede: ${ch.title}`.slice(0, 80),
      detail: `resolvido; pontuação ${score}; dicas ${hints}`,
    });
    this.host.log('netsim.challenge', { org: p.orgId, by: p.accountId, challenge: ch.id, score });
  }
}
