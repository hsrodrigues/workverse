import { describe, expect, it } from 'vitest';
import type { AccountStore } from '../../src/store';

export interface ResetHandle {
  store: AccountStore;
  settle(): Promise<void>;
  reopen(): Promise<AccountStore>;
}

/** Contrato dos tokens de redefinicao de senha (migracao 0012): TODA implementacao de AccountStore precisa cumpri-lo. */
export function resetTokenContract(label: string, make: () => Promise<ResetHandle>) {
  describe(`contrato tokens de redefinicao: ${label}`, () => {
    const NOW = Date.now();
    const mk = (store: AccountStore, n: string) => store.create({ email: `${n}@example.com`, displayName: `Pessoa ${n}`, passwordHash: 'scrypt$x' });
    const rec = (accountId: string, hash: string, at = NOW, ttl = 30 * 60_000) => ({ tokenHash: hash, accountId, createdAt: at, expiresAt: at + ttl });

    it('cria, consulta e consome uma unica vez', async () => {
      const h = await make();
      const a = mk(h.store, 'ana');
      h.store.createResetToken(rec(a.id, 'h1'), 3, NOW);
      expect(h.store.getResetToken('h1', NOW + 1)?.accountId).toBe(a.id);
      expect(h.store.getResetToken('nope', NOW)).toBeUndefined();
      expect(h.store.consumeResetToken('h1', NOW + 1)?.accountId).toBe(a.id);
      expect(h.store.consumeResetToken('h1', NOW + 1)).toBeUndefined();
      expect(h.store.getResetToken('h1', NOW + 1)).toBeUndefined();
    });

    it('expirado nao vale (consulta nem consumo) e some na limpeza', async () => {
      const h = await make();
      const a = mk(h.store, 'bia');
      h.store.createResetToken(rec(a.id, 'h1'), 3, NOW);
      const late = NOW + 30 * 60_000;
      expect(h.store.getResetToken('h1', late)).toBeUndefined();
      expect(h.store.consumeResetToken('h1', late)).toBeUndefined();
      expect(h.store.countResetTokens(a.id, late)).toBe(0);
      h.store.deleteExpiredResetTokens(late);
      await h.settle();
      const s2 = await h.reopen();
      expect(s2.getResetToken('h1', NOW)).toBeUndefined();
    });

    it('mantem no maximo N pendentes por conta (o mais antigo cai) sem mexer em outras contas', async () => {
      const h = await make();
      const a = mk(h.store, 'caio');
      const b = mk(h.store, 'duda');
      h.store.createResetToken(rec(b.id, 'b1'), 3, NOW);
      for (let i = 1; i <= 4; i++) h.store.createResetToken(rec(a.id, `a${i}`, NOW + i), 3, NOW + i);
      expect(h.store.countResetTokens(a.id, NOW + 10)).toBe(3);
      expect(h.store.getResetToken('a1', NOW + 10)).toBeUndefined();
      expect(h.store.getResetToken('a2', NOW + 10)).toBeDefined();
      expect(h.store.getResetToken('a4', NOW + 10)).toBeDefined();
      expect(h.store.countResetTokens(b.id, NOW + 10)).toBe(1);
    });

    it('deleteResetTokensOf apaga so os da conta', async () => {
      const h = await make();
      const a = mk(h.store, 'eva');
      const b = mk(h.store, 'fabio');
      h.store.createResetToken(rec(a.id, 'a1'), 3, NOW);
      h.store.createResetToken(rec(a.id, 'a2', NOW + 1), 3, NOW + 1);
      h.store.createResetToken(rec(b.id, 'b1'), 3, NOW);
      h.store.deleteResetTokensOf(a.id);
      expect(h.store.countResetTokens(a.id, NOW + 2)).toBe(0);
      expect(h.store.countResetTokens(b.id, NOW + 2)).toBe(1);
    });

    it('persiste (so o hash) e o consumo tambem persiste', async () => {
      const h = await make();
      const a = mk(h.store, 'gil');
      h.store.createResetToken(rec(a.id, 'keep'), 3, NOW);
      h.store.createResetToken(rec(a.id, 'used', NOW + 1), 3, NOW + 1);
      h.store.consumeResetToken('used', NOW + 2);
      await h.settle();
      const s2 = await h.reopen();
      expect(s2.getResetToken('keep', NOW + 2)?.accountId).toBe(a.id);
      expect(s2.getResetToken('used', NOW + 2)).toBeUndefined();
    });
  });
}
