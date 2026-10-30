import { beforeEach, describe, expect, it } from 'vitest';
import { BOOKING_DAY, BOOKING_HOUR, BOOKING_MINUTE, ROOM_DEFS, type ClientMessage, type Role, type ServerMessage } from '@workverse/shared';
import { World, type Connection } from '../src/world';
import { MemoryAccountStore, type Account } from '../src/store';

/**
 * Corredor / Hall 2 e as salas que saem dele: entrada, acesso padrao (a Diretoria so com convite, equipe ou chefia), reserva padrao
 * (Treinamento e RH reservaveis; a Diretoria nunca) e a travessia pelos portais.
 */
class FakeConn implements Connection {
  strikes = 0;
  accountId?: string;
  player?: Connection['player'];
  inbox: ServerMessage[] = [];
  send(msg: ServerMessage) {
    this.inbox.push(msg);
  }
  close() {}
  last<T extends ServerMessage['t']>(t: T) {
    return [...this.inbox].reverse().find((m) => m.t === t) as Extract<ServerMessage, { t: T }> | undefined;
  }
  get room() {
    return this.player?.roomId ?? null;
  }
}

const T0 = Date.UTC(2026, 9, 20, 15, 0, 0);
let now = T0;
let store: MemoryAccountStore;
let world: World;
let rid = 0;
const at = (h: number, m = 0, d = 0) => T0 + d * BOOKING_DAY + (h - 12) * BOOKING_HOUR + m * BOOKING_MINUTE;

function account(name: string): Account {
  const a = store.create({ email: `${name.toLowerCase()}@x.com`, displayName: name, passwordHash: 'scrypt$x' });
  a.orgsInit = true;
  store.save(a);
  return a;
}
function member(acc: Account, role: Role, team: string | null = null) {
  store.orgs.putMember({ orgId: 'orgA', accountId: acc.id, role, teamId: team ? `orgA-${team}` : null, status: 'active', createdAt: 0 });
}
function connect(acc: Account, roomId = 'reception'): FakeConn {
  const c = new FakeConn();
  c.accountId = acc.id;
  world.handle(c, { t: 'hello', orgId: 'orgA' });
  world.handle(c, { t: 'join', roomId });
  return c;
}
const send = (c: FakeConn, msg: Record<string, unknown>) => world.handle(c, msg as unknown as ClientMessage);
const join = (c: FakeConn, roomId: string) => send(c, { t: 'join', roomId });
const act = (c: FakeConn, t: string, extra: Record<string, unknown> = {}) => {
  send(c, { t, rid: ++rid, ...extra });
  return c.last('booking_result')!;
};
const request = (c: FakeConn, roomId: string) => act(c, 'booking_request', { roomId, slots: [{ startAt: at(14), endAt: at(15) }], title: 'Treino' });

const NEW_IDS = ['training', 'rh', 'board', 'lab', 'cafeteria', 'games', 'terrace', 'library', 'studio'].filter((id) => ROOM_DEFS.some((d) => d.id === id));

let cBoss: FakeConn, cAdm: FakeConn, cAna: FakeConn, cDir: FakeConn, cGuest: FakeConn;

beforeEach(() => {
  now = T0;
  rid = 0;
  store = new MemoryAccountStore();
  world = new World({ store, clock: () => now });
  store.orgs.putOrg({ id: 'orgA', slug: 'orga', name: 'Org A', settings: {}, createdAt: 0 });
  store.orgs.putTeam({ id: 'orgA-alfa', orgId: 'orgA', name: 'Alfa', color: '#ff0000' });
  store.orgs.putTeam({ id: 'orgA-dir', orgId: 'orgA', name: 'Diretoria', color: '#00ff00' });
  const boss = account('Chefe');
  const adm = account('Admin');
  const ana = account('Ana');
  const dir = account('Dira');
  const gui = account('Gui');
  member(boss, 'owner');
  member(adm, 'admin');
  member(ana, 'member', 'alfa');
  member(dir, 'member', 'dir');
  member(gui, 'guest');
  cBoss = connect(boss);
  cAdm = connect(adm);
  cAna = connect(ana);
  cDir = connect(dir);
  cGuest = connect(gui);
});

describe('Hall 2: travessia', () => {
  it('a recepcao leva ao corredor e o corredor leva a cada sala nova, e cada uma volta ao corredor', () => {
    const reception = ROOM_DEFS.find((d) => d.id === 'reception')!;
    expect(reception.portals.find((p) => p.toRoom === 'hall2')).toMatchObject({ x: 0, y: 1, toRoom: 'hall2' });
    join(cBoss, 'hall2');
    expect(cBoss.room).toBe('hall2');
    for (const id of NEW_IDS) {
      join(cBoss, id);
      expect(cBoss.room, id).toBe(id);
      const def = ROOM_DEFS.find((d) => d.id === id)!;
      expect(def.portals.find((p) => p.toRoom === 'hall2'), id).toBeDefined();
      join(cBoss, 'hall2');
      expect(cBoss.room).toBe('hall2');
    }
  });

  it('visitantes (guest) nao entram no corredor nem nas salas novas', () => {
    join(cGuest, 'hall2');
    expect(cGuest.room).toBe('reception');
    for (const id of NEW_IDS) {
      join(cGuest, id);
      expect(cGuest.room, id).toBe('reception');
    }
  });
});

