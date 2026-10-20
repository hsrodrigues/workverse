import { beforeEach, describe, expect, it } from 'vitest';
import { BOOKING_DAY, BOOKING_HOUR, BOOKING_MINUTE, DEFAULT_BOOKING_LIMITS, type BookingSlotResult, type ClientMessage, type Role, type ServerMessage } from '@workverse/shared';
import { World, type Connection } from '../src/world';
import { MemoryAccountStore, type Account } from '../src/store';

class FakeConn implements Connection {
  strikes = 0;
  accountId?: string;
  player?: Connection['player'];
  inbox: ServerMessage[] = [];
  closed = false;
  send(msg: ServerMessage) {
    this.inbox.push(msg);
  }
  close() {
    this.closed = true;
  }
  last<T extends ServerMessage['t']>(t: T) {
    return [...this.inbox].reverse().find((m) => m.t === t) as Extract<ServerMessage, { t: T }> | undefined;
  }
  all<T extends ServerMessage['t']>(t: T) {
    return this.inbox.filter((m) => m.t === t) as Extract<ServerMessage, { t: T }>[];
  }
  notices(kind?: string) {
    return this.all('booking_notice').filter((n) => !kind || n.kind === kind);
  }
  errors(code: string) {
    return this.all('error').filter((e) => e.code === code);
  }
  get room() {
    return this.player?.roomId ?? null;
  }
  clear() {
    this.inbox = [];
  }
}

// 2026-10-20 12:00 em Brasilia
const T0 = Date.UTC(2026, 9, 20, 15, 0, 0);
let now = T0;
let store: MemoryAccountStore;
let world: World;
let rid = 0;
/** Hora local de Brasilia (h) do dia `d` depois de hoje, em ms UTC. */
const at = (h: number, m = 0, d = 0) => T0 + d * BOOKING_DAY + (h - 12) * BOOKING_HOUR + m * BOOKING_MINUTE;

function account(name: string): Account {
  const a = store.create({ email: `${name.toLowerCase()}@x.com`, displayName: name, passwordHash: 'scrypt$x' });
  a.orgsInit = true;
  store.save(a);
  return a;
}
function org(id: string) {
  store.orgs.putOrg({ id, slug: id.toLowerCase(), name: `Org ${id}`, settings: {}, createdAt: 0 });
  store.orgs.putTeam({ id: `${id}-alfa`, orgId: id, name: 'Alfa', color: '#ff0000' });
}
function member(orgId: string, acc: Account, role: Role) {
  store.orgs.putMember({ orgId, accountId: acc.id, role, teamId: null, status: 'active', createdAt: 0 });
}
function connect(acc: Account, orgId: string, roomId = 'reception'): FakeConn {
  const c = new FakeConn();
  c.accountId = acc.id;
  world.handle(c, { t: 'hello', orgId });
  world.handle(c, { t: 'join', roomId });
  return c;
}
const send = (c: FakeConn, msg: Record<string, unknown>) => world.handle(c, msg as unknown as ClientMessage);
const advance = (ms: number, step = 10_000) => {
  const end = now + ms;
  while (now < end) {
    now = Math.min(end, now + step);
    world.tick(now);
  }
};
const goTo = (t: number, step = 10_000) => advance(t - now, step);

const request = (c: FakeConn, roomId: string, slots: Array<[number, number]>, title = 'Reunião', guests?: string[]) => {
  send(c, { t: 'booking_request', rid: ++rid, roomId, slots: slots.map(([startAt, endAt]) => ({ startAt, endAt })), title, ...(guests ? { guests } : {}) });
  return c.last('booking_result')!;
};
const slot0 = (r: { results?: BookingSlotResult[] }) => r.results![0]!;
const act = (c: FakeConn, t: string, extra: Record<string, unknown> = {}) => {
  send(c, { t, rid: ++rid, ...extra });
  return c.last('booking_result')!;
};
const sync = (c: FakeConn, roomId = 'private', from = at(0), to = at(0, 0, 3)) => {
  send(c, { t: 'booking_sync', roomId, from, to });
  return c.last('bookings')!;
};
const join = (c: FakeConn, roomId: string) => send(c, { t: 'join', roomId });

let boss: Account, adm: Account, ana: Account, bia: Account, cris: Account, gui: Account, outsider: Account;
let cBoss: FakeConn, cAdm: FakeConn, cAna: FakeConn, cBia: FakeConn, cCris: FakeConn, cGui: FakeConn;

beforeEach(() => {
  now = T0;
  rid = 0;
  store = new MemoryAccountStore();
  world = new World({ store, clock: () => now });
  org('orgA');
  org('orgB');
  boss = account('Chefe');
  adm = account('Admin');
  ana = account('Ana');
  bia = account('Bia');
  cris = account('Cris');
  gui = account('Gui');
  outsider = account('Forasteiro');
  member('orgA', boss, 'owner');
  member('orgA', adm, 'admin');
  member('orgA', ana, 'member');
  member('orgA', bia, 'member');
  member('orgA', cris, 'member');
  member('orgA', gui, 'guest');
  member('orgB', outsider, 'member');
  cBoss = connect(boss, 'orgA');
  cAdm = connect(adm, 'orgA');
  cAna = connect(ana, 'orgA');
  cBia = connect(bia, 'orgA');
  cCris = connect(cris, 'orgA');
  cGui = connect(gui, 'orgA');
});

