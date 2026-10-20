import { randomUUID } from 'node:crypto';
import {
  BOOKING_EXTEND_MS,
  BOOKING_GRID_MS,
  BOOKING_MINUTE,
  BOOKING_START_GRACE_MS,
  BOOKING_WARN_MS,
  DEFAULT_BOOKABLE_ROOM_IDS,
  MAX_AGENDA_SPAN_MS,
  MAX_BOOKING_GUESTS,
  MAX_BOOKING_REASON,
  MAX_BOOKING_SLOTS,
  MAX_BOOKING_TITLE,
  NEVER_BOOKABLE_ROOM_IDS,
  NOTIFIED,
  checkPersonLimits,
  conflictsWith,
  doorOf,
  fmtClock,
  fmtRange,
  fmtWhen,
  formatMinutes,
  isForbiddenChar,
  isHolder,
  isLive,
  limitsAreValid,
  noShowDue,
  nextFreeStart,
  overlaps,
  promotionPlan,
  queueCompare,
  queuePosition,
  validateWindow,
  windowPhase,
  type BookingBlock,
  type BookingClientMessage,
  type BookingDoor,
  type BookingLimits,
  type BookingMine,
  type BookingNoticeKind,
  type BookingPendingEntry,
  type BookingQueueEntry,
  type BookingRoomInfo,
  type BookingServerMessage,
  type BookingSlotResult,
  type BookingStatus,
  type BookingWindow,
  type ClientMessage,
} from '@workverse/shared';
import { can, type Actor } from './authz';
import type { BookingRow } from './bookingStore';
import { TokenBucket } from './limiter';
import type { OrgService } from './org';
import type { Player } from './room';
import type { OrgWorld } from './orgWorld';
import type { AccountStore } from './store';
import { isBanned, isDisabled } from './accountState';

/**
 * Reserva de sala com fila (docs/bookings.md). O servidor e a unica autoridade: cada mensagem e validada aqui (tipos, tamanhos,
 * datas, papel, organizacao, taxa), o relogio (`tick`) faz a agenda andar (avisos, inicio, fim, no-show, promocao da fila) e a
 * decisao de acesso a sala durante uma reserva sai de `restriction()`, usada por World.canEnter.
 */

const BOOKING_MESSAGES = new Set(['booking_sync', 'booking_request', 'booking_cancel', 'booking_end', 'booking_extend', 'booking_edit', 'booking_decide', 'booking_room_set', 'booking_limits_set']);
export const isBookingMessage = (t: string) => BOOKING_MESSAGES.has(t);

/** Do aviso previo ate a janela comecar de fato, a sala ainda nao muda para quem ja esta dentro. */
const TICK_MS = 1000;
const PURGE_EVERY_MS = 60 * 60_000;
/** Reservas terminadas que ainda aparecem em "Minhas reservas". */
const MINE_HISTORY_MS = 3 * 86_400_000;
const MAX_MINE = 60;

export interface BookingHost {
  store: AccountStore;
  orgService: OrgService;
  clock: () => number;
  log: (event: string, data?: Record<string, unknown>) => void;
  org(orgId: string): OrgWorld;
  orgWorlds(): Iterable<OrgWorld>;
  players(orgId: string): Iterable<Player>;
  playerOf(accountId: string): Player | undefined;
  isStaffAdmin(p: Player): boolean;
  actorOf(p: Player): Actor;
  /** Pode estar na sala (`stay`: ja esta dentro, vale a tolerancia do inicio da reserva). */
  canEnter(p: Player, roomId: string, opts?: { stay?: boolean }): { allow: boolean };
  evict(p: Player, roomId: string, message: string): void;
  sendRooms(p: Player): void;
}

type Result = Extract<BookingServerMessage, { t: 'booking_result' }>;

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v);
const isStr = (v: unknown, max: number): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;
const isRid = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && Math.abs(v) < 1e9;

/** Texto livre: sem caracteres de controle/bidi/zero-width, espacos normalizados, no maximo `max`. */
export function cleanText(raw: string, max: number): string {
  let out = '';
  for (const ch of raw.normalize('NFKC')) out += isForbiddenChar(ch.codePointAt(0)!) ? ' ' : ch;
  return out.replace(/\s+/g, ' ').trim().slice(0, max);
}

export class BookingService {
  private nextTick = 0;
  private nextPurge = 0;
  /** Ultimo carimbo de chegada: crescente, para a ordem da fila nunca empatar. */
  private lastStamp = 0;
  private readonly buckets = new Map<string, TokenBucket>();
  /** Ultima placa enviada de cada sala (para so reenviar quando muda). */
  private readonly doorSig = new Map<string, string>();

  constructor(private readonly host: BookingHost) {}

  private get store() {
    return this.host.store.bookings;
  }

  // ---- configuracao ------------------------------------------------------------------------------------

  limits(orgId: string): BookingLimits {
    return this.store.getLimits(orgId);
  }

  /** A sala existe nesta organizacao e pode ser reservada (padrao: so a Sala Privada; a organizacao liga as demais). */
  settingOf(orgId: string, roomId: string): { bookable: boolean; requiresApproval: boolean } {
    if (NEVER_BOOKABLE_ROOM_IDS.includes(roomId) || !this.host.org(orgId).rooms.has(roomId)) return { bookable: false, requiresApproval: false };
    const s = this.store.getRoom(orgId, roomId);
    if (s) return { bookable: s.bookable, requiresApproval: s.requiresApproval };
    return { bookable: DEFAULT_BOOKABLE_ROOM_IDS.includes(roomId), requiresApproval: false };
  }

  private roomName(orgId: string, roomId: string): string {
    return this.host.org(orgId).rooms.get(roomId)?.built.def.name ?? 'sala';
  }

  private nameOf(accountId: string): string {
    return this.host.store.getById(accountId)?.displayName ?? 'Alguém';
  }

  private isManagerPlayer(p: Player): boolean {
    return this.host.isStaffAdmin(p) || can(this.host.actorOf(p), 'room.book.manage', { orgId: p.orgId }).allow;
  }

  /** Dono/admin da organizacao (por conta, mesmo offline). */
  private isManagerAccount(orgId: string, accountId: string): boolean {
    const a = this.host.orgService.actorFor(accountId, orgId);
    return !!a && (a.role === 'owner' || a.role === 'admin');
  }

  private bucket(accountId: string, kind: 'sync' | 'act', now: number): TokenBucket {
    const key = `${kind}:${accountId}`;
    let b = this.buckets.get(key);
    if (!b) {
      b = kind === 'sync' ? new TokenBucket(8, 2, now) : new TokenBucket(8, 1.5, now);
      this.buckets.set(key, b);
      if (this.buckets.size > 2000) for (const [k, v] of this.buckets) if (v.isIdle(now)) this.buckets.delete(k);
    }
    return b;
  }

