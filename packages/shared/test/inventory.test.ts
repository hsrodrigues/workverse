import { describe, expect, it } from 'vitest';
import { HOST_KINDS, ROOM_DEFS, WORKSTATION_KINDS, formatUptime, hostLabels, rebootJoke, roomCode, simCpu, simPingMs, type Station } from '../src';

const stations = (roomId: string): Station[] =>
  ROOM_DEFS.find((r) => r.id === roomId)!.furniture.filter((f) => (HOST_KINDS as readonly string[]).includes(f.kind)).map((f) => ({ id: f.id, kind: f.kind as Station['kind'], x: f.x, y: f.y }));

describe('inventário: hostnames, IPs e simulações estáveis', () => {
  it('os tipos de host são as estações de trabalho do jogo', () => {
    expect([...HOST_KINDS].sort()).toEqual([...WORKSTATION_KINDS].sort());
  });

  it('hostname por sala e posição, IP fictício 10.x.y.z, sem repetição no escritório', () => {
    const labels = hostLabels('office', stations('office'));
    const names = [...labels.values()].map((l) => l.hostname);
    expect(new Set(names).size).toBe(names.length);
    expect(names.every((n) => /^PC-ESC-\d\d$/.test(n))).toBe(true);
    const ips = [...labels.values()].map((l) => l.ip);
    expect(new Set(ips).size).toBe(ips.length);
    expect(ips.every((ip) => /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip) && ip.split('.').every((o) => Number(o) <= 255))).toBe(true);
    // estável: refazer dá o mesmo, mesmo com as peças em outra ordem
    const again = hostLabels('office', [...stations('office')].reverse());
    for (const [id, l] of labels) expect(again.get(id)).toEqual(l);
  });

  it('mesa de comando e bancada têm prefixos próprios; o código da sala segue a tabela', () => {
    const labels = [...hostLabels('ti', stations('ti')).values()].map((l) => l.hostname);
    expect(labels.some((n) => /^CMD-TI-\d\d$/.test(n))).toBe(true);
    expect(labels.some((n) => /^LAB-TI-\d\d$/.test(n))).toBe(true);
    expect(roomCode('office')).toBe('ESC');
    expect(roomCode('salaNova')).toBe('SAL');
  });

  it('CPU: desligado 0, ocioso baixo, ocupado alto; determinística na janela de 15 s', () => {
    expect(simCpu('a/b', 1000, 'off')).toBe(0);
    for (let i = 0; i < 20; i++) {
      expect(simCpu(`k${i}`, 5000, 'idle')).toBeLessThan(10);
      expect(simCpu(`k${i}`, 5000, 'online')).toBeGreaterThanOrEqual(25);
      expect(simCpu(`k${i}`, 5000, 'online')).toBeLessThanOrEqual(92);
    }
    expect(simCpu('x', 1000, 'online')).toBe(simCpu('x', 14_000, 'online'));
    expect(simPingMs('x', 3)).toBe(simPingMs('x', 3));
    expect(simPingMs('x', 3)).toBeGreaterThanOrEqual(1);
  });

  it('tempo de uso e piadas', () => {
    expect(formatUptime(35_000)).toBe('35s');
    expect(formatUptime(14 * 60_000)).toBe('14m');
    expect(formatUptime(125 * 60_000)).toBe('2h 05m');
    expect(rebootJoke('a', 1).length).toBeGreaterThan(10);
  });
});