describe('papeis: quem pode o que', () => {
  it('visitante nao reserva; membro, admin e dono sim', () => {
    send(cGui, { t: 'booking_request', rid: 1, roomId: 'private', slots: [{ startAt: at(14), endAt: at(15) }], title: 'x' });
    expect(cGui.errors('forbidden')).toHaveLength(1);
    expect(cGui.all('booking_result')).toHaveLength(0);
    send(cGui, { t: 'booking_sync', roomId: 'private', from: at(0), to: at(0, 0, 1) });
    expect(cGui.errors('forbidden')).toHaveLength(2);
    for (const c of [cAna, cAdm, cBoss]) expect(request(c, 'private', [[at(14 + [cAna, cAdm, cBoss].indexOf(c) * 2), at(15 + [cAna, cAdm, cBoss].indexOf(c) * 2)]]).ok).toBe(true);
  });

  it('aprovar, configurar sala e limites e so da administracao (membro leva forbidden)', () => {
    const r = request(cAna, 'private', [[at(14), at(15)]]);
    const id = slot0(r).id!;
    for (const t of ['booking_decide', 'booking_room_set', 'booking_limits_set']) {
      cAna.clear();
      send(cAna, { t, rid: ++rid, id, approve: true, roomId: 'meeting1', bookable: true, requiresApproval: false, limits: DEFAULT_BOOKING_LIMITS });
      expect(cAna.errors('forbidden'), t).toHaveLength(1);
    }
    expect(act(cAdm, 'booking_room_set', { roomId: 'meeting1', bookable: true, requiresApproval: false }).ok).toBe(true);
    expect(act(cBoss, 'booking_limits_set', { limits: { ...DEFAULT_BOOKING_LIMITS, maxActivePerPerson: 3 } }).ok).toBe(true);
    expect(sync(cAna).limits.maxActivePerPerson).toBe(3);
  });

  it('so o dono (ou a administracao) cancela, estende ou edita; convidado e outro membro nao', () => {
    const id = slot0(request(cAna, 'private', [[at(14), at(15)]], 'Plano', ['Bia'])).id!;
    expect(act(cBia, 'booking_cancel', { id })).toMatchObject({ ok: false, code: 'forbidden' });
    expect(act(cCris, 'booking_edit', { id, title: 'Roubei' })).toMatchObject({ ok: false, code: 'forbidden' });
    expect(act(cBia, 'booking_extend', { id })).toMatchObject({ ok: false, code: 'forbidden' });
    expect(act(cAdm, 'booking_edit', { id, title: 'Plano B' }).ok).toBe(true);
    expect(act(cAna, 'booking_cancel', { id }).ok).toBe(true);
  });
});

