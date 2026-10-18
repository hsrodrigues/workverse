import { describe, expect, it } from 'vitest';
import { DuplicateAccountError, type AccountStore } from '../../src/store';

export interface ContractHandle {
  store: AccountStore;
  /** Espera as escritas assincronas (no-op para memoria). */
  settle(): Promise<void>;
}

/** Bateria de comportamento que TODA implementacao de AccountStore precisa cumprir. */
export function accountStoreContract(label: string, make: () => Promise<ContractHandle>) {
  describe(`contrato AccountStore: ${label}`, () => {
    const newAccount = (n: string) => ({ email: `${n}@Example.com`, displayName: `Nome ${n}`, passwordHash: 'scrypt$x' });

    it('cria conta e consulta por id, e-mail e nome (case-insensitive)', async () => {
      const { store } = await make();
      const a = store.create(newAccount('ana'));
      expect(a.email).toBe('ana@example.com');
      expect(a.lastRoom).toBeTruthy();
      expect(store.getById(a.id)).toBe(a);
      expect(store.getByEmail('  ANA@EXAMPLE.COM ')?.id).toBe(a.id);
      expect(store.getByName('nome ANA')?.id).toBe(a.id);
      expect(store.getByEmail('outro@example.com')).toBeUndefined();
    });

    it('rejeita e-mail e nome duplicados com DuplicateAccountError', async () => {
      const { store } = await make();
      store.create(newAccount('bia'));
      expect(() => store.create({ ...newAccount('x'), email: 'BIA@example.com' })).toThrowError(DuplicateAccountError);
      try {
        store.create({ ...newAccount('x'), email: 'BIA@example.com' });
      } catch (e) {
        expect((e as DuplicateAccountError).field).toBe('email');
      }
      try {
        store.create({ ...newAccount('y'), displayName: 'NOME BIA' });
        throw new Error('deveria ter lancado');
      } catch (e) {
        expect(e).toBeInstanceOf(DuplicateAccountError);
        expect((e as DuplicateAccountError).field).toBe('displayName');
      }
    });

    it('save() atualiza avatar, sala, status e equipe', async () => {
      const { store } = await make();
      const a = store.create(newAccount('caio'));
      store.save({ ...a, lastRoom: 'lounge', status: 'focus', team: 'devs', avatar: { ...a.avatar, hair: { id: 'hair.bun', color: 'black' } } });
      const b = store.getById(a.id)!;
      expect(b.lastRoom).toBe('lounge');
      expect(b.status).toBe('focus');
      expect(b.team).toBe('devs');
      expect(b.avatar.hair.id).toBe('hair.bun');
    });

    it('save() guarda e remove o nivel de staff da plataforma', async () => {
      const { store, settle } = await make();
      const a = store.create(newAccount('staffer'));
      expect(a.staff).toBeUndefined();
      store.save({ ...a, staff: 'moderator' });
      await settle();
      expect(store.getById(a.id)!.staff).toBe('moderator');
      const b = store.getById(a.id)!;
      delete b.staff;
      store.save(b);
      await settle();
      expect(store.getById(a.id)!.staff).toBeUndefined();
    });

    it('sessoes: cria, le, apaga uma, apaga as da conta e remove expiradas', async () => {
      const { store } = await make();
      const a = store.create(newAccount('duda'));
      const b = store.create(newAccount('edu'));
      const s = (tokenHash: string, accountId: string, expiresAt: number) => ({ tokenHash, accountId, createdAt: 1_000, expiresAt });
      store.createSession(s('h1', a.id, 5_000));
      store.createSession(s('h2', a.id, 5_000));
      store.createSession(s('h3', b.id, 500));
      expect(store.getSession('h1')?.accountId).toBe(a.id);
      store.deleteSession('h1');
      expect(store.getSession('h1')).toBeUndefined();
      store.deleteExpiredSessions(1_000);
      expect(store.getSession('h3')).toBeUndefined();
      expect(store.getSession('h2')).toBeDefined();
      store.deleteSessionsOf(a.id);
      expect(store.getSession('h2')).toBeUndefined();
    });
  });
}
