import { randomUUID } from 'node:crypto';
import {
  MAX_STAFF_REASON,
  ROOM_OPS,
  EVENT_IDS,
  getEventDef,
  type RoomAdminEntry,
  type RoomOp,
  MUTE_MAX_MINUTES,
  STAFF_LABELS,
  STAFF_RANK,
  equipItem,
  isStaffLevel,
  staffCan,
  unequipItem,
  type AvatarConfig,
  type AvatarV2,
  type OnlineEntry,
  type EventMode,
  PET_STAFF_OPS,
  type PetAdminEntry,
  type PetStaffOp,
  type EventsView,
  type Point,
  type ServerMessage,
  type StaffAction,
  type StaffClientMessage,
  type StaffLevel,
  type StaffLogEntry,
  type StaffSelf,
  type Dir8,
} from '@workverse/shared';
import { TokenBucket } from './limiter';
import { cleanChat, type Player } from './room';
import type { Account, AccountStore } from './store';
import { STAFF_BADGE_ID, parseUnlockKey, setUnlock } from './wardrobe';

/**
 * Staff da PLATAFORMA (suporte / moderacao). Concedido so pelo servidor (Account.staff, via BOOTSTRAP_STAFF_EMAILS ou CLI).
 * Toda acao passa por `gate()` (conta staff -> em servico -> nivel minimo -> limite de taxa), valida o alvo (nao age
 * sobre staff de nivel igual/maior, nem sobre si mesmo) e e AUDITADA. Nada aqui le DMs ou midia privada.
 */

export const STAFF_MESSAGE_TYPES: ReadonlySet<string> = new Set([
  'staff_duty',
  'staff_invis',
  'staff_list',
  'staff_mute',
  'staff_kick',
  'staff_goto',
  'staff_bring',
  'staff_announce',
  'staff_item',
  'staff_dm',
  'staff_rooms',
  'staff_room',
  'staff_event',
  'staff_pet',
]);
export const isStaffMessage = (t: string): boolean => STAFF_MESSAGE_TYPES.has(t);

/** Comandos de chat reconhecidos (so para staff; para os demais o chat segue como antes). */
const COMMANDS = new Set(['evento', 'staff', 'invis', 'online', 'mute', 'silenciar', 'unmute', 'desilenciar', 'kick', 'expulsar', 'kickroom', 'goto', 'bring', 'trazer', 'aviso', 'avisosala', 'dar', 'tirar']);

const LOG_MAX = 100;
const MAX_TARGET = 64;
const MAX_ANNOUNCE = 200;

export interface OnlineHandle {
  player: Player;
  conn: { send(msg: ServerMessage): void };
  account: Account;
}

export interface StaffHost {
  clock(): number;
  log(event: string, data?: Record<string, unknown>): void;
  store: AccountStore;
  online(): Iterable<OnlineHandle>;
  byAccount(accountId: string): OnlineHandle | undefined;
  roomName(p: Player): string;
  /** Posicao logica atual (sincronizada com o relogio) ou null fora de sala. */
  position(p: Player): (Point & { roomId: string; dir: Dir8 }) | null;
  enterRoom(p: Player, roomId: string, at?: Point & { dir: Dir8 }): void;
  landingRoom(p: Player): string;
  endSession(accountId: string, code: string, message: string): void;
  setAvatar(p: Player, avatar: AvatarConfig): void;
  setVisibility(p: Player): void;
  /** Avisa a sala do jogador (selo mudou). */
  flag(p: Player): void;
  /** Salas de todas as organizacoes (populacao e estado). */
  roomsOverview(): RoomAdminEntry[];
  /** Tranca / fecha / esvazia uma sala. `moved` = pessoas mandadas para a sala inicial. */
  roomControl(orgId: string, roomId: string, op: RoomOp): { ok: true; moved: number; name: string } | { ok: false; message: string };
  roomExists(orgId: string, roomId: string): boolean;
  /** Forca um evento (ligado / desligado / automatico) e avisa todos os online. `changed` = false quando ja estava assim. */
  setEvent(id: string, mode: EventMode): { changed: boolean; view: EventsView };
  /** Byte, o pet do escritorio, por organizacao (ver pet.ts). */
  pets: {
    list(): PetAdminEntry[];
    /** false = ja estava assim. */
    setEnabled(orgId: string, on: boolean): boolean;
    rename(orgId: string, name: unknown): string | null;
    bring(orgId: string, roomId: string, at: Point): { ok: true } | { ok: false; message: string };
  };
}