describe('reservar e acesso durante a janela', () => {
  it('confirma, avisa e so deixa entrar dono, convidados e admins durante a janela; fora dela volta ao normal', () => {
    const r = request(cAna, 'private', [[at(14), at(16)]], 'Conversa com cliente', ['Bia']);
    expect(slot0(r)).toMatchObject({ ok: true, status: 'confirmed' });
    expect(cAna.notices('confirmed')).toHaveLength(1);
    expect(cAna.notices('confirmed')[0]!.text).toContain('Reserva confirmada');
    expect(cBia.notices('invited')).toHaveLength(1);

    // antes da janela: sala privada = so convite (ninguem alem da administracao)
    join(cAna, 'private');
    expect(cAna.room).toBe('reception');
    goTo(at(14, 0));
    // dentro da janela
    join(cAna, 'private');
    join(cBia, 'private');
    join(cCris, 'private');
    join(cAdm, 'private');
    join(cBoss, 'private');
    expect(cAna.room).toBe('private');
    expect(cBia.room).toBe('private');
    expect(cAdm.room).toBe('private');
    expect(cBoss.room).toBe('private');
    expect(cCris.room).toBe('reception');
    expect(cCris.errors('room_denied').length + cCris.errors('forbidden').length).toBeGreaterThan(0);
    // depois do fim a sala volta ao acesso normal dela: dono e convidado saem; admin fica
    goTo(at(16, 0));
    expect(cAna.room).toBe('reception');
    expect(cBia.room).toBe('reception');
    expect(cAdm.room).toBe('private');
    expect(cAna.notices('ended')).toHaveLength(1);
    join(cAna, 'private');
    expect(cAna.room).toBe('reception');
  });

  it('a configuracao permanente da sala nao muda (acesso e convites seguem os mesmos)', () => {
    request(cAna, 'private', [[at(14), at(16)]], 'x', ['Bia']);
    goTo(at(14, 30));
    const room = world.org('orgA').rooms.get('private')!;
    expect(room.built.def.access).toBe('private');
    expect(store.orgs.getRoomSetting('orgA', 'private')).toBeUndefined();
    expect(store.orgs.allRoomInvitesOf('orgA')).toEqual([]);
  });

  it('sala aberta reservavel: durante a janela so entram os participantes e quem estava dentro sai apos aviso e tolerancia', () => {
    act(cAdm, 'booking_room_set', { roomId: 'meeting1', bookable: true, requiresApproval: false });
    request(cAna, 'meeting1', [[at(14), at(15)]], 'Retro', ['Bia']);
    goTo(at(13, 40));
    join(cCris, 'meeting1');
    join(cGui, 'meeting1'); // visitante nunca entra em meeting1 (so membros)
    expect(cCris.room).toBe('meeting1');
    cCris.clear();
    // aviso de 5 minutos
    goTo(at(13, 55, 0));
    expect(cCris.notices('vacate')).toHaveLength(1);
    expect(cAna.notices('starts_soon')).toHaveLength(1);
    expect(cBia.notices('starts_soon')).toHaveLength(1);
    // comeca: tolerancia de 1 minuto
    goTo(at(14, 0));
    expect(cAna.notices('started')).toHaveLength(1);
    expect(cCris.room).toBe('meeting1');
    goTo(at(14, 0) + 59_000, 1000);
    expect(cCris.room).toBe('meeting1');
    goTo(at(14, 1) + 2000, 1000);
    expect(cCris.room).toBe('reception');
    expect(cCris.errors('kicked_room').length).toBeGreaterThan(0);
    join(cCris, 'meeting1');
    expect(cCris.room).toBe('reception');
    join(cAna, 'meeting1');
    join(cBia, 'meeting1');
    expect(cAna.room).toBe('meeting1');
    expect(cBia.room).toBe('meeting1');
    // fim: aviso 5 min antes, depois a sala volta a ser aberta e Cris entra
    goTo(at(14, 55));
    expect(cAna.notices('ends_soon')).toHaveLength(1);
    goTo(at(15, 0));
    join(cCris, 'meeting1');
    expect(cCris.room).toBe('meeting1');
    expect(cAna.room).toBe('meeting1');
  });

  it('lista de salas: cadeado com motivo "booked" so para quem nao tem acesso, e placa da porta sem detalhes para estranhos', () => {
    act(cAdm, 'booking_room_set', { roomId: 'meeting1', bookable: true, requiresApproval: false });
    request(cAna, 'meeting1', [[at(14), at(15)]], 'Segredo', ['Bia']);
    goTo(at(14, 10));
    const entry = (c: FakeConn) => c.last('rooms')!.rooms.find((r) => r.id === 'meeting1')!;
    expect(entry(cCris)).toMatchObject({ locked: true, lockReason: 'booked' });
    expect(entry(cCris).population).toBeUndefined();
    expect(entry(cAna).locked).toBe(false);
    expect(entry(cBia).locked).toBe(false);
    expect(entry(cAdm).locked).toBe(false);
    const door = (c: FakeConn) => c.last('booking_doors')!.doors.find((d) => d.roomId === 'meeting1')!;
    expect(door(cCris)).toMatchObject({ state: 'busy', until: at(15), open: false });
    expect(door(cCris).by).toBeUndefined();
    expect(door(cAna)).toMatchObject({ state: 'busy', by: 'Ana', open: true });
    expect(door(cAdm).by).toBe('Ana');
    goTo(at(15, 0));
    expect(door(cCris)).toMatchObject({ state: 'free', open: true });
  });

  it('o dono pode encerrar antes: a sala e liberada na hora e o dono e levado para fora (sala privada)', () => {
    const id = slot0(request(cAna, 'private', [[at(14), at(16)]])).id!;
    goTo(at(14, 5));
    join(cAna, 'private');
    expect(cAna.room).toBe('private');
    expect(act(cAna, 'booking_cancel', { id })).toMatchObject({ ok: false, code: 'active' });
    expect(act(cAna, 'booking_end', { id }).ok).toBe(true);
    expect(cAna.room).toBe('reception');
    expect(sync(cAna).mine[0]).toMatchObject({ status: 'ended', canEnd: false });
    // a janela ja liberou: outra pessoa pode reservar o resto
    expect(slot0(request(cBia, 'private', [[at(14, 15), at(15)]])).status).toBe('confirmed');
  });
});

