import { describe, expect, it } from 'vitest';
import { DuplicateAccountError, type AccountStore } from '../../src/store';

export interface ProfileHandle {
  store: AccountStore;
  /** Espera as escritas assincronas (no-op para memoria). */
  settle(): Promise<void>;
  /** Abre um store NOVO sobre o mesmo armazenamento (reinicio do servidor). */
  reopen(): Promise<AccountStore>;
}

/** O que todo store persistente precisa guardar do perfil editavel (profile.ts) e do rename. */
export function profileStoreContract(label: string, make: () => Promise<ProfileHandle>) {
  describe(`contrato de perfil: ${label}`, () => {
    const mk = (store: AccountStore, n: string) => store.create({ email: `${n}@x.com`, displayName: `Pessoa ${n}`, passwordHash: 'scrypt$x' });

    it('conta nova nao tem perfil; perfil salvo sobrevive ao reinicio', async () => {
      const h = await make();
      const a = mk(h.store, 'ana');
      expect(a.profile).toBeUndefined();
      a.profile = { about: 'Cafe e codigo', pronouns: 'ela', birthday: { m: 2, d: 29 }, birthdayVisible: true, birthdayChat: false, prefs: { tz: 'America/Manaus', sound: false, showWorking: false }, nameChanges: [123] };
      h.store.save(a);
      await h.settle();
      const s2 = await h.reopen();
      const b = s2.getById(a.id)!;
      expect(b.profile).toEqual(a.profile);
      // perfil limpo volta a ficar ausente (escrito pelo store reaberto, que e o que o settle espera)
      delete b.profile;
      s2.save(b);
      await h.settle();
      expect((await h.reopen()).getById(a.id)!.profile).toBeUndefined();
    });

    it('rename() troca o nome, libera o antigo, respeita unicidade e persiste', async () => {
      const h = await make();
      const a = mk(h.store, 'bia');
      const b = mk(h.store, 'caio');
      expect(() => h.store.rename(a.id, 'PESSOA CAIO')).toThrowError(DuplicateAccountError);
      expect(h.store.getById(a.id)!.displayName).toBe('Pessoa bia');
      h.store.rename(a.id, 'Beatriz');
      expect(h.store.getByName('beatriz')?.id).toBe(a.id);
      expect(h.store.getByName('Pessoa bia')).toBeUndefined();
      // o nome antigo ficou livre para outra conta
      h.store.rename(b.id, 'Pessoa bia');
      expect(h.store.getByName('pessoa BIA')?.id).toBe(b.id);
      // so mudar a caixa do proprio nome vale
      h.store.rename(a.id, 'BEATRIZ');
      await h.settle();
      const s2 = await h.reopen();
      expect(s2.getById(a.id)!.displayName).toBe('BEATRIZ');
      expect(s2.getByName('beatriz')?.id).toBe(a.id);
      expect(s2.getById(b.id)!.displayName).toBe('Pessoa bia');
      expect(() => s2.create({ email: 'novo@x.com', displayName: 'beatriz', passwordHash: '' })).toThrowError(DuplicateAccountError);
    });
  });
}
