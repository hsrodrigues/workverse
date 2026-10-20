import { useSyncExternalStore } from 'react';
import type { ProfilePatch, ProfileView } from '@workverse/shared';
import { api, ApiError, describeError } from '../../api';
import { applyPrefs } from '../../clientPrefs';
import { decorEnabled } from '../../eventsStore';
import { fieldOfError, type FormErrors } from './profileForm';

export interface ProfileState {
  open: boolean;
  loading: boolean;
  saving: boolean;
  profile: ProfileView | null;
  /** Falha ao carregar. */
  loadError: string;
}

let state: ProfileState = { open: false, loading: false, saving: false, profile: null, loadError: '' };
const listeners = new Set<() => void>();
const set = (patch: Partial<ProfileState>) => {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
};

export const useProfileState = (): ProfileState => useSyncExternalStore((fn) => (listeners.add(fn), () => listeners.delete(fn)), () => state);

export type SaveResult = { ok: true; profile: ProfileView } | { ok: false; message: string; field: keyof FormErrors | null };

export const profileStore = {
  get: () => state,
  open() {
    set({ open: true });
    void profileStore.load();
  },
  close: () => set({ open: false }),
  toggle() {
    if (state.open) profileStore.close();
    else profileStore.open();
  },

  /** Carrega o perfil (e aplica as preferencias da conta). Migra a decoracao de eventos que ainda so existia no navegador. */
  async load(force = false) {
    if (state.loading || (state.profile && !force && state.open === false)) return;
    set({ loading: true, loadError: '' });
    try {
      const p = await api.profile();
      set({ profile: p, loading: false });
      applyPrefs(p.prefs);
      // Migracao: quem desligou a decoracao no navegador (localStorage) e nunca salvou na conta leva o valor para a conta.
      // `applyPrefs` acima ja gravou o padrao do servidor; lemos o valor antigo antes via marcador.
      if (!p.prefsSet.includes('eventDecor') && legacyDecorOff) {
        legacyDecorOff = false;
        void profileStore.save({ prefs: { eventDecor: false } });
      }
    } catch (err) {
      set({ loading: false, loadError: describeError(err) });
    }
  },

  async save(patch: ProfilePatch): Promise<SaveResult> {
    set({ saving: true });
    try {
      const p = await api.saveProfile(patch);
      set({ profile: p, saving: false });
      applyPrefs(p.prefs);
      return { ok: true, profile: p };
    } catch (err) {
      set({ saving: false });
      const e = err instanceof ApiError ? err : null;
      return { ok: false, message: describeError(err), field: e ? fieldOfError(e.code, e.field) : null };
    }
  },
};

/** Valor antigo (so no navegador) lido uma vez, antes de qualquer `applyPrefs` sobrescrever a decoracao. */
let legacyDecorOff = !decorEnabled();
