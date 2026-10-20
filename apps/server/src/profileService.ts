import { randomUUID } from 'node:crypto';
import { isBirthdayToday, prefsOf, type AccountProfile, type AuditRecord, type PlayerView, type ProfileView, type ServerMessage } from '@workverse/shared';
import type { Account, AccountStore } from './store';

/** Campos de perfil que podem aparecer para outras pessoas, ja resolvidos para "agora" (aniversario depende do dia). */
export interface PublicCard {
  about?: string;
  pronouns?: string;
  bday: boolean;
  hideWorking: boolean;
}

export function cardOf(account: Pick<Account, 'profile'>, now: number): PublicCard {
  const p: AccountProfile = account.profile ?? {};
  const prefs = prefsOf(p);
  return {
    ...(p.about ? { about: p.about } : {}),
    ...(p.pronouns ? { pronouns: p.pronouns } : {}),
    bday: !!p.birthday && p.birthdayVisible === true && isBirthdayToday(p.birthday, now, prefs.tz),
    hideWorking: !prefs.showWorking,
  };
}

/** Visao completa que so o dono recebe. Cargo/setor/e-mail vem de fora e sao somente leitura. */
export function profileViewOf(account: Account, tag: { title?: string; dept?: string }, now: number, nameChangeAt: number, cooldownHours: number): ProfileView {
  const p = account.profile ?? {};
  return {
    displayName: account.displayName,
    email: account.email,
    ...(tag.title ? { title: tag.title } : {}),
    ...(tag.dept ? { dept: tag.dept } : {}),
    ...(p.about ? { about: p.about } : {}),
    ...(p.pronouns ? { pronouns: p.pronouns } : {}),
    ...(p.birthday ? { birthday: p.birthday } : {}),
    birthdayVisible: p.birthdayVisible === true,
    birthdayChat: p.birthdayChat === true,
    prefs: prefsOf(p),
    prefsSet: Object.keys(p.prefs ?? {}),
    nameChangeAt: nameChangeAt > now ? nameChangeAt : 0,
    nameCooldownHours: cooldownHours,
  };
}

/** Tira os campos opcionais do perfil de uma mensagem (visitantes nao os recebem). */
export function stripOptionalProfile(msg: ServerMessage): ServerMessage {
  const strip = (v: PlayerView): PlayerView => {
    if (v.about === undefined && v.pronouns === undefined && v.bday === undefined) return v;
    const { about: _a, pronouns: _p, bday: _b, ...rest } = v;
    return rest;
  };
  switch (msg.t) {
    case 'profile': {
      const { about: _a, pronouns: _p, bday: _b, ...rest } = msg;
      return rest;
    }
    case 'joined':
      return { ...msg, player: strip(msg.player) };
    case 'room':
      return { ...msg, room: { ...msg.room, players: msg.room.players.map(strip) } };
    default:
      return msg;
  }
}

/** Trocas de nome recentes (auditoria `profile.rename`), mais novas primeiro. */
export function nameHistoryOf(store: AccountStore, accountId: string, limit = 10): { at: number; from: string; to: string }[] {
  const out: { at: number; from: string; to: string }[] = [];
  for (const r of store.queryAudit({ action: 'profile.rename', target: accountId, limit })) {
    try {
      const d = JSON.parse(r.detail ?? '{}') as { from?: unknown; to?: unknown };
      if (typeof d.from === 'string' && typeof d.to === 'string') out.push({ at: r.at, from: d.from, to: d.to });
    } catch {
      /* registro antigo ou de outro formato */
    }
  }
  return out;
}

export function renameAudit(account: Account, from: string, to: string, at: number): AuditRecord {
  return { id: randomUUID(), at, actorId: account.id, actor: to, level: null, action: 'profile.rename', targetId: account.id, target: to, detail: JSON.stringify({ from, to }) };
}