describe('acesso padrao', () => {
  it('as salas abertas da organizacao admitem qualquer membro', () => {
    for (const id of NEW_IDS.filter((x) => x !== 'board')) {
      join(cAna, id);
      expect(cAna.room, id).toBe(id);
    }
  });

  it('a Diretoria so admite chefia, a equipe Diretoria ou convite', () => {
    if (!NEW_IDS.includes('board')) return;
    join(cAna, 'board');
    expect(cAna.room).toBe('reception');
    expect(world.roomListFor(cAna.player!).find((r) => r.id === 'board')).toMatchObject({ locked: true, access: 'invited' });
    for (const c of [cBoss, cAdm, cDir]) {
      join(c, 'board');
      expect(c.room).toBe('board');
    }
    // convite: o dono convida a Ana e ela entra
    send(cBoss, { t: 'room_invite_add', rid: ++rid, roomId: 'board', who: 'Ana' });
    join(cAna, 'board');
    expect(cAna.room).toBe('board');
  });
});

describe('reserva padrao', () => {
  it('Treinamento e RH podem ser reservados sem configurar nada; a Diretoria nunca, nem se a organizacao tentar', () => {
    for (const id of ['training', 'rh'].filter((x) => NEW_IDS.includes(x))) {
      const r = request(cAna, id);
      expect(r, id).toMatchObject({ ok: true });
    }
    if (!NEW_IDS.includes('board')) return;
    expect(request(cAna, 'board')).toMatchObject({ ok: false, code: 'not_bookable' });
    expect(act(cBoss, 'booking_room_set', { roomId: 'board', bookable: true, requiresApproval: false })).toMatchObject({ ok: false });
    expect(request(cAna, 'board')).toMatchObject({ ok: false, code: 'not_bookable' });
    // o corredor tambem nunca e reservavel
    expect(act(cBoss, 'booking_room_set', { roomId: 'hall2', bookable: true, requiresApproval: false })).toMatchObject({ ok: false });
  });
});

describe('jogos e self-service', () => {
  const wait = (ms: number) => {
    const end = now + ms;
    while (now < end) {
      now += 100;
      world.tick(now);
    }
  };
  const interact = (c: FakeConn, f: { id: string; x: number; y: number }) => world.handle(c, { t: 'interact', furniId: f.id, x: f.x, y: f.y });
  const piece = (room: string, kind: string) => ROOM_DEFS.find((d) => d.id === room)?.furniture.find((f) => f.kind === kind);

  for (const [room, kind] of [['games', 'arcade'], ['games', 'pingpong'], ['games', 'foosball']] as const) {
    it(`${kind}: usar mostra o balao de quem joga, anima a peca e a apaga depois`, () => {
      const f = piece(room, kind);
      if (!f) return;
      join(cAna, room);
      join(cBoss, room);
      interact(cAna, f);
      for (let i = 0; i < 80 && cBoss.last('chat')?.kind !== 'say'; i++) wait(100);
      expect(cBoss.last('chat')).toMatchObject({ kind: 'say', id: cAna.player!.id });
      expect(world.org('orgA').rooms.get(room)!.furniState[f.id]).toBe(true);
      wait(5000);
      expect(world.org('orgA').rooms.get(room)!.furniState[f.id]).toBe(false);
    });
  }

  it('o self-service do refeitorio entrega uma refeicao com frase propria', () => {
    const f = piece('cafeteria', 'buffet');
    if (!f) return;
    join(cAna, 'cafeteria');
    join(cBoss, 'cafeteria');
    interact(cAna, f);
    wait(6000);
    expect(cAna.player!.activity).toBe('holding:meal');
    expect(cBoss.last('chat')).toMatchObject({ kind: 'system', text: 'Ana se serviu no self-service.' });
  });
});

describe('Biblioteca silenciosa', () => {
  it('ninguem recebe direito de publicar audio ou video na biblioteca, e nas outras salas sim', async () => {
    const { publishRights } = await import('../src/mediaEconomy');
    if (!NEW_IDS.includes('library')) return;
    join(cBoss, 'library');
    expect(publishRights('library', cBoss.player!)).toBe('none');
    expect(publishRights('library', cAna.player!, 'room')).toBe('none');
    expect(publishRights('training', cAna.player!)).toBe('all');
    expect(ROOM_DEFS.find((d) => d.id === 'library')!.description).toMatch(/Silêncio/);
  });
});
