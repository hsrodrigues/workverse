import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getChallenge, type ServerMessage } from '@workverse/shared';

const sent: Array<Record<string, unknown>> = [];
vi.mock('../src/net', () => ({ net: { send: (m: Record<string, unknown>) => sent.push(m) } }));

const { netsimStore } = await import('../src/ui/netsim/netsimStore');
const { fmtTime } = await import('../src/ui/netsim/NetsimChallenges');

const sessionMsg = (over: Record<string, unknown> = {}, rid?: number): ServerMessage =>
  ({ t: 'netsim_challenge_session', ...(rid !== undefined ? { rid } : {}), session: { id: 'gateway-errado', version: 1, topology: getChallenge('gateway-errado')!.build(), hints: [], nextHintCost: 5, failedChecks: 0, elapsedSec: 0, solved: false, ...over } }) as ServerMessage;

beforeEach(() => {
  sent.length = 0;
  netsimStore._reset();
});

describe('painel Rede: modo desafio', () => {
  it('na rede real a edição exige TI; no desafio vai para o sandbox com a versão do desafio', async () => {
    expect((await netsimStore.edit([{ op: 'moveDevice', id: 'd1', x: 1, y: 1 }])).ok).toBe(false);
    expect(sent).toHaveLength(0);
    netsimStore.setView('challenges');
    netsimStore.startChallenge('gateway-errado');
    expect(sent.at(-1)).toMatchObject({ t: 'netsim_challenge_start', id: 'gateway-errado' });
    netsimStore.onMessage(sessionMsg());
    const p = netsimStore.edit([{ op: 'moveDevice', id: 'd1', x: 1, y: 1 }]);
    expect(sent.at(-1)).toMatchObject({ t: 'netsim_challenge_edit', base: 1 });
    netsimStore.onMessage(sessionMsg({ version: 2 }, sent.at(-1)!.rid as number));
    expect((await p).ok).toBe(true);
    expect(netsimStore.get().session?.version).toBe(2);
  });

  it('verificar, dica e desistir enviam as mensagens certas; resolvido bloqueia edição e novos checks', async () => {
    netsimStore.setView('challenges');
    netsimStore.onMessage(sessionMsg());
    netsimStore.checkChallenge();
    netsimStore.hintChallenge();
    expect(sent.map((m) => m.t).slice(-2)).toEqual(['netsim_challenge_check', 'netsim_challenge_hint']);
    netsimStore.onMessage(sessionMsg({ solved: true }));
    const n = sent.length;
    netsimStore.checkChallenge();
    netsimStore.hintChallenge();
    expect(sent).toHaveLength(n);
    expect((await netsimStore.edit([{ op: 'moveDevice', id: 'd1', x: 1, y: 1 }])).ok).toBe(false);
    netsimStore.quitChallenge();
    expect(sent.at(-1)).toMatchObject({ t: 'netsim_challenge_quit' });
    expect(netsimStore.get().session).toBeNull();
  });

  it('formata o tempo', () => {
    expect(fmtTime(0)).toBe('0:00');
    expect(fmtTime(125)).toBe('2:05');
  });
});
