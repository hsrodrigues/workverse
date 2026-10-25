import { describe, expect, it } from 'vitest';
import { monthKey, quotaLevel, quotaPercent, videoProfile } from '@workverse/shared';
import { ConnectGate, evaluateDemand, type GateInputs } from '../src/media/connectGate';

const base: GateInputs = {
  inRoom: true,
  economy: true,
  quotaExceeded: false,
  publishing: false,
  othersPublishing: false,
  stageLive: false,
  hiddenForMs: 0,
  hiddenLimitMs: 120_000,
  away: false,
};
const d = (o: Partial<GateInputs>) => evaluateDemand({ ...base, ...o });

describe('quando conectar a chamada', () => {
  it('sem ninguem falando e sem eu querer falar: nao conecta', () => {
    expect(d({}).want).toBe(false);
  });
  it('conecta se eu transmito, se alguem publica ou se ha palco/TV', () => {
    expect(d({ publishing: true })).toMatchObject({ want: true, reason: 'publish' });
    expect(d({ othersPublishing: true })).toMatchObject({ want: true, reason: 'others' });
    expect(d({ stageLive: true })).toMatchObject({ want: true, reason: 'stage' });
  });
  it('sem economia: conecta ao entrar na sala (comportamento antigo)', () => {
    expect(d({ economy: false })).toMatchObject({ want: true, reason: 'always' });
    expect(d({ economy: false, inRoom: false }).want).toBe(false);
  });
  it('cota estourada nunca conecta', () => {
    expect(d({ quotaExceeded: true, publishing: true })).toMatchObject({ want: false, suspended: 'quota' });
  });
  it('aba escondida alem do limite ou ausente pausam, mas quem transmite nao', () => {
    expect(d({ othersPublishing: true, hiddenForMs: 130_000 })).toMatchObject({ want: false, suspended: 'hidden' });
    expect(d({ othersPublishing: true, hiddenForMs: 30_000 })).toMatchObject({ want: true, recheckInMs: 90_000 });
    expect(d({ othersPublishing: true, away: true })).toMatchObject({ want: false, suspended: 'away' });
    expect(d({ publishing: true, away: true, hiddenForMs: 999_999 }).want).toBe(true);
  });
});

describe('tolerancia de ociosidade', () => {
  it('fica 20 s depois do ultimo motivo e entao desconecta', () => {
    const g = new ConnectGate(20_000);
    expect(g.decide(d({ othersPublishing: true }), false, 1000).connect).toBe(true);
    const idle = d({});
    let r = g.decide(idle, true, 10_000);
    expect(r).toEqual({ connect: true, recheckInMs: 11_000 });
    r = g.decide(idle, true, 21_001);
    expect(r.connect).toBe(false);
    // desconectado e sem motivo: continua desconectado
    expect(g.decide(idle, false, 22_000).connect).toBe(false);
  });
  it('pausa por aba escondida sai na hora, sem tolerancia', () => {
    const g = new ConnectGate(20_000);
    g.decide(d({ othersPublishing: true }), true, 1000);
    expect(g.decide(d({ othersPublishing: true, hiddenForMs: 200_000 }), true, 2000).connect).toBe(false);
  });
});

describe('regras puras compartilhadas', () => {
  it('cota: percentuais e niveis', () => {
    expect(quotaLevel(3499, 5000)).toBe('ok');
    expect(quotaLevel(3500, 5000)).toBe('warn70');
    expect(quotaLevel(4500, 5000)).toBe('warn90');
    expect(quotaLevel(5000, 5000)).toBe('exceeded');
    expect(quotaLevel(9999, 0)).toBe('ok');
    expect(quotaPercent(1250, 5000)).toBe(25);
  });
  it('virada do mes no fuso de Brasilia', () => {
    expect(monthKey(Date.UTC(2026, 10, 1, 2, 59, 0))).toBe('2026-10');
    expect(monthKey(Date.UTC(2026, 10, 1, 3, 0, 0))).toBe('2026-11');
  });
  it('perfil de video: camera 360p e tela 1080p/15; economia baixa tudo; simulcast so com varias pessoas', () => {
    const n = videoProfile({ lowData: false, strict: false, participants: 3 });
    expect(n.camera).toMatchObject({ height: 360, simulcast: false });
    expect(n.screen).toMatchObject({ height: 1080, frameRate: 15, contentHint: 'text' });
    expect(videoProfile({ lowData: false, strict: false, participants: 10 }).camera.simulcast).toBe(true);
    expect(videoProfile({ lowData: true, strict: false, participants: 10 }).camera).toMatchObject({ height: 180, simulcast: false });
  });
});