  // ---- acesso (usado por World.canEnter) ----------------------------------------------------------------

  /** Reserva confirmada em curso na sala. */
  activeBooking(orgId: string, roomId: string, now: number): BookingRow | undefined {
    for (const r of this.store.liveOfRoom(orgId, roomId)) if (r.status === 'confirmed' && r.startAt <= now && now < r.endAt) return r;
    return undefined;
  }

  /**
   * Efeito de uma reserva em curso sobre o acesso de uma pessoa. `normal`: sem reserva (valem as regras da sala) ou pessoa que
   * sempre entra; `participant`: dono ou convidado, entra como numa sala aberta; `blocked`: a sala esta reservada para outros.
   * `stay`: quem ja estava dentro tem 1 minuto de tolerancia depois do inicio.
   */
  restriction(p: Pick<Player, 'orgId' | 'accountId' | 'role'>, roomId: string, now: number, stay = false): 'normal' | 'participant' | 'blocked' {
    const b = this.activeBooking(p.orgId, roomId, now);
    if (!b) return 'normal';
    if (b.ownerId === p.accountId || b.guestIds.includes(p.accountId)) return 'participant';
    if (p.role === 'owner' || p.role === 'admin') return 'normal';
    if (stay && now < Math.max(b.startAt, b.createdAt) + BOOKING_START_GRACE_MS) return 'normal';
    return 'blocked';
  }

  /** Anota a entrada do dono na sala dentro da janela (evita liberar a reserva por no-show). */
  onEnter(p: Player, roomId: string, now: number): void {
    const b = this.activeBooking(p.orgId, roomId, now);
    if (b && b.ownerId === p.accountId && b.checkedInAt === null) this.store.put({ ...b, checkedInAt: now, updatedAt: now });
  }

  // ---- mensagens ----------------------------------------------------------------------------------------

  /** Devolve false para mensagem malformada (o mundo conta uma advertencia). */
  handle(p: Player, msg: ClientMessage, now: number): boolean {
    switch (msg.t) {
      case 'booking_sync':
        return this.sync(p, msg, now);
      case 'booking_request':
        return this.request(p, msg, now);
      case 'booking_cancel':
        return this.withBooking(p, msg, now, (b) => this.cancel(p, msg.rid, b, now));
      case 'booking_end':
        return this.withBooking(p, msg, now, (b) => this.endNow(p, msg.rid, b, now));
      case 'booking_extend':
        return this.withBooking(p, msg, now, (b) => this.extend(p, msg.rid, b, now));
      case 'booking_edit':
        return this.edit(p, msg, now);
      case 'booking_decide':
        return this.decide(p, msg, now);
      case 'booking_room_set':
        return this.roomSet(p, msg, now);
      case 'booking_limits_set':
        return this.limitsSet(p, msg, now);
      default:
        return false;
    }
  }

  private reply(p: Player, rid: number, ok: boolean, message: string, code?: string, results?: BookingSlotResult[]) {
    p.send({ t: 'booking_result', rid, ok, message, ...(code ? { code } : {}), ...(results ? { results } : {}) });
  }

  private fail(p: Player, rid: number, code: string, message: string) {
    this.reply(p, rid, false, message, code);
  }

  /** Taxa das acoes que mudam algo. false = ja respondeu. */
  private throttled(p: Player, rid: number, now: number): boolean {
    if (this.bucket(p.accountId, 'act', now).take(now)) return false;
    this.fail(p, rid, 'rate_limited', 'Calma! Muitas ações seguidas nas reservas.');
    return true;
  }

  private audit(p: Player, action: string, roomId: string, detail: string) {
    const at = this.host.clock();
    this.host.store.appendAudit({
      id: randomUUID(),
      at,
      actorId: p.accountId,
      actor: p.name,
      level: p.staff && p.onDuty ? p.staff : null,
      action,
      targetId: `${p.orgId}/${roomId}`,
      target: this.roomName(p.orgId, roomId),
      detail: detail.slice(0, 300),
    });
    this.host.log(action, { org: p.orgId, room: roomId, by: p.accountId, detail });
  }

  // ---- agenda -------------------------------------------------------------------------------------------

  private sync(p: Player, msg: Extract<ClientMessage, { t: 'booking_sync' }>, now: number): boolean {
    if (!isInt(msg.from) || !isInt(msg.to) || msg.to <= msg.from || msg.to - msg.from > MAX_AGENDA_SPAN_MS) return false;
    if (msg.roomId !== undefined && !isStr(msg.roomId, 64)) return false;
    if (!this.bucket(p.accountId, 'sync', now).take(now)) return p.send({ t: 'error', code: 'rate_limited', message: 'Calma! Muitas consultas seguidas à agenda.' }), true;
    this.rememberView(p, msg);
    p.send(this.snapshot(p, msg.roomId, msg.from, msg.to, now));
    return true;
  }

  roomInfos(p: Player): BookingRoomInfo[] {
    const manager = this.isManagerPlayer(p);
    const out: BookingRoomInfo[] = [];
    for (const [id, room] of this.host.org(p.orgId).rooms) {
      if (NEVER_BOOKABLE_ROOM_IDS.includes(id)) continue;
      const s = this.settingOf(p.orgId, id);
      if (!s.bookable && !manager) continue;
      out.push({ roomId: id, name: room.built.def.name, bookable: s.bookable, requiresApproval: s.requiresApproval, capacity: room.built.def.maxPlayers });
    }
    return out;
  }

  snapshot(p: Player, roomId: string | undefined, from: number, to: number, now: number): Extract<BookingServerMessage, { t: 'bookings' }> {
    const orgId = p.orgId;
    const manager = this.isManagerPlayer(p);
    const rooms = this.roomInfos(p);
    const chosen = roomId !== undefined ? rooms.find((r) => r.roomId === roomId) : rooms.find((r) => r.bookable);
    const win = { startAt: from, endAt: to };
    const blocks: BookingBlock[] = [];
    const queue: BookingQueueEntry[] = [];
    if (chosen) {
      const all = this.store.liveOfRoom(orgId, chosen.roomId);
      for (const b of all.filter((x) => isHolder(x.status) && overlaps(x, win)).sort((a, c) => a.startAt - c.startAt)) {
        const mine = b.ownerId === p.accountId || b.guestIds.includes(p.accountId);
        const detail = mine || manager;
        blocks.push({
          id: b.id,
          startAt: b.startAt,
          endAt: b.endAt,
          state: b.status === 'confirmed' ? 'busy' : 'pending',
          mine,
          ...(detail ? { title: b.title, ownerName: this.nameOf(b.ownerId), guests: b.guestIds.map((g) => this.nameOf(g)) } : {}),
        });
      }
      for (const b of all.filter((x) => x.status === 'queued' && overlaps(x, win)).sort(queueCompare)) {
        const mine = b.ownerId === p.accountId;
        queue.push({ id: b.id, startAt: b.startAt, endAt: b.endAt, position: queuePosition(b, all), ownerName: this.nameOf(b.ownerId), mine, ...(mine || manager ? { title: b.title } : {}) });
      }
    }
    const msg: Extract<BookingServerMessage, { t: 'bookings' }> = {
      t: 'bookings',
      now,
      roomId: chosen?.roomId ?? null,
      from,
      to,
      rooms,
      limits: this.limits(orgId),
      blocks,
      queue,
      mine: this.mineOf(p, now),
      canManage: manager,
    };
    if (manager) msg.pending = this.pendingOf(orgId);
    return msg;
  }

