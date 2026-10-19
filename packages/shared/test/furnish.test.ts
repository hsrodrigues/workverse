import { describe, expect, it } from 'vitest';
import { FURNI_KINDS, MAX_FURNITURE, ROOM_DEFS, applyOps, checkOps, validateLayout, type FurnishOp, type Furniture, type RoomDef } from '../src';

const room = (id: string): RoomDef => ROOM_DEFS.find((d) => d.id === id)!;
const piece = (id: string, kind: Furniture['kind'], x: number, y: number, dir = 0): Furniture => ({ id, kind, x, y, dir });
const add = (p: Furniture): FurnishOp => ({ op: 'add', piece: p });
const codes = (r: { errors: { code: string }[] }) => r.errors.map((e) => e.code);

describe('validateLayout: the built-in rooms', () => {
  for (const def of ROOM_DEFS) {
    it(`${def.id}: the original layout is valid`, () => {
      const r = validateLayout(def, def.furniture);
      expect(r.errors, r.errors.map((e) => e.message).join('; ')).toEqual([]);
      expect(r.warnings).toEqual([]);
    });
  }
});

describe('validateLayout: placement rules', () => {
  const office = room('office');

  it('accepts a sofa on free floor and refuses one outside the floor, with the coordinate', () => {
    expect(checkOps(office, office.furniture, [add(piece('n1', 'sofa', 6, 7, 0))]).ok).toBe(true);
    const out = checkOps(office, office.furniture, [add(piece('n1', 'sofa', 15, 11, 0))]);
    expect(out.ok).toBe(false);
    expect(out.errors[0]).toMatchObject({ code: 'outside', x: 15, y: 12 });
    expect(out.errors[0]!.message).toContain('(15, 12)');
    expect(codes(checkOps(office, office.furniture, [add(piece('n1', 'plant', -1, 3))]))).toContain('outside');
  });

  it('refuses overlapping solid pieces, but lets a computer sit on a desk and a plant stand on a rug', () => {
    const desk = office.furniture.find((f) => f.kind === 'desk')!;
    const r = checkOps(office, office.furniture, [add(piece('n1', 'plant', desk.x, desk.y))]);
    expect(codes(r)).toContain('overlap');
    expect(r.errors[0]!.message).toMatch(/sobrepostos em \(\d+, \d+\)/);
    const rug = office.furniture.find((f) => f.kind === 'rug')!;
    expect(checkOps(office, office.furniture, [add(piece('n1', 'plant', rug.x, rug.y))]).ok).toBe(true);
    expect(codes(checkOps(office, office.furniture, [add(piece('n1', 'computer', 12, 1))]))).toContain('computer_surface');
    expect(codes(checkOps(office, office.furniture, [add(piece('n1', 'rug', rug.x, rug.y))]))).toContain('overlap');
  });

  it('keeps wall pieces on the north row / west column and away from doors', () => {
    expect(checkOps(office, office.furniture, [add(piece('n1', 'frame', 11, 0))]).ok).toBe(true);
    expect(checkOps(office, office.furniture, [add(piece('n1', 'frame', 0, 9, 1))]).ok).toBe(true);
    expect(codes(checkOps(office, office.furniture, [add(piece('n1', 'frame', 4, 3))]))).toContain('wall_only');
    // dir 1 runs along the west column, so y = 0 with dir 0 is fine but x = 3 with dir 1 is not
    expect(codes(checkOps(office, office.furniture, [add(piece('n1', 'clock', 3, 4, 1))]))).toContain('wall_only');
    expect(codes(checkOps(office, office.furniture, [add(piece('n1', 'frame', 7, 0))]))).toContain('wall_covers_door');
    expect(codes(checkOps(office, office.furniture, [add(piece('n1', 'frame', 4, 0))]))).toContain('overlap');
  });

  it('applies the allow-list of piece kinds per room type', () => {
    const lounge = room('lounge');
    const r = checkOps(lounge, lounge.furniture, [add(piece('n1', 'podium', 6, 6))]);
    expect(codes(r)).toContain('room_type');
    expect(r.errors[0]!.message).toContain('auditório');
    expect(codes(checkOps(lounge, lounge.furniture, [add(piece('n2', 'stage', 4, 4))]))).toContain('room_type');
    expect(codes(checkOps(lounge, lounge.furniture, [add(piece('n3', 'screen', 5, 0))]))).toContain('room_type');
    const aud = room('auditorium');
    expect(checkOps(aud, aud.furniture, [add(piece('n4', 'auditorium_seat', 16, 9, 3))]).ok).toBe(true);
    expect(codes(checkOps(aud, aud.furniture, [add(piece('n5', 'podium', 12, 3))]))).toContain('too_many');
  });

  it('never lets the auditorium lose its stage or podium', () => {
    const aud = room('auditorium');
    const podium = aud.furniture.find((f) => f.kind === 'podium')!;
    expect(codes(checkOps(aud, aud.furniture, [{ op: 'remove', id: podium.id }]))).toContain('required');
    const stage = aud.furniture.find((f) => f.kind === 'stage')!;
    expect(codes(checkOps(aud, aud.furniture, [{ op: 'remove', id: stage.id }]))).toContain('required');
  });

  it('enforces the piece limit', () => {
    const filler: Furniture[] = Array.from({ length: MAX_FURNITURE + 1 }, (_, i) => piece(`f${i}`, 'rug', 0, 0));
    const r = validateLayout(office, filler);
    expect(codes(r)).toContain('limit');
    const near = office.furniture.slice(0, MAX_FURNITURE);
    const grown = [...near, ...Array.from({ length: MAX_FURNITURE - near.length + 1 }, (_, i) => piece(`g${i}`, 'frame', 4, 0))];
    expect(codes(validateLayout(office, grown))).toContain('limit');
  });

  it('rejects malformed pieces and operations', () => {
    expect(codes(validateLayout(office, [{ id: 'a', kind: 'nope' as never, x: 1, y: 1, dir: 0 }]))).toContain('bad_piece');
    expect(codes(validateLayout(office, [piece('a', 'plant', 1.5, 1)]))).toContain('bad_piece');
    expect(codes(validateLayout(office, [piece('a', 'plant', 1, 1, 7)]))).toContain('bad_piece');
    expect(codes(validateLayout(office, [piece('a b', 'plant', 1, 1)]))).toContain('bad_piece');
    expect(codes(validateLayout(office, [piece('a', 'plant', 1, 1), piece('a', 'plant', 2, 1)]))).toContain('duplicate_id');
    expect(applyOps([], [])).toMatchObject({ ok: false });
    expect(applyOps([], [{ op: 'remove', id: 'x' }])).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(applyOps([], [{ op: 'bogus' } as never])).toMatchObject({ ok: false });
    expect(applyOps(office.furniture, [add(piece(office.furniture[0]!.id, 'plant', 1, 1))])).toMatchObject({ ok: false, error: { code: 'duplicate_id' } });
  });
});

