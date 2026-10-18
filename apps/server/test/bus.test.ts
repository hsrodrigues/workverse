import { afterAll, describe, expect, it } from 'vitest';
import { MemoryBus, RedisBus, type PresenceBus } from '../src/bus';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Contrato comum do barramento; `advance` empurra o tempo (relogio falso na memoria, espera real no Redis). */
function busContract(label: string, make: () => PresenceBus, advance: (ms: number) => Promise<void>) {
  describe(`contrato PresenceBus: ${label}`, () => {
    const buses: PresenceBus[] = [];
    const fresh = () => {
      const b = make();
      buses.push(b);
      return b;
    };
    afterAll(async () => {
      for (const b of buses) await b.close();
    });
    // Salas unicas por execucao: o Redis real pode ser compartilhado.
    const uid = Math.random().toString(36).slice(2, 8);
    const room = (n: string) => `${n}-${uid}`;
    const acc = (n: string) => `${n}-${uid}`;

    it('publish entrega a todos os assinantes do canal e respeita unsubscribe', async () => {
      const a = fresh();
      const b = fresh();
      const got: string[] = [];
      const off = await b.subscribe(`chan-${uid}`, (m) => got.push(m));
      await a.publish(`chan-${uid}`, 'um');
      await a.publish(`outro-${uid}`, 'ignorada');
      await sleep(100);
      expect(got).toEqual(['um']);
      await off();
      await a.publish(`chan-${uid}`, 'dois');
      await sleep(100);
      expect(got).toEqual(['um']);
    });

    it('um assinante que lanca erro nao impede os demais', async () => {
      const a = fresh();
      const got: string[] = [];
      await a.subscribe(`err-${uid}`, () => {
        throw new Error('boom');
      });
      await a.subscribe(`err-${uid}`, (m) => got.push(m));
      await a.publish(`err-${uid}`, 'x');
      await sleep(100);
      expect(got).toEqual(['x']);
    });

    it('presenca: set, mudar de sala, listar, contar e limpar', async () => {
      const bus = fresh();
      await bus.setPresence(acc('a'), room('office'), 60_000);
      await bus.setPresence(acc('b'), room('office'), 60_000);
      await bus.setPresence(acc('c'), room('lounge'), 60_000);
      expect(await bus.getPresence(acc('a'))).toBe(room('office'));
      expect(await bus.listRoom(room('office'))).toEqual([acc('a'), acc('b')]);
      const counts = await bus.roomCounts();
      expect(counts[room('office')]).toBe(2);
      expect(counts[room('lounge')]).toBe(1);

      await bus.setPresence(acc('a'), room('lounge'), 60_000); // mudou de sala
      expect(await bus.listRoom(room('office'))).toEqual([acc('b')]);
      expect(await bus.listRoom(room('lounge'))).toEqual([acc('a'), acc('c')]);

      await bus.clearPresence(acc('a'));
      expect(await bus.getPresence(acc('a'))).toBeNull();
      expect(await bus.listRoom(room('lounge'))).toEqual([acc('c')]);
      for (const n of ['b', 'c']) await bus.clearPresence(acc(n));
    });

    it('presenca expira pelo TTL quando nao e renovada', async () => {
      const bus = fresh();
      await bus.setPresence(acc('ttl'), room('r'), 300);
      expect(await bus.getPresence(acc('ttl'))).toBe(room('r'));
      await advance(450);
      expect(await bus.getPresence(acc('ttl'))).toBeNull();
      expect(await bus.listRoom(room('r'))).toEqual([]);
    });
  });
}

let now = 1_000_000;
const sharedMemory = new MemoryBus(() => now); // na memoria, 'instancias' compartilham o mesmo objeto
busContract('MemoryBus', () => sharedMemory, async (ms) => void (now += ms));

describe('MemoryBus: instancias separadas nao se enxergam (barramento e por objeto)', () => {
  it('publish em um bus nao chega em outro', async () => {
    const a = new MemoryBus();
    const b = new MemoryBus();
    const got: string[] = [];
    await b.subscribe('c', (m) => got.push(m));
    await a.publish('c', 'x');
    expect(got).toEqual([]);
  });
});

// No Redis cada RedisBus e uma conexao/instancia distinta sobre o mesmo servidor.
const REDIS_URL = process.env.REDIS_URL;
if (REDIS_URL) {
  const testPrefix = `wvtest:${Date.now()}:`;
  busContract('RedisBus (REDIS_URL)', () => new RedisBus({ url: REDIS_URL, prefix: testPrefix }), async (ms) => void (await sleep(ms)));
} else {
  describe.skip('contrato PresenceBus: RedisBus (defina REDIS_URL para executar)', () => it('pulado', () => undefined));
}