  private mineOf(p: Player, now: number): BookingMine[] {
    const orgId = p.orgId;
    const manager = this.isManagerPlayer(p);
    const out: BookingMine[] = [];
    const limits = this.limits(orgId);
    for (const b of this.store.ofOrg(orgId)) {
      const owner = b.ownerId === p.accountId;
      if (!owner && !b.guestIds.includes(p.accountId)) continue;
      if (!isLive(b.status) && b.endAt < now - MINE_HISTORY_MS) continue;
      const live = isLive(b.status);
      const active = b.status === 'confirmed' && b.startAt <= now && now < b.endAt;
      const canAct = owner || manager;
      const roomBookings = live ? this.store.liveOfRoom(orgId, b.roomId) : [];
      const holders = roomBookings.filter((x) => isHolder(x.status));
      out.push({
        id: b.id,
        roomId: b.roomId,
        roomName: this.roomName(orgId, b.roomId),
        startAt: b.startAt,
        endAt: b.endAt,
        status: b.status,
        title: b.title,
        ownerName: this.nameOf(b.ownerId),
        role: owner ? 'owner' : 'guest',
        guests: b.guestIds.map((g) => this.nameOf(g)),
        ...(b.status === 'queued' ? { position: queuePosition(b, roomBookings), suggestion: nextFreeStart(holders, b.endAt - b.startAt, b.startAt, now, limits) } : {}),
        ...(b.reason ? { reason: b.reason } : {}),
        active,
        checkedIn: b.checkedInAt !== null,
        canExtend: canAct && b.status === 'confirmed' && now < b.endAt,
        canCancel: canAct && live && now < b.endAt && !active,
        canEnd: canAct && active,
        canEdit: canAct && live && now < b.endAt,
      });
    }
    out.sort((a, c) => Number(isLive(c.status)) - Number(isLive(a.status)) || (isLive(a.status) ? a.startAt - c.startAt : c.startAt - a.startAt));
    return out.slice(0, MAX_MINE);
  }

  private pendingOf(orgId: string): BookingPendingEntry[] {
    return this.store
      .ofOrg(orgId)
      .filter((b) => b.status === 'pending')
      .sort((a, c) => a.startAt - c.startAt)
      .slice(0, 100)
      .map((b) => ({ id: b.id, roomId: b.roomId, roomName: this.roomName(orgId, b.roomId), startAt: b.startAt, endAt: b.endAt, ownerName: this.nameOf(b.ownerId), title: b.title, guests: b.guestIds.map((g) => this.nameOf(g)), createdAt: b.createdAt }));
  }

  /** Reenvia a agenda inteira para quem precisa ver (a sala afetada), sem esperar um novo pedido. */
  private pushSnapshotTo(orgId: string, accountIds: Iterable<string>, now: number) {
    const done = new Set<string>();
    for (const id of accountIds) {
      if (done.has(id)) continue;
      done.add(id);
      const q = this.host.playerOf(id);
      if (q && q.orgId === orgId) this.pushSnapshot(q, now);
    }
  }

  /** Ultima janela consultada por cada pessoa (para atualizar a tela dela quando algo muda). */
  private readonly lastView = new Map<string, { roomId: string | undefined; from: number; to: number }>();

  private pushSnapshot(p: Player, now: number) {
    const v = this.lastView.get(p.accountId);
    if (!v) return;
    p.send(this.snapshot(p, v.roomId, v.from, v.to, now));
  }

  /** Chamado pelo mundo quando uma pessoa pede a agenda: lembra a janela para os envios espontaneos. */
  rememberView(p: Player, msg: Extract<ClientMessage, { t: 'booking_sync' }>) {
    this.lastView.set(p.accountId, { roomId: msg.roomId, from: msg.from, to: msg.to });
    if (this.lastView.size > 5000) this.lastView.delete(this.lastView.keys().next().value as string);
  }

  forget(accountId: string) {
    this.lastView.delete(accountId);
  }

  // ---- pedir ---------------------------------------------------------------------------------------------

  private resolveGuests(p: Pick<Player, 'orgId' | 'accountId'>, names: readonly string[]): { ids: string[] } | { error: string; code: string } {
    const ids: string[] = [];
    for (const raw of names) {
      const name = cleanText(raw, 64);
      const acc = name ? this.host.store.getByName(name) : undefined;
      const actor = acc ? this.host.orgService.actorFor(acc.id, p.orgId) : undefined;
      const now = this.host.clock();
      if (!acc || !actor || actor.role === 'guest' || isDisabled(acc) || isBanned(acc, now)) return { code: 'unknown_person', error: `Não encontrei "${name || raw.slice(0, 20)}" entre os membros da organização.` };
      if (acc.id === p.accountId) continue;
      if (!ids.includes(acc.id)) ids.push(acc.id);
    }
    return { ids };
  }