/** `email[:nivel],email2[:nivel]` (nivel padrao: admin). Linhas invalidas sao ignoradas. */
export function parseStaffEmails(raw: string | undefined): Map<string, StaffLevel> {
  const out = new Map<string, StaffLevel>();
  for (const part of (raw ?? '').split(/[,;\s]+/)) {
    if (!part) continue;
    const [email, level] = part.split(':');
    const key = email!.normalize('NFKC').trim().toLowerCase();
    if (!key.includes('@')) continue;
    if (level !== undefined && !isStaffLevel(level)) continue;
    out.set(key, (level as StaffLevel | undefined) ?? 'admin');
  }
  return out;
}

/** Concede (ou muda) o nivel das contas listadas. Nunca revoga. Retorna as contas alteradas. */
export function applyBootstrapStaff(store: AccountStore, list: Map<string, StaffLevel>, log?: StaffHost['log']): Account[] {
  const changed: Account[] = [];
  if (list.size === 0) return changed;
  for (const a of store.listAccounts()) {
    const level = list.get(a.email);
    if (level && a.staff !== level) {
      a.staff = level;
      store.save(a);
      changed.push(a);
      log?.('staff.grant', { by: 'env:BOOTSTRAP_STAFF_EMAILS', account: a.id, name: a.displayName, level });
    }
  }
  return changed;
}

const hasBadge = (a: AvatarV2) => a.special.some((r) => r.id === STAFF_BADGE_ID);

export class StaffService {
  private readonly buckets = new Map<string, TokenBucket>();
  private readonly ring: StaffLogEntry[] = [];

  constructor(
    private readonly host: StaffHost,
    private readonly bootstrap: Map<string, StaffLevel>,
  ) {}

  // ---- identidade / selo ---------------------------------------------------------------------------------------

  /** Chamado no hello: confere o e-mail da lista de bootstrap e liga o estado de staff do jogador (sempre a partir da conta). */
  attach(player: Player, account: Account) {
    const level = this.bootstrap.get(account.email);
    if (level && account.staff !== level) {
      account.staff = level;
      this.host.store.save(account);
      this.host.log('staff.grant', { by: 'env:BOOTSTRAP_STAFF_EMAILS', account: account.id, name: account.displayName, level });
    }
    player.staff = isStaffLevel(account.staff) ? account.staff : null;
    player.onDuty = player.staff !== null;
    player.invisible = false;
    player.avatar = this.decorate(player, player.avatar);
  }

  /** Aparencia exibida: com o cracha dourado em servico (nao da para tirar), sem ele para quem nao esta em servico / nao e staff. */
  decorate<A extends AvatarConfig>(player: Player, avatar: A): A {
    const a = avatar as AvatarV2;
    if (player.staff && player.onDuty) {
      if (hasBadge(a)) return avatar;
      const r = equipItem(a, STAFF_BADGE_ID);
      return (r.ok ? r.avatar : a) as A;
    }
    return (hasBadge(a) ? unequipItem(a, STAFF_BADGE_ID) : a) as A;
  }

  selfOf(player: Player): StaffSelf | undefined {
    return player.staff ? { level: player.staff, duty: player.onDuty, invisible: player.invisible } : undefined;
  }

  // ---- mute ----------------------------------------------------------------------------------------------------

  /** Milissegundos restantes de silenciamento (0 = livre). O silenciamento mora na conta: sobrevive a reinicio. */
  mutedFor(accountId: string, now: number): number {
    const acc = this.host.store.getById(accountId);
    const m = acc?.mute;
    if (!acc || !m) return 0;
    if (m.until <= now) {
      delete acc.mute;
      this.host.store.save(acc);
      return 0;
    }
    return m.until - now;
  }

  /** E-mail definido por BOOTSTRAP_STAFF_EMAILS: o nivel dessa conta so muda pela variavel de ambiente. */
  isEnvManaged(email: string): boolean {
    return this.bootstrap.has(email.normalize('NFKC').trim().toLowerCase());
  }

  /**
   * Aplica na hora (sem reiniciar) uma mudanca de Account.staff para quem esta online: selo, poderes e painel.
   * Chamado depois que a API grava o novo nivel na conta.
   */
  reconcile(accountId: string) {
    const h = this.host.byAccount(accountId);
    if (!h) return;
    const before = h.player.staff;
    this.refresh(h.player);
    if (h.player.staff && h.player.staff !== before) this.sendList(h.player);
  }

  // ---- gate / auditoria ----------------------------------------------------------------------------------------

  private say(p: Player, text: string) {
    p.send({ t: 'chat', id: null, name: '', text, kind: 'system' });
  }

