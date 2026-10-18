import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import WebSocket from 'ws';
import { ROOM_DEFS, STAGE_LIMITS, STEP_MS, type ClientMessage, type Deck, type ServerMessage } from '@workverse/shared';
import { createApp } from '../src/app';
import { MemoryAccountStore } from '../src/store';
import { World, type Connection } from '../src/world';
import { canPublishIn, publishRights, resolveMediaConfig, type PublishRights } from '../src/media';

const AUD = 'auditorium';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

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

let now = 1_700_000_000_000;
let world: World;
let syncs: { room: string; id: string; rights: PublishRights }[];

beforeEach(() => {
  now = 1_700_000_000_000;
  syncs = [];
  world = new World({ store: new MemoryAccountStore(), allowDevLogin: true, clock: () => now, permissionSync: (room, id, rights) => syncs.push({ room, id, rights }) });
});

function enter(name: string, roomId = AUD): FakeConn {
  const c = new FakeConn();
  world.handle(c, { t: 'hello', name });
  world.handle(c, { t: 'join', roomId });
  return c;
}
const send = (c: FakeConn, msg: ClientMessage) => world.handle(c, msg);
/** Deck of `n` image slides whose images already live on the server (as after an upload). */
const deck = (n = 3, extra: Partial<Deck> = {}): Deck => ({
  title: 'Treinamento',
  slides: Array.from({ length: n }, () => {
    const r = world.stage.addImage(AUD, Buffer.from(PNG), 'image/png');
    if (!r.ok) throw new Error(r.error);
    return { kind: 'image' as const, imageId: r.id };
  }),
  ...extra,
});
/** Speaker with a published deck, presentation live. */
function liveStage() {
  const ana = enter('Ana');
  send(ana, { t: 'stage_take' });
  send(ana, { t: 'deck_set', deck: deck() });
  send(ana, { t: 'present_start' });
  return ana;
}

describe('auditorium room', () => {
  it('exists, is bigger than the others and has a stage, podium, screen and many seats', () => {
    const def = ROOM_DEFS.find((r) => r.id === AUD)!;
    expect(def.name).toBe('Auditório');
    expect(def.tiles.length * def.tiles[0].length).toBeGreaterThan(ROOM_DEFS[0].tiles.length * ROOM_DEFS[0].tiles[0].length);
    for (const kind of ['stage', 'podium', 'screen']) expect(def.furniture.some((f) => f.kind === kind)).toBe(true);
    expect(def.furniture.filter((f) => f.kind === 'auditorium_seat').length).toBeGreaterThanOrEqual(30);
  });

  it('is connected to the office both ways', () => {
    expect(ROOM_DEFS.find((r) => r.id === 'office')!.portals.some((p) => p.toRoom === AUD)).toBe(true);
    expect(ROOM_DEFS.find((r) => r.id === AUD)!.portals.some((p) => p.toRoom === 'office')).toBe(true);
  });
});

