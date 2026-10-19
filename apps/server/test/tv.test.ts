import { beforeEach, describe, expect, it } from 'vitest';
import { ROOM_DEFS, checkOps, newPieceId, type ClientMessage, type Deck, type Furniture, type Role, type ServerMessage } from '@workverse/shared';
import { World, type Connection } from '../src/world';
import { MemoryAccountStore, type Account } from '../src/store';
import { publishRights, sourcesFor, type PublishRights } from '../src/media';

/** TV on a stand in the meeting rooms: same presentation system as the auditorium, one presenter per room. */

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
  all<T extends ServerMessage['t']>(t: T) {
    return this.inbox.filter((m) => m.t === t) as Extract<ServerMessage, { t: T }>[];
  }
  last<T extends ServerMessage['t']>(t: T) {
    return this.all(t).at(-1);
  }
  errors() {
    return this.all('error').map((e) => e.code);
  }
}

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const M1 = 'meeting1';

let now = 1_700_000_000_000;
let store: MemoryAccountStore;
let world: World;
let syncs: { org?: string; room: string; id: string; rights: PublishRights }[];

function account(name: string): Account {
  const a = store.create({ email: `${name.toLowerCase()}@x.com`, displayName: name, passwordHash: 'scrypt$x' });
  a.orgsInit = true;
  store.save(a);
  return a;
}
function org(id: string) {
  store.orgs.putOrg({ id, slug: id.toLowerCase(), name: `Org ${id}`, settings: {}, createdAt: 0 });
}
function enter(orgId: string, name: string, role: Role = 'member', roomId = M1): FakeConn {
  const acc = account(`${name}-${orgId}`);
  store.orgs.putMember({ orgId, accountId: acc.id, role, teamId: null, status: 'active', createdAt: 0 });
  const c = new FakeConn();
  c.accountId = acc.id;
  world.handle(c, { t: 'hello', orgId });
  world.handle(c, { t: 'join', roomId });
  return c;
}
const send = (c: FakeConn, msg: Record<string, unknown>) => world.handle(c, msg as unknown as ClientMessage);
const stageOf = (orgId = 'orgA') => world.org(orgId).stage;
const deck = (orgId = 'orgA', n = 2): Deck => ({
  title: 'Reunião',
  slides: Array.from({ length: n }, () => {
    const r = stageOf(orgId).addImage(M1, Buffer.from(PNG), 'image/png');
    if (!r.ok) throw new Error(r.error);
    return { kind: 'image' as const, imageId: r.id };
  }),
});
const tvOn = (c: FakeConn) => {
  const tv = ROOM_DEFS.find((r) => r.id === M1)!.furniture.find((f) => f.kind === 'tv_stand')!;
  const snap = c.all('furni').filter((m) => m.id === tv.id).at(-1);
  return snap?.on ?? false;
};

beforeEach(() => {
  now = 1_700_000_000_000;
  syncs = [];
  store = new MemoryAccountStore();
  world = new World({ store, clock: () => now, permissionSync: (room, id, rights, orgId) => syncs.push({ org: orgId, room, id, rights }) });
  org('orgA');
  org('orgB');
});

describe('the TV in the meeting rooms', () => {
  it('exists in meeting 1, meeting 2 and the team room, and each is a TV room', () => {
    const a = world.org('orgA').stage;
    for (const id of ['meeting1', 'meeting2', 'team']) {
      expect(ROOM_DEFS.find((r) => r.id === id)!.furniture.filter((f) => f.kind === 'tv_stand')).toHaveLength(1);
      expect(a.isTvRoom(id), id).toBe(true);
      expect(a.isStageRoom(id), id).toBe(false);
    }
    expect(a.isTvRoom('office')).toBe(false);
    expect(a.isStageRoom('auditorium')).toBe(true);
    expect(a.isTvRoom('auditorium')).toBe(false);
  });
});