  private request(p: Player, msg: Extract<ClientMessage, { t: 'booking_request' }>, now: number): boolean {
    if (!isRid(msg.rid) || !isStr(msg.roomId, 64) || typeof msg.title !== 'string' || msg.title.length > 400) return false;
    if (!Array.isArray(msg.slots) || msg.slots.length < 1 || msg.slots.length > MAX_BOOKING_SLOTS) return false;
    for (const s of msg.slots) if (typeof s !== 'object' || s === null || !isInt((s as BookingWindow).startAt) || !isInt((s as BookingWindow).endAt)) return false;
    if (msg.guests !== undefined && (!Array.isArray(msg.guests) || msg.guests.length > MAX_BOOKING_GUESTS * 2 || !msg.guests.every((g) => typeof g === 'string' && g.length <= 200))) return false;
    if (this.throttled(p, msg.rid, now)) return true;
    const orgId = p.orgId;
    const setting = this.settingOf(orgId, msg.roomId);
    if (!setting.bookable) return this.fail(p, msg.rid, 'not_bookable', 'Essa sala não está disponível para reserva.'), true;
    const title = cleanText(msg.title, MAX_BOOKING_TITLE);
    if (!title) return this.fail(p, msg.rid, 'title', 'Diga o motivo da reserva.'), true;
    const guests = this.resolveGuests(p, msg.guests ?? []);
    if ('error' in guests) return this.fail(p, msg.rid, guests.code, guests.error), true;
    const capacity = this.host.org(orgId).rooms.get(msg.roomId)!.built.def.maxPlayers;
    if (guests.ids.length + 1 > capacity) return this.fail(p, msg.rid, 'too_many_guests', `A sala comporta ${capacity} pessoas (você e ${capacity - 1} convidado${capacity - 1 === 1 ? '' : 's'}).`), true;
    if (guests.ids.length > MAX_BOOKING_GUESTS) return this.fail(p, msg.rid, 'too_many_guests', `No máximo ${MAX_BOOKING_GUESTS} convidados.`), true;

    const limits = this.limits(orgId);
    const manager = this.isManagerPlayer(p);
    const results: BookingSlotResult[] = [];
    const sorted = [...msg.slots].sort((a, b) => a.startAt - b.startAt);
    for (const s of sorted) {
      const win = { startAt: s.startAt, endAt: s.endAt };
      results.push(this.requestSlot(p, msg.roomId, win, title, guests.ids, setting.requiresApproval && !manager, manager, limits, now));
    }
    const okCount = results.filter((r) => r.ok).length;
    const msgText = okCount === results.length ? results.map((r) => r.message).join(' ') : okCount === 0 ? (results[0]?.message ?? 'Não foi possível reservar.') : `${okCount} de ${results.length} dias reservados. Veja o resultado de cada um.`;
    this.reply(p, msg.rid, okCount > 0, msgText, okCount > 0 ? undefined : results[0]?.code, results);
    this.afterChange(orgId, msg.roomId, now, [p.accountId]);
    return true;
  }

  private requestSlot(p: Player, roomId: string, win: BookingWindow, title: string, guestIds: string[], needsApproval: boolean, manager: boolean, limits: BookingLimits, now: number): BookingSlotResult {
    const orgId = p.orgId;
    const base = { startAt: win.startAt, endAt: win.endAt };
    const bad = (code: string, message: string): BookingSlotResult => ({ ...base, ok: false, code, message });
    const w = validateWindow(win, now, limits);
    if (!w.ok) return bad(w.code, w.message);
    const mine = this.store.ofOwner(orgId, p.accountId);
    const lim = checkPersonLimits(win, mine, now, limits);
    // quem administra a organizacao nao esbarra nos limites por pessoa (so nos de forma da janela)
    if (!lim.ok && !manager) return bad(lim.code, lim.message);
    const roomBookings = this.store.liveOfRoom(orgId, roomId);
    const conflicts = conflictsWith(win, roomBookings.map((b) => ({ ...b })));
    const dur = win.endAt - win.startAt;
    const when = fmtRange(win.startAt, win.endAt);
    if (conflicts.length > 0 && conflicts.every((c) => c.ownerId === p.accountId)) return bad('self_conflict', 'Você já tem uma reserva nesse horário.');
    const status: BookingStatus = conflicts.length > 0 ? 'queued' : needsApproval ? 'pending' : 'confirmed';
    const row: BookingRow = { id: randomUUID(), orgId, roomId, ownerId: p.accountId, title, startAt: win.startAt, endAt: win.endAt, status, guestIds, createdAt: this.stamp(now), updatedAt: now, decidedBy: null, reason: null, checkedInAt: null, notified: 0 };
    this.store.put(row);
    const roomName = this.roomName(orgId, roomId);
    if (status === 'queued') {
      const position = queuePosition(row, this.store.liveOfRoom(orgId, roomId));
      const suggestion = nextFreeStart(roomBookings.filter((b) => isHolder(b.status)), dur, win.startAt, now, limits);
      this.notify(p.accountId, orgId, 'queued', row, `A ${roomName} está ocupada em ${when}. Você entrou na fila: ${position}º lugar. Se a reserva anterior sair, você sobe sozinho.`);
      return { ...base, ok: true, status, id: row.id, position, suggestion, message: `Horário ocupado: você é o ${position}º da fila.` };
    }
    if (status === 'pending') {
      this.notify(p.accountId, orgId, 'pending', row, `Pedido de ${roomName} (${when}) enviado. Aguarde a aprovação de um gestor.`);
      this.notifyManagers(orgId, row, `${p.name} pediu a ${roomName} (${when}): "${title}". Abra Reservas > Pendentes para decidir.`);
      return { ...base, ok: true, status, id: row.id, message: 'Pedido enviado: aguardando aprovação.' };
    }
    this.notify(p.accountId, orgId, 'confirmed', row, `Reserva confirmada: ${roomName}, ${when}.`);
    this.inviteGuests(row, p.name);
    return { ...base, ok: true, status, id: row.id, message: `Reserva confirmada: ${when}.` };
  }

  private stamp(now: number): number {
    this.lastStamp = Math.max(now, this.lastStamp + 1);
    return this.lastStamp;
  }

  private inviteGuests(row: BookingRow, ownerName: string, only?: readonly string[]) {
    const when = fmtRange(row.startAt, row.endAt);
    for (const g of only ?? row.guestIds) this.notify(g, row.orgId, 'invited', row, `${ownerName} convidou você para a ${this.roomName(row.orgId, row.roomId)}: ${when}.`);
  }


  // ---- acoes sobre uma reserva ---------------------------------------------------------------------------

  private withBooking(p: Player, msg: { rid: number; id: string }, now: number, run: (b: BookingRow) => void): boolean {
    if (!isRid(msg.rid) || !isStr(msg.id, 64)) return false;
    if (this.throttled(p, msg.rid, now)) return true;
    const b = this.store.getIn(p.orgId, msg.id);
    // reserva de outra organizacao (ou inexistente): a mesma resposta
    if (!b) return this.fail(p, msg.rid, 'not_found', 'Reserva não encontrada.'), true;
    if (b.ownerId !== p.accountId && !this.isManagerPlayer(p)) return this.fail(p, msg.rid, 'forbidden', 'Só quem fez a reserva (ou a administração) pode mudar isso.'), true;
    run(b);
    return true;
  }

  /** Grava uma copia nova com o status novo. */
  private setStatus(b: BookingRow, status: BookingStatus, now: number, extra: Partial<BookingRow> = {}): BookingRow {
    const row = { ...b, status, updatedAt: now, ...extra };
    this.store.put(row);
    return row;
  }

  private participants(b: Pick<BookingRow, 'ownerId' | 'guestIds'>): string[] {
    return [b.ownerId, ...b.guestIds];
  }