describe('taking and leaving the stage', () => {
  it('gives the stage to the first person and refuses the second while it is busy', () => {
    const ana = enter('Ana');
    const beto = enter('Beto');
    send(ana, { t: 'stage_take' });
    expect(ana.last('stage')!.stage.speakerName).toBe('Ana');
    expect(beto.last('stage')!.stage.speakerId).toBe(ana.player!.id);
    send(beto, { t: 'stage_take' });
    expect(beto.errors()).toContain('stage_busy');
    expect(beto.last('stage')!.stage.speakerId).toBe(ana.player!.id);
  });

  it('is released by the speaker and can then be taken by someone else', () => {
    const ana = enter('Ana');
    const beto = enter('Beto');
    send(ana, { t: 'stage_take' });
    send(beto, { t: 'stage_release' });
    expect(beto.errors()).toContain('not_speaker');
    expect(ana.last('stage')!.stage.speakerId).toBe(ana.player!.id);
    send(ana, { t: 'stage_release' });
    expect(beto.last('stage')!.stage.speakerId).toBeNull();
    send(beto, { t: 'stage_take' });
    expect(ana.last('stage')!.stage.speakerName).toBe('Beto');
  });

  it('is taken by interacting with the podium', () => {
    const ana = enter('Ana');
    const podium = ROOM_DEFS.find((r) => r.id === AUD)!.furniture.find((f) => f.kind === 'podium')!;
    send(ana, { t: 'interact', furniId: podium.id, x: podium.x, y: podium.y });
    for (let i = 0; i < 80 && !ana.last('stage')?.stage.speakerId; i++) {
      now += STEP_MS;
      world.tick();
    }
    expect(ana.last('stage')!.stage.speakerId).toBe(ana.player!.id);
  });

  it('refuses stage messages outside an auditorium', () => {
    const ana = enter('Ana', 'office');
    send(ana, { t: 'stage_take' });
    expect(ana.errors()).toContain('not_stage_room');
    send(ana, { t: 'hand_raise' });
    expect(ana.errors().filter((c) => c === 'not_stage_room')).toHaveLength(2);
  });

  it('loses the stage when leaving the room, disconnecting or going away', () => {
    const ana = enter('Ana');
    const beto = enter('Beto');
    send(ana, { t: 'stage_take' });
    world.enterRoom(ana.player!, 'office');
    expect(beto.last('stage')!.stage.speakerId).toBeNull();

    send(beto, { t: 'stage_take' });
    world.disconnect(beto);
    const cris = enter('Cris');
    expect(cris.last('stage')!.stage.speakerId).toBeNull();

    send(cris, { t: 'stage_take' });
    const dani = enter('Dani');
    send(cris, { t: 'status', status: 'away' });
    expect(dani.last('stage')!.stage.speakerId).toBeNull();
    expect(syncs.filter((s) => s.id === cris.player!.id).map((s) => s.rights)).toEqual(['all', 'none']);
  });

  it('loses the stage to automatic away when the speaker goes idle', () => {
    const ana = enter('Ana');
    const beto = enter('Beto');
    send(ana, { t: 'stage_take' });
    now += 4 * 60_000;
    send(beto, { t: 'hand_lower' }); // others being active changes nothing
    world.tick();
    expect(beto.last('stage')!.stage.speakerId).toBe(ana.player!.id);
    now += 2 * 60_000;
    world.tick();
    expect(beto.last('stage')!.stage.speakerId).toBeNull();
  });

  it('keeps the stage while the speaker client sends its keep-alive', () => {
    const ana = enter('Ana');
    const beto = enter('Beto');
    send(ana, { t: 'stage_take' });
    for (let i = 0; i < 8; i++) {
      now += 60_000;
      send(ana, { t: 'stage_alive' });
      send(beto, { t: 'stage_alive' });
      world.tick();
    }
    expect(beto.last('stage')!.stage.speakerId).toBe(ana.player!.id);
  });

  it('does not let someone who is manually away take the stage', () => {
    const ana = enter('Ana');
    send(ana, { t: 'status', status: 'away' });
    send(ana, { t: 'stage_take' });
    expect(ana.errors()).toContain('stage_away');
  });
});

describe('who may publish audio, video and screen', () => {
  it('lets only the speaker publish everything in the auditorium, the audience nothing', () => {
    const ana = enter('Ana');
    const beto = enter('Beto');
    const p = (c: FakeConn) => c.player!;
    expect(publishRights(AUD, p(ana), 'room', world.stage)).toBe('none');
    expect(canPublishIn(AUD, p(ana), 'stage', world.stage)).toBe(false);
    send(ana, { t: 'stage_take' });
    expect(publishRights(AUD, p(ana), 'stage', world.stage)).toBe('all');
    expect(publishRights(AUD, p(beto), 'stage', world.stage)).toBe('none');
    expect(publishRights(AUD, p(beto), 'room', world.stage)).toBe('none');
  });

  it('keeps normal rooms open to everyone and refuses the stage kind where there is no stage', () => {
    const ana = enter('Ana', 'office');
    expect(publishRights('office', ana.player!, 'room', world.stage)).toBe('all');
    expect(canPublishIn('office', ana.player!, 'stage', world.stage)).toBe(false);
  });

  it('tells LiveKit about each change for people already connected', () => {
    const ana = enter('Ana');
    const beto = enter('Beto');
    send(ana, { t: 'stage_take' });
    send(beto, { t: 'hand_raise' });
    send(ana, { t: 'voice_grant', id: beto.player!.id });
    send(ana, { t: 'voice_revoke', id: beto.player!.id });
    send(ana, { t: 'stage_release' });
    expect(syncs).toEqual([
      { room: AUD, id: ana.player!.id, rights: 'all' },
      { room: AUD, id: beto.player!.id, rights: 'audio' },
      { room: AUD, id: beto.player!.id, rights: 'none' },
      { room: AUD, id: ana.player!.id, rights: 'none' },
    ]);
  });
});