  private err(p: Player, code: string, message: string) {
    p.send({ t: 'error', code, message });
  }

  /** Reconfere a conta (nivel revogado no meio da sessao derruba o selo na hora). */
  private refresh(p: Player): StaffLevel | null {
    const acc = this.host.byAccount(p.accountId)?.account;
    const level = acc && isStaffLevel(acc.staff) ? acc.staff : null;
    if (level !== p.staff) {
      const wasStaff = p.staff !== null;
      const wasDuty = p.onDuty;
      p.staff = level;
      // Quem acaba de virar staff entra em servico (como no login); quem perdeu o nivel sai.
      p.onDuty = level !== null && (wasStaff ? wasDuty : true);
      if (!level) p.invisible = false;
      this.syncLook(p);
      this.send(p);
      if (!level && wasStaff) p.send({ t: 'staff_revoked' });
    }
    return level;
  }

  private bucket(p: Player, now: number): TokenBucket {
    let b = this.buckets.get(p.accountId);
    if (!b) this.buckets.set(p.accountId, (b = new TokenBucket(10, 2, now)));
    return b;
  }

  private deny(p: Player, action: string, reason: string, detail?: string) {
    this.host.log('staff.denied', { actor: p.accountId, actorName: p.name, level: p.staff ?? null, action, reason, ...(detail ? { detail } : {}) });
    this.err(p, 'forbidden', 'Você não tem permissão para isso.');
  }

  /** Negativa de uma rota HTTP de staff (conta comum ou nivel insuficiente): registrada como no WebSocket. */
  deniedHttp(account: Account, action: string, reason: string) {
    this.host.log('staff.denied', { actor: account.id, actorName: account.displayName, level: account.staff ?? null, action, reason, via: 'http' });
  }

  private gate(p: Player, action: StaffAction | 'duty', now: number): StaffLevel | null {
    const level = this.refresh(p);
    if (!level) {
      this.deny(p, action, 'not_staff');
      return null;
    }
    if (!this.bucket(p, now).take(now)) {
      this.err(p, 'rate_limited', 'Calma! Muitas ações de staff seguidas.');
      return null;
    }
    if (action === 'duty') return level;
    if (!p.onDuty) {
      this.err(p, 'off_duty', 'Você está fora de serviço. Use /staff on.');
      return null;
    }
    if (!staffCan(level, action)) {
      this.deny(p, action, 'level', level);
      return null;
    }
    return level;
  }

  private audit(p: Player, level: StaffLevel, action: string, target?: { id: string; name: string } | null, detail?: string) {
    this.record({ id: p.accountId, name: p.name, level }, action, target, detail);
  }

  /**
   * Registra uma acao de staff: log estruturado, anel em memoria (painel), tabela permanente (store) e aviso em tempo
   * real a quem esta em servico. E o unico caminho de auditoria, usado pelo WebSocket e pela API HTTP.
   */
  record(actor: { id: string; name: string; level: StaffLevel | null }, action: string, target?: { id: string; name: string } | null, detail?: string) {
    const at = this.host.clock();
    const text = detail ? detail.slice(0, 300) : undefined;
    const entry: StaffLogEntry = { at, actor: actor.name, level: actor.level ?? 'helper', action, ...(target ? { target: target.name } : {}), ...(text ? { detail: text } : {}) };
    this.ring.push(entry);
    if (this.ring.length > LOG_MAX) this.ring.shift();
    this.host.store.appendAudit({
      id: randomUUID(),
      at,
      actorId: actor.id,
      actor: actor.name,
      level: actor.level,
      action,
      ...(target ? { targetId: target.id, target: target.name } : {}),
      ...(text ? { detail: text } : {}),
    });
    this.host.log('staff.action', { at, actor: actor.id, actorName: actor.name, level: actor.level, action, ...(target ? { target: target.id, targetName: target.name } : {}), ...(text ? { detail: text } : {}) });
    for (const h of this.host.online()) if (h.player.staff && h.player.onDuty) h.conn.send({ t: 'staff_log', entries: [entry], append: true });
  }

  /** Alvo valido para moderar: online, diferente de quem age, sem nivel igual/maior. */
  private target(p: Player, level: StaffLevel, raw: unknown): OnlineHandle | null {
    const t = typeof raw === 'string' && raw.length > 0 && raw.length <= MAX_TARGET ? this.find(raw) : undefined;
    if (!t) {
      this.say(p, 'Jogador não encontrado (precisa estar online).');
      return null;
    }
    if (t.player.accountId === p.accountId) {
      this.say(p, 'Você não pode fazer isso consigo mesmo.');
      return null;
    }
    const tl = isStaffLevel(t.account.staff) ? t.account.staff : null;
    if (tl && STAFF_RANK[tl] >= STAFF_RANK[level]) {
      this.deny(p, 'target', 'hierarchy', t.player.name);
      return null;
    }
    return t;
  }