  private cancel(p: Player, rid: number, b: BookingRow, now: number) {
    if (!isLive(b.status) || b.endAt <= now) return this.fail(p, rid, 'not_live', 'Essa reserva já foi encerrada.');
    if (b.status === 'confirmed' && b.startAt <= now) return this.fail(p, rid, 'active', 'A reserva já começou: use "Encerrar agora".');
    const byOther = b.ownerId !== p.accountId;
    const wasConfirmed = b.status === 'confirmed';
    const row = this.setStatus(b, 'cancelled', now, { decidedBy: p.accountId, reason: byOther ? 'Cancelada pela administração.' : null });
    const when = fmtRange(row.startAt, row.endAt);
    const roomName = this.roomName(row.orgId, row.roomId);
    if (byOther) this.notify(row.ownerId, row.orgId, 'cancelled', row, `Sua reserva da ${roomName} (${when}) foi cancelada pela administração.`);
    if (wasConfirmed) for (const g of row.guestIds) this.notify(g, row.orgId, 'cancelled', row, `A reserva da ${roomName} (${when}) para a qual você foi convidado foi cancelada.`);
    if (byOther) this.audit(p, 'booking.cancel', row.roomId, `${this.nameOf(row.ownerId)}; ${when}`);
    this.reply(p, rid, true, 'Reserva cancelada.');
    this.afterChange(row.orgId, row.roomId, now, [p.accountId, ...this.participants(row)], 'A reserva foi cancelada.');
  }

  private endNow(p: Player, rid: number, b: BookingRow, now: number) {
    if (b.status !== 'confirmed' || !(b.startAt <= now && now < b.endAt)) return this.fail(p, rid, 'not_active', 'Só dá para encerrar uma reserva em andamento.');
    const row = this.setStatus(b, 'ended', now, { endAt: Math.max(now, b.startAt + 1000) });
    const roomName = this.roomName(row.orgId, row.roomId);
    for (const id of this.participants(row)) this.notify(id, row.orgId, 'ended', row, `Reserva da ${roomName} encerrada. A sala foi liberada.`);
    this.reply(p, rid, true, 'Reserva encerrada: a sala foi liberada.');
    this.afterChange(row.orgId, row.roomId, now, [p.accountId, ...this.participants(row)], 'A reserva foi encerrada.');
  }

  private extend(p: Player, rid: number, b: BookingRow, now: number) {
    if (b.status !== 'confirmed' || now >= b.endAt) return this.fail(p, rid, 'not_extendable', 'Só dá para estender uma reserva confirmada que ainda não terminou.');
    const orgId = b.orgId;
    const limits = this.limits(orgId);
    const ext = { startAt: b.endAt, endAt: b.endAt + BOOKING_EXTEND_MS };
    const live = this.store.liveOfRoom(orgId, b.roomId);
    if (conflictsWith(ext, live, b.id).length > 0) return this.fail(p, rid, 'extend_blocked', 'Há outra reserva logo depois: não dá para estender.');
    if (live.some((x) => x.status === 'queued' && x.id !== b.id && overlaps(x, ext))) return this.fail(p, rid, 'extend_queue', 'Há gente na fila para depois desta reserva: não dá para estender.');
    const full = { startAt: b.startAt, endAt: ext.endAt };
    const manager = this.isManagerPlayer(p) || this.isManagerAccount(orgId, b.ownerId);
    if (!manager) {
      if (full.endAt - full.startAt > limits.maxDurationMin * BOOKING_MINUTE) return this.fail(p, rid, 'too_long', `Cada reserva pode ter no máximo ${formatMinutes(limits.maxDurationMin)}.`);
      const lim = checkPersonLimits(full, this.store.ofOwner(orgId, b.ownerId), now, limits, b.id);
      if (!lim.ok) return this.fail(p, rid, lim.code, lim.message);
    }
    const row = this.setStatus(b, 'confirmed', now, { endAt: ext.endAt, notified: b.notified & ~NOTIFIED.endSoon });
    const text = `Reserva da ${this.roomName(orgId, row.roomId)} estendida até ${fmtClock(row.endAt)}.`;
    for (const id of this.participants(row)) this.notify(id, orgId, 'extended', row, text);
    this.reply(p, rid, true, `Estendida até ${fmtClock(row.endAt)}.`);
    this.afterChange(orgId, row.roomId, now, [p.accountId, ...this.participants(row)]);
  }

  private edit(p: Player, msg: Extract<ClientMessage, { t: 'booking_edit' }>, now: number): boolean {
    if (!isRid(msg.rid) || !isStr(msg.id, 64)) return false;
    if (msg.title !== undefined && (typeof msg.title !== 'string' || msg.title.length > 400)) return false;
    if (msg.guests !== undefined && (!Array.isArray(msg.guests) || msg.guests.length > MAX_BOOKING_GUESTS * 2 || !msg.guests.every((g) => typeof g === 'string' && g.length <= 200))) return false;
    if ((msg.startAt === undefined) !== (msg.endAt === undefined)) return false;
    if (msg.startAt !== undefined && (!isInt(msg.startAt) || !isInt(msg.endAt))) return false;
    return this.withBooking(p, msg, now, (b) => {
      const orgId = b.orgId;
      if (!isLive(b.status) || b.endAt <= now) return this.fail(p, msg.rid, 'not_live', 'Essa reserva já foi encerrada.');
      const row: BookingRow = { ...b };
      let addedGuests: string[] = [];
      if (msg.title !== undefined) {
        const title = cleanText(msg.title, MAX_BOOKING_TITLE);
        if (!title) return this.fail(p, msg.rid, 'title', 'Diga o motivo da reserva.');
        row.title = title;
      }
      if (msg.guests !== undefined) {
        const g = this.resolveGuests({ orgId, accountId: b.ownerId }, msg.guests);
        if ('error' in g) return this.fail(p, msg.rid, g.code, g.error);
        const capacity = this.host.org(orgId).rooms.get(b.roomId)?.built.def.maxPlayers ?? 1;
        if (g.ids.length + 1 > capacity) return this.fail(p, msg.rid, 'too_many_guests', `A sala comporta ${capacity} pessoas (o dono e ${capacity - 1} convidado${capacity - 1 === 1 ? '' : 's'}).`);
        if (g.ids.length > MAX_BOOKING_GUESTS) return this.fail(p, msg.rid, 'too_many_guests', `No máximo ${MAX_BOOKING_GUESTS} convidados.`);
        addedGuests = g.ids.filter((id) => !b.guestIds.includes(id));
        row.guestIds = g.ids;
      }
      let moved = false;
      if (msg.startAt !== undefined && msg.endAt !== undefined && (msg.startAt !== b.startAt || msg.endAt !== b.endAt)) {
        if (b.status === 'queued') return this.fail(p, msg.rid, 'queued_time', 'Quem está na fila não muda o horário: cancele e peça outro.');
        if (b.startAt <= now) return this.fail(p, msg.rid, 'started', 'A reserva já começou: use Estender ou Encerrar.');
        const limits = this.limits(orgId);
        const win = { startAt: msg.startAt, endAt: msg.endAt };
        const w = validateWindow(win, now, limits);
        if (!w.ok) return this.fail(p, msg.rid, w.code, w.message);
        const ownerManager = this.isManagerAccount(orgId, b.ownerId);
        if (!ownerManager) {
          const lim = checkPersonLimits(win, this.store.ofOwner(orgId, b.ownerId), now, limits, b.id);
          if (!lim.ok) return this.fail(p, msg.rid, lim.code, lim.message);
        }
        const live = this.store.liveOfRoom(orgId, b.roomId);
        if (conflictsWith(win, live, b.id).length > 0) {
          const next = nextFreeStart(live.filter((x) => isHolder(x.status) && x.id !== b.id), win.endAt - win.startAt, win.startAt, now, limits);
          return this.reply(p, msg.rid, false, next ? `Esse horário está ocupado. Próxima janela livre: ${fmtWhen(next)}.` : 'Esse horário está ocupado.', 'conflict');
        }
        row.startAt = win.startAt;
        row.endAt = win.endAt;
        row.notified = 0;
        moved = true;
        if (row.status === 'confirmed' && this.settingOf(orgId, b.roomId).requiresApproval && !ownerManager && !this.isManagerPlayer(p)) row.status = 'pending';
      }
      row.updatedAt = now;
      this.store.put(row);
      if (row.status === 'confirmed') this.inviteGuests(row, this.nameOf(row.ownerId), addedGuests);
      if (moved && row.status === 'pending') this.notifyManagers(orgId, row, `${this.nameOf(row.ownerId)} mudou o horário de um pedido da ${this.roomName(orgId, row.roomId)}: ${fmtRange(row.startAt, row.endAt)}.`);
      this.reply(p, msg.rid, true, row.status === 'pending' && moved ? 'Atualizada: o novo horário aguarda aprovação.' : 'Reserva atualizada.');
      this.afterChange(orgId, row.roomId, now, [p.accountId, ...this.participants(row), ...b.guestIds]);
    });
  }