describe('open stage', () => {
  const p = (c: FakeConn) => c.player!;
  it('lets the speaker open the stage so everybody may publish, and close it again', () => {
    const ana = enter('Ana');
    const beto = enter('Beto');
    const cris = enter('Cris');
    send(ana, { t: 'stage_take' });
    send(beto, { t: 'stage_open' });
    expect(beto.errors()).toContain('not_speaker');
    expect(publishRights(AUD, p(beto), 'stage', world.stage)).toBe('none');
    syncs.length = 0;

    send(ana, { t: 'stage_open' });
    expect(beto.last('stage')!.stage.open).toBe(true);
    expect(publishRights(AUD, p(beto), 'stage', world.stage)).toBe('all');
    expect(publishRights(AUD, p(cris), 'stage', world.stage)).toBe('all');
    expect(syncs.filter((s) => s.rights === 'all').map((s) => s.id).sort()).toEqual([p(ana).id, p(beto).id, p(cris).id].sort());
    const late = enter('Tarde'); // enters while open: its token says everything
    expect(publishRights(AUD, p(late), 'stage', world.stage)).toBe('all');

    syncs.length = 0;
    send(ana, { t: 'stage_close' });
    expect(beto.last('stage')!.stage.open).toBe(false);
    expect(publishRights(AUD, p(beto), 'stage', world.stage)).toBe('none');
    expect(publishRights(AUD, p(ana), 'stage', world.stage)).toBe('all');
    expect(syncs.find((s) => s.id === p(beto).id)!.rights).toBe('none');
    expect(syncs.find((s) => s.id === p(ana).id)!.rights).toBe('all');
  });

  it('keeps the floor of people who were called on when the stage closes', () => {
    const ana = enter('Ana');
    const beto = enter('Beto');
    send(ana, { t: 'stage_take' });
    send(beto, { t: 'hand_raise' });
    send(ana, { t: 'voice_grant', id: p(beto).id });
    send(ana, { t: 'stage_open' });
    expect(publishRights(AUD, p(beto), 'stage', world.stage)).toBe('all');
    send(ana, { t: 'stage_close' });
    expect(publishRights(AUD, p(beto), 'stage', world.stage)).toBe('audio');
  });

  it('closes by itself when the speaker steps down', () => {
    const ana = enter('Ana');
    const beto = enter('Beto');
    send(ana, { t: 'stage_take' });
    send(ana, { t: 'stage_open' });
    syncs.length = 0;
    send(ana, { t: 'stage_release' });
    expect(beto.last('stage')!.stage.open).toBe(false);
    expect(publishRights(AUD, p(beto), 'stage', world.stage)).toBe('none');
    expect(syncs.find((s) => s.id === p(beto).id)!.rights).toBe('none');
  });
});

describe('where the speaker stands', () => {
  it('walks behind the podium on the stage and turns to the audience', () => {
    const ana = enter('Ana');
    const def = ROOM_DEFS.find((r) => r.id === AUD)!;
    const podium = def.furniture.find((f) => f.kind === 'podium')!;
    const stage = def.furniture.find((f) => f.kind === 'stage')!;
    send(ana, { t: 'stage_take' });
    for (let i = 0; i < 80; i++) {
      now += STEP_MS;
      world.tick();
    }
    const me = ana.player!;
    expect({ x: me.x, y: me.y }).toEqual({ x: podium.x, y: podium.y - 1 });
    expect(me.y).toBeGreaterThanOrEqual(stage.y);
    expect(me.dir).toBe(2); // +y: toward the seats
    expect(ana.last('face')).toEqual({ t: 'face', id: me.id, dir: 2 });
  });

  it('takes the next free spot when somebody already stands behind the podium', () => {
    const ana = enter('Ana');
    const beto = enter('Beto');
    const podium = ROOM_DEFS.find((r) => r.id === AUD)!.furniture.find((f) => f.kind === 'podium')!;
    send(beto, { t: 'move', x: podium.x, y: podium.y - 1 });
    for (let i = 0; i < 80; i++) {
      now += STEP_MS;
      world.tick();
    }
    send(ana, { t: 'stage_take' });
    for (let i = 0; i < 80; i++) {
      now += STEP_MS;
      world.tick();
    }
    expect({ x: ana.player!.x, y: ana.player!.y }).not.toEqual({ x: beto.player!.x, y: beto.player!.y });
    expect(ana.player!.dir).toBe(2);
  });
});