  /** Procura um online por id de jogador, id de conta ou nome (qualquer org: so staff chega aqui). */
  find(raw: string): OnlineHandle | undefined {
    const key = raw.normalize('NFKC').trim();
    for (const h of this.host.online()) if (h.player.id === key || h.player.accountId === key) return h;
    const acc = this.host.store.getByName(key);
    return acc ? this.host.byAccount(acc.id) : undefined;
  }

  // ---- estado enviado ao proprio staff ---------------------------------------------------------------------------

  private send(p: Player) {
    const self = this.selfOf(p);
    if (self) p.send({ t: 'staff_self', ...self });
  }

  private syncLook(p: Player) {
    const acc = this.host.byAccount(p.accountId)?.account;
    if (acc) this.host.setAvatar(p, this.decorate(p, acc.avatar));
    this.host.flag(p);
  }

  /** Enviado logo depois do `session`. */
  onSession(p: Player) {
    this.send(p);
    if (p.staff) this.sendList(p);
  }

  private sendList(p: Player) {
    const players: OnlineEntry[] = [];
    for (const h of this.host.online()) {
      const q = h.player;
      players.push({
        id: q.id,
        accountId: q.accountId,
        name: q.name,
        status: q.status,
        roomId: q.roomId,
        roomName: this.host.roomName(q),
        orgId: q.orgId,
        orgName: this.host.store.orgs.getOrg(q.orgId)?.name ?? q.orgId,
        ...(q.staff && q.onDuty ? { staff: q.staff } : {}),
        muted: this.mutedFor(q.accountId, this.host.clock()) > 0,
        invisible: q.invisible,
      });
    }
    p.send({ t: 'staff_online', players });
    p.send({ t: 'staff_log', entries: this.ring.slice(-50), append: false });
  }

  // ---- mensagens do protocolo ------------------------------------------------------------------------------------