describe('conflito e fila', () => {
  it('horario ocupado entra na fila com posicao e proxima janela livre; cancelar promove automaticamente', () => {
    const a = slot0(request(cAna, 'private', [[at(14), at(16)]]));
    expect(a.status).toBe('confirmed');
    const b = slot0(request(cBia, 'private', [[at(15), at(17)]]));
    expect(b).toMatchObject({ ok: true, status: 'queued', position: 1, suggestion: at(16) });
    expect(b.message).toContain('1º da fila');
    expect(cBia.notices('queued')).toHaveLength(1);
    const c = slot0(request(cCris, 'private', [[at(15), at(16)]]));
    expect(c).toMatchObject({ status: 'queued', position: 2 });
    const view = sync(cCris);
    expect(view.queue.map((q) => [q.ownerName, q.position, q.mine])).toEqual([['Bia', 1, false], ['Cris', 2, true]]);
    expect(view.mine[0]).toMatchObject({ status: 'queued', position: 2, suggestion: at(16) });

    cBia.clear();
    cCris.clear();
    expect(act(cAna, 'booking_cancel', { id: a.id }).ok).toBe(true);
    // Bia (1a) sobe; Cris (15-16) agora bate com Bia (15-17): continua na fila, agora em 1o
    expect(cBia.notices('promoted')).toHaveLength(1);
    expect(cBia.notices('promoted')[0]!.text).toContain('confirmada');
    expect(sync(cBia).mine[0]).toMatchObject({ status: 'confirmed' });
    expect(sync(cCris).mine[0]).toMatchObject({ status: 'queued', position: 1 });
    // cancelar a da Bia promove a Cris
    expect(act(cBia, 'booking_cancel', { id: b.id }).ok).toBe(true);
    expect(sync(cCris).mine[0]).toMatchObject({ status: 'confirmed' });
    expect(cCris.notices('promoted')).toHaveLength(1);
  });

  it('a fila respeita a ordem de chegada, nao o horario pedido', () => {
    const a = slot0(request(cAna, 'private', [[at(14), at(16)]]));
    const first = slot0(request(cCris, 'private', [[at(15), at(16)]]));
    now += 5000;
    const second = slot0(request(cBia, 'private', [[at(14, 30), at(16)]]));
    expect([first.position, second.position]).toEqual([1, 2]);
    act(cAna, 'booking_cancel', { id: a.id });
    expect(sync(cCris).mine[0]!.status).toBe('confirmed');
    expect(sync(cBia).mine[0]).toMatchObject({ status: 'queued', position: 1 });
  });

  it('terminar a reserva anterior ou liberar por no-show tambem promove; quem perdeu o inicio expira', () => {
    request(cAna, 'private', [[at(14), at(15)]]);
    const q = slot0(request(cBia, 'private', [[at(14, 10), at(15)]]));
    expect(q.status).toBe('queued');
    // Ana nao aparece: aos 15 min a reserva e liberada e o horario de Bia (14:10) ja passou -> expira
    goTo(at(14, 15));
    expect(cAna.notices('released')).toHaveLength(1);
    expect(sync(cBia).mine[0]).toMatchObject({ status: 'expired' });
    expect(cBia.notices('released')).toHaveLength(1);
  });

  it('liberacao por no-show promove quem ainda cabe', () => {
    request(cAna, 'private', [[at(14), at(16)]]);
    request(cBia, 'private', [[at(14, 30), at(15)]]);
    goTo(at(14, 15));
    expect(sync(cAna).mine[0]).toMatchObject({ status: 'no_show' });
    expect(sync(cBia).mine[0]).toMatchObject({ status: 'confirmed' });
    expect(cBia.notices('promoted')).toHaveLength(1);
  });

  it('no-show: entrar na sala antes do prazo mantem a reserva; configuravel ou desligado', () => {
    request(cAna, 'private', [[at(14), at(16)]]);
    goTo(at(14, 10));
    join(cAna, 'private');
    goTo(at(14, 40));
    expect(sync(cAna).mine[0]).toMatchObject({ status: 'confirmed', checkedIn: true });
    // limite proprio de 5 min
    act(cAdm, 'booking_limits_set', { limits: { ...DEFAULT_BOOKING_LIMITS, noShowMin: 5 } });
    request(cBia, 'private', [[at(17), at(18)]]);
    goTo(at(17, 4));
    expect(sync(cBia).mine.find((m) => m.startAt === at(17))!.status).toBe('confirmed');
    goTo(at(17, 5));
    expect(sync(cBia).mine.find((m) => m.startAt === at(17))!.status).toBe('no_show');
    // desligado (0 = nunca libera)
    act(cAdm, 'booking_limits_set', { limits: { ...DEFAULT_BOOKING_LIMITS, noShowMin: 0 } });
    request(cCris, 'private', [[at(18), at(19)]]);
    goTo(at(18, 50));
    expect(sync(cCris).mine[0]).toMatchObject({ status: 'confirmed' });
  });

  it('nao pede por cima de si mesmo', () => {
    request(cAna, 'private', [[at(14), at(16)]]);
    const r = request(cAna, 'private', [[at(15), at(17)]]);
    expect(r).toMatchObject({ ok: false, code: 'self_conflict' });
  });

  it('varios dias de uma vez: cada dia e decidido sozinho (um ocupado entra na fila)', () => {
    request(cBia, 'private', [[at(14, 0, 1), at(15, 0, 1)]]);
    const r = request(cAna, 'private', [[at(14), at(15)], [at(14, 0, 1), at(15, 0, 1)], [at(14, 0, 2), at(15, 0, 2)]]);
    expect(r.ok).toBe(true); // ok = ao menos um dia reservado; o limite padrao e 2 reservas ativas, entao o terceiro dia nao cabe
    expect(r.results!.map((x) => x.status ?? x.code)).toEqual(['confirmed', 'queued', 'too_many']);
    expect(r.message).toContain('2 de 3');
  });

  it('aumentar o limite libera os 3 dias; mais de 7 dias e mensagem invalida', () => {
    act(cAdm, 'booking_limits_set', { limits: { ...DEFAULT_BOOKING_LIMITS, maxActivePerPerson: 7 } });
    const r = request(cAna, 'private', [0, 1, 2, 3, 4, 5, 6].map((d) => [at(14, 0, d), at(15, 0, d)] as [number, number]));
    expect(r.ok).toBe(true);
    expect(r.results).toHaveLength(7);
    const before = cAna.strikes;
    send(cAna, { t: 'booking_request', rid: 99, roomId: 'private', slots: [0, 1, 2, 3, 4, 5, 6, 7].map((d) => ({ startAt: at(8, 0, d), endAt: at(9, 0, d) })), title: 'x' });
    expect(cAna.strikes).toBe(before + 1);
  });
});