describe('raising hands and giving the floor', () => {
  it('queues hands in order, and the speaker grants and revokes audio-only voice', () => {
    const ana = enter('Ana');
    const beto = enter('Beto');
    const cris = enter('Cris');
    send(beto, { t: 'hand_raise' });
    expect(beto.errors()).toContain('no_speaker');
    send(ana, { t: 'stage_take' });
    send(cris, { t: 'hand_raise' });
    send(beto, { t: 'hand_raise' });
    send(beto, { t: 'hand_raise' }); // idempotent
    expect(ana.last('stage')!.stage.hands.map((h) => h.name)).toEqual(['Cris', 'Beto']);

    send(ana, { t: 'voice_grant', id: cris.player!.id });
    const st = beto.last('stage')!.stage;
    expect(st.voices).toEqual([cris.player!.id]);
    expect(st.hands.map((h) => h.name)).toEqual(['Beto']);
    expect(publishRights(AUD, cris.player!, 'stage', world.stage)).toBe('audio');
    expect(publishRights(AUD, beto.player!, 'stage', world.stage)).toBe('none');

    send(ana, { t: 'voice_revoke', id: cris.player!.id });
    expect(beto.last('stage')!.stage.voices).toEqual([]);
    expect(publishRights(AUD, cris.player!, 'stage', world.stage)).toBe('none');
  });

  it('refuses grants from the audience, for strangers and for the speaker, and caps simultaneous voices', () => {
    const ana = enter('Ana');
    const beto = enter('Beto');
    const guests = ['Cris', 'Dani', 'Edu', 'Fabi'].map((n) => enter(n));
    send(ana, { t: 'stage_take' });
    send(beto, { t: 'voice_grant', id: beto.player!.id });
    expect(beto.errors()).toContain('not_speaker');
    send(ana, { t: 'voice_grant', id: 'nobody' });
    send(ana, { t: 'voice_grant', id: ana.player!.id });
    expect(ana.errors().filter((c) => c === 'no_target')).toHaveLength(2);
    send(ana, { t: 'voice_grant', id: 42 as unknown as string });
    expect(ana.errors()).toContain('bad_message');
    for (const g of guests) send(ana, { t: 'voice_grant', id: g.player!.id });
    expect(ana.last('stage')!.stage.voices).toHaveLength(STAGE_LIMITS.maxVoices);
    expect(ana.errors()).toContain('voices_full');
  });

  it('forgets hands and voices of people who leave, and everything when the speaker leaves', () => {
    const ana = enter('Ana');
    const beto = enter('Beto');
    const cris = enter('Cris');
    send(ana, { t: 'stage_take' });
    send(beto, { t: 'hand_raise' });
    send(cris, { t: 'hand_raise' });
    send(ana, { t: 'voice_grant', id: cris.player!.id });
    world.enterRoom(beto.player!, 'office');
    expect(ana.last('stage')!.stage.hands).toEqual([]);
    world.disconnect(cris);
    expect(ana.last('stage')!.stage.voices).toEqual([]);
    expect(syncs.at(-1)).toEqual({ room: AUD, id: cris.player!.id, rights: 'none' });
  });

  it('lets a person lower their hand, and the speaker dismiss one', () => {
    const ana = enter('Ana');
    const beto = enter('Beto');
    send(ana, { t: 'stage_take' });
    send(beto, { t: 'hand_raise' });
    send(beto, { t: 'hand_lower' });
    expect(ana.last('stage')!.stage.hands).toEqual([]);
    send(beto, { t: 'hand_raise' });
    send(ana, { t: 'voice_revoke', id: beto.player!.id });
    expect(ana.last('stage')!.stage.hands).toEqual([]);
  });

  it('does not let the speaker raise a hand', () => {
    const ana = enter('Ana');
    send(ana, { t: 'stage_take' });
    send(ana, { t: 'hand_raise' });
    expect(ana.errors()).toContain('stage_speaker');
  });
});

describe('deck validation', () => {
  const setup = () => {
    const ana = enter('Ana');
    send(ana, { t: 'stage_take' });
    return ana;
  };
  const refused = (c: FakeConn, d: unknown) => {
    const before = c.errors().length;
    send(c, { t: 'deck_set', deck: d as Deck });
    now += 10_000; // keep the deck rate limit out of the way
    return c.errors().slice(before);
  };

  it('accepts a valid image deck and cleans control characters', () => {
    const ana = setup();
    send(ana, { t: 'deck_set', deck: deck(2, { title: 'Oi\u0007 ‮ mundo' }) });
    const d = ana.last('deck')!.deck!;
    expect(d.title).not.toMatch(/[\u0007‮]/);
    expect(d.slides).toHaveLength(2);
  });

  it('rejects limits and malformed input without changing anything', () => {
    const ana = setup();
    expect(refused(ana, deck(STAGE_LIMITS.maxSlides + 1))).toEqual(['deck_invalid']);
    expect(refused(ana, deck(0))).toEqual(['deck_invalid']);
    expect(refused(ana, { ...deck(), slides: [{ kind: 'html', html: '<b>x</b>' }] })).toEqual(['deck_invalid']);
    expect(refused(ana, { ...deck(), slides: [{ kind: 'text', md: '# texto não é mais um tipo de slide' }] })).toEqual(['deck_invalid']);
    expect(refused(ana, { ...deck(), slides: [{ kind: 'image', imageId: '../../etc/passwd' }] })).toEqual(['deck_invalid']);
    expect(refused(ana, { ...deck(), slides: [{ kind: 'image', imageId: 'a'.repeat(24) }] })).toEqual(['deck_invalid']); // never uploaded
    expect(refused(ana, null)).toEqual(['deck_invalid']);
    expect(refused(ana, 'x')).toEqual(['deck_invalid']);
    expect(ana.all('deck').filter((m) => m.deck !== null)).toHaveLength(0);
  });

  it('keeps HTML in the title and description as inert text', () => {
    const ana = setup();
    const d = deck(1);
    (d.slides[0] as { alt?: string }).alt = '<script>alert(1)</script>';
    send(ana, { t: 'deck_set', deck: { ...d, title: '<img src=x onerror=alert(1)>' } });
    const got = ana.last('deck')!.deck!;
    expect(got.title).toBe('<img src=x onerror=alert(1)>');
    expect(got.slides[0]).toMatchObject({ kind: 'image', alt: '<script>alert(1)</script>' });
  });

  it('only the speaker can set a deck', () => {
    const ana = setup();
    const beto = enter('Beto');
    send(beto, { t: 'deck_set', deck: deck() });
    expect(beto.errors()).toContain('not_speaker');
    send(beto, { t: 'present_start' });
    send(beto, { t: 'slide_goto', index: 1 });
    send(beto, { t: 'present_end' });
    expect(beto.errors().filter((c) => c === 'not_speaker')).toHaveLength(4);
    expect(ana.all('deck').filter((m) => m.deck)).toHaveLength(0);
  });

  it('rate limits deck updates and slide changes', () => {
    const ana = liveStage();
    const before = ana.errors().length;
    for (let i = 0; i < 14; i++) send(ana, { t: 'deck_set', deck: deck(2) });
    expect(ana.errors().slice(before)).toContain('rate_limited');
    now += 60_000;
    const mark = ana.errors().length;
    for (let i = 0; i < 60; i++) send(ana, { t: 'slide_goto', index: i % 2 });
    expect(ana.errors().slice(mark)).toContain('rate_limited');
  });
});

