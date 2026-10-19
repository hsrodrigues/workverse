import { randomUUID } from 'node:crypto';
import {
  MAX_OUTFITS,
  MAX_OUTFIT_NAME,
  accessOf,
  isLegacyAvatar,
  makePolicy,
  migrateLegacyAvatar,
  sanitizeOutfitName,
  validateAvatar,
  getItem,
  wornIds,
  ACCESS_MESSAGES,
  type AvatarClientMessage,
  type AvatarIssue,
  type AvatarServerMessage,
  type AvatarV2,
  type ItemDef,
  type Outfit,
  type OutfitView,
  type ValidationResult,
  type WardrobeState,
} from '@workverse/shared';
import type { Account, AccountStore } from './store';

/**
 * Server side of the avatar editor and "Meu Guarda-Roupa". Everything the client sends is validated here
 * (catalog, slots, palette colors, compatibility, unlocks); the editor's own checks are only hints.
 */

/** Item e chave reservados a staff: nunca vem de Account.unlocks (concessao manual/legada), so de Account.staff definido pelo servidor. */
export const STAFF_BADGE_ID = 'sp.badge_staff';
const STAFF_ONLY_KEYS = new Set(['staff', `item:${STAFF_BADGE_ID}`]);

/**
 * Eventos ativos agora (ids): enquanto durarem, todo mundo ganha a chave `event:<id>` e pode vestir os itens do evento.
 * Quem esta VESTINDO um item de evento continua podendo mante-lo depois que o evento acaba (o item nao some do visual
 * nem trava o salvamento do avatar); para trocar de item de novo, so no proximo evento. Concessao manual (`event:<id>`
 * em Account.unlocks, staff_item) continua valendo para sempre. O mundo registra a fonte (ver World).
 */
let activeEventIds: () => readonly string[] = () => [];
export function setActiveEventsProvider(fn: () => readonly string[]): void {
  activeEventIds = fn;
}

/**
 * Chaves `dept:<setor>` da conta, derivadas do vinculo ATUAL com o setor (equipe) em qualquer organizacao dela: membro ativo
 * (nao visitante) de uma equipe cujo nome normalizado e o do setor (ex.: "TI"). O World registra a fonte; nunca vem de dado
 * que a pessoa edite (so quem administra a organizacao define equipes e vinculos).
 */
let deptKeysOf: (accountId: string) => readonly string[] = () => [];
export function setDeptKeysProvider(fn: (accountId: string) => readonly string[]): void {
  deptKeysOf = fn;
}

const unlockSet = (account: Account): Set<string> => {
  const keys = new Set((account.unlocks ?? []).filter((k) => !STAFF_ONLY_KEYS.has(k)));
  if (account.staff) for (const k of STAFF_ONLY_KEYS) keys.add(k);
  for (const id of activeEventIds()) keys.add(`event:${id}`);
  for (const k of deptKeysOf(account.id)) keys.add(k);
  // quem ja veste um item de evento (ou do setor) o mantem depois que o evento acaba / a pessoa sai do setor
  for (const id of wornIds(account.avatar)) {
    const item = getItem(id);
    if (item && (item.unlock.startsWith('event:') || item.unlock.startsWith('dept:')) && item.availability === 'available') keys.add(`item:${id}`);
  }
  return keys;
};

/** Whether the account may equip `item` right now (unlocked and offered). Free items are open to everybody. */
export function canUse(account: Account, item: ItemDef): boolean {
  return accessOf(item, { unlocks: unlockSet(account), wearing: wornIds(account.avatar) }) === 'ok';
}

/** Why the account cannot use `item`, or null when it can. */
export function whyNot(account: Account, item: ItemDef): string | null {
  const a = accessOf(item, { unlocks: unlockSet(account), wearing: wornIds(account.avatar) });
  return a === 'ok' ? null : `"${item.name}" ${ACCESS_MESSAGES[a]}.`;
}

/** Strict validation of an untrusted appearance for this account (legacy index configs are migrated first). */
export function validateFor(account: Account, input: unknown): ValidationResult {
  const candidate = isLegacyAvatar(input) ? migrateLegacyAvatar(input) : input;
  return validateAvatar(candidate, makePolicy({ unlocks: unlockSet(account), wearing: wornIds(account.avatar) }));
}

const summary = (issues: AvatarIssue[]) => issues.map((i) => i.message).join(' ');

export function wardrobeState(account: Account): WardrobeState {
  const outfits: OutfitView[] = (account.outfits ?? []).map((o) => {
    const res = validateFor(account, o.avatar);
    return { id: o.id, name: o.name, avatar: o.avatar, updatedAt: o.updatedAt, usable: res.ok, problems: res.ok ? [] : res.issues.map((i) => i.message) };
  });
  return {
    avatar: account.avatar,
    outfits,
    unlocks: [...unlockSet(account)],
    maxOutfits: MAX_OUTFITS,
    devAccount: account.passwordHash === '',
  };
}

export interface WardrobeDeps {
  store: AccountStore;
  /** Stores the new look on the live player and tells everybody in the room (`avatar` message). */
  apply(avatar: AvatarV2): void;
  reply(msg: AvatarServerMessage): void;
  now(): number;
}

const fail = (rid: number | undefined, code: string, message: string, issues?: AvatarIssue[]): AvatarServerMessage => ({
  t: 'avatar_result',
  ...(rid !== undefined ? { rid } : {}),
  ok: false,
  code,
  message,
  ...(issues ? { issues } : {}),
});

const ridOf = (msg: { rid?: unknown }): number | undefined => (typeof msg.rid === 'number' && Number.isInteger(msg.rid) && msg.rid >= 0 ? msg.rid : undefined);