  /** Retorna false quando a mensagem esta malformada (o chamador conta um strike). */
  handle(p: Player, msg: StaffClientMessage, now: number): boolean {
    const m = msg as Record<string, unknown>;
    const str = (v: unknown, max: number) => typeof v === 'string' && v.length <= max;
    // Conta comum: recusa generica ANTES de olhar o formato (sem pista de como a mensagem deveria ser).
    if (!this.refresh(p)) return this.deny(p, msg.t, 'not_staff'), true;
    switch (msg.t) {
      case 'staff_duty': {
        if (typeof m.on !== 'boolean') return this.malformedIfStaff(p);
        const level = this.gate(p, 'duty', now);
        if (!level) return true;
        if (p.onDuty === msg.on) return this.send(p), true;
        p.onDuty = msg.on;
        if (!msg.on && p.invisible) this.setInvisible(p, false);
        this.syncLook(p);
        this.send(p);
        this.audit(p, level, msg.on ? 'duty.on' : 'duty.off');
        if (msg.on) this.sendList(p);
        return true;
      }
      case 'staff_invis': {
        if (typeof m.on !== 'boolean') return this.malformedIfStaff(p);
        const level = this.gate(p, 'invis', now);
        if (!level) return true;
        if (p.invisible !== msg.on) {
          this.setInvisible(p, msg.on);
          this.audit(p, level, msg.on ? 'invis.on' : 'invis.off');
        }
        this.send(p);
        return true;
      }
      case 'staff_list': {
        if (!this.gate(p, 'list', now)) return true;
        this.sendList(p);
        return true;
      }
      case 'staff_mute': {
        if (!str(m.target, MAX_TARGET) || typeof m.minutes !== 'number' || !Number.isInteger(m.minutes) || m.minutes < 0 || m.minutes > 100_000 || (m.reason !== undefined && !str(m.reason, 300))) {
          return this.malformedIfStaff(p);
        }
        const unmute = m.minutes === 0;
        const level = this.gate(p, unmute ? 'unmute' : 'mute', now);
        if (!level) return true;
        const t = this.target(p, level, m.target);
        if (!t) return true;
        const reason = this.reason(m.reason);
        if (unmute) {
          delete t.account.mute;
          this.host.store.save(t.account);
          t.player.send({ t: 'error', code: 'unmuted', message: 'Seu silenciamento foi removido.' });
          this.say(p, `${t.player.name} não está mais silenciado.`);
          this.audit(p, level, 'unmute', { id: t.player.accountId, name: t.player.name });
          return true;
        }
        if (m.minutes > MUTE_MAX_MINUTES[level]) {
          this.say(p, `Seu nível permite silenciar por até ${MUTE_MAX_MINUTES[level]} min.`);
          return true;
        }
        t.account.mute = { until: now + m.minutes * 60_000, by: p.name, reason };
        this.host.store.save(t.account);
        t.player.send({ t: 'error', code: 'muted', message: `Você foi silenciado por ${m.minutes} min pela equipe${reason ? `: ${reason}` : '.'}` });
        this.say(p, `${t.player.name} silenciado por ${m.minutes} min.`);
        this.audit(p, level, 'mute', { id: t.player.accountId, name: t.player.name }, `${m.minutes}min${reason ? `; ${reason}` : ''}`);
        return true;
      }
      case 'staff_kick': {
        if ((m.scope !== 'room' && m.scope !== 'session') || !str(m.target, MAX_TARGET) || (m.reason !== undefined && !str(m.reason, 300))) return this.malformedIfStaff(p);
        const level = this.gate(p, m.scope === 'room' ? 'kick.room' : 'kick.session', now);
        if (!level) return true;
        const t = this.target(p, level, m.target);
        if (!t) return true;
        const reason = this.reason(m.reason);
        const label = { id: t.player.accountId, name: t.player.name };
        if (m.scope === 'session') {
          this.host.endSession(t.player.accountId, 'kicked', `Você foi removido da sessão pela equipe${reason ? `: ${reason}` : '.'}`);
          this.say(p, `${label.name} foi expulso da sessão.`);
          this.audit(p, level, 'kick.session', label, reason);
          return true;
        }
        const home = this.host.landingRoom(t.player);
        if (t.player.roomId === home) {
          this.say(p, `${label.name} já está na sala inicial; use /kick para expulsar da sessão.`);
          return true;
        }
        t.player.send({ t: 'error', code: 'kicked_room', message: `A equipe tirou você da sala${reason ? `: ${reason}` : '.'}` });
        this.host.enterRoom(t.player, home);
        this.say(p, `${label.name} foi mandado para a sala inicial.`);
        this.audit(p, level, 'kick.room', label, reason);
        return true;
      }
      case 'staff_goto':
      case 'staff_bring': {
        if (!str(m.target, MAX_TARGET)) return this.malformedIfStaff(p);
        const bring = msg.t === 'staff_bring';
        const level = this.gate(p, bring ? 'bring' : 'goto', now);
        if (!level) return true;
        const t = this.target(p, level, m.target);
        if (!t) return true;
        // A staff nao atravessa organizacoes: so teleporta dentro da org em que esta.
        if (t.player.orgId !== p.orgId) {
          this.say(p, 'Esse jogador está em outra organização: você só pode silenciar, expulsar ou avisar.');
          return true;
        }
        const label = { id: t.player.accountId, name: t.player.name };
        const [mover, anchor] = bring ? [t.player, p] : [p, t.player];
        const at = this.host.position(anchor);
        if (!at) {
          this.say(p, 'Esse jogador não está em uma sala.');
          return true;
        }
        this.host.enterRoom(mover, at.roomId, { x: at.x, y: at.y, dir: at.dir });
        if (mover.roomId !== at.roomId) {
          this.say(p, 'Não foi possível teleportar (sala lotada ou sem acesso).');
          return true;
        }
        this.audit(p, level, bring ? 'bring' : 'goto', label, at.roomId);
        return true;
      }
      case 'staff_announce': {
        if ((m.scope !== 'room' && m.scope !== 'all' && m.scope !== 'org') || !str(m.text, 1000)) return this.malformedIfStaff(p);
        if ((m.orgId !== undefined && !str(m.orgId, MAX_TARGET)) || (m.roomId !== undefined && !str(m.roomId, MAX_TARGET)) || (m.highlight !== undefined && typeof m.highlight !== 'boolean')) {
          return this.malformedIfStaff(p);
        }
        const level = this.gate(p, m.scope === 'all' ? 'announce.all' : m.scope === 'org' ? 'announce.org' : 'announce.room', now);
        if (!level) return true;
        const text = cleanChat(m.text as string).slice(0, MAX_ANNOUNCE);
        if (!text) return true;
        const highlight = m.highlight === true;
        // Destino: sala atual da staff (padrao) ou qualquer sala; org inteira; ou todos.
        const orgId = (m.scope === 'org' ? (m.orgId as string | undefined) : m.scope === 'room' ? ((m.orgId as string | undefined) ?? p.orgId) : undefined) ?? '';
        const roomId = m.scope === 'room' ? ((m.roomId as string | undefined) ?? (m.orgId === undefined ? p.roomId : null)) : null;
        if (m.scope === 'org' && !this.host.store.orgs.getOrg(orgId)) {
          this.say(p, 'Organização não encontrada.');
          return true;
        }
        if (m.scope === 'room' && (!roomId || !this.host.roomExists(orgId, roomId))) {
          this.say(p, 'Sala não encontrada.');
          return true;
        }
        const out: ServerMessage = { t: 'announce', scope: m.scope, from: p.name, level, text, at: now, ...(highlight ? { highlight } : {}) };
        let n = 0;
        for (const h of this.host.online()) {
          if (m.scope === 'org' && h.player.orgId !== orgId) continue;
          if (m.scope === 'room' && (h.player.orgId !== orgId || h.player.roomId !== roomId)) continue;
          h.conn.send(out);
          n++;
        }
        const where = m.scope === 'all' ? '' : m.scope === 'org' ? `[org ${this.host.store.orgs.getOrg(orgId)?.name ?? orgId}] ` : `[sala ${orgId}/${roomId}] `;
        this.audit(p, level, `announce.${m.scope}`, null, `${highlight ? '(destaque) ' : ''}${where}${n} destinatários: ${text}`);
        this.say(p, `Aviso enviado a ${n} pessoa${n === 1 ? '' : 's'}.`);
        return true;
      }
      case 'staff_dm': {
        if (!str(m.target, MAX_TARGET) || !str(m.text, 1000)) return this.malformedIfStaff(p);
        const level = this.gate(p, 'dm', now);
        if (!level) return true;
        const t = this.find(m.target as string);
        if (!t) {
          this.say(p, 'Jogador não encontrado (precisa estar online).');
          return true;
        }
        if (t.player.accountId === p.accountId) {
          this.say(p, 'Você não pode fazer isso consigo mesmo.');
          return true;
        }
        const text = cleanChat(m.text as string).slice(0, MAX_ANNOUNCE);
        if (!text) return true;
        t.conn.send({ t: 'announce', scope: 'private', from: p.name, level, text, at: now });
        this.say(p, `Mensagem de staff enviada a ${t.player.name}.`);
        this.audit(p, level, 'dm', { id: t.player.accountId, name: t.player.name }, text);
        return true;
      }
      case 'staff_rooms': {
        if (!this.gate(p, 'rooms.view', now)) return true;
        p.send({ t: 'staff_rooms', rooms: this.host.roomsOverview() });
        return true;
      }
      case 'staff_room': {
        if (!str(m.orgId, MAX_TARGET) || !str(m.roomId, MAX_TARGET) || typeof m.op !== 'string' || !(ROOM_OPS as readonly string[]).includes(m.op)) return this.malformedIfStaff(p);
        const level = this.gate(p, 'rooms.control', now);
        if (!level) return true;
        const r = this.host.roomControl(m.orgId as string, m.roomId as string, m.op as RoomOp);
        if (!r.ok) {
          this.say(p, r.message);
          return true;
        }
        this.audit(p, level, `room.${m.op}`, { id: `${m.orgId}/${m.roomId}`, name: r.name }, r.moved > 0 ? `${r.moved} pessoa(s) mandada(s) para a sala inicial` : undefined);
        this.say(p, `Sala ${r.name}: ${{ lock: 'trancada', unlock: 'destrancada', close: 'fechada', open: 'reaberta', empty: 'esvaziada' }[m.op as RoomOp]}${r.moved > 0 ? ` (${r.moved} saíram)` : ''}.`);
        p.send({ t: 'staff_rooms', rooms: this.host.roomsOverview() });
        return true;
      }
      case 'staff_event': {
        if (!str(m.id, MAX_TARGET) || (m.mode !== 'on' && m.mode !== 'off' && m.mode !== 'auto')) return this.malformedIfStaff(p);
        const level = this.gate(p, 'events.control', now);
        if (!level) return true;
        const def = getEventDef(m.id as string);
        if (!def) {
          this.say(p, 'Evento não encontrado.');
          return true;
        }
        const mode = m.mode as EventMode;
        const r = this.host.setEvent(def.id, mode);
        const label = { on: 'forçado LIGADO', off: 'forçado DESLIGADO', auto: 'voltou a seguir a data' }[mode];
        this.say(p, r.changed ? `Evento ${def.name}: ${label}.` : `Evento ${def.name} já estava assim.`);
        if (r.changed) this.audit(p, level, `event.${mode}`, { id: def.id, name: def.name }, `${label}; ativos agora: ${r.view.active.join(', ') || 'nenhum'}`);
        return true;
      }
      case 'staff_pet': {
        if (typeof m.op !== 'string' || !(PET_STAFF_OPS as readonly string[]).includes(m.op) || (m.orgId !== undefined && !str(m.orgId, MAX_TARGET)) || (m.name !== undefined && typeof m.name !== 'string')) return this.malformedIfStaff(p);
        const op = m.op as PetStaffOp;
        if (op === 'list') {
          if (!this.gate(p, 'rooms.view', now)) return true;
          p.send({ t: 'staff_pet', pets: this.host.pets.list() });
          return true;
        }
        const level = this.gate(p, 'pet.control', now);
        if (!level) return true;
        const orgId = (m.orgId as string | undefined) ?? p.orgId;
        const org = this.host.store.orgs.getOrg(orgId);
        if (!org) {
          this.say(p, 'Organização não encontrada.');
          return true;
        }
        const target = { id: orgId, name: org.name };
        if (op === 'on' || op === 'off') {
          const changed = this.host.pets.setEnabled(orgId, op === 'on');
          this.say(p, changed ? `Byte ${op === 'on' ? 'ligado' : 'desligado'} em ${org.name}.` : `O Byte já estava ${op === 'on' ? 'ligado' : 'desligado'}.`);
          if (changed) this.audit(p, level, `pet.${op}`, target);
        } else if (op === 'rename') {
          const name = this.host.pets.rename(orgId, m.name);
          if (!name) this.say(p, 'Nome inválido (2 a 16 letras, números, espaço, - ou _).');
          else {
            this.say(p, `O pet de ${org.name} agora se chama ${name}.`);
            this.audit(p, level, 'pet.rename', target, name);
          }
        } else {
          // "levar ate mim": so dentro da organizacao e da sala em que a staff esta
          const at = this.host.position(p);
          if (orgId !== p.orgId || !at) this.say(p, 'Você não está em uma sala dessa organização: o Byte só vem até quem está na mesma organização.');
          else {
            const r = this.host.pets.bring(orgId, at.roomId, { x: at.x, y: at.y });
            this.say(p, r.ok ? 'O Byte está a caminho.' : r.message);
            if (r.ok) this.audit(p, level, 'pet.bring', target, at.roomId);
          }
        }
        p.send({ t: 'staff_pet', pets: this.host.pets.list() });
        return true;
      }
      case 'staff_item': {
        if (!str(m.target, MAX_TARGET) || !str(m.key, 80) || typeof m.grant !== 'boolean') return this.malformedIfStaff(p);
        const level = this.gate(p, 'item.grant', now);
        if (!level) return true;
        const key = parseUnlockKey(m.key);
        if (!key.ok) {
          this.say(p, key.message);
          return true;
        }
        const raw = (m.target as string).normalize('NFKC').trim();
        const acc = this.host.store.getById(raw) ?? this.host.store.getByName(raw);
        if (!acc) {
          this.say(p, 'Conta não encontrada.');
          return true;
        }
        const changed = setUnlock(this.host.store, acc, key.key, m.grant);
        this.say(p, changed ? `${m.grant ? 'Concedido' : 'Revogado'}: ${key.key} (${acc.displayName}).` : 'Nada mudou.');
        this.audit(p, level, m.grant ? 'item.grant' : 'item.revoke', { id: acc.id, name: acc.displayName }, `${key.key}${changed ? '' : ' (sem mudança)'}`);
        return true;
      }
    }
    return false;
  }

