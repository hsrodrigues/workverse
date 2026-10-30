import { describe, expect, it } from 'vitest';
import { CHALLENGES, DIFFICULTY_BASE, HINT_COST, allPassed, applyOp, evaluateObjectives, getChallenge, scoreChallenge, validateTopology, type NetOp, type Topology } from '../src';
import { SOLUTIONS } from '../src/netsim/challengeSolutions';

function applyAll(t: Topology, ops: NetOp[]): Topology {
  let cur = t;
  for (const op of ops) {
    const r = applyOp(cur, op);
    if (!r.ok) throw new Error(`${op.op}: ${r.error}`);
    cur = r.topo;
  }
  return cur;
}

describe('desafios: catalogo', () => {
  it('tem ~10 desafios com ids unicos, textos em pt-BR, 3 dicas e todas as dificuldades', () => {
    expect(CHALLENGES.length).toBeGreaterThanOrEqual(10);
    expect(new Set(CHALLENGES.map((c) => c.id)).size).toBe(CHALLENGES.length);
    expect(new Set(CHALLENGES.map((c) => c.difficulty))).toEqual(new Set(['facil', 'medio', 'dificil']));
    for (const c of CHALLENGES) {
      expect(c.title.length).toBeGreaterThan(3);
      expect(c.story.length).toBeGreaterThan(40);
      expect(c.hints).toHaveLength(3);
      expect(c.hints.every((h) => h.length > 20)).toBe(true);
      expect(c.objectives.length).toBeGreaterThan(0);
      expect(new Set(c.objectives.map((o) => o.id)).size).toBe(c.objectives.length);
      expect(SOLUTIONS[c.id], `solucao de ${c.id}`).toBeTypeOf('function');
    }
  });

  it('cada topologia e valida, determinista e cada chamada devolve uma copia nova', () => {
    for (const c of CHALLENGES) {
      const a = c.build();
      expect(validateTopology(a).ok, c.id).toBe(true);
      expect(c.build()).toEqual(a);
      expect(c.build()).not.toBe(a);
    }
  });
});

describe('desafios: resolvíveis', () => {
  for (const c of CHALLENGES) {
    it(`${c.id}: sem a solução ao menos um objetivo falha; com a solução todos passam`, () => {
      const t = c.build();
      const before = evaluateObjectives(t, c);
      expect(allPassed(before)).toBe(false);
      expect(before.some((r) => !r.ok && r.detail.length > 0)).toBe(true);
      const fixed = applyAll(t, SOLUTIONS[c.id]!(t));
      const after = evaluateObjectives(fixed, c);
      expect(after.filter((r) => !r.ok), c.id).toEqual([]);
      expect(allPassed(after)).toBe(true);
    });
  }

  it('cada objetivo positivo falha na rede quebrada ao menos em um dos objetivos de cada desafio plantado (mais de uma falha plantada exige todos os passos)', () => {
    for (const id of ['cabo-solto', 'dns-interno', 'acl-financeiro', 'segunda-feira', 'nat-desligado']) {
      const c = getChallenge(id)!;
      const t = c.build();
      const ops = SOLUTIONS[id]!(t);
      expect(ops.length).toBeGreaterThan(1);
      // aplicar so a primeira correção nao basta
      const partial = applyAll(t, ops.slice(0, 1));
      expect(allPassed(evaluateObjectives(partial, c)), `${id} parcial`).toBe(false);
    }
  });

  it('atalhos nao funcionam: apagar a ACL libera o RH, remover o PC reprova o objetivo', () => {
    const c = getChallenge('acl-financeiro')!;
    const t = c.build();
    const noAcl = applyAll(t, [{ op: 'removeAcl', id: t.devices.find((d) => d.name === 'R1')!.id, index: 0 }, { op: 'setDevice', id: t.devices.find((d) => d.name === 'SRV-FIN')!.id, patch: { gateway: '192.168.30.1' } }]);
    const r = evaluateObjectives(noAcl, c);
    expect(r.find((x) => x.id === 'fin-ok')!.ok).toBe(true);
    expect(r.find((x) => x.id === 'rh-bloq')!.ok).toBe(false);
    const fixed = applyAll(t, SOLUTIONS['acl-financeiro']!(t));
    const gone = applyAll(fixed, [{ op: 'removeDevice', id: fixed.devices.find((d) => d.name === 'PC-RH-01')!.id }]);
    expect(evaluateObjectives(gone, c).find((x) => x.id === 'rh-bloq')!.ok).toBe(false);
  });
});

describe('desafios: pontuação', () => {
  const base = { hints: 0, failedChecks: 0, elapsedSec: 10, parSec: 300 };
  it('base por dificuldade + bônus de tempo cheio dentro do tempo de referência', () => {
    expect(scoreChallenge({ ...base, difficulty: 'facil' }).score).toBe(DIFFICULTY_BASE.facil + 20);
    expect(scoreChallenge({ ...base, difficulty: 'dificil' }).score).toBe(100);
  });
  it('dicas e verificações erradas descontam; bônus de tempo decai até zero', () => {
    const s = scoreChallenge({ difficulty: 'medio', hints: 2, failedChecks: 3, elapsedSec: 10, parSec: 300 });
    expect(s.hintPenalty).toBe(HINT_COST[0] + HINT_COST[1]);
    expect(s.failPenalty).toBe(6);
    expect(s.score).toBe(60 + 20 - 15 - 6);
    expect(scoreChallenge({ ...base, difficulty: 'medio', elapsedSec: 600 }).timeBonus).toBe(10);
    expect(scoreChallenge({ ...base, difficulty: 'medio', elapsedSec: 900 }).timeBonus).toBe(0);
    expect(scoreChallenge({ ...base, difficulty: 'medio', elapsedSec: 99999 }).timeBonus).toBe(0);
  });
  it('limites: penalidade de tentativas tem teto, nota mínima 10 e máxima 100', () => {
    expect(scoreChallenge({ ...base, difficulty: 'facil', failedChecks: 999 }).failPenalty).toBe(10);
    expect(scoreChallenge({ difficulty: 'facil', hints: 3, failedChecks: 99, elapsedSec: 99999, parSec: 1 }).score).toBe(10);
    expect(scoreChallenge({ ...base, difficulty: 'dificil', hints: -4, failedChecks: -3 }).score).toBe(100);
  });
});