describe('taking and leaving the TV', () => {
  it('gives the TV to the first person, refuses the second, and frees it when released', () => {
    const ana = enter('orgA', 'Ana');
    const beto = enter('orgA', 'Beto');
    send(ana, { t: 'stage_take' });
    expect(ana.last('stage')!.stage).toMatchObject({ mode: 'tv', speakerName: 'Ana-orgA' });
    expect(beto.last('stage')!.stage.speakerId).toBe(ana.player!.id);
    expect(tvOn(beto)).toBe(true);
    send(beto, { t: 'stage_take' });
    expect(beto.errors()).toContain('stage_busy');
    send(beto, { t: 'stage_release' });
    expect(beto.errors()).toContain('not_speaker');
    send(ana, { t: 'stage_release' });
    expect(beto.last('stage')!.stage.speakerId).toBeNull();
    expect(tvOn(beto)).toBe(false);
    send(beto, { t: 'stage_take' });
    expect(ana.last('stage')!.stage.speakerName).toBe('Beto-orgA');
  });

  it('is taken by walking to the TV and using it', () => {
    const ana = enter('orgA', 'Ana');
    const tv = ROOM_DEFS.find((r) => r.id === M1)!.furniture.find((f) => f.kind === 'tv_stand')!;
    send(ana, { t: 'interact', furniId: tv.id, x: tv.x, y: tv.y });
    for (let i = 0; i < 120 && !ana.last('stage')?.stage.speakerId; i++) {
      now += 200;
      world.tick();
    }
    expect(ana.last('stage')!.stage.speakerId).toBe(ana.player!.id);
  });

  it('is lost when the presenter leaves the room, disconnects or goes away', () => {
    const ana = enter('orgA', 'Ana');
    const beto = enter('orgA', 'Beto');
    send(ana, { t: 'stage_take' });
    world.enterRoom(ana.player!, 'office');
    expect(beto.last('stage')!.stage.speakerId).toBeNull();
    expect(tvOn(beto)).toBe(false);

    send(beto, { t: 'stage_take' });
    world.disconnect(beto);
    const cris = enter('orgA', 'Cris');
    expect(cris.last('stage')!.stage.speakerId).toBeNull();

    send(cris, { t: 'stage_take' });
    send(cris, { t: 'status', status: 'away' });
    const dani = enter('orgA', 'Dani');
    expect(dani.last('stage')!.stage.speakerId).toBeNull();
  });

  it('refuses people who are not in a presentation room, and never reaches another room', () => {
    const outside = enter('orgA', 'Fora', 'member', 'office');
    send(outside, { t: 'stage_take' });
    expect(outside.errors()).toContain('not_stage_room');
    const ana = enter('orgA', 'Ana', 'member', 'meeting2');
    send(ana, { t: 'stage_take' });
    const beto = enter('orgA', 'Beto');
    expect(beto.last('stage')!.stage.speakerId).toBeNull(); // meeting 1 is its own TV
    expect(stageOf().view('meeting2')!.speakerId).toBe(ana.player!.id);
    expect(stageOf().view('office')).toBeNull();
  });

  it('has no open stage, raised hands or voices (those belong to the auditorium)', () => {
    const ana = enter('orgA', 'Ana');
    const beto = enter('orgA', 'Beto');
    send(ana, { t: 'stage_take' });
    send(beto, { t: 'hand_raise' });
    send(ana, { t: 'stage_open' });
    send(ana, { t: 'voice_grant', id: beto.player!.id });
    expect(beto.errors()).toContain('tv_room');
    expect(ana.errors().filter((c) => c === 'tv_room')).toHaveLength(2);
    expect(ana.last('stage')!.stage).toMatchObject({ open: false, hands: [], voices: [] });
  });

  it('lets only owners and admins take a busy TV by force, with a strict message', () => {
    const ana = enter('orgA', 'Ana');
    const membro = enter('orgA', 'Membro');
    const admin = enter('orgA', 'Admin', 'admin');
    send(ana, { t: 'stage_take' });
    send(membro, { t: 'stage_take', force: true });
    expect(membro.errors()).toContain('stage_busy');
    expect(ana.last('stage')!.stage.speakerId).toBe(ana.player!.id);
    send(admin, { t: 'stage_take', force: 'sim' });
    expect(admin.errors()).toContain('bad_message');
    send(admin, { t: 'stage_take', force: true });
    expect(ana.last('stage')!.stage.speakerId).toBe(admin.player!.id);
    expect(syncs.some((s) => s.id === ana.player!.id && s.rights === 'av')).toBe(true); // the former presenter went back to viewer rights
    const dono = enter('orgA', 'Dono', 'owner');
    send(dono, { t: 'stage_take', force: true });
    expect(admin.last('stage')!.stage.speakerId).toBe(dono.player!.id);
  });

  it('does not let `force` take the auditorium stage', () => {
    const ana = enter('orgA', 'Ana', 'member', 'auditorium');
    const dono = enter('orgA', 'Dono', 'owner', 'auditorium');
    send(ana, { t: 'stage_take' });
    send(dono, { t: 'stage_take', force: true });
    expect(dono.errors()).toContain('stage_busy');
    expect(ana.last('stage')!.stage).toMatchObject({ mode: 'stage', speakerId: ana.player!.id });
  });
});