  /** Mensagem malformada de staff: o chamador conta um strike. */
  private malformedIfStaff(_p: Player): boolean {
    return false;
  }

  private reason(raw: unknown): string {
    return typeof raw === 'string' ? cleanChat(raw).slice(0, MAX_STAFF_REASON) : '';
  }

  private setInvisible(p: Player, on: boolean) {
    p.invisible = on;
    this.host.setVisibility(p);
  }

  // ---- comandos de chat ------------------------------------------------------------------------------------------

  /** Interpreta `/comando` de staff. Retorna false quando nao e um comando de staff OU a conta nao e staff (chat segue normal). */
  tryCommand(p: Player, text: string, now: number): boolean {
    const m = /^\/([\p{L}]+)(?:\s+(.*))?$/u.exec(text.trim());
    if (!m) return false;
    const cmd = m[1]!.toLowerCase();
    if (!COMMANDS.has(cmd)) return false;
    // Conta comum: o comando nao existe (mesma resposta generica de qualquer comando desconhecido).
    if (!this.refresh(p)) return false;
    const rest = (m[2] ?? '').trim();
    const send = (msg: StaffClientMessage) => this.handle(p, msg, now);

    switch (cmd) {
      case 'staff': {
        const arg = rest.toLowerCase();
        if (arg === 'on' || arg === 'off') return send({ t: 'staff_duty', on: arg === 'on' }), true;
        this.say(p, `${STAFF_LABELS[p.staff!]} — ${p.onDuty ? 'em serviço' : 'fora de serviço'}${p.invisible ? ', invisível' : ''}. Uso: /staff on|off, /invis, /online, /mute, /unmute, /kick, /kickroom, /goto, /bring, /aviso, /avisosala, /dar, /tirar.`);
        return true;
      }
      case 'invis': {
        const arg = rest.toLowerCase();
        return send({ t: 'staff_invis', on: arg === 'on' ? true : arg === 'off' ? false : !p.invisible }), true;
      }
      case 'online': {
        if (!this.gate(p, 'list', now)) return true;
        this.sendList(p);
        const names = [...this.host.online()].map((h) => h.player.name);
        this.say(p, `Online (${names.length}): ${names.slice(0, 25).join(', ')}${names.length > 25 ? '…' : ''}`);
        return true;
      }
      case 'aviso':
      case 'avisosala':
        return send({ t: 'staff_announce', text: rest, scope: cmd === 'aviso' ? 'all' : 'room' }), true;
      case 'goto':
      case 'bring':
      case 'trazer':
      case 'kick':
      case 'expulsar':
      case 'kickroom':
      case 'unmute':
      case 'desilenciar': {
        const hit = this.splitTarget(rest);
        if (!hit) return this.say(p, 'Uso: /' + cmd + ' <nome>' + (cmd.startsWith('kick') || cmd === 'expulsar' ? ' [motivo]' : '')), true;
        if (cmd === 'goto') return send({ t: 'staff_goto', target: hit.name }), true;
        if (cmd === 'bring' || cmd === 'trazer') return send({ t: 'staff_bring', target: hit.name }), true;
        if (cmd === 'unmute' || cmd === 'desilenciar') return send({ t: 'staff_mute', target: hit.name, minutes: 0 }), true;
        return send({ t: 'staff_kick', target: hit.name, scope: cmd === 'kickroom' ? 'room' : 'session', reason: hit.rest }), true;
      }
      case 'mute':
      case 'silenciar': {
        // /mute <nome> <minutos> [motivo]
        const tokens = rest.split(' ').filter(Boolean);
        const i = tokens.findIndex((t, k) => k > 0 && /^\d{1,6}$/.test(t));
        if (i < 0) return this.say(p, 'Uso: /mute <nome> <minutos> [motivo]'), true;
        return send({ t: 'staff_mute', target: tokens.slice(0, i).join(' '), minutes: Number(tokens[i]), reason: tokens.slice(i + 1).join(' ') }), true;
      }
      case 'evento': {
        // /evento <id> on|off|auto   (sem argumentos: lista)
        const tokens = rest.toLowerCase().split(' ').filter(Boolean);
        if (tokens.length < 2) {
          this.say(p, `Uso: /evento <id> on|off|auto. Ids: ${EVENT_IDS.join(', ')}.`);
          return true;
        }
        return send({ t: 'staff_event', id: tokens[0]!, mode: tokens[1] as EventMode }), true;
      }
      case 'dar':
      case 'tirar': {
        // /dar <nome> <chave>
        const tokens = rest.split(' ').filter(Boolean);
        if (tokens.length < 2) return this.say(p, `Uso: /${cmd} <nome> <chave>  (ex.: event:natal, item:sp.mug_gold)`), true;
        const key = tokens.pop()!;
        return send({ t: 'staff_item', target: tokens.join(' '), key, grant: cmd === 'dar' }), true;
      }
    }
    return false;
  }

  /** Separa "<nome com espacos> <resto>" achando o maior prefixo que e um jogador online. */
  private splitTarget(rest: string): { name: string; rest: string } | null {
    const tokens = rest.split(' ').filter(Boolean);
    if (tokens.length === 0) return null;
    for (let k = tokens.length; k >= 1; k--) {
      const name = tokens.slice(0, k).join(' ');
      if (name.length <= MAX_TARGET && this.find(name)) return { name, rest: tokens.slice(k).join(' ') };
    }
    return { name: tokens[0]!, rest: tokens.slice(1).join(' ') };
  }
}
