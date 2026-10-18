import { describe, expect, it } from 'vitest';
import {
  FURNI_KINDS,
  ROOM_DEFS,
  STAGE_LIMITS,
  buildRoom,
  checkImageUpload,
  findPath,
  footprintTiles,
  isStageRoom,
  isWalkable,
  sniffImage,
  stageSpots,
  validateDeck,
} from '../src';

const PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'));

describe('auditorium layout', () => {
  const def = ROOM_DEFS.find((r) => r.id === 'auditorium')!;
  const room = buildRoom(def);

  it('is the only stage room and has the stage furniture', () => {
    expect(ROOM_DEFS.filter(isStageRoom).map((r) => r.id)).toEqual(['auditorium']);
    expect(def.furniture.some((f) => f.kind === 'stage')).toBe(true);
    expect(def.furniture.some((f) => f.kind === 'screen' && f.y === 0)).toBe(true);
  });

  it('puts the podium on the stage and the screen on the north wall without blocking', () => {
    const stage = def.furniture.find((f) => f.kind === 'stage')!;
    const podium = def.furniture.find((f) => f.kind === 'podium')!;
    const stageTiles = footprintTiles(stage).map((t) => `${t.x},${t.y}`);
    expect(stageTiles).toContain(`${podium.x},${podium.y}`);
    expect(FURNI_KINDS.screen.blocks).toBe(false);
    expect(FURNI_KINDS.stage.blocks).toBe(false);
  });

  it('has a speaker spot behind the podium, on the stage, reachable and facing the audience', () => {
    const stage = def.furniture.find((f) => f.kind === 'stage')!;
    const podium = def.furniture.find((f) => f.kind === 'podium')!;
    const spots = stageSpots(room);
    expect(spots.length).toBeGreaterThan(1);
    expect(spots[0]).toEqual({ x: podium.x, y: podium.y - 1, dir: 2 });
    const onStage = footprintTiles(stage).map((t) => `${t.x},${t.y}`);
    for (const s of spots) {
      expect(onStage).toContain(`${s.x},${s.y}`);
      expect(findPath(room.grid, def.spawn, s), `${s.x},${s.y}`).not.toBeNull();
      expect(s.dir).toBe(2);
    }
    const firstSeat = def.furniture.find((f) => f.kind === 'auditorium_seat')!;
    expect(firstSeat.y).toBeGreaterThan(spots[0].y); // the audience is on the +y side
  });

  it('keeps every portal reachable and links both ways with the office', () => {
    for (const portal of def.portals) expect(findPath(room.grid, def.spawn, portal), portal.label).not.toBeNull();
    const office = ROOM_DEFS.find((r) => r.id === 'office')!;
    const toAud = office.portals.find((p) => p.toRoom === 'auditorium')!;
    expect(findPath(buildRoom(office).grid, office.spawn, toAud)).not.toBeNull();
    expect(isWalkable(room.grid, toAud.toX, toAud.toY)).toBe(true);
    const back = def.portals.find((p) => p.toRoom === 'office')!;
    expect(isWalkable(buildRoom(office).grid, back.toX, back.toY)).toBe(true);
  });

  it('gives every seat of every room a reachable neighbour tile', () => {
    for (const d of ROOM_DEFS) {
      const r = buildRoom(d);
      for (const f of d.furniture.filter((x) => FURNI_KINDS[x.kind].seat)) {
        expect(findPath(r.grid, d.spawn, f, { allowBlockedGoal: true }), `${d.id}/${f.id}`).not.toBeNull();
      }
    }
  });

  it('has no isolated tile and every usable item reachable from a neighbour, podium included', () => {
    for (let y = 0; y < room.grid.height; y++) {
      for (let x = 0; x < room.grid.width; x++) {
        if (isWalkable(room.grid, x, y)) expect(findPath(room.grid, def.spawn, { x, y }), `${x},${y}`).not.toBeNull();
      }
    }
    const podium = def.furniture.find((f) => f.kind === 'podium')!;
    const near = [-1, 0, 1]
      .flatMap((dy) => [-1, 0, 1].map((dx) => ({ x: podium.x + dx, y: podium.y + dy })))
      .filter((t) => isWalkable(room.grid, t.x, t.y));
    expect(near.length).toBeGreaterThanOrEqual(3);
    expect(near.every((t) => findPath(room.grid, def.spawn, t) !== null)).toBe(true);
  });

  it('seats the audience facing the stage', () => {
    for (const f of def.furniture.filter((x) => x.kind === 'auditorium_seat')) expect(f.dir).toBe(3);
  });
});

