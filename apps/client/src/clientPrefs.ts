import { DEFAULT_PREFS, prefsOf, type ProfilePrefs } from '@workverse/shared';
import { setDecorEnabled } from './eventsStore';

/**
 * Preferencias pessoais no cliente. A fonte da verdade e a CONTA (GET/PATCH /api/profile); esta copia fica em
 * localStorage so para valer antes do perfil carregar e quando o servidor estiver fora do ar (fallback). Nada aqui e seguranca.
 */
const KEY = 'wv.prefs';
let current: ProfilePrefs = read();
const listeners = new Set<() => void>();

function read(): ProfilePrefs {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? prefsOf({ prefs: JSON.parse(raw) as Partial<ProfilePrefs> }) : { ...DEFAULT_PREFS };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export const getPrefs = (): ProfilePrefs => current;
export const subscribePrefs = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

/** Aplica as preferencias vindas da conta: guarda a copia local e liga os efeitos (decoracao de eventos...). */
export function applyPrefs(p: ProfilePrefs) {
  current = { ...p };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* sem armazenamento: vale ate recarregar */
  }
  setDecorEnabled(p.eventDecor);
  listeners.forEach((l) => l());
}

/** Modo economia de dados de audio/video (usado pela camada de midia ao abrir camera/microfone). */
export const dataSaverOn = (): boolean => current.dataSaver;

/** Hora no fuso escolhido ("14:32"). */
export function clockIn(tz: string, now = Date.now()): string {
  try {
    return new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: tz }).format(new Date(now));
  } catch {
    return '';
  }
}