describe('aprovacao', () => {
  beforeEach(() => {
    act(cAdm, 'booking_room_set', { roomId: 'private', bookable: true, requiresApproval: true });
  });

  it('com aprovacao a reserva fica pendente: ocupa o horario, nao libera acesso e a administracao decide', () => {
    cBoss.clear();
    const r = slot0(request(cAna, 'private', [[at(14), at(15)]], 'Pauta', ['Bia']));
    expect(r.status).toBe('pending');
    expect(cBoss.notices('pending')).toHaveLength(1);
    expect(cBia.notices('invited')).toHaveLength(0);
    // ocupa o horario: outro pedido entra na fila
    expect(slot0(request(cCris, 'private', [[at(14, 30), at(15, 30)]])).status).toBe('queued');
    // pendente aparece como "pending" para estranhos, sem detalhes; admin ve tudo e a lista de pendentes
    const outsiderView = sync(cCris);
    expect(outsiderView.blocks).toEqual([{ id: r.id, startAt: at(14), endAt: at(15), state: 'pending', mine: false }]);
    expect(outsiderView.pending).toBeUndefined();
    const adminView = sync(cAdm);
    expect(adminView.pending!.map((p) => [p.ownerName, p.title, p.guests])).toEqual([['Ana', 'Pauta', ['Bia']]]);
    goTo(at(14, 5));
    join(cAna, 'private');
    expect(cAna.room).toBe('reception'); // pendente nao libera a sala
    // aprovar
    expect(act(cAdm, 'booking_decide', { id: r.id, approve: true }).ok).toBe(true);
    expect(cAna.notices('approved')).toHaveLength(1);
    expect(cBia.notices('invited')).toHaveLength(1);
    join(cAna, 'private');
    expect(cAna.room).toBe('private');
    expect(act(cAdm, 'booking_decide', { id: r.id, approve: true })).toMatchObject({ ok: false, code: 'not_pending' });
  });

  it('recusar com motivo avisa o dono e promove a fila (que tambem espera aprovacao)', () => {
    const a = slot0(request(cAna, 'private', [[at(14), at(15)]]));
    request(cCris, 'private', [[at(14, 30), at(15, 30)]]);
    expect(act(cAdm, 'booking_decide', { id: a.id, approve: false, reason: 'Sala em manutenção' }).ok).toBe(true);
    expect(cAna.notices('declined')[0]!.text).toContain('Sala em manutenção');
    expect(sync(cAna).mine[0]).toMatchObject({ status: 'declined', reason: 'Sala em manutenção' });
    expect(cCris.notices('promoted')[0]!.text).toContain('aprovação');
    expect(sync(cCris).mine[0]).toMatchObject({ status: 'pending' });
  });

  it('pedidos de quem administra a organizacao saem confirmados', () => {
    expect(slot0(request(cAdm, 'private', [[at(14), at(15)]])).status).toBe('confirmed');
  });

  it('pedido nunca aprovado expira quando o horario passa', () => {
    const r = slot0(request(cAna, 'private', [[at(14), at(15)]]));
    goTo(at(15, 1));
    expect(sync(cAna).mine[0]).toMatchObject({ status: 'expired' });
    expect(act(cAdm, 'booking_decide', { id: r.id, approve: true })).toMatchObject({ ok: false, code: 'not_pending' });
  });
});

describe('limites configuraveis, com mensagens claras', () => {
  it('duracao maxima, antecedencia, reservas ativas e horas por dia', () => {
    act(cAdm, 'booking_limits_set', { limits: { maxDurationMin: 120, maxActivePerPerson: 2, maxAdvanceDays: 7, maxDailyMin: 180, noShowMin: 15 } });
    expect(request(cAna, 'private', [[at(14), at(17)]])).toMatchObject({ ok: false, code: 'too_long', message: 'Cada reserva pode ter no máximo 2 h.' });
    expect(request(cAna, 'private', [[at(14, 0, 8), at(15, 0, 8)]])).toMatchObject({ ok: false, code: 'too_far', message: 'Só dá para reservar com até 7 dias de antecedência.' });
    expect(request(cAna, 'private', [[at(14), at(16)]]).ok).toBe(true);
    // 2 h ja usadas no dia + 2 h > 3 h
    const daily = request(cAna, 'private', [[at(17), at(19)]]);
    expect(daily).toMatchObject({ ok: false, code: 'daily_cap' });
    expect(daily.message).toContain('3 h');
    expect(request(cAna, 'private', [[at(14, 0, 1), at(15, 0, 1)]]).ok).toBe(true);
    const many = request(cAna, 'private', [[at(14, 0, 2), at(15, 0, 2)]]);
    expect(many).toMatchObject({ ok: false, code: 'too_many' });
    expect(many.message).toContain('Você já tem 2 reservas ativas');
    // cancelar abre vaga
    act(cAna, 'booking_cancel', { id: sync(cAna).mine[0]!.id });
    expect(request(cAna, 'private', [[at(14, 0, 2), at(15, 0, 2)]]).ok).toBe(true);
  });

  it('dono e admin da organizacao nao esbarram nos limites por pessoa', () => {
    act(cAdm, 'booking_limits_set', { limits: { ...DEFAULT_BOOKING_LIMITS, maxActivePerPerson: 1 } });
    expect(request(cAdm, 'private', [[at(14), at(15)]]).ok).toBe(true);
    expect(request(cAdm, 'private', [[at(16), at(17)]]).ok).toBe(true);
    expect(request(cBoss, 'private', [[at(18), at(19)]]).ok).toBe(true);
  });

  it('formato do horario: passado, grade de 5 min, ordem e duracao minima', () => {
    expect(request(cAna, 'private', [[at(9), at(10)]])).toMatchObject({ code: 'past' });
    expect(request(cAna, 'private', [[at(14, 3), at(15)]])).toMatchObject({ code: 'bad_time' });
    expect(request(cAna, 'private', [[at(15), at(14)]])).toMatchObject({ code: 'bad_time' });
    expect(request(cAna, 'private', [[at(14), at(14, 10)]])).toMatchObject({ code: 'too_short' });
  });

  it('estender +30: so sem conflito nem fila logo depois e respeitando o limite de duracao', () => {
    const a = slot0(request(cAna, 'private', [[at(14), at(15)]]));
    goTo(at(14, 5));
    join(cAna, 'private');
    goTo(at(14, 30));
    expect(act(cAna, 'booking_extend', { id: a.id }).ok).toBe(true);
    expect(sync(cAna).mine[0]!.endAt).toBe(at(15, 30));
    // fila logo depois bloqueia
    expect(slot0(request(cBia, 'private', [[at(15), at(16)]])).status).toBe('queued');
    expect(act(cAna, 'booking_extend', { id: a.id })).toMatchObject({ ok: false, code: 'extend_queue' });
    // reserva confirmada logo depois tambem
    request(cCris, 'private', [[at(17), at(18)]]);
    act(cBia, 'booking_cancel', { id: sync(cBia).mine[0]!.id });
    expect(act(cAna, 'booking_extend', { id: a.id }).ok).toBe(true); // ate 16:00
    expect(act(cAna, 'booking_extend', { id: a.id }).ok).toBe(true); // ate 16:30
    expect(act(cAna, 'booking_extend', { id: a.id }).ok).toBe(true); // ate 17:00
    expect(act(cAna, 'booking_extend', { id: a.id })).toMatchObject({ ok: false, code: 'extend_blocked' }); // 17:30 bate com a reserva das 17:00
    // aviso de "termina em 5 min" volta a valer depois de estender
    goTo(at(16, 55));
    expect(cAna.notices('ends_soon').length).toBeGreaterThanOrEqual(1);
  });

  it('estender respeita o maximo de duracao de quem nao administra', () => {
    act(cAdm, 'booking_limits_set', { limits: { ...DEFAULT_BOOKING_LIMITS, maxDurationMin: 60 } });
    const a = slot0(request(cAna, 'private', [[at(14), at(15)]]));
    goTo(at(14, 10));
    expect(act(cAna, 'booking_extend', { id: a.id })).toMatchObject({ ok: false, code: 'too_long' });
  });
});

