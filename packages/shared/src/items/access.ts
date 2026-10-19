import type { ItemDef, Unlock } from './types';

/**
 * Who may wear what. This module is pure so the server (authoritative) and the editor (hints only) share it.
 * The server feeds it the account's unlock table (`store.getUnlocks`); the editor gets the same keys from the server.
 *
 * Unlock keys in the table:
 *   `achievement:<id>` / `event:<id>`  grants every item with that unlock;
 *   `staff`                            grants every item with `unlock: 'staff'`;
 *   `item:<itemId>`                    grants one item directly (also needed for `hidden` items).
 */
export type Access = 'ok' | 'locked' | 'upcoming' | 'retired' | 'hidden';

export interface AccessContext {
  unlocks: ReadonlySet<string>;
  /** Ids already worn by the account (a retired item stays usable for whoever already wears it). */
  wearing?: ReadonlySet<string>;
}

export function accessOf(item: ItemDef, ctx: AccessContext): Access {
  if (item.availability === 'upcoming') return 'upcoming';
  const direct = ctx.unlocks.has(`item:${item.id}`);
  if (item.availability === 'hidden' && !direct) return 'hidden';
  if (item.availability === 'retired' && !ctx.wearing?.has(item.id) && !direct) return 'retired';
  if (item.unlock === 'free' || direct || ctx.unlocks.has(item.unlock)) return 'ok';
  return 'locked';
}

/** Nome de setor sem acento, caixa e espacos repetidos (comparacao do setor "TI" e do desbloqueio `dept:`). */
export const normDeptName = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

/** Setores com desbloqueio proprio (`dept:<id>`): nomes normalizados que valem como esse setor. */
export const DEPT_UNLOCK_NAMES: Readonly<Record<string, readonly string[]>> = { ti: ['ti', 'tecnologia da informacao'] };

/** Chave de desbloqueio (`dept:ti`) do setor com esse nome, ou null quando o setor nao tem itens exclusivos. */
export function deptUnlockKeyOf(teamName: string): string | null {
  const n = normDeptName(teamName);
  for (const [id, names] of Object.entries(DEPT_UNLOCK_NAMES)) if (names.includes(n)) return `dept:${id}`;
  return null;
}

export const UNLOCK_LABELS: Readonly<Record<string, string>> = {
  free: 'Gratuito',
  staff: 'Equipe WorkVerse',
  'achievement:coffee-lover': 'Conquista: Fã de café',
  'achievement:champion': 'Conquista: Campeão',
  'achievement:team-player': 'Conquista: Jogador de equipe',
  'achievement:night-owl': 'Conquista: Coruja noturna',
  'achievement:top-collaborator': 'Conquista: Colaborador destaque',
  'event:aniversario': 'Evento: Aniversário do WorkVerse',
  'event:natal': 'Evento: Natal',
  'event:diati': 'Evento: Dia do Profissional de TI',
  'dept:ti': 'Exclusivo do setor TI',
};

export function describeUnlock(unlock: Unlock): string {
  if (UNLOCK_LABELS[unlock]) return UNLOCK_LABELS[unlock];
  if (unlock.startsWith('achievement:')) return `Conquista: ${unlock.slice(12)}`;
  if (unlock.startsWith('event:')) return `Evento: ${unlock.slice(6)}`;
  if (unlock.startsWith('dept:')) return `Exclusivo do setor ${unlock.slice(5).toUpperCase()}`;
  return unlock;
}

export const ACCESS_MESSAGES: Readonly<Record<Exclude<Access, 'ok'>, string>> = {
  locked: 'ainda não foi desbloqueado',
  upcoming: 'ainda não está disponível (em breve)',
  retired: 'saiu de linha e não pode mais ser equipado',
  hidden: 'não está disponível',
};