describe('validateLayout: walking', () => {
  it('refuses to block spawn, doors and arrival tiles', () => {
    const office = room('office');
    const spawn = office.spawn;
    expect(codes(checkOps(office, office.furniture, [add(piece('n1', 'plant', spawn.x, spawn.y))]))).toContain('blocks_spawn');
    // portal to the reception at (0,4); the arrival tile from the reception is (1,4)
    expect(codes(checkOps(office, office.furniture, [add(piece('n1', 'plant', 0, 4))]))).toContain('blocks_portal');
    expect(codes(checkOps(office, office.furniture, [add(piece('n1', 'plant', 1, 4))]))).toContain('blocks_arrival');
  });

  it('detects a pocket cut off from the entrance (blocked path), with the coordinate', () => {
    const team = room('team');
    // surround the tile (1, 1) of the team room (free corner area near the door) with bins
    const ring = [
      [2, 0],
      [2, 1],
      [2, 2],
      [1, 2],
      [0, 2],
    ] as const;
    const ops = ring.filter(([x, y]) => !team.furniture.some((f) => FURNI_KINDS[f.kind].blocks && f.x === x && f.y === y)).map(([x, y], i) => add(piece(`r${i}`, 'bin', x, y)));
    const r = checkOps(team, team.furniture, ops);
    expect(r.ok).toBe(false);
    const isolated = r.errors.find((e) => e.code === 'isolated');
    expect(isolated, JSON.stringify(r.errors)).toBeTruthy();
    expect(isolated!.message).toMatch(/\(\d+, \d+\)/);
  });

  it('allows moving a seat and rotating a piece (update)', () => {
    const office = room('office');
    const sofa = office.furniture.find((f) => f.kind === 'sofa')!;
    expect(checkOps(office, office.furniture, [{ op: 'update', id: sofa.id, x: sofa.x, y: sofa.y, dir: 0 }]).errors).toEqual([]);
    expect(checkOps(office, office.furniture, [{ op: 'remove', id: sofa.id }]).ok).toBe(true);
  });
});

describe('validateLayout: soft warnings', () => {
  it('warns (without blocking) about a sofa facing the wall and a shelf away from the wall', () => {
    const lounge = room('lounge');
    const r = checkOps(lounge, lounge.furniture, [add(piece('n1', 'sofa', 0, 5, 2)), add(piece('n2', 'bookshelf', 7, 1, 0))]);
    expect(r.ok, JSON.stringify(r.errors)).toBe(true);
    const wc = r.warnings.map((w) => w.code);
    expect(wc).toContain('seat_wall');
    expect(wc).toContain('wall_not_north');
  });
});