describe('editar', () => {
  it('muda titulo e convidados (novos convidados sao avisados); mudar horario com conflito sugere outro', () => {
    const a = slot0(request(cAna, 'private', [[at(14), at(15)]], 'Antes'));
    request(cBia, 'private', [[at(16), at(17)]]);
    expect(act(cAna, 'booking_edit', { id: a.id, title: 'Depois', guests: ['Cris'] }).ok).toBe(true);
    expect(cCris.notices('invited')).toHaveLength(1);
    expect(sync(cAna).mine[0]).toMatchObject({ title: 'Depois', guests: ['Cris'] });
    expect(act(cAna, 'booking_edit', { id: a.id, guests: ['Fantasma'] })).toMatchObject({ ok: false, code: 'unknown_person' });
    expect(act(cAna, 'booking_edit', { id: a.id, guests: ['Gui'] })).toMatchObject({ ok: false, code: 'unknown_person' }); // visitante nao e convidado
    const clash = act(cAna, 'booking_edit', { id: a.id, startAt: at(15, 30), endAt: at(16, 30) });
    expect(clash).toMatchObject({ ok: false, code: 'conflict' });
    expect(clash.message).toContain('Próxima janela livre');
    expect(act(cAna, 'booking_edit', { id: a.id, startAt: at(15), endAt: at(16) }).ok).toBe(true);
    // liberou 14-15: quem estava na fila ali sobe
    request(cCris, 'private', [[at(14, 30), at(15, 30)]]);
    expect(sync(cCris).mine.find((m) => m.startAt === at(14, 30))).toMatchObject({ status: 'queued' });
    act(cAna, 'booking_edit', { id: a.id, startAt: at(17), endAt: at(18) });
    expect(sync(cCris).mine.find((m) => m.startAt === at(14, 30))).toMatchObject({ status: 'confirmed' });
  });

  it('convidados ate a capacidade da sala', () => {
    const a = slot0(request(cAna, 'private', [[at(14), at(15)]]));
    // a Sala Privada comporta 4: dono + 3 convidados
    expect(act(cAna, 'booking_edit', { id: a.id, guests: ['Bia', 'Cris', 'Chefe', 'Admin'] })).toMatchObject({ ok: false, code: 'too_many_guests' });
    expect(act(cAna, 'booking_edit', { id: a.id, guests: ['Bia', 'Cris', 'Chefe'] }).ok).toBe(true);
  });

  it('remover convidado tira o acesso na hora (ele e levado para fora)', () => {
    const a = slot0(request(cAna, 'private', [[at(14), at(16)]], 'x', ['Bia']));
    goTo(at(14, 5));
    join(cBia, 'private');
    expect(cBia.room).toBe('private');
    act(cAna, 'booking_edit', { id: a.id, guests: [] });
    expect(cBia.room).toBe('reception');
  });
});