describe('who may publish in a TV room', () => {
  it('the presenter publishes everything; the rest of the meeting keeps mic and camera but cannot share a screen', () => {
    const ana = enter('orgA', 'Ana');
    const beto = enter('orgA', 'Beto');
    const w = world.org('orgA').stage;
    expect(publishRights(M1, beto.player!, 'stage', w)).toBe('av'); // nobody presents yet: still no screen share
    send(ana, { t: 'stage_take' });
    expect(publishRights(M1, ana.player!, 'stage', w)).toBe('all');
    expect(publishRights(M1, beto.player!, 'stage', w)).toBe('av');
    expect(sourcesFor('av').length).toBe(2);
    expect(sourcesFor('av')).not.toContain(sourcesFor('all')[2]);
    expect(syncs.find((s) => s.id === ana.player!.id && s.rights === 'all')).toBeTruthy();
    send(ana, { t: 'stage_release' });
    expect(publishRights(M1, ana.player!, 'stage', w)).toBe('av');
  });

  it('keeps ordinary rooms unrestricted and the auditorium as it was', () => {
    const ana = enter('orgA', 'Ana', 'member', 'office');
    const w = world.org('orgA').stage;
    expect(publishRights('office', ana.player!, 'room', w)).toBe('all');
    const bia = enter('orgA', 'Bia', 'member', 'auditorium');
    const cris = enter('orgA', 'Cris', 'member', 'auditorium');
    expect(publishRights('auditorium', bia.player!, 'stage', w)).toBe('none');
    send(bia, { t: 'stage_take' });
    expect(publishRights('auditorium', bia.player!, 'stage', w)).toBe('all');
    expect(publishRights('auditorium', cris.player!, 'stage', w)).toBe('none');
    send(cris, { t: 'hand_raise' });
    expect(cris.last('stage')!.stage.hands).toHaveLength(1);
    send(bia, { t: 'voice_grant', id: cris.player!.id });
    expect(publishRights('auditorium', cris.player!, 'stage', w)).toBe('audio');
  });
});