  private decide(p: Player, msg: Extract<ClientMessage, { t: 'booking_decide' }>, now: number): boolean {
    if (!isRid(msg.rid) || !isStr(msg.id, 64) || typeof msg.approve !== 'boolean') return false;
    if (msg.reason !== undefined && (typeof msg.reason !== 'string' || msg.reason.length > 400)) return false;
    if (!this.isManagerPlayer(p)) return this.fail(p, msg.rid, 'forbidden', 'Só a administração aprova ou recusa reservas.'), true;
    if (this.throttled(p, msg.rid, now)) return true;
    const b = this.store.getIn(p.orgId, msg.id);
    if (!b) return this.fail(p, msg.rid, 'not_found', 'Reserva não encontrada.'), true;
    if (b.status !== 'pending') return this.fail(p, msg.rid, 'not_pending', 'Esse pedido já foi decidido.'), true;
    const roomName = this.roomName(b.orgId, b.roomId);
    const when = fmtRange(b.startAt, b.endAt);
    if (b.endAt <= now) {
      this.setStatus(b, 'expired', now);
      this.reply(p, msg.rid, false, 'Esse horário já passou.', 'past');
      this.afterChange(b.orgId, b.roomId, now, [p.accountId, b.ownerId]);
      return true;
    }
    if (msg.approve) {
      const row = this.setStatus(b, 'confirmed', now, { decidedBy: p.accountId, reason: null });
      this.notify(row.ownerId, row.orgId, 'approved', row, `Sua reserva da ${roomName} (${when}) foi aprovada por ${p.name}.`);
      this.inviteGuests(row, this.nameOf(row.ownerId));
      this.audit(p, 'booking.approve', row.roomId, `${this.nameOf(row.ownerId)}; ${when}`);
      this.reply(p, msg.rid, true, 'Reserva aprovada.');
    } else {
      const reason = cleanText(msg.reason ?? '', MAX_BOOKING_REASON);
      const row = this.setStatus(b, 'declined', now, { decidedBy: p.accountId, reason: reason || null });
      this.notify(row.ownerId, row.orgId, 'declined', row, `Sua reserva da ${roomName} (${when}) foi recusada${reason ? `: ${reason}` : '.'}`);
      this.audit(p, 'booking.decline', row.roomId, `${this.nameOf(row.ownerId)}; ${when}${reason ? `; ${reason}` : ''}`);
      this.reply(p, msg.rid, true, 'Reserva recusada.');
    }
    this.afterChange(b.orgId, b.roomId, now, [p.accountId, b.ownerId, ...b.guestIds]);
    return true;
  }

  private roomSet(p: Player, msg: Extract<ClientMessage, { t: 'booking_room_set' }>, now: number): boolean {
    if (!isRid(msg.rid) || !isStr(msg.roomId, 64) || typeof msg.bookable !== 'boolean' || typeof msg.requiresApproval !== 'boolean') return false;
    if (!this.isManagerPlayer(p)) return this.fail(p, msg.rid, 'forbidden', 'Só a administração configura as salas reserváveis.'), true;
    if (this.throttled(p, msg.rid, now)) return true;
    const orgId = p.orgId;
    if (NEVER_BOOKABLE_ROOM_IDS.includes(msg.roomId) || !this.host.org(orgId).rooms.has(msg.roomId)) return this.fail(p, msg.rid, 'room', 'Essa sala não pode ser reservada.'), true;
    this.store.putRoom({ orgId, roomId: msg.roomId, bookable: msg.bookable, requiresApproval: msg.requiresApproval, updatedBy: p.accountId, updatedAt: now });
    if (!msg.bookable) {
      for (const b of this.store.liveOfRoom(orgId, msg.roomId)) {
        const row = this.setStatus(b, 'cancelled', now, { decidedBy: p.accountId, reason: 'A sala deixou de ser reservável.' });
        this.notify(row.ownerId, orgId, 'cancelled', row, `Sua reserva da ${this.roomName(orgId, row.roomId)} (${fmtRange(row.startAt, row.endAt)}) foi cancelada: a sala deixou de ser reservável.`);
      }
    }
    this.audit(p, 'booking.room', msg.roomId, `${msg.bookable ? 'reservável' : 'não reservável'}${msg.bookable && msg.requiresApproval ? '; exige aprovação' : ''}`);
    this.reply(p, msg.rid, true, 'Configuração salva.');
    this.afterChange(orgId, msg.roomId, now, [p.accountId], 'A reserva foi cancelada.');
    return true;
  }