describe('privacidade e isolamento', () => {
  it('quem nao tem acesso ve so "ocupada": sem titulo, dono, convidados, e-mail ou id de conta', () => {
    const a = slot0(request(cAna, 'private', [[at(14), at(15)]], 'Demissão do Pedro', ['Bia']));
    request(cCris, 'private', [[at(14, 30), at(15, 30)]], 'Título da fila');
    const spy = sync(cGui.accountId ? cAna : cAna); // so para ter a conta
    expect(spy.blocks[0]).toMatchObject({ title: 'Demissão do Pedro', ownerName: 'Ana', guests: ['Bia'], mine: true });
    const stranger = sync(cBia.accountId ? cCris : cCris);
    expect(stranger.blocks).toEqual([{ id: a.id, startAt: at(14), endAt: at(15), state: 'busy', mine: false }]);
    const json = JSON.stringify(stranger);
    for (const secret of ['Demissão', 'x.com', ana.id, bia.id, cris.id, boss.id]) expect(json, secret).not.toContain(secret);
    // a fila mostra nomes, mas o titulo so para o dono da entrada e para a administracao
    const q = sync(cBia).queue;
    expect(q).toEqual([{ id: expect.any(String), startAt: at(14, 30), endAt: at(15, 30), position: 1, ownerName: 'Cris', mine: false }]);
    expect(sync(cCris).queue[0]!.title).toBe('Título da fila');
    expect(sync(cAdm).queue[0]!.title).toBe('Título da fila');
    // convidado ve detalhes
    expect(sync(cBia).blocks[0]).toMatchObject({ title: 'Demissão do Pedro', guests: ['Bia'], mine: true });
    expect(sync(cAdm).blocks[0]).toMatchObject({ title: 'Demissão do Pedro', mine: false });
  });

  it('outra organizacao: nao ve, nao cancela, nao decide, nao convida e tem as proprias salas', () => {
    const cOut = connect(outsider, 'orgB');
    const a = slot0(request(cAna, 'private', [[at(14), at(15)]]));
    expect(sync(cOut).blocks).toEqual([]);
    expect(act(cOut, 'booking_cancel', { id: a.id })).toMatchObject({ ok: false, code: 'not_found' });
    expect(act(cOut, 'booking_extend', { id: a.id })).toMatchObject({ ok: false, code: 'not_found' });
    expect(act(cOut, 'booking_edit', { id: a.id, title: 'x' })).toMatchObject({ ok: false, code: 'not_found' });
    // pessoas de outra org nao sao convidadas pelo nome
    expect(request(cAna, 'private', [[at(16), at(17)]], 'x', ['Forasteiro'])).toMatchObject({ ok: false, code: 'unknown_person' });
    // a mesma sala (mesmo id) da outra org continua com as regras dela; reservar la nao conflita
    expect(slot0(request(cOut, 'private', [[at(14), at(15)]])).status).toBe('confirmed');
    goTo(at(14, 10));
    expect(sync(cAna).mine[0]!.status).toBe('confirmed');
    const room = world.org('orgB').rooms.get('private')!;
    expect(room.built.def.access).toBe('private');
    expect(store.bookings.ofOrg('orgB')).toHaveLength(1);
    expect(store.bookings.ofOrg('orgA')).toHaveLength(1);
  });

  it('a administracao de outra org nao decide pedidos desta', () => {
    const o2 = account('DonaB');
    member('orgB', o2, 'owner');
    const cB = connect(o2, 'orgB');
    act(cAdm, 'booking_room_set', { roomId: 'private', bookable: true, requiresApproval: true });
    const a = slot0(request(cAna, 'private', [[at(14), at(15)]]));
    expect(act(cB, 'booking_decide', { id: a.id, approve: true })).toMatchObject({ ok: false, code: 'not_found' });
    expect(sync(cAna).mine[0]!.status).toBe('pending');
  });

  it('recepcao e escritorio nunca sao reservaveis; a sala so e reservavel quando a organizacao liga', () => {
    expect(request(cAna, 'reception', [[at(14), at(15)]])).toMatchObject({ ok: false, code: 'not_bookable' });
    expect(request(cAna, 'meeting1', [[at(14), at(15)]])).toMatchObject({ ok: false, code: 'not_bookable' });
    expect(request(cAna, 'sala-inexistente', [[at(14), at(15)]])).toMatchObject({ ok: false, code: 'not_bookable' });
    expect(act(cAdm, 'booking_room_set', { roomId: 'office', bookable: true, requiresApproval: false })).toMatchObject({ ok: false, code: 'room' });
    expect(sync(cAna).rooms.map((r) => r.roomId)).toEqual(['private']);
    act(cAdm, 'booking_room_set', { roomId: 'meeting1', bookable: true, requiresApproval: false });
    expect(sync(cAna).rooms.map((r) => r.roomId).sort()).toEqual(['meeting1', 'private']);
    // desligar cancela as reservas vivas da sala
    const m = slot0(request(cAna, 'meeting1', [[at(14), at(15)]]));
    act(cAdm, 'booking_room_set', { roomId: 'meeting1', bookable: false, requiresApproval: false });
    expect(sync(cAna).mine.find((x) => x.id === m.id)).toMatchObject({ status: 'cancelled' });
    expect(cAna.notices('cancelled')).toHaveLength(1);
  });
});