describe('the deck of a TV', () => {
  it('is set, goes live, follows the slide and survives leaving and coming back; a different person starts clean', () => {
    const ana = enter('orgA', 'Ana');
    const beto = enter('orgA', 'Beto');
    send(ana, { t: 'stage_take' });
    send(ana, { t: 'deck_set', deck: deck() });
    expect(beto.last('deck')?.deck ?? null).toBeNull(); // private until live
    send(ana, { t: 'present_start' });
    expect(beto.last('deck')!.deck!.slides).toHaveLength(2);
    send(ana, { t: 'slide_goto', index: 1 });
    expect(beto.last('slide')!.state).toEqual({ live: true, index: 1 });
    send(beto, { t: 'slide_goto', index: 0 });
    expect(beto.errors()).toContain('not_speaker');
    send(beto, { t: 'deck_set', deck: deck() });
    expect(beto.errors()).toContain('not_speaker');

    send(ana, { t: 'stage_release' }); // closing the panel / stepping down keeps the deck for the same account
    expect(beto.last('slide')!.state.live).toBe(false);
    send(ana, { t: 'stage_take' });
    expect(ana.last('deck')!.deck!.slides).toHaveLength(2);
    expect(ana.last('slide')!.state.index).toBe(1);

    send(ana, { t: 'stage_release' });
    send(beto, { t: 'stage_take' });
    expect(beto.last('deck')!.deck).toBeNull();
  });

  it('serves slide images to the room only while live, and only the presenter uploads', () => {
    const ana = enter('orgA', 'Ana');
    const beto = enter('orgA', 'Beto');
    const w = stageOf();
    send(ana, { t: 'stage_take' });
    const d = deck();
    const id = d.slides[0].imageId;
    expect(w.getImage(M1, beto.player!, id)).toBeUndefined();
    expect(w.getImage(M1, ana.player!, id)).toBeDefined();
    send(ana, { t: 'deck_set', deck: d });
    send(ana, { t: 'present_start' });
    expect(w.getImage(M1, beto.player!, id)).toBeDefined();
  });
});

describe('isolation between organizations', () => {
  it('keeps the TV, the deck and the images of each organization apart', () => {
    const ana = enter('orgA', 'Ana');
    const bia = enter('orgB', 'Bia');
    send(ana, { t: 'stage_take' });
    const d = deck('orgA');
    send(ana, { t: 'deck_set', deck: d });
    send(ana, { t: 'present_start' });

    expect(bia.last('stage')!.stage.speakerId).toBeNull(); // the same room id, another organization
    expect(tvOn(bia)).toBe(false);
    expect(bia.last('deck')?.deck ?? null).toBeNull();
    expect(stageOf('orgB').getImage(M1, bia.player!, d.slides[0].imageId)).toBeUndefined();
    send(bia, { t: 'stage_take' });
    expect(bia.errors()).not.toContain('stage_busy');
    expect(stageOf('orgB').view(M1)!.speakerId).toBe(bia.player!.id);
    expect(stageOf('orgA').view(M1)!.speakerId).toBe(ana.player!.id);
    // org B's owner cannot force org A's TV: he is not even in that organization
    const donoB = enter('orgB', 'Dono', 'owner');
    send(donoB, { t: 'stage_take', force: true });
    expect(stageOf('orgA').view(M1)!.speakerId).toBe(ana.player!.id);
  });
});

describe('a TV added or removed with the room editor', () => {
  it('turns a room into a TV room and back, without restarting', () => {
    const dono = enter('orgA', 'Dono', 'owner', 'lounge');
    const room = world.org('orgA').rooms.get('lounge')!;
    const base = world.org('orgA').baseDefs.get('lounge')!;
    expect(stageOf().isTvRoom('lounge')).toBe(false);
    send(dono, { t: 'stage_take' });
    expect(dono.errors()).toContain('not_stage_room');

    let piece: Furniture | undefined;
    for (let y = 0; y < room.built.grid.height && !piece; y++) {
      for (let x = 0; x < room.built.grid.width && !piece; x++) {
        const p: Furniture = { id: newPieceId(), kind: 'tv_stand', x, y, dir: 0 };
        if (checkOps(base, room.built.def.furniture, [{ op: 'add', piece: p }]).ok) piece = p;
      }
    }
    expect(piece).toBeDefined();
    send(dono, { t: 'furnish_apply', rid: 1, base: room.version, ops: [{ op: 'add', piece }] });
    expect(dono.last('furnish_result')?.ok, JSON.stringify(dono.last('furnish_result'))).toBe(true);
    expect(stageOf().isTvRoom('lounge')).toBe(true);
    send(dono, { t: 'stage_take' });
    expect(stageOf().view('lounge')!.speakerId).toBe(dono.player!.id);
  });
});
