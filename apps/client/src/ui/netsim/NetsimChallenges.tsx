import { useEffect, useState } from 'react';
import { CHALLENGES, DIFFICULTY_BASE, DIFFICULTY_LABEL, HINT_COST, type Challenge, type ChallengeCheckPayload, type ChallengeSessionPayload, type ObjectiveResult } from '@workverse/shared';
import { netsimStore, type ChallengeList as ListData } from './netsimStore';

/** Telas dos desafios "Conserte a rede": lista com placar, objetivos ao vivo, dicas e conclusao. Textos em pt-BR. */

export const fmtTime = (sec: number): string => `${Math.floor(sec / 60)}:${String(Math.max(0, Math.floor(sec % 60))).padStart(2, '0')}`;

const DIFF_CLASS = { facil: 'easy', medio: 'mid', dificil: 'hard' } as const;

export function Difficulty({ d }: { d: Challenge['difficulty'] }) {
  return <span className={`ns-diff ${DIFF_CLASS[d]}`}>{DIFFICULTY_LABEL[d]}</span>;
}

// ---------------------------------------------------------------- lista

export function ChallengeListView({ list, busy }: { list: ListData | null; busy: boolean }) {
  const [open, setOpen] = useState<string | null>(null);
  // se o servidor nao responde (ex. versao antiga do servidor), avisa em vez de carregar para sempre
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (list) {
      setSlow(false);
      return;
    }
    const t = setTimeout(() => setSlow(true), 6000);
    return () => clearTimeout(t);
  }, [list]);
  const byId = new Map(list?.progress.map((p) => [p.id, p]));
  const solved = list?.progress.filter((p) => p.solved).length ?? 0;
  return (
    <div className="ns-chlist" data-testid="netsim-challenges">
      <p className="ns-note">
        <b>Conserte a rede</b>: cada desafio traz uma rede com defeitos escondidos. Use as mesmas ferramentas do painel (propriedades, terminal e testes) para consertar e depois clique em <b>Verificar</b>. Você edita uma <b>cópia</b>: a rede real da organização nunca é alterada.
      </p>
      <p className="ns-dim" data-testid="netsim-ch-summary">
        {list ? `${solved} de ${CHALLENGES.length} resolvidos · ${list.totalPoints} pontos` : slow ? 'O servidor não respondeu aos desafios. Dê Ctrl+F5; se persistir, o servidor está numa versão antiga e precisa reiniciar.' : 'Carregando…'}
        {busy ? ' · aguarde…' : ''}
      </p>
      <ul className="ns-chitems">
        {CHALLENGES.map((c) => {
          const p = byId.get(c.id);
          const active = list?.activeId === c.id;
          const expanded = open === c.id;
          return (
            <li key={c.id} className={`ns-ch${p?.solved ? ' done' : ''}`} data-testid={`netsim-ch-${c.id}`}>
              <button type="button" className="ns-chhead" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : c.id)}>
                <span className="ns-chmark" aria-hidden="true">{p?.solved ? '✔' : active ? '▶' : '○'}</span>
                <span className="ns-chtitle">{c.title}</span>
                <Difficulty d={c.difficulty} />
                <span className="ns-chstate" data-testid={`netsim-ch-state-${c.id}`}>
                  {p?.solved ? `Resolvido · ${p.best} pts` : active ? 'Em andamento' : p && p.attempts > 0 ? `Tentado ${p.attempts}x` : 'Novo'}
                </span>
              </button>
              {expanded && (
                <div className="ns-chbody">
                  <p>{c.story}</p>
                  <p className="ns-dim">
                    {c.objectives.length} objetivo(s) · pontos: até {DIFFICULTY_BASE[c.difficulty] + 20} (dicas e verificações erradas descontam; bônus de tempo até {fmtTime(c.parSec)}).
                    {p?.solved ? ` Melhor: ${p.best} pts, ${p.hints} dica(s).` : ''}
                  </p>
                  <div className="ns-row">
                    {active && (
                      <button type="button" className="ns-btn big" onClick={() => netsimStore.startChallenge(c.id, true)} data-testid={`netsim-ch-resume-${c.id}`}>
                        Continuar
                      </button>
                    )}
                    <button type="button" className={`ns-btn${active ? '' : ' big'}`} onClick={() => netsimStore.startChallenge(c.id)} data-testid={`netsim-ch-start-${c.id}`}>
                      {active ? 'Recomeçar' : p?.solved ? 'Jogar de novo' : 'Iniciar'}
                    </button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <h4 className="ns-dim">Placar da organização</h4>
      {list && list.board.length > 0 ? (
        <ol className="ns-board" data-testid="netsim-board">
          {list.board.map((r) => (
            <li key={`${r.rank}-${r.name}`} className={r.me ? 'me' : ''}>
              <span className="ns-rank">{r.rank}º</span>
              <span className="ns-bname">{r.name}{r.me ? ' (você)' : ''}</span>
              <span className="ns-dim">{r.solved} resolvido(s)</span>
              <b>{r.points} pts</b>
            </li>
          ))}
        </ol>
      ) : (
        <p className="ns-dim">Ninguém pontuou ainda. Seja a primeira pessoa!</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- faixa e objetivos

export function ChallengeBar({ ch, session, results, elapsed, busy }: { ch: Challenge; session: ChallengeSessionPayload; results: ObjectiveResult[]; elapsed: number; busy: boolean }) {
  const okN = results.filter((r) => r.ok).length;
  return (
    <div className="ns-chbar" data-testid="netsim-chbar">
      <span className="ns-chbar-title">
        <b>{ch.title}</b> <Difficulty d={ch.difficulty} />
      </span>
      <span className="ns-dim" data-testid="netsim-ch-progress">
        {okN}/{results.length} objetivos · {fmtTime(elapsed)}
      </span>
      <span className="ns-chbar-btns">
        <button type="button" className="ns-btn on" disabled={busy || session.solved} onClick={() => netsimStore.checkChallenge()} data-testid="netsim-ch-check">
          Verificar
        </button>
        <button
          type="button"
          className="ns-btn"
          disabled={busy || session.solved || session.nextHintCost === null}
          onClick={() => netsimStore.hintChallenge()}
          title={session.nextHintCost === null ? 'Sem mais dicas' : `Revela a próxima dica (−${session.nextHintCost} pontos)`}
          data-testid="netsim-ch-hint"
        >
          {session.nextHintCost === null ? 'Sem dicas' : `Dica (−${session.nextHintCost})`}
        </button>
        <button
          type="button"
          className="ns-btn danger"
          onClick={() => {
            if (session.solved || window.confirm('Desistir deste desafio? O progresso desta tentativa será perdido.')) netsimStore.quitChallenge();
          }}
          data-testid="netsim-ch-quit"
        >
          {session.solved ? 'Voltar à lista' : 'Desistir'}
        </button>
      </span>
    </div>
  );
}

export function GoalsTab({ ch, session, results, result }: { ch: Challenge; session: ChallengeSessionPayload; results: ObjectiveResult[]; result: ChallengeCheckPayload | null }) {
  return (
    <div className="ns-goals" data-testid="netsim-goals">
      <p>{ch.story}</p>
      <h4>Objetivos (ao vivo)</h4>
      <ul className="ns-objs">
        {ch.objectives.map((o) => {
          const r = results.find((x) => x.id === o.id);
          return (
            <li key={o.id} className={r?.ok ? 'ok' : 'bad'} data-testid={`netsim-obj-${o.id}`} data-ok={r?.ok ? '1' : '0'}>
              <span className="ns-objmark" aria-hidden="true">{r?.ok ? '✔' : '✘'}</span>
              <span>
                {o.text}
                {!r?.ok && r?.detail && <span className="ns-dim ns-objwhy"> — {r.detail}</span>}
              </span>
              <span className="sr-only">{r?.ok ? ' (cumprido)' : ' (não cumprido)'}</span>
            </li>
          );
        })}
      </ul>
      {result && !result.solved && (
        <p className="ns-alert" role="status" data-testid="netsim-ch-fail">
          Ainda faltam objetivos. Cada verificação errada desconta pontos ({session.failedChecks} até agora).
        </p>
      )}
      <h4>Dicas</h4>
      {session.hints.length === 0 ? (
        <p className="ns-dim">Nenhuma dica usada. Cada dica desconta pontos ({HINT_COST.join(', ')}).</p>
      ) : (
        <ol className="ns-hints" data-testid="netsim-hints">
          {session.hints.map((h, k) => (
            <li key={k}>{h}</li>
          ))}
        </ol>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- conclusao

export function DoneCard({ ch, result, onSee }: { ch: Challenge; result: ChallengeCheckPayload; onSee: () => void }) {
  const b = result.breakdown;
  return (
    <div className="ns-done" role="status" data-testid="netsim-done">
      <h3>Rede consertada!</h3>
      <p>
        Você resolveu <b>{ch.title}</b>.
      </p>
      <p className="ns-score" data-testid="netsim-done-score">
        {b?.score ?? 0} pontos
      </p>
      {b && (
        <ul className="ns-break">
          <li>Base ({DIFFICULTY_LABEL[ch.difficulty]}): +{b.base}</li>
          <li>Bônus de tempo: +{b.timeBonus}</li>
          <li>Dicas: −{b.hintPenalty}</li>
          <li>Verificações erradas: −{b.failPenalty}</li>
        </ul>
      )}
      <p className={result.newBest ? 'ns-ok' : 'ns-dim'}>{result.newBest ? 'Novo recorde pessoal neste desafio!' : `Sua melhor pontuação continua ${result.best} pts.`}</p>
      <p className="ns-dim">Total da sua conta: {result.totalPoints ?? 0} pontos.</p>
      <div className="ns-row">
        <button type="button" className="ns-btn big" onClick={() => netsimStore.leaveSession()} data-testid="netsim-done-list">
          Ver a lista e o placar
        </button>
        <button type="button" className="ns-btn" onClick={onSee}>
          Ver a rede consertada
        </button>
        <button type="button" className="ns-btn" onClick={() => netsimStore.startChallenge(ch.id)}>
          Jogar de novo
        </button>
      </div>
    </div>
  );
}

/** Segundos desde que a sessao chegou, atualizado a cada segundo enquanto nao resolvida. */
export function useElapsed(startedAtLocal: number, running: boolean): number {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [running]);
  return Math.max(0, Math.floor((Date.now() - startedAtLocal) / 1000));
}