  private limitsSet(p: Player, msg: Extract<ClientMessage, { t: 'booking_limits_set' }>, now: number): boolean {
    if (!isRid(msg.rid) || !limitsAreValid(msg.limits)) return false;
    if (!this.isManagerPlayer(p)) return this.fail(p, msg.rid, 'forbidden', 'Só a administração muda os limites de reserva.'), true;
    if (this.throttled(p, msg.rid, now)) return true;
    const l = msg.limits;
    const limits: BookingLimits = { maxDurationMin: l.maxDurationMin, maxActivePerPerson: l.maxActivePerPerson, maxAdvanceDays: l.maxAdvanceDays, maxDailyMin: l.maxDailyMin, noShowMin: l.noShowMin };
    this.store.putLimits({ orgId: p.orgId, limits, updatedBy: p.accountId, updatedAt: now });
    this.audit(p, 'booking.limits', 'private', JSON.stringify(limits));
    this.reply(p, msg.rid, true, 'Limites salvos.');
    this.afterChange(p.orgId, '', now, [p.accountId]);
    return true;
  }

  // ---- notificacoes --------------------------------------------------------------------------------------

  private notify(accountId: string, orgId: string, kind: BookingNoticeKind, b: Pick<BookingRow, 'id' | 'roomId'>, text: string) {
    const q = this.host.playerOf(accountId);
    if (!q || q.orgId !== orgId) return;
    q.send({ t: 'booking_notice', kind, bookingId: b.id, roomId: b.roomId, roomName: this.roomName(orgId, b.roomId), text, at: this.host.clock() });
    q.send({ t: 'chat', id: null, name: '', text, kind: 'system' });
  }

  private notifyManagers(orgId: string, b: BookingRow, text: string) {
    for (const q of this.host.players(orgId)) if (q.accountId !== b.ownerId && this.isManagerPlayer(q)) this.notify(q.accountId, orgId, 'pending', b, text);
  }

  // ---- relogio ---------------------------------------------------------------------------------------------

  /** Depois de qualquer mudanca: anda a fila, aplica o acesso, atualiza placas e telas abertas. */
  private afterChange(orgId: string, roomId: string, now: number, _involved: Iterable<string>, endedMessage?: string) {
    if (roomId) {
      this.processRoom(orgId, roomId, now, endedMessage ?? 'A reserva terminou.');
      this.enforce(orgId, roomId, endedMessage ?? 'A reserva terminou.');
    }
    this.refreshDoors(orgId, now);
    for (const q of this.host.players(orgId)) if (this.lastView.has(q.accountId)) this.pushSnapshot(q, now);
  }

  /** Avanca uma sala: avisos, inicio, fim, no-show, promocao da fila e expulsao de quem nao pode ficar. Devolve true se algo mudou. */
  processRoom(orgId: string, roomId: string, now: number, endedMessage = 'A reserva terminou.'): boolean {
    if (!this.host.store.orgs.getOrg(orgId)) return false;
    const limits = this.limits(orgId);
    const room = this.host.org(orgId).rooms.get(roomId);
    const roomName = this.roomName(orgId, roomId);
    let changed = false;
    let released = false;
    const rows = this.store.liveOfRoom(orgId, roomId).sort((a, b) => a.startAt - b.startAt);
    for (const b0 of rows) {
      let b = b0;
      const others = (x: BookingRow) => (room ? [...room.players.values()].filter((q) => q.orgId === orgId && !this.participants(x).includes(q.accountId) && q.role !== 'owner' && q.role !== 'admin' && !this.host.isStaffAdmin(q)) : []);
      if (b.endAt <= now) {
        if (b.status === 'confirmed') {
          b = this.setStatus(b, 'ended', now);
          for (const id of this.participants(b)) this.notify(id, orgId, 'ended', b, `Reserva da ${roomName} encerrada. A sala foi liberada.`);
          released = true;
        } else if (b.status === 'pending') {
          b = this.setStatus(b, 'expired', now, { reason: 'Ninguém aprovou a tempo.' });
          this.notify(b.ownerId, orgId, 'declined', b, `Seu pedido da ${roomName} (${fmtRange(b.startAt, b.endAt)}) expirou sem aprovação.`);
        } else b = this.setStatus(b, 'expired', now);
        changed = true;
        continue;
      }
      if (b.status !== 'confirmed') continue;
      let notified = b.notified;
      let checkedInAt = b.checkedInAt;
      const phase = windowPhase(b, now);
      const when = fmtRange(b.startAt, b.endAt);
      if (phase === 'upcoming') {
        if (b.startAt - now <= BOOKING_WARN_MS && !(notified & NOTIFIED.startSoon)) {
          notified |= NOTIFIED.startSoon | NOTIFIED.evictWarned;
          for (const id of this.participants(b)) this.notify(id, orgId, 'starts_soon', b, `Sua reserva da ${roomName} começa em 5 minutos (${fmtClock(b.startAt)}).`);
          for (const q of others(b)) this.notify(q.accountId, orgId, 'vacate', b, `Esta sala será reservada às ${fmtClock(b.startAt)}. Saia até lá para não ser levado à recepção.`);
        }
      } else {
        if (!(notified & NOTIFIED.started)) {
          notified |= NOTIFIED.started | NOTIFIED.startSoon;
          for (const id of this.participants(b)) this.notify(id, orgId, 'started', b, `Sua reserva da ${roomName} começou: a sala é sua até ${fmtClock(b.endAt)}.`);
        }
        if (!(notified & NOTIFIED.evictWarned)) {
          notified |= NOTIFIED.evictWarned;
          for (const q of others(b)) this.notify(q.accountId, orgId, 'vacate', b, `Esta sala foi reservada até ${fmtClock(b.endAt)}. Você será levado à recepção em instantes.`);
        }
        if (checkedInAt === null && room && [...room.players.values()].some((q) => q.accountId === b.ownerId)) checkedInAt = now;
        if (b.endAt - now <= BOOKING_WARN_MS && !(notified & NOTIFIED.endSoon)) {
          notified |= NOTIFIED.endSoon;
          for (const id of this.participants(b)) this.notify(id, orgId, 'ends_soon', b, `Sua reserva da ${roomName} termina em 5 minutos (${fmtClock(b.endAt)}). Quem reservou pode estender +30 min se não houver fila.`);
        }
        if (noShowDue({ ...b, checkedInAt }, now, limits)) {
          b = this.setStatus(b, 'no_show', now, { notified, checkedInAt });
          this.notify(b.ownerId, orgId, 'released', b, `Sua reserva da ${roomName} (${when}) foi liberada: você não entrou nos primeiros ${limits.noShowMin} minutos.`);
          for (const g of b.guestIds) this.notify(g, orgId, 'released', b, `A reserva da ${roomName} (${when}) foi liberada porque o dono não chegou.`);
          released = true;
          changed = true;
          continue;
        }
      }
      if (notified !== b.notified || checkedInAt !== b.checkedInAt) {
        this.store.put({ ...b, notified, checkedInAt, updatedAt: now });
        changed = true;
      }
    }
    if (this.promote(orgId, roomId, now, limits)) changed = true;
    // quem nao pode ficar: durante a reserva (apos a tolerancia) ou quando a sala volta ao acesso normal
    if (room && (released || changed || this.activeBooking(orgId, roomId, now))) this.enforce(orgId, roomId, released ? endedMessage : 'A sala está reservada neste horário.');
    return changed || released;
  }