describe('deck validation', () => {
  const id = 'a'.repeat(24);
  const ok = { title: 'T', slides: [{ kind: 'image', imageId: id }] };

  it('normalises a valid deck', () => {
    const r = validateDeck({ ...ok, slides: [{ kind: 'image', imageId: id, alt: ' foto\n' }] });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.deck.slides[0]).toEqual({ kind: 'image', imageId: id, alt: 'foto' });
  });

  it('refuses every malformed shape, including text/html slides', () => {
    const bads: unknown[] = [
      null,
      1,
      {},
      { title: 1, slides: [] },
      { ...ok, slides: 'x' },
      { ...ok, slides: [] },
      { ...ok, slides: [null] },
      { ...ok, slides: [{ kind: 'text', md: '# oi' }] },
      { ...ok, slides: [{ kind: 'html', html: '<b>x</b>' }] },
      { ...ok, slides: [{ kind: 'image', imageId: 'zz' }] },
      { ...ok, slides: [{ kind: 'image', imageId: '../../x' }] },
      { ...ok, slides: Array(STAGE_LIMITS.maxSlides + 1).fill(ok.slides[0]) },
    ];
    for (const bad of bads) expect(validateDeck(bad).ok, JSON.stringify(bad)?.slice(0, 60)).toBe(false);
  });

  it('strips control and bidi characters from the title', () => {
    const r = validateDeck({ ...ok, title: 'a\u0000b\u202ec' });
    expect(r.ok && r.deck.title).toBe('a b c');
  });
});

describe('image signatures', () => {
  it('recognises PNG with its size', () => {
    expect(sniffImage(PNG)).toEqual({ mime: 'image/png', width: 1, height: 1 });
  });

  it('recognises JPEG and WebP headers', () => {
    const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 11, 8, 0x01, 0x2c, 0x02, 0x58, 1, 1, 0x11, 0]);
    expect(sniffImage(jpeg)).toEqual({ mime: 'image/jpeg', width: 600, height: 300 });
    const webp = new Uint8Array(30);
    webp.set(Buffer.from('RIFF'), 0);
    webp.set(Buffer.from('WEBP'), 8);
    webp.set(Buffer.from('VP8X'), 12);
    webp[24] = 99; // width - 1
    webp[27] = 49; // height - 1
    expect(sniffImage(webp)).toEqual({ mime: 'image/webp', width: 100, height: 50 });
  });

  it('refuses SVG, HTML, GIF and junk', () => {
    for (const text of ['<svg xmlns="http://www.w3.org/2000/svg"/>', '<!doctype html><html></html>', 'GIF89a......................', '']) {
      expect(sniffImage(Buffer.from(text))).toBeNull();
    }
  });

  it('checks declared type, size and pixels', () => {
    expect(checkImageUpload(PNG, 'image/png').ok).toBe(true);
    expect(checkImageUpload(PNG, 'image/jpeg')).toMatchObject({ ok: false, status: 415 });
    expect(checkImageUpload(PNG, 'image/svg+xml')).toMatchObject({ ok: false, status: 415 });
    expect(checkImageUpload(new Uint8Array(STAGE_LIMITS.maxImageBytes + 1), 'image/png')).toMatchObject({ ok: false, status: 413 });
    expect(checkImageUpload(new Uint8Array(), 'image/png')).toMatchObject({ ok: false, status: 400 });
  });
});
