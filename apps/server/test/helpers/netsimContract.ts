import { describe, expect, it } from 'vitest';
import { edgeNatDhcp, lanSimple } from '@workverse/shared';
import type { RoomsHandle } from './roomsContract';

/** O que todo store persistente deve guardar do simulador de rede: uma topologia versionada por organizacao e o progresso dos desafios. */
export function netsimStoreContract(label: string, make: () => Promise<RoomsHandle>) {
  describe(`contrato do simulador de rede: ${label}`, () => {
    async function seed(h: RoomsHandle) {
      const { store } = h;
      const boss = store.create({ email: 'chefe@x.com', displayName: 'Chefe', passwordHash: 'scrypt$x' });
      const ana = store.create({ email: 'ana@x.com', displayName: 'Ana', passwordHash: 'scrypt$x' });
      for (const id of ['orgA', 'orgB', 'orgC']) store.orgs.putOrg({ id, slug: id.toLowerCase(), name: id, settings: {}, createdAt: 1 });
      return { boss, ana };
    }

    it('guarda topologia e versao depois de um reinicio, separadas por organizacao', async () => {
      const h = await make();
      const { boss } = await seed(h);
      const a = edgeNatDhcp();
      const b = lanSimple();
      h.store.netsim.put({ orgId: 'orgA', version: 3, topology: a, updatedBy: boss.id, updatedAt: 1000 });
      h.store.netsim.put({ orgId: 'orgB', version: 1, topology: b, updatedBy: boss.id, updatedAt: 2000 });
      await h.settle();
      const again = await h.reopen();
      expect(again.netsim.get('orgA')).toEqual({ orgId: 'orgA', version: 3, topology: a, updatedBy: boss.id, updatedAt: 1000 });
      expect(again.netsim.get('orgB')?.topology.devices.map((d) => d.name)).toEqual(b.devices.map((d) => d.name));
      expect(again.netsim.get('orgC')).toBeUndefined();
    });

    it('a ultima versao vence (upsert) e apagar remove', async () => {
      const h = await make();
      const { boss } = await seed(h);
      h.store.netsim.put({ orgId: 'orgA', version: 1, topology: lanSimple(), updatedBy: boss.id, updatedAt: 1 });
      h.store.netsim.put({ orgId: 'orgA', version: 2, topology: edgeNatDhcp(), updatedBy: boss.id, updatedAt: 2 });
      h.store.netsim.put({ orgId: 'orgB', version: 1, topology: lanSimple(), updatedBy: boss.id, updatedAt: 2 });
      h.store.netsim.put({ orgId: 'orgC', version: 1, topology: lanSimple(), updatedBy: boss.id, updatedAt: 3 });
      h.store.netsim.delete('orgC');
      await h.settle();
      const again = await h.reopen();
      expect(again.netsim.get('orgA')?.version).toBe(2);
      expect(again.netsim.get('orgA')?.topology.devices.some((d) => d.kind === 'router')).toBe(true);
      expect(again.netsim.get('orgB')?.version).toBe(1);
      expect(again.netsim.get('orgC')).toBeUndefined();
    });

    it('guarda o progresso dos desafios por conta e organizacao', async () => {
      const h = await make();
      const { boss, ana } = await seed(h);
      h.store.netsim.putProgress({ orgId: 'orgA', accountId: ana.id, challengeId: 'gateway', best: 60, attempts: 2, hints: 1, solvedAt: null, updatedAt: 10 });
      h.store.netsim.putProgress({ orgId: 'orgA', accountId: ana.id, challengeId: 'gateway', best: 90, attempts: 3, hints: 2, solvedAt: 20, updatedAt: 20 });
      h.store.netsim.putProgress({ orgId: 'orgA', accountId: boss.id, challengeId: 'vlan', best: 100, attempts: 1, hints: 0, solvedAt: 5, updatedAt: 5 });
      h.store.netsim.putProgress({ orgId: 'orgB', accountId: ana.id, challengeId: 'gateway', best: 10, attempts: 1, hints: 3, solvedAt: null, updatedAt: 6 });
      await h.settle();
      const again = await h.reopen();
      expect(again.netsim.getProgress('orgA', ana.id, 'gateway')).toEqual({ orgId: 'orgA', accountId: ana.id, challengeId: 'gateway', best: 90, attempts: 3, hints: 2, solvedAt: 20, updatedAt: 20 });
      expect(again.netsim.progressOfOrg('orgA').map((r) => r.challengeId).sort()).toEqual(['gateway', 'vlan']);
      expect(again.netsim.progressOfOrg('orgB')).toHaveLength(1);
      expect(again.netsim.progressOf('orgA', boss.id)).toHaveLength(1);
      expect(again.netsim.getProgress('orgB', ana.id, 'gateway')?.best).toBe(10);
      expect(again.netsim.getProgress('orgB', ana.id, 'gateway')?.hints).toBe(3);
    });
  });
}