  /** Sobe da fila, em ordem de chegada, quem agora cabe. */
  private promote(orgId: string, roomId: string, now: number, limits: BookingLimits): boolean {
    const live = this.store.liveOfRoom(orgId, roomId);
    if (!live.some((b) => b.status === 'queued')) return false;
    const approval = this.settingOf(orgId, roomId).requiresApproval;
    const plan = promotionPlan(live, now, (b) => {
      if (!this.host.orgService.actorFor(b.ownerId, orgId)) return 'expire';
      if (this.isManagerAccount(orgId, b.ownerId)) return 'ok';
      const lim = checkPersonLimits(b, this.store.ofOwner(orgId, b.ownerId), now, limits, b.id);
      return !lim.ok && lim.code === 'daily_cap' ? 'expire' : 'ok';
    });
    const roomName = this.roomName(orgId, roomId);
    for (const b of plan.expire) {
      const row = this.setStatus(b, 'expired', now, { reason: 'O horário chegou e a fila não andou.' });
      this.notify(row.ownerId, orgId, 'released', row, `Sua vez na fila da ${roomName} (${fmtRange(row.startAt, row.endAt)}) passou: o horário não ficou livre.`);
    }
    for (const b of plan.promote) {
      const pending = approval && !this.isManagerAccount(orgId, b.ownerId);
      const row = this.setStatus(b, pending ? 'pending' : 'confirmed', now);
      const when = fmtRange(row.startAt, row.endAt);
      if (pending) {
        this.notify(row.ownerId, orgId, 'promoted', row, `Boa notícia: o horário da ${roomName} (${when}) liberou e você subiu da fila. Falta a aprovação de um gestor.`);
        this.notifyManagers(orgId, row, `${this.nameOf(row.ownerId)} pediu a ${roomName} (${when}): "${row.title}". Abra Reservas > Pendentes para decidir.`);
      } else {
        this.notify(row.ownerId, orgId, 'promoted', row, `Boa notícia: o horário da ${roomName} (${when}) liberou e sua reserva foi confirmada.`);
        this.inviteGuests(row, this.nameOf(row.ownerId));
      }
    }
    return plan.expire.length + plan.promote.length > 0;
  }

  /** Leva para a recepcao quem nao pode mais estar na sala. */
  private enforce(orgId: string, roomId: string, message: string) {
    const room = this.host.org(orgId).rooms.get(roomId);
    if (!room) return;
    for (const q of [...room.players.values()]) {
      if (q.orgId !== orgId) continue;
      if (!this.host.canEnter(q, roomId, { stay: true }).allow) this.host.evict(q, roomId, message);
    }
  }

  /** Relogio barato: uma passada por segundo so nas salas com reserva viva. */
  tick(now: number) {
    if (now < this.nextTick) return;
    this.nextTick = now + TICK_MS;
    const orgs = new Set<string>();
    for (const { orgId, roomId } of this.store.liveRooms()) {
      orgs.add(orgId);
      if (this.processRoom(orgId, roomId, now)) for (const q of this.host.players(orgId)) if (this.lastView.has(q.accountId)) this.pushSnapshot(q, now);
    }
    for (const key of this.doorSig.keys()) orgs.add(key.split('\0')[0]!);
    for (const orgId of orgs) this.refreshDoors(orgId, now);
    if (now >= this.nextPurge) {
      this.nextPurge = now + PURGE_EVERY_MS;
      const n = this.store.purge(now);
      if (n > 0) this.host.log('booking.purge', { removed: n });
    }
  }

  // ---- placas das portas ---------------------------------------------------------------------------------------

  private confirmedOf(orgId: string, roomId: string): BookingRow[] {
    return this.store.liveOfRoom(orgId, roomId).filter((b) => b.status === 'confirmed');
  }

  doorsFor(p: Player, now: number): BookingDoor[] {
    const out: BookingDoor[] = [];
    const manager = this.isManagerPlayer(p);
    for (const [roomId] of this.host.org(p.orgId).rooms) {
      if (!this.settingOf(p.orgId, roomId).bookable) continue;
      const rows = this.confirmedOf(p.orgId, roomId);
      const d = doorOf(rows, now);
      const cur = rows.find((r) => r.startAt <= now && now < r.endAt);
      const mine = !!cur && (cur.ownerId === p.accountId || cur.guestIds.includes(p.accountId));
      out.push({ roomId, state: d.state, ...(d.until !== undefined ? { until: d.until } : {}), ...(d.from !== undefined ? { from: d.from } : {}), ...(cur && (mine || manager) ? { by: this.nameOf(cur.ownerId) } : {}), open: this.host.canEnter(p, roomId).allow });
    }
    return out;
  }

  sendDoors(p: Player) {
    p.send({ t: 'booking_doors', doors: this.doorsFor(p, this.host.clock()) });
  }

  /** Reenvia as placas (e a lista de salas, com cadeados) quando o estado de alguma porta da organizacao mudou. */
  private refreshDoors(orgId: string, now: number) {
    let dirty = false;
    const rooms = new Set<string>(this.store.liveRooms().filter((r) => r.orgId === orgId).map((r) => r.roomId));
    for (const key of this.doorSig.keys()) if (key.startsWith(`${orgId}\0`)) rooms.add(key.slice(orgId.length + 1));
    for (const roomId of rooms) {
      const key = `${orgId}\0${roomId}`;
      const rows = this.settingOf(orgId, roomId).bookable ? this.confirmedOf(orgId, roomId) : [];
      const d = doorOf(rows, now);
      const cur = rows.find((r) => r.startAt <= now && now < r.endAt);
      const sig = d.state === 'free' ? 'free' : `${d.state}|${d.until ?? ''}|${d.from ?? ''}|${cur?.id ?? ''}`;
      if ((this.doorSig.get(key) ?? 'free') !== sig) dirty = true;
      if (sig === 'free') this.doorSig.delete(key);
      else this.doorSig.set(key, sig);
    }
    if (!dirty) return;
    for (const q of this.host.players(orgId)) {
      this.sendDoors(q);
      this.host.sendRooms(q);
    }
  }
}