describe('validacao estrita e taxa', () => {
  const bad: Array<[string, Record<string, unknown>]> = [
    ['sync sem tempos', { t: 'booking_sync' }],
    ['sync janela invertida', { t: 'booking_sync', from: 10, to: 5 }],
    ['sync janela enorme', { t: 'booking_sync', from: 0, to: 40 * BOOKING_DAY }],
    ['sync tempo nao inteiro', { t: 'booking_sync', from: 0.5, to: 100 }],
    ['request sem slots', { t: 'booking_request', rid: 1, roomId: 'private', slots: [], title: 'x' }],
    ['request slot invalido', { t: 'booking_request', rid: 1, roomId: 'private', slots: [{ startAt: 'a', endAt: 2 }], title: 'x' }],
    ['request titulo numero', { t: 'booking_request', rid: 1, roomId: 'private', slots: [{ startAt: 1, endAt: 2 }], title: 5 }],
    ['request titulo enorme', { t: 'booking_request', rid: 1, roomId: 'private', slots: [{ startAt: 1, endAt: 2 }], title: 'x'.repeat(500) }],
    ['request convidados nao lista', { t: 'booking_request', rid: 1, roomId: 'private', slots: [{ startAt: 1, endAt: 2 }], title: 'x', guests: 'Bia' }],
    ['request sala vazia', { t: 'booking_request', rid: 1, roomId: '', slots: [{ startAt: 1, endAt: 2 }], title: 'x' }],
    ['request rid decimal', { t: 'booking_request', rid: 1.5, roomId: 'private', slots: [{ startAt: 1, endAt: 2 }], title: 'x' }],
    ['cancel sem id', { t: 'booking_cancel', rid: 1 }],
    ['edit so com inicio', { t: 'booking_edit', rid: 1, id: 'x', startAt: 5 }],
    ['decide approve nao booleano', { t: 'booking_decide', rid: 1, id: 'x', approve: 'sim' }],
    ['room_set bookable texto', { t: 'booking_room_set', rid: 1, roomId: 'private', bookable: 'sim', requiresApproval: false }],
    ['limits fora da faixa', { t: 'booking_limits_set', rid: 1, limits: { ...DEFAULT_BOOKING_LIMITS, maxDurationMin: 5 } }],
    ['limits sem campo', { t: 'booking_limits_set', rid: 1, limits: { maxDurationMin: 60 } }],
  ];
  it.each(bad)('%s conta uma advertencia', (_n, msg) => {
    const before = cAdm.strikes;
    send(cAdm, msg);
    expect(cAdm.strikes).toBe(before + 1);
  });

  it('muitas acoes seguidas levam rate_limited, sem criar reservas demais', () => {
    act(cAdm, 'booking_limits_set', { limits: { ...DEFAULT_BOOKING_LIMITS, maxActivePerPerson: 20 } });
    const results: string[] = [];
    for (let i = 0; i < 30; i++) results.push(request(cAna, 'private', [[at(8 + (i % 8), 0, 1 + Math.floor(i / 8)), at(9 + (i % 8), 0, 1 + Math.floor(i / 8))]]).code ?? 'ok');
    expect(results).toContain('rate_limited');
    expect(results.filter((r) => r === 'ok').length).toBeLessThan(15);
    // some o limite depois de um tempo
    now += 10_000;
    expect(request(cAna, 'private', [[at(18, 0, 10), at(19, 0, 10)]]).code).not.toBe('rate_limited');
  });

  it('texto livre e limpo (controle/bidi/zero-width) e limitado a 60 caracteres', () => {
    const r = slot0(request(cAna, 'private', [[at(14), at(15)]], `  Reuni​ão‮   ${'a'.repeat(100)}`));
    const title = sync(cAna).mine[0]!.title;
    expect(r.ok).toBe(true);
    expect(title.length).toBeLessThanOrEqual(60);
    expect(title).not.toMatch(/[​‮]/);
    expect(request(cAna, 'private', [[at(16), at(17)]], '   ')).toMatchObject({ ok: false, code: 'title' });
  });
});

describe('persistencia e reinicio', () => {
  it('um servidor novo sobre o mesmo armazenamento continua a agenda: acesso, fila e fim da janela', () => {
    const a = slot0(request(cAna, 'private', [[at(14), at(16)]], 'x', ['Bia']));
    request(cCris, 'private', [[at(15), at(16)]]);
    goTo(at(14, 5));
    join(cAna, 'private');
    goTo(at(14, 30));
    expect(cAna.notices('started')).toHaveLength(1);
    // reinicio: novo mundo, mesmo store e mesmo relogio
    world = new World({ store, clock: () => now });
    const cAna2 = connect(ana, 'orgA');
    const cCris2 = connect(cris, 'orgA');
    join(cAna2, 'private');
    expect(cAna2.room).toBe('private');
    // nao repete o aviso "comecou"
    goTo(at(14, 40));
    expect(cAna2.notices('started')).toHaveLength(0);
    join(cCris2, 'private');
    expect(cCris2.room).toBe('reception');
    // o fim passou enquanto "o servidor estava fora": ao voltar, a reserva termina e a fila expira sem travar
    now = at(17);
    world = new World({ store, clock: () => now });
    world.tick(now);
    expect(store.bookings.get(a.id!)!.status).toBe('ended');
    expect(store.bookings.ofOwner('orgA', cris.id)[0]!.status).toBe('expired');
  });

  it('limpeza: reservas terminadas ha mais de 90 dias somem; as recentes ficam', () => {
    const a = slot0(request(cAna, 'private', [[at(14), at(15)]]));
    goTo(at(14, 5));
    join(cAna, 'private');
    goTo(at(15, 1));
    expect(store.bookings.get(a.id!)!.status).toBe('ended');
    now = at(15) + 89 * BOOKING_DAY;
    world.tick(now);
    expect(store.bookings.get(a.id!)).toBeDefined();
    now = at(15) + 91 * BOOKING_DAY;
    world.tick(now + 3_600_000);
    expect(store.bookings.get(a.id!)).toBeUndefined();
  });
});

describe('contas fora da organizacao', () => {
  it('dono que deixa a organizacao perde a vaga na fila; reserva dele nao trava ninguem', () => {
    const a = slot0(request(cAna, 'private', [[at(14), at(16)]]));
    const q = slot0(request(cBia, 'private', [[at(15), at(16)]]));
    store.orgs.putMember({ orgId: 'orgA', accountId: bia.id, role: 'member', teamId: null, status: 'suspended', createdAt: 0 });
    act(cAna, 'booking_cancel', { id: a.id });
    expect(store.bookings.get(q.id!)!.status).toBe('expired');
  });
});