describe('presentation control and late joiners', () => {
  it('starts, navigates and ends only by the speaker, and everyone follows', () => {
    const ana = enter('Ana');
    const beto = enter('Beto');
    send(ana, { t: 'stage_take' });
    send(ana, { t: 'present_start' });
    expect(ana.errors()).toContain('no_deck');
    send(ana, { t: 'deck_set', deck: deck(4) });
    expect(beto.all('deck').filter((m) => m.deck)).toHaveLength(0); // draft stays private
    send(ana, { t: 'slide_goto', index: 1 });
    expect(ana.errors()).toContain('not_live');
    send(ana, { t: 'present_start' });
    expect(beto.last('deck')!.deck!.slides).toHaveLength(4);
    expect(beto.last('slide')!.state).toEqual({ live: true, index: 0 });
    send(ana, { t: 'slide_goto', index: 2 });
    expect(beto.last('slide')!.state).toEqual({ live: true, index: 2 });
    for (const bad of [-1, 4, 1.5, '2', null, Infinity]) send(ana, { t: 'slide_goto', index: bad as number });
    expect(ana.errors().filter((c) => c === 'bad_slide')).toHaveLength(6);
    expect(beto.last('slide')!.state.index).toBe(2);
    send(beto, { t: 'slide_goto', index: 0 });
    expect(beto.last('slide')!.state.index).toBe(2);
    send(ana, { t: 'present_end' });
    expect(beto.last('slide')!.state.live).toBe(false);
    expect(beto.last('deck')!.deck).toBeNull();
    expect(ana.last('deck')!.deck).not.toBeNull();
  });

  it('brings someone who enters in the middle up to date', () => {
    const ana = liveStage();
    send(ana, { t: 'slide_goto', index: 2 });
    const late = enter('Tarde');
    expect(late.last('stage')!.stage.speakerName).toBe('Ana');
    expect(late.last('deck')!.deck!.title).toBe('Treinamento');
    expect(late.last('slide')!.state).toEqual({ live: true, index: 2 });
    const order = late.inbox.map((m) => m.t).filter((t) => ['room', 'stage', 'deck', 'slide'].includes(t));
    expect(order).toEqual(['room', 'stage', 'deck', 'slide']);
  });

  it('does not leak the draft deck to someone who enters before the presentation starts', () => {
    const ana = enter('Ana');
    send(ana, { t: 'stage_take' });
    send(ana, { t: 'deck_set', deck: deck() });
    const late = enter('Tarde');
    expect(late.last('deck')!.deck).toBeNull();
    expect(late.last('slide')!.state.live).toBe(false);
  });

  it('clears the presentation when the speaker leaves', () => {
    const ana = liveStage();
    const beto = enter('Beto');
    world.disconnect(ana);
    expect(beto.last('deck')!.deck).toBeNull();
    expect(beto.last('slide')!.state).toEqual({ live: false, index: 0 });
    expect(beto.last('stage')!.stage.speakerId).toBeNull();
    const cris = enter('Cris');
    send(cris, { t: 'stage_take' });
    expect(cris.last('deck')!.deck).toBeNull();
    send(cris, { t: 'present_start' });
    expect(cris.errors()).toContain('no_deck');
  });

  it('keeps the deck and the current slide for the same account after leaving, F5 or coming back', () => {
    const ana = liveStage();
    send(ana, { t: 'slide_goto', index: 2 });
    const firstImage = ana.last('deck')!.deck!.slides[0];
    world.disconnect(ana); // F5: the socket closes, the stage is released
    expect(world.stage.view(AUD)!.speakerId).toBeNull();

    const back = enter('Ana'); // new session of the same account
    expect(back.last('deck')!.deck).toBeNull(); // nothing is shown to a plain visitor
    send(back, { t: 'stage_take' });
    expect(back.last('deck')!.deck!.slides).toHaveLength(3);
    expect(back.last('deck')!.deck!.title).toBe('Treinamento');
    expect(back.last('slide')!.state).toEqual({ live: false, index: 2 });
    expect(world.stage.getImage(AUD, back.player!, (firstImage as { imageId: string }).imageId)).toBeDefined();
    send(back, { t: 'present_start', index: 2 });
    expect(back.last('slide')!.state).toEqual({ live: true, index: 2 });
  });

  it('keeps the deck when the speaker only steps down, and a different account starts clean', () => {
    const ana = liveStage();
    const beto = enter('Beto');
    send(ana, { t: 'stage_release' });
    send(beto, { t: 'stage_take' });
    expect(beto.last('deck')!.deck).toBeNull();
    expect(world.stage.imageStats(AUD).count).toBe(0);
    send(beto, { t: 'stage_release' });
    send(ana, { t: 'stage_take' });
    expect(ana.last('deck')!.deck).toBeNull(); // Beto took over, so Ana's old deck is gone
    send(ana, { t: 'stage_release' });

    const cris = enter('Cris');
    send(cris, { t: 'stage_take' });
    send(cris, { t: 'deck_set', deck: deck(2) });
    send(cris, { t: 'stage_release' });
    send(cris, { t: 'stage_take' });
    expect(cris.last('deck')!.deck!.slides).toHaveLength(2);
    send(cris, { t: 'deck_clear' });
    expect(cris.last('deck')!.deck).toBeNull();
    expect(world.stage.imageStats(AUD).count).toBe(0);
    send(cris, { t: 'present_start' });
    expect(cris.errors()).toContain('no_deck');
  });

  it('drops an abandoned deck after twelve hours', () => {
    const ana = liveStage();
    send(ana, { t: 'stage_release' });
    now += 13 * 60 * 60 * 1000;
    send(ana, { t: 'stage_take' });
    expect(ana.last('deck')!.deck).toBeNull();
  });

  it('shows the presentation to a person in another auditorium client only', () => {
    // people in the office never receive stage traffic
    const ana = liveStage();
    const out = enter('Fora', 'office');
    send(ana, { t: 'slide_goto', index: 1 });
    expect(out.all('slide')).toHaveLength(0);
    expect(out.all('stage')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// HTTP: slide images and media tokens

describe('HTTP: images and tokens', () => {
  let app: FastifyInstance;
  let appWorld: World;

  beforeEach(async () => {
    const created = await createApp({
      store: new MemoryAccountStore(),
      allowDevLogin: true,
      clock: () => now,
      permissionSync: () => undefined,
      media: resolveMediaConfig({}, false),
    });
    app = created.app;
    appWorld = created.world;
  });
  afterEach(async () => {
    await app.close();
  });

  const join = (name: string, roomId = AUD) => {
    const c = new FakeConn();
    appWorld.handle(c, { t: 'hello', name });
    appWorld.handle(c, { t: 'join', roomId });
    return c;
  };
  const upload = (name: string | null, body: Buffer | string, type = 'image/png') =>
    app.inject({ method: 'POST', url: '/api/stage/image', payload: body, headers: { 'content-type': type, ...(name ? { 'x-dev-name': name } : {}) } });
  const fetchImage = (name: string | null, id: string) =>
    app.inject({ method: 'GET', url: `/api/stage/image/${id}`, headers: name ? { 'x-dev-name': name } : {} });
  const token = (name: string, roomId = AUD) => app.inject({ method: 'POST', url: '/api/media/token', payload: { roomId, devName: name, kind: 'stage' } });
  const claims = (jwt: string) => JSON.parse(Buffer.from(jwt.split('.')[1]!, 'base64url').toString('utf8')).video as { canPublish: boolean; canPublishSources?: string[] };

  it('gives the audience a token that cannot publish, the speaker everything, a called-on member only the microphone', async () => {
    const ana = join('Ana');
    const beto = join('Beto');
    const cris = join('Cris');
    appWorld.handle(ana, { t: 'stage_take' });
    const speaker = (await token('Ana')).json();
    expect(speaker.canPublish).toBe(true);
    expect(speaker.rights).toBe('all');
    expect(claims(speaker.token).canPublishSources).toEqual(expect.arrayContaining(['microphone', 'camera', 'screen_share']));

    const audience = (await token('Beto')).json();
    expect(audience.canPublish).toBe(false);
    expect(audience.rights).toBe('none');
    expect(claims(audience.token).canPublish).toBe(false);
    expect(claims(audience.token).canPublishSources ?? []).toEqual([]);

    // The client asking for more changes nothing.
    const greedy = await app.inject({ method: 'POST', url: '/api/media/token', payload: { roomId: AUD, devName: 'Beto', kind: 'stage', canPublish: true } });
    expect(greedy.json().canPublish).toBe(false);

    appWorld.handle(beto, { t: 'hand_raise' });
    appWorld.handle(ana, { t: 'voice_grant', id: beto.player!.id });
    const voice = (await token('Beto')).json();
    expect(voice.rights).toBe('audio');
    expect(claims(voice.token).canPublish).toBe(true);
    expect(claims(voice.token).canPublishSources).toEqual(['microphone']);
    void cris;
  });

  it('still gives everyone publish rights in the office', async () => {
    join('Ana', 'office');
    const t = (await app.inject({ method: 'POST', url: '/api/media/token', payload: { roomId: 'office', devName: 'Ana' } })).json();
    expect(t.rights).toBe('all');
  });

  it('accepts images only from the speaker and returns an unguessable id', async () => {
    const ana = join('Ana');
    join('Beto');
    expect((await upload(null, PNG)).statusCode).toBe(401);
    expect((await upload('Ghost', PNG)).statusCode).toBe(401);
    const early = await upload('Ana', PNG);
    expect(early.statusCode).toBe(403);
    expect(early.json().error.code).toBe('not_speaker');
    appWorld.handle(ana, { t: 'stage_take' });
    expect((await upload('Beto', PNG)).statusCode).toBe(403);
    const ok = await upload('Ana', PNG);
    expect(ok.statusCode).toBe(200);
    expect(ok.json().id).toMatch(/^[a-f0-9]{24}$/);
    expect(ok.json()).toMatchObject({ width: 1, height: 1 });
  });

  it('refuses uploads outside an auditorium', async () => {
    join('Ana', 'office');
    expect((await upload('Ana', PNG)).statusCode).toBe(409);
  });

  it('rejects SVG, HTML, mismatched, truncated and oversized files', async () => {
    const ana = join('Ana');
    appWorld.handle(ana, { t: 'stage_take' });
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>';
    expect((await upload('Ana', svg, 'image/svg+xml')).statusCode).toBe(415);
    expect((await upload('Ana', svg, 'image/png')).statusCode).toBe(415); // svg bytes pretending to be png
    expect((await upload('Ana', '<html><script>alert(1)</script></html>', 'text/html')).statusCode).toBe(415);
    expect((await upload('Ana', '<html></html>', 'image/jpeg')).statusCode).toBe(415);
    expect((await upload('Ana', PNG, 'image/jpeg')).statusCode).toBe(415); // content does not match the declared type
    expect((await upload('Ana', PNG.subarray(0, 12))).statusCode).toBe(415); // truncated header
    expect((await upload('Ana', Buffer.from('GIF89a' + 'x'.repeat(40)), 'image/png')).statusCode).toBe(415);
    expect((await upload('Ana', Buffer.alloc(STAGE_LIMITS.maxImageBytes + 10, 1))).statusCode).toBe(413);
    const huge = Buffer.from(PNG);
    huge.writeUInt32BE(100_000, 16); // width far over the pixel limit
    expect((await upload('Ana', huge)).statusCode).toBe(413);
    expect((await upload('Ana', Buffer.alloc(0))).statusCode).toBe(400);
  });

  it('rate limits uploads', async () => {
    const ana = join('Ana');
    appWorld.handle(ana, { t: 'stage_take' });
    const codes: number[] = [];
    for (let i = 0; i < 14; i++) codes.push((await upload('Ana', PNG)).statusCode);
    expect(codes).toContain(429);
    expect(codes.slice(0, 5).every((c) => c === 200)).toBe(true);
  });

  it('serves images safely and only to people in the room, the audience only while live', async () => {
    const ana = join('Ana');
    const beto = join('Beto');
    const out = join('Fora', 'office');
    appWorld.handle(ana, { t: 'stage_take' });
    const { id } = (await upload('Ana', PNG)).json();
    appWorld.handle(ana, { t: 'deck_set', deck: { title: 'x', slides: [{ kind: 'image', imageId: id }] } });
    expect(ana.errors()).toEqual([]);

    const mine = await fetchImage('Ana', id);
    expect(mine.statusCode).toBe(200);
    expect(mine.headers['content-type']).toBe('image/png');
    expect(mine.headers['x-content-type-options']).toBe('nosniff');
    expect(String(mine.headers['content-security-policy'])).toContain("default-src 'none'");
    expect(mine.headers['cross-origin-resource-policy']).toBe('same-origin');
    expect(Buffer.from(mine.rawPayload).equals(PNG)).toBe(true);

    expect((await fetchImage('Beto', id)).statusCode).toBe(404); // draft: not live yet
    appWorld.handle(ana, { t: 'present_start' });
    expect((await fetchImage('Beto', id)).statusCode).toBe(200);
    expect((await fetchImage('Fora', id)).statusCode).toBe(404); // another room
    expect((await fetchImage(null, id)).statusCode).toBe(401);
    expect((await fetchImage('Beto', '../../etc/passwd')).statusCode).toBe(404);
    expect((await fetchImage('Beto', 'f'.repeat(24))).statusCode).toBe(404);

    appWorld.handle(ana, { t: 'present_end' });
    expect((await fetchImage('Beto', id)).statusCode).toBe(404);
    appWorld.handle(ana, { t: 'stage_release' });
    expect((await fetchImage('Ana', id)).statusCode).toBe(404); // freed with the stage
    void beto;
    void out;
  });

  it('drops images that a new deck no longer uses', async () => {
    const ana = join('Ana');
    appWorld.handle(ana, { t: 'stage_take' });
    const a = (await upload('Ana', PNG)).json().id as string;
    const b = (await upload('Ana', PNG)).json().id as string;
    appWorld.handle(ana, { t: 'deck_set', deck: { title: '', slides: [{ kind: 'image', imageId: a }, { kind: 'image', imageId: b }] } });
    expect(appWorld.stage.imageStats(AUD).count).toBe(2);
    now += 60_000;
    appWorld.handle(ana, { t: 'deck_set', deck: { title: '', slides: [{ kind: 'image', imageId: a }] } });
    expect(appWorld.stage.imageStats(AUD).count).toBe(1);
    expect((await fetchImage('Ana', b)).statusCode).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Real WebSocket: message size limits

describe('WebSocket message size', () => {
  let app: FastifyInstance;
  let url: string;
  let created: Awaited<ReturnType<typeof createApp>>;
  const sockets: WebSocket[] = [];
  beforeEach(async () => {
    created = await createApp({ store: new MemoryAccountStore(), allowDevLogin: true, permissionSync: () => undefined });
    app = created.app;
    await app.listen({ port: 0, host: '127.0.0.1' });
    const addr = app.server.address();
    url = `ws://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}/ws`;
  });
  afterEach(async () => {
    for (const s of sockets.splice(0)) s.terminate();
    await app.close();
  });

  async function open(name: string) {
    const ws = new WebSocket(url);
    sockets.push(ws);
    const inbox: ServerMessage[] = [];
    ws.on('message', (raw) => inbox.push(JSON.parse(raw.toString())));
    await new Promise((res, rej) => {
      ws.once('open', res);
      ws.once('error', rej);
    });
    const wait = async (pred: (m: ServerMessage) => boolean) => {
      for (let i = 0; i < 100; i++) {
        const m = inbox.find(pred);
        if (m) return m;
        await new Promise((r) => setTimeout(r, 20));
      }
      throw new Error('timeout');
    };
    ws.send(JSON.stringify({ t: 'hello', name }));
    await wait((m) => m.t === 'session');
    ws.send(JSON.stringify({ t: 'join', roomId: AUD }));
    await wait((m) => m.t === 'room');
    return { ws, inbox, wait };
  }

  it('accepts a big deck but refuses any other oversized message', async () => {
    const ana = await open('Ana');
    ana.ws.send(JSON.stringify({ t: 'stage_take' }));
    await ana.wait((m) => m.t === 'stage' && m.stage.speakerName === 'Ana');
    const slides = Array.from({ length: 40 }, () => {
      const r = created.world.stage.addImage(AUD, Buffer.from(PNG), 'image/png');
      if (!r.ok) throw new Error(r.error);
      return { kind: 'image', imageId: r.id, alt: 'descricao '.repeat(12) };
    });
    const raw = JSON.stringify({ t: 'deck_set', deck: { title: 'Grande', slides } });
    expect(raw.length).toBeGreaterThan(4_096);
    ana.ws.send(raw);
    await ana.wait((m) => m.t === 'deck' && m.deck?.slides.length === 40);
    ana.ws.send(JSON.stringify({ t: 'chat', text: 'x'.repeat(6000) }));
    const err = await ana.wait((m) => m.t === 'error' && m.code === 'bad_message');
    expect(err.t).toBe('error');
  });
});