/** Saves the appearance of the account after validating it. Returns the clean avatar or null (answer already sent). */
export function saveAvatar(deps: WardrobeDeps, account: Account, input: unknown, rid?: number): AvatarV2 | null {
  const res = validateFor(account, input);
  if (!res.ok) {
    deps.reply(fail(rid, res.issues[0]?.code ?? 'invalid', summary(res.issues), res.issues));
    return null;
  }
  account.avatar = res.avatar;
  deps.store.save(account);
  deps.apply(res.avatar);
  deps.reply({ t: 'avatar_result', ...(rid !== undefined ? { rid } : {}), ok: true, avatar: res.avatar });
  return res.avatar;
}

/** Handles every wardrobe message of an authenticated connection. */
export function handleWardrobeMessage(deps: WardrobeDeps, account: Account, msg: AvatarClientMessage): void {
  const rid = ridOf(msg);
  switch (msg.t) {
    case 'wardrobe_get':
      deps.reply({ t: 'wardrobe', ...(rid !== undefined ? { rid } : {}), state: wardrobeState(account) });
      return;
    case 'avatar_save':
      saveAvatar(deps, account, msg.avatar, rid);
      return;
    case 'outfit_save': {
      const name = sanitizeOutfitName(msg.name, MAX_OUTFIT_NAME);
      if (!name) return deps.reply(fail(rid, 'bad_name', `Dê ao conjunto um nome de 1 a ${MAX_OUTFIT_NAME} caracteres (letras, números e espaços).`));
      const res = validateFor(account, msg.avatar);
      if (!res.ok) return deps.reply(fail(rid, res.issues[0]?.code ?? 'invalid', summary(res.issues), res.issues));
      const list = account.outfits ?? [];
      const byId = typeof msg.id === 'string' ? list.find((o) => o.id === msg.id) : undefined;
      const lower = name.toLocaleLowerCase();
      const target = byId ?? list.find((o) => o.name.toLocaleLowerCase() === lower);
      if (msg.id !== undefined && !byId) return deps.reply(fail(rid, 'not_found', 'Esse conjunto não existe mais.'));
      if (!target && list.length >= MAX_OUTFITS) {
        return deps.reply(fail(rid, 'too_many_outfits', `Você já tem ${MAX_OUTFITS} conjuntos. Exclua um para salvar outro.`));
      }
      const clash = list.find((o) => o !== target && o.name.toLocaleLowerCase() === lower);
      if (clash) return deps.reply(fail(rid, 'duplicate_name', `Já existe um conjunto chamado "${clash.name}".`));
      const saved: Outfit = { id: target?.id ?? randomUUID().slice(0, 8), name, avatar: res.avatar, updatedAt: deps.now() };
      account.outfits = target ? list.map((o) => (o === target ? saved : o)) : [...list, saved];
      deps.store.save(account);
      deps.reply({ t: 'wardrobe', ...(rid !== undefined ? { rid } : {}), state: wardrobeState(account) });
      return;
    }
    case 'outfit_delete': {
      const list = account.outfits ?? [];
      if (typeof msg.id !== 'string' || !list.some((o) => o.id === msg.id)) return deps.reply(fail(rid, 'not_found', 'Esse conjunto não existe mais.'));
      account.outfits = list.filter((o) => o.id !== msg.id);
      deps.store.save(account);
      deps.reply({ t: 'wardrobe', ...(rid !== undefined ? { rid } : {}), state: wardrobeState(account) });
      return;
    }
    case 'outfit_apply': {
      const outfit = typeof msg.id === 'string' ? (account.outfits ?? []).find((o) => o.id === msg.id) : undefined;
      if (!outfit) return deps.reply(fail(rid, 'not_found', 'Esse conjunto não existe mais.'));
      saveAvatar(deps, account, outfit.avatar, rid);
      return;
    }
  }
}

// ---- unlock keys -------------------------------------------------------------------------------------------------

/** Chaves de staff nao sao concedidas por unlock: so por Account.staff (BOOTSTRAP_STAFF_EMAILS / CLI). */
const UNLOCK_KEY = /^(staff|(achievement|event):[a-z0-9][a-z0-9-]{0,39}|item:[a-z0-9][a-z0-9._-]{0,47})$/;

/** Validates an unlock key (`staff`, `achievement:x`, `event:x`, `item:<catalog id>`). Returns the key or an error text. */
export function parseUnlockKey(raw: unknown): { ok: true; key: string } | { ok: false; message: string } {
  if (typeof raw !== 'string' || !UNLOCK_KEY.test(raw)) {
    return { ok: false, message: 'Chave inválida. Use staff, achievement:<nome>, event:<nome> ou item:<id do item>.' };
  }
  if (STAFF_ONLY_KEYS.has(raw)) return { ok: false, message: 'O crachá da equipe só é liberado pelo servidor para contas de staff.' };
  if (raw.startsWith('item:') && !getItem(raw.slice(5))) return { ok: false, message: `Item inexistente: ${raw.slice(5)}.` };
  return { ok: true, key: raw };
}

/** Grants or revokes an unlock key on the account and saves it. Returns false when nothing changed. */
export function setUnlock(store: AccountStore, account: Account, key: string, grant: boolean): boolean {
  const list = account.unlocks ?? [];
  const has = list.includes(key);
  if (grant === has) return false;
  account.unlocks = grant ? [...list, key] : list.filter((k) => k !== key);
  store.save(account);
  return true;
}

/** Keys the development command `/desbloquear todos` grants. */
export const DEV_UNLOCK_ALL = ['achievement:coffee-lover', 'event:aniversario', 'event:natal'] as const;
