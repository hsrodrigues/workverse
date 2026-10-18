import type { Account } from './store';

/** Estado de acesso de uma conta (banimento / desativacao por staff). Funcoes puras, sem I/O. */

export function isBanned(a: Pick<Account, 'ban'>, now: number): boolean {
  return !!a.ban && (a.ban.until === null || a.ban.until > now);
}

export function isDisabled(a: Pick<Account, 'disabled'>): boolean {
  return !!a.disabled;
}

export type AccessBlock = { code: 'banned' | 'disabled'; message: string };

const fmtDate = (ms: number) => new Date(ms).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

/** Por que a conta nao pode entrar (ou null). A mensagem e a que a pessoa le: sem nome de staff. */
export function accessBlock(a: Pick<Account, 'ban' | 'disabled'>, now: number): AccessBlock | null {
  if (a.ban && isBanned(a, now)) {
    const until = a.ban.until === null ? 'permanentemente' : `até ${fmtDate(a.ban.until)}`;
    return { code: 'banned', message: `Sua conta está banida ${until}${a.ban.reason ? `: ${a.ban.reason}` : '.'}` };
  }
  if (a.disabled) return { code: 'disabled', message: 'Sua conta está desativada. Fale com quem administra o escritório.' };
  return null;
}
