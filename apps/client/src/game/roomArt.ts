import { FURNI_KINDS, footprintTiles, furniFront, idx, type BuiltRoom } from '@workverse/shared';
import {
  Plane,
  Raster,
  bayer,
  createCanvas,
  drawBox,
  hash2,
  hexToRgb,
  mixRgb,
  shade,
  shadeRgb,
  type RGB,
} from './pixel';

export const WALL_H = 104;
const PAD = 4;
/** Visible thickness of the floor slab on the south and east edges, in px. */
const SLAB = 10;

export interface Theme {
  floorStyle: 'carpet' | 'wood';
  /** Carpet: two checker tones then the darker border ring. Wood: four plank tones. */
  floor: string[];
  wallA: string;
  wallB: string;
  /** Lower wall panelling. */
  wains: string;
  /** Moldings (chair rail, crown, window frames). */
  trim: string;
  paper: 'stripe' | 'diamond' | 'plain' | 'acoustic' | 'tech';
  door: string;
  /** Extra floor treatment: lit aisle, spot pools and entrance mat (auditorium). */
  fx?: 'hall' | 'tech';
  /** `false` = no windows (windowless hall). */
  windows?: boolean;
}

export const THEMES: Record<string, Theme> = {
  office: {
    floorStyle: 'carpet',
    floor: ['#bcc1c8', '#b3b9c1', '#9aa2ad'],
    wallA: '#f0eee8',
    wallB: '#dedbd2',
    wains: '#35646f',
    trim: '#ffffff',
    paper: 'plain',
    door: '#2f4a55',
  },
  lounge: {
    floorStyle: 'wood',
    floor: ['#c9975f', '#bd8a54', '#d3a46c', '#b27f4b'],
    wallA: '#e8cdab',
    wallB: '#d4b48f',
    wains: '#6b8c78',
    trim: '#f8f1e3',
    paper: 'plain',
    door: '#7a4a2c',
  },
  auditorium: {
    floorStyle: 'carpet',
    floor: ['#2e3452', '#292f4b', '#1d2138'],
    wallA: '#2a3050',
    wallB: '#222844',
    wains: '#181c31',
    trim: '#cdd6e6',
    paper: 'acoustic',
    door: '#233c4f',
    fx: 'hall',
    windows: false,
  },
  // Reception: pale oak, white walls, graphite panelling
  reception: {
    floorStyle: 'wood',
    floor: ['#dcc49c', '#d1b78d', '#e4cfa9', '#c8ad82'],
    wallA: '#f4f2ed',
    wallB: '#e3e0d8',
    wains: '#33414d',
    trim: '#ffffff',
    paper: 'plain',
    door: '#2a9a98',
  },
  // Team room: blue carpet
  team: {
    floorStyle: 'carpet',
    floor: ['#9db8cc', '#93b0c5', '#789aaf'],
    wallA: '#eef1f5',
    wallB: '#dce2ea',
    wains: '#2f6f8f',
    trim: '#ffffff',
    paper: 'plain',
    door: '#24566e',
  },
  // Meeting 1: graphite carpet, terracotta panelling
  meeting1: {
    floorStyle: 'carpet',
    floor: ['#737c88', '#6b7480', '#525a66'],
    wallA: '#ece8e0',
    wallB: '#dad5cb',
    wains: '#a05a44',
    trim: '#fbf8f1',
    paper: 'plain',
    door: '#6e3a2c',
  },
  // Meeting 2: sage carpet, forest panelling
  meeting2: {
    floorStyle: 'carpet',
    floor: ['#a9bcae', '#a0b5a6', '#82998a'],
    wallA: '#f1efe6',
    wallB: '#dfdccf',
    wains: '#3f6b57',
    trim: '#ffffff',
    paper: 'plain',
    door: '#2f5444',
  },
  // Private room: dark walnut, plum panelling
  private: {
    floorStyle: 'wood',
    floor: ['#9a7350', '#8d6846', '#a67d58', '#815f3f'],
    wallA: '#e8dfcd',
    wallB: '#d6ccb8',
    wains: '#5a4668',
    trim: '#f6efe0',
    paper: 'stripe',
    door: '#3e2f4a',
  },
  // IT room: dark carpet with LED strips, graphite metal panels with a cyan cove
  ti: {
    floorStyle: 'carpet',
    floor: ['#252d44', '#202840', '#161c30'],
    wallA: '#2a3350',
    wallB: '#232b46',
    wains: '#141a2c',
    trim: '#9fb1d6',
    paper: 'tech',
    door: '#1d3b52',
    fx: 'tech',
  },
  // Focus space: deep blue carpet, soft cool walls
  focus: {
    floorStyle: 'carpet',
    floor: ['#5f6e8e', '#58678a', '#46526f'],
    wallA: '#cfd5e4',
    wallB: '#bcc4d8',
    wains: '#2b3550',
    trim: '#e9ecf5',
    paper: 'plain',
    door: '#232c44',
  },
};

export interface Layer {
  canvas: HTMLCanvasElement;
  /** Where the world origin (north vertex of tile 0,0) lies inside the canvas. */
  ox: number;
  oy: number;
  /** Floor only: sun beams from the windows as a translucent overlay (shown by day only, see dayCycle.ts). */
  beams?: HTMLCanvasElement;
}

const layerCache = new Map<string, Layer>();

export interface WindowSpot {
  side: 'n' | 'w';
  /** Tile index along the wall. */
  t: number;
}

/** Window positions for a room (skips doors, neighbours of doors and wall decor). */
export function windowSpots(room: BuiltRoom, theme?: Theme): WindowSpot[] {
  if (theme?.windows === false) return [];
  const { width: W, height: H } = room.grid;
  const portalsN = new Set(room.def.portals.filter((p) => p.y === 0).map((p) => p.x));
  const portalsW = new Set(room.def.portals.filter((p) => p.x === 0).map((p) => p.y));
  const busyN = new Set<number>();
  const busyW = new Set<number>();
  for (const f of room.def.furniture) {
    // wall hangings, and tall pieces leaning on the wall (shelf, rack, fridge), would hide the window
    const tall = f.kind === 'bookshelf' || f.kind === 'rack' || f.kind === 'fridge' || f.kind === 'snack_machine' || f.kind === 'soda_machine' || f.kind === 'server_rack';
    if (!FURNI_KINDS[f.kind].wall && !tall) continue;
    // hangings: dir 0 = north wall, 1 = west wall. Floor pieces: furniFront 1 (+y) leans on the north wall, 0 (+x) on the west
    const north = FURNI_KINDS[f.kind].wall ? f.dir % 2 === 0 : furniFront(f) === 1;
    for (const t of footprintTiles(f)) {
      if (!FURNI_KINDS[f.kind].wall && (north ? t.y : t.x) !== 0) continue;
      (north ? busyN : busyW).add(north ? t.x : t.y);
    }
  }
  const out: WindowSpot[] = [];
  for (let x = 0; x < W; x++) {
    if (x % 3 !== 1 || busyN.has(x) || portalsN.has(x) || portalsN.has(x - 1) || portalsN.has(x + 1)) continue;
    out.push({ side: 'n', t: x });
  }
  for (let y = 0; y < H; y++) {
    if (y % 3 !== 1 || busyW.has(y) || portalsW.has(y) || portalsW.has(y - 1) || portalsW.has(y + 1)) continue;
    out.push({ side: 'w', t: y });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Floor

const quant = (d: number, px: number, py: number) => (d <= 0 ? 0 : Math.floor(d / 0.05 + bayer(px, py)) * 0.05);

/** Floor tiles, wall contact shadows, window light pools and the slab thickness on the south/east edges. */
export function renderFloor(room: BuiltRoom, theme: Theme): Layer {
  const cached = layerCache.get(`floor:${room.def.id}`);
  if (cached) return cached;
  const { width: W, height: H, floor } = room.grid;
  const ox = H * 32 + PAD;
  const oy = PAD;
  const cw = (W + H) * 32 + PAD * 2;
  const ch = (W + H) * 16 + SLAB + PAD * 2;
  const r = new Raster(cw, ch);
  const at = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && floor[idx(room.grid, x, y)];
  const pal = theme.floor.map(hexToRgb);
  const spots = windowSpots(room, theme);
  const warm: RGB = [255, 243, 201];
  const br = new Raster(cw, ch);

  // slab (drawn first; tile pixels never overlap it)
  const lipL = shadeRgb(pal[0], -0.14);
  const lipR = shadeRgb(pal[0], -0.3);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!at(x, y)) continue;
      if (!at(x, y + 1)) {
        const wx = ox + (x - y - 1) * 32;
        const wy = oy + (x + y + 1) * 16;
        for (let k = 0; k < 32; k++) slabColumn(r, wx + k, Math.round(wy + (k + 0.5) / 2), k === 0 || k === 31 ? 1 : 0, false, lipL, pal[0], x + k);
      }
      if (!at(x + 1, y)) {
        const sx = ox + (x - y) * 32;
        const sy = oy + (x + y + 2) * 16;
        for (let k = 0; k < 32; k++) slabColumn(r, sx + k, Math.round(sy - (k + 0.5) / 2), k === 0 || k === 31 ? 1 : 0, true, lipR, pal[0], y + k);
      }
    }
  }

  // tiles
  const wood = theme.floorStyle === 'wood';
  for (let py = 0; py < ch; py++) {
    for (let px = 0; px < cw; px++) {
      const dx = px + 0.5 - ox;
      const dy = py + 0.5 - oy;
      const X = (dx / 32 + dy / 16) / 2;
      const Y = (dy / 16 - dx / 32) / 2;
      if (X < 0 || Y < 0) continue;
      const tx = Math.floor(X);
      const ty = Math.floor(Y);
      if (!at(tx, ty)) continue;
      const u = X - tx;
      const v = Y - ty;
      let amt = 0;
      let c: RGB;
      if (wood) {
        const pr = Math.floor(Y * 4);
        const pf = Y * 4 - pr;
        const PL = 2.5;
        const k = (X + hash2(pr, 0, 3) * PL) / PL;
        const pk = Math.floor(k);
        const fk = (k - pk) * PL;
        const tone = Math.floor(hash2(pr, pk, 5) * pal.length);
        c = pal[tone];
        const gx = Math.floor(X * 6 + hash2(pr, pk, 9) * 40);
        const g = hash2(gx, pr * 4 + Math.floor(pf * 3), pk);
        if (g < 0.2) amt -= 0.055;
        else if (g > 0.93) amt += 0.05;
        if (hash2(px, py, 2) < 0.06) amt += 0.025;
        if (pf < 0.13) amt -= 0.17;
        else if (pf < 0.26) amt += 0.04;
        if (fk < 0.035) amt -= 0.2;
        else if (fk < 0.07) amt += 0.03;
      } else {
        const border = tx === 0 || ty === 0 || tx === W - 1 || ty === H - 1;
        c = border ? pal[2] : (tx + ty) & 1 ? pal[1] : pal[0];
        const n = hash2(px, py, 1);
        if (n < 0.14) amt += 0.045;
        else if (n < 0.3) amt -= 0.04;
        if (((px >> 1) + (py >> 1)) & 1) amt -= 0.012;
        const e = 0.04;
        if (u < e) amt += 0.11;
        else if (v < e) amt += 0.05;
        if (u > 1 - e) amt -= 0.12;
        else if (v > 1 - e) amt -= 0.08;
        if (Math.abs(u - 0.5) + Math.abs(v - 0.5) < 0.05 && !border) amt += 0.035;
      }
      // contact shadow where the floor meets the walls
      if (ty === 0) amt -= quant((1 - v / 0.5) * 0.17, px, py);
      if (tx === 0) amt -= quant((1 - u / 0.5) * 0.13, px, py);
      let out = shadeRgb(c, amt);
      if (theme.fx === 'hall') out = hallFx(out, X, Y, px, py, W, H);
      else if (theme.fx === 'tech') out = techFx(out, X, Y, px, py);
      // window light pools
      let beam = 0;
      for (const s of spots) {
        const along = s.side === 'n' ? X : Y;
        const depth = s.side === 'n' ? Y : X;
        if (depth < 0.1) continue;
        const rel = (along - 0.58 * depth - s.t - 0.125) / 0.75;
        if (rel < 0 || rel > 1) continue;
        if (Math.abs(rel - 0.5) < 0.035) continue;
        const soft = Math.min(1, Math.min(rel, 1 - rel) / 0.12);
        const fall = Math.max(0, 1 - depth / 3.2);
        beam += 0.24 * soft * fall * Math.min(1, (depth - 0.1) / 0.5);
      }
      if (beam > 0.01) {
        const bq = quant(beam, px, py);
        if (bq > 0) {
          const bi = (py * cw + px) * 4;
          br.data[bi] = warm[0];
          br.data[bi + 1] = warm[1];
          br.data[bi + 2] = warm[2];
          br.data[bi + 3] = Math.round(bq * 255);
        }
      }
      r.set(px, py, out);
    }
  }

  const layer: Layer = { canvas: r.toCanvas(), ox, oy, beams: spots.length ? br.toCanvas() : undefined };
  layerCache.set(`floor:${room.def.id}`, layer);
  return layer;
}

const SPOTS: ReadonlyArray<readonly [number, number, number, number, RGB]> = [
  [6.4, 4.55, 1.5, 0.75, [255, 228, 170]],
  [9.0, 4.65, 1.7, 0.8, [150, 214, 255]],
  [11.6, 4.55, 1.5, 0.75, [255, 168, 222]],
];

/** Auditorium floor: lit aisle, pools from the stage spots, spill at the stage front and the entrance mat. */
function hallFx(c: RGB, X: number, Y: number, px: number, py: number, W: number, H: number): RGB {
  let out = c;
  // fine diagonal pinstripe, like broadloom carpet
  if ((px + py * 2) % 14 === 0) out = shadeRgb(out, 0.028);
  // aisle: lit edge strips with a soft glow
  if (X >= 7.82 && X < 10.18 && Y >= 4 && Y < H) {
    const d = Math.min(Math.abs(X - 8.03), Math.abs(X - 9.97));
    if (X >= 8.0 && X <= 10.0) out = mixRgb(out, [70, 84, 130], 0.22);
    if (d < 0.04) out = mixRgb(out, [150, 235, 255], 0.95);
    else if (d < 0.2) out = mixRgb(out, [100, 205, 245], quant(0.28 * (1 - d / 0.2), px, py));
  }
  // spill of the stage front
  if (X > 5 && X < W - 5 && Y >= 4 && Y < 4.6) out = mixRgb(out, [255, 236, 190], quant(0.2 * (1 - (Y - 4) / 0.6), px, py));
  for (const [cx, cy, rx, ry, col] of SPOTS) {
    const e = ((X - cx) / rx) ** 2 + ((Y - cy) / ry) ** 2;
    if (e < 1) out = mixRgb(out, col, quant(0.3 * (1 - e), px, py));
  }
  // entrance mat
  if (X >= 0.06 && X < 2 && Y >= 8.06 && Y < 10) {
    const m = Math.min(X - 0.06, 2 - X, Y - 8.06, 10 - Y);
    if (m < 0.06) out = [150, 235, 255];
    else if (m < 0.14) out = [34, 38, 60];
    else out = (Math.floor(X * 8) + Math.floor(Y * 8)) & 1 ? [58, 66, 100] : [50, 57, 90];
  }
  return out;
}

function slabColumn(r: Raster, x: number, top: number, edge: number, east: boolean, lip: RGB, base: RGB, seed: number) {
  const body = shadeRgb(base, east ? -0.5 : -0.36);
  for (let i = 0; i < SLAB; i++) {
    let c: RGB;
    if (i === 0) c = lip;
    else if (i === 1) c = shadeRgb(body, 0.1);
    else if (i >= SLAB - 1) c = shadeRgb(body, -0.5);
    else {
      const g = (i - 2) / (SLAB - 3);
      c = shadeRgb(body, -0.2 * g - (bayer(x, top + i) < g * 0.6 ? 0.05 : 0));
      if (hash2(x >> 1, i, seed >> 5) < 0.07) c = shadeRgb(c, 0.05);
    }
    if (edge) c = shadeRgb(c, -0.12);
    r.set(x, top + i, c);
  }
}

// ---------------------------------------------------------------------------
// Walls

interface WallColors {
  paperA: RGB;
  wains: RGB;
  trim: RGB;
  style: Theme['paper'];
  wood: boolean;
}

/** Auditorium wall: alternating quilted fabric and walnut slat acoustic panels under a lit cove. */
function acousticPixel(side: 'n' | 'w', a: number, z: number): RGB {
  const H = WALL_H;
  const dk = side === 'w' ? -0.1 : 0;
  const cove: Record<number, RGB> = {
    [H - 8]: [28, 36, 66],
    [H - 9]: [120, 204, 244],
    [H - 10]: [220, 247, 255],
    [H - 11]: [120, 204, 244],
    [H - 12]: [56, 92, 150],
    [H - 13]: [34, 46, 86],
  };
  if (cove[z]) return side === 'w' ? shadeRgb(cove[z], -0.06) : cove[z];
  if (z <= 38 || z === H - 7) return shadeRgb([16, 19, 34], dk);
  const mod = Math.floor(a / 32);
  const pa = ((a % 32) + 32) % 32;
  const zp = z - 39;
  let c: RGB;
  if (mod % 3 === 1) {
    // walnut slats
    const slat = Math.floor(pa / 4);
    const wood: RGB = [168, 112, 66];
    const r = hash2(mod * 8 + slat, 3, 17);
    c = shadeRgb(wood, (r - 0.5) * 0.18);
    const sp = pa % 4;
    if (sp === 3) c = [42, 28, 22];
    else if (sp === 0) c = shadeRgb(c, 0.1);
    if (hash2(a, z >> 2, 9) < 0.08) c = shadeRgb(c, -0.07);
  } else {
    const base: RGB = mod % 3 === 0 ? [62, 76, 122] : [52, 64, 108];
    c = base;
    const ap = pa % 16;
    const d = Math.abs(ap - 8) + Math.abs((((zp % 16) + 16) % 16) - 8);
    if (d === 8) c = shadeRgb(c, -0.16);
    else if (d <= 1) c = shadeRgb(c, 0.1);
    if (hash2(a, z, 6) < 0.05) c = shadeRgb(c, -0.05);
    if (pa === 0) c = shadeRgb(c, 0.1);
    else if (pa === 31) c = shadeRgb(c, -0.25);
  }
  // panel frame (top and bottom) and the glow from the cove
  if (z === 39) c = shadeRgb(c, -0.3);
  if (z < H - 13 && z > H - 30) c = mixRgb(c, [110, 200, 245], 0.2 * (1 - (H - 13 - z) / 17));
  return shadeRgb(c, dk);
}

/** LED strips of the IT room floor: a path from the door, a loop around the command desk and the edges of the server aisle. */
const LED_STRIPS: ReadonlyArray<readonly [number, number, number, number]> = [
  [0.2, 5.5, 3.6, 5.5],
  [3.6, 3.6, 9.4, 3.6],
  [9.4, 3.6, 9.4, 7.6],
  [9.4, 7.6, 3.6, 7.6],
  [3.6, 7.6, 3.6, 3.6],
  [9.4, 5.6, 17.6, 5.6],
  [10.3, 1.12, 17.6, 1.12],
  [10.3, 2.88, 17.6, 2.88],
  [10.3, 1.12, 10.3, 2.88],
];

function techFx(c: RGB, X: number, Y: number, px: number, py: number): RGB {
  let out = c;
  let best = 9;
  for (const [x0, y0, x1, y1] of LED_STRIPS) {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const t = Math.max(0, Math.min(1, ((X - x0) * dx + (Y - y0) * dy) / (dx * dx + dy * dy)));
    const d = Math.hypot(X - (x0 + dx * t), Y - (y0 + dy * t));
    if (d < best) best = d;
  }
  if (best < 0.035) out = mixRgb(out, [170, 245, 255], 0.95);
  else if (best < 0.07) out = mixRgb(out, [53, 216, 255], 0.7);
  else if (best < 0.12) out = mixRgb(out, [40, 170, 230], 0.4);
  else if (best < 0.2) out = mixRgb(out, [40, 170, 230], 0.16);
  return out;
}

/** IT room wall: graphite metal panels, a cyan LED cove under the crown and a faint cable light near the floor panelling. */
function techPixel(side: 'n' | 'w', a: number, z: number): RGB {
  const H = WALL_H;
  const dk = side === 'w' ? -0.1 : 0;
  const cove: Record<number, RGB> = {
    [H - 8]: [20, 26, 48],
    [H - 9]: [60, 200, 245],
    [H - 10]: [190, 245, 255],
    [H - 11]: [60, 200, 245],
    [H - 12]: [34, 80, 130],
    [H - 13]: [26, 34, 62],
  };
  const cv = cove[z];
  if (cv) return shadeRgb(cv, dk);
  const mod = Math.floor(a / 32);
  const pa = ((a % 32) + 32) % 32;
  let c: RGB = mod % 2 === 0 ? [44, 54, 86] : [38, 47, 78];
  if (pa === 0) c = shadeRgb(c, 0.16);
  else if (pa === 31) c = shadeRgb(c, -0.3);
  else if (pa === 16 && z % 8 < 4) c = shadeRgb(c, 0.06);
  if (z === 39) c = shadeRgb(c, -0.3);
  if (z === 40) c = [53, 216, 255];
  else if (z === 41) c = mixRgb(c, [53, 216, 255], 0.3);
  if (z < H - 13 && z > H - 28) c = mixRgb(c, [90, 200, 245], 0.14 * (1 - (H - 13 - z) / 15));
  if (hash2(a, z, 6) < 0.05) c = shadeRgb(c, -0.05);
  return shadeRgb(c, dk);
}

/** One pixel of the textured wall face: `a` px along the wall, `z` px above the floor. */
function wallPixel(t: WallColors, side: 'n' | 'w', a: number, z: number): RGB {
  const H = WALL_H;
  let c: RGB;
  let amt = side === 'w' ? -0.1 : 0;
  if (z >= H - 6) {
    c = t.trim;
    amt += [0.32, 0.14, 0, -0.1, -0.2, -0.32][H - 1 - z];
  } else if (z >= 37) {
    if (t.style === 'acoustic') return acousticPixel(side, a, z);
    if (t.style === 'tech') return techPixel(side, a, z);
    c = t.paperA;
    const ap = ((a % 16) + 16) % 16;
    const zp = z - 37;
    if (t.style === 'plain') {
      // painted wall: faint vertical roller marks and speckle instead of a pattern
      amt += ap < 8 ? 0.012 : -0.008;
      if (hash2(a >> 1, z >> 1, 14) < 0.07) amt -= 0.022;
    } else if (t.style === 'stripe') {
      amt += ap < 8 ? 0.022 : -0.012;
      if (ap < 2) amt -= 0.045;
      const zz = (zp + (ap >= 8 ? 7 : 0)) % 14;
      const cx = ap >= 8 ? 12 : 4;
      if ((ap === cx && zz >= 5 && zz <= 7) || (zz === 6 && Math.abs(ap - cx) === 1)) amt -= 0.075;
    } else {
      const d = Math.abs(ap - 8) + Math.abs(((zp % 16) + 16) % 16 - 8);
      if (d === 8) amt -= 0.075;
      else if (d <= 1) amt += 0.08;
      else if (d === 4 && (ap + zp) % 2 === 0) amt += 0.02;
    }
    if (hash2(a, z, 4) < 0.04) amt -= 0.02;
    if (z === H - 7) amt -= 0.24;
    else if (z === H - 8) amt -= 0.12;
    else if (z === H - 9) amt -= 0.05;
    else if (z === 37) amt -= 0.12;
    else if (z === 38) amt -= 0.05;
  } else if (z >= 34) {
    c = t.trim;
    amt += z === 36 ? 0.3 : z === 35 ? 0.02 : -0.2;
  } else if (z >= 8) {
    c = t.wains;
    const pa = ((a % 32) + 32) % 32;
    if (t.wood) {
      // vertical boards with grain
      const board = (a >> 3) % 2 === 0 ? 0.02 : -0.02;
      amt += board;
      if (a % 8 === 0) amt -= 0.16;
      else if (a % 8 === 1) amt += 0.04;
      if (hash2(a, z >> 2, 8) < 0.12) amt -= 0.05;
    }
    const inPanel = pa >= 4 && pa < 28 && z >= 12 && z <= 29;
    if (inPanel) {
      if (pa === 4 || z === 29) amt -= 0.16;
      else if (pa === 27 || z === 12) amt += 0.09;
      else amt -= 0.02;
    } else if (z === 33) {
      amt -= 0.22;
    }
    if (z === 8) amt -= 0.12;
  } else {
    c = t.wains;
    amt += z === 7 ? 0.28 : z === 0 ? -0.5 : z === 1 ? -0.4 : -0.28 + (z > 4 ? 0.05 : 0);
  }
  if (a < 7) amt -= (7 - a) * 0.02;
  return shadeRgb(c, amt);
}

/** Glass rectangle of a window in plane coordinates (used by the day-cycle sky). */
export function windowGlass(s: WindowSpot) {
  const a0 = s.t * 32 + 4;
  return { a0: a0 + 1, a1: a0 + 23, zb: 45, zt: 89 };
}

function renderWindow(ctx: CanvasRenderingContext2D, p: Plane, a0: number, trim: string, side: 'n' | 'w') {
  const W = 24;
  const Hh = 46;
  const z0 = 44;
  const dk = side === 'w' ? -0.1 : 0;
  const T = shade(trim, dk);
  const outlineC = shade(trim, -0.5 + dk);
  p.rect(a0 - 3, a0 + W + 3, z0 - 3, z0 + Hh + 3, outlineC);
  p.rect(a0 - 2, a0 + W + 2, z0 - 2, z0 + Hh + 2, T);
  // bevel on the molding
  p.rect(a0 - 2, a0 + W + 2, z0 + Hh + 1, z0 + Hh + 2, shade(T, 0.25));
  p.rect(a0 - 2, a0 - 1, z0 - 2, z0 + Hh + 2, shade(T, 0.15));
  p.rect(a0 + W + 1, a0 + W + 2, z0 - 2, z0 + Hh + 1, shade(T, -0.14));
  // glass
  const g0 = a0 + 1;
  const g1 = a0 + W - 1;
  const zb = z0 + 1;
  const zt = z0 + Hh - 1;
  // the glass is a hole in the wall: the sky behind it is a separate layer (dayCycle.ts) that follows the hour
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  p.rect(g0, g1, zb, zt, '#000');
  ctx.restore();
  p.rectFn(g0, g1, zb, zt, (a, z) => {
    let c: string | null = side === 'w' ? 'rgba(0,0,30,0.07)' : null;
    // glare streaks
    if ((a + z) % 22 <= 1 && (zt - z) / (zt - zb) > 0.1) c = 'rgba(255,255,255,0.16)';
    // shadow of the left and top reveal
    if (a - g0 < 2 || zt - 1 - z < 2) c = a - g0 < 1 || zt - 1 - z < 1 ? 'rgba(20,16,40,0.3)' : 'rgba(20,16,40,0.15)';
    return c;
  });
  // mullions
  const mid = a0 + (W >> 1) - 1;
  p.rect(mid, mid + 2, zb, zt, T);
  p.rect(mid, mid + 1, zb, zt, shade(T, 0.12));
  p.rect(mid + 1, mid + 2, zb, zt, shade(T, -0.12));
  const mz = z0 + Math.round(Hh * 0.42);
  p.rect(g0, g1, mz, mz + 2, T);
  p.rect(g0, g1, mz + 1, mz + 2, shade(T, -0.12));
  // sill
  p.rect(a0 - 4, a0 + W + 4, z0 - 6, z0 - 3, shade(T, 0.05));
  p.rect(a0 - 4, a0 + W + 4, z0 - 4, z0 - 3, shade(T, -0.2));
  p.rect(a0 - 4, a0 + W + 4, z0 - 3, z0 - 2, shade(T, 0.3));
  p.rect(a0 - 4, a0 + W + 4, z0 - 7, z0 - 6, outlineC);
  // shadow cast below the sill
  p.rectFn(a0 - 3, a0 + W + 3, z0 - 12, z0 - 7, (a, z) => (bayer(a, z) < (z - (z0 - 12)) / 5 ? null : 'rgba(30,25,50,0.16)'));
  void ctx;
}

function renderDoor(p: Plane, a0: number, theme: Theme, side: 'n' | 'w') {
  const dk = side === 'w' ? -0.1 : 0;
  const W = 26;
  const leaf = shade(theme.door, dk);
  const frame = shade(theme.door, -0.4 + dk);
  const trim = shade(theme.trim, dk);
  const Z = 82;
  // architrave
  p.rect(a0 - 2, a0 + W + 2, 0, Z + 5, shade(trim, -0.55));
  p.rect(a0 - 1, a0 + W + 1, 0, Z + 4, trim);
  p.rect(a0 - 1, a0, 0, Z + 4, shade(trim, 0.2));
  p.rect(a0 + W, a0 + W + 1, 0, Z + 4, shade(trim, -0.15));
  p.rect(a0 - 1, a0 + W + 1, Z + 3, Z + 4, shade(trim, 0.3));
  // jamb (dark opening)
  p.rect(a0 + 1, a0 + W - 1, 0, Z, frame);
  // leaf
  const l0 = a0 + 3;
  const l1 = a0 + W - 2;
  p.rectFn(l0, l1, 0, Z - 3, (a, z) => {
    let c = leaf;
    if (hash2(a, z >> 1, 6) < 0.1) c = shade(c, -0.07);
    if (a === l0) c = shade(leaf, -0.2);
    return c;
  });
  const panel = (z0: number, z1: number) => {
    p.rect(l0 + 3, l1 - 2, z0, z1, shade(leaf, 0.2));
    p.rect(l0 + 4, l1 - 3, z0 + 1, z1 - 1, shade(leaf, -0.05));
    p.rect(l0 + 3, l1 - 2, z0, z0 + 1, shade(leaf, -0.28));
    p.rect(l1 - 3, l1 - 2, z0, z1, shade(leaf, -0.28));
  };
  panel(34, 74);
  panel(9, 31);
  // kick plate
  p.rectFn(l0, l1, 0, 5, (a, z) => (z === 4 ? '#e6e8ec' : z === 0 ? '#6b717e' : '#aeb4c0'));
  // handle
  p.rect(l1 - 6, l1 - 3, 38, 42, '#8a6a1a');
  p.rect(l1 - 6, l1 - 4, 39, 42, '#f2cf5c');
  p.px(l1 - 6, 41, '#fff2b0');
  // hinges
  p.rect(l0, l0 + 1, 12, 17, '#2b2f3a');
  p.rect(l0, l0 + 1, 62, 67, '#2b2f3a');
  // exit sign
  const sa = a0 + (W >> 1) - 8;
  p.rect(sa - 1, sa + 17, Z + 7, Z + 14, '#16301f');
  p.rectFn(sa, sa + 16, Z + 8, Z + 13, (a, z) => (z === Z + 8 ? '#2f9d55' : '#58e08a'));
  p.rect(sa + 3, sa + 12, Z + 10, Z + 11, '#e9fff1');
  p.px(sa + 11, Z + 11, '#e9fff1');
  p.px(sa + 11, Z + 9, '#e9fff1');
  p.px(sa + 10, Z + 10, '#e9fff1');
}

/** Two back walls along the north (y=0) and west (x=0) edges, with doors and windows. */
export function renderWalls(room: BuiltRoom, theme: Theme): Layer {
  const cached = layerCache.get(`walls:${room.def.id}`);
  if (cached) return cached;
  const { width: W, height: H } = room.grid;
  const ox = H * 32 + PAD;
  const oy = WALL_H + PAD;
  const { canvas, ctx } = createCanvas((W + H) * 32 + PAD * 2, WALL_H + (W + H) * 16 + PAD * 2);
  const T = 0.22;

  const portalsN = new Set(room.def.portals.filter((p) => p.y === 0).map((p) => p.x));
  const portalsW = new Set(room.def.portals.filter((p) => p.x === 0).map((p) => p.y));

  // wall bodies (shape, top cap and end faces)
  const capTop = shade(theme.trim, -0.02);
  drawBox(ctx, ox, oy, { x: -T, y: -T, z: 0, w: T, d: H + T, h: WALL_H, top: capTop, left: shade(theme.wallB, -0.15), right: theme.wallB, flat: true });
  drawBox(ctx, ox, oy, { x: 0, y: -T, z: 0, w: W, d: T, h: WALL_H, top: capTop, left: theme.wallA, right: shade(theme.wallA, -0.2), flat: true });

  // textured faces
  const colors: WallColors = {
    paperA: hexToRgb(theme.wallA),
    wains: hexToRgb(theme.wains),
    trim: hexToRgb(theme.trim),
    style: theme.paper,
    wood: theme.floorStyle === 'wood',
  };
  const wr = new Raster(canvas.width, canvas.height);
  const faceW = (side: 'n' | 'w', len: number) => {
    const wallColors = side === 'w' ? { ...colors, paperA: hexToRgb(theme.wallB) } : colors;
    for (let a = 0; a < len; a++) {
      const px = side === 'n' ? ox + a : ox - 1 - a;
      const by = (a + 1) >> 1;
      for (let z = 0; z < WALL_H; z++) wr.set(px, oy + by - 1 - z, wallPixel(wallColors, side, a, z));
    }
  };
  faceW('w', H * 32);
  faceW('n', W * 32);
  ctx.drawImage(wr.toCanvas(), 0, 0);

  const north = new Plane(ctx, 'n', ox, oy);
  const west = new Plane(ctx, 'w', ox, oy);
  for (const s of windowSpots(room, theme)) renderWindow(ctx, s.side === 'n' ? north : west, s.t * 32 + 4, theme.trim, s.side);
  for (const x of portalsN) renderDoor(north, x * 32 + 3, theme, 'n');
  for (const y of portalsW) renderDoor(west, y * 32 + 3, theme, 'w');

  if (theme.paper === 'acoustic') hallDecor(ctx, north, west);

  // light catch on the corner post
  ctx.fillStyle = shade(theme.trim, 0.3);
  ctx.fillRect(ox - 1, oy - WALL_H + 1, 2, WALL_H - 1);
  ctx.fillStyle = 'rgba(30,25,50,0.35)';
  ctx.fillRect(ox - 1, oy - 1, 2, 1);

  const layer: Layer = { canvas, ox, oy };
  layerCache.set(`walls:${room.def.id}`, layer);
  return layer;
}

/** Auditorium wall dressing: LED backdrop and curtains behind the screen, track spots, emergency exit sign and extinguisher. */
function hallDecor(ctx: CanvasRenderingContext2D, north: Plane, west: Plane) {
  // LED backdrop (the projection screen is drawn over its middle)
  const L0 = 176;
  const L1 = 392;
  north.rect(L0 - 2, L1 + 2, 4, 98, '#0c0e15');
  north.rectFn(L0, L1, 6, 96, (a, z) => {
    const u = (a - L0) / (L1 - L0);
    const v = (z - 6) / 90;
    const cell = (a % 4 === 0 || z % 4 === 0) ? 0.55 : 1;
    const wave = 0.5 + 0.5 * Math.sin(u * 9 + v * 3);
    const r = 40 + 150 * (1 - v) * wave + 30 * v;
    const g = 40 + 70 * v * (1 - wave) + 40 * wave;
    const b = 120 + 110 * v + 40 * wave;
    const spark = hash2(a >> 2, z >> 2, 31) < 0.1 ? 1.35 : 1;
    const k = cell * spark;
    return `rgb(${Math.min(255, Math.round(r * k * 0.8))},${Math.min(255, Math.round(g * k * 0.8))},${Math.min(255, Math.round(b * k * 0.9))})`;
  });
  // velvet curtains on both sides, gathered at the floor, with a scalloped valance
  const curtain = (a0: number, a1: number) => {
    north.rectFn(a0, a1, 3, 96, (a, z) => {
      const f = Math.sin((a - a0) * 0.62) * 0.5 + 0.5;
      const gather = z < 14 ? 0.1 * (14 - z) / 14 : 0;
      const c = shade('#8a1f45', (f - 0.45) * 0.55 - gather);
      return a === a0 ? shade('#8a1f45', -0.5) : c;
    });
    north.rectFn(a0, a1, 86, 98, (a, z) => {
      const scallop = 88 + Math.round(Math.abs(Math.sin((a - a0) * 0.2)) * 6);
      if (z < 86 || z > scallop + 8) return null;
      return z > scallop ? shade('#c63a68', 0.12 + (z - scallop) * 0.03) : shade('#8a1f45', -0.2);
    });
  };
  curtain(160, 180);
  curtain(388, 416);
  // track lighting with faint light cones on the wall
  for (const [t0, t1] of [[6, 156], [430, 540]] as const) {
    north.rect(t0, t1, 90, 92, '#14161d');
    north.rect(t0, t1, 91, 92, '#3a3f4c');
    for (let ah = t0 + 14; ah < t1 - 6; ah += 34) {
      north.rect(ah - 3, ah + 3, 86, 90, '#1b1e28');
      north.rect(ah - 2, ah + 2, 85, 86, '#ffe9b0');
      for (let z = 84; z > 48; z--) {
        const hw = 2 + (85 - z) * 0.32;
        const al = 0.09 * (1 - (85 - z) / 38);
        north.rect(Math.round(ah - hw), Math.round(ah + hw), z, z + 1, `rgba(255,236,180,${al.toFixed(3)})`);
      }
    }
  }
  // emergency exit sign (west wall) pointing toward the door, and a fire extinguisher
  const a0 = 7 * 32 + 5;
  west.rect(a0 - 4, a0 + 32, 66, 90, 'rgba(88,224,138,0.10)');
  west.rect(a0 - 1, a0 + 27, 70, 84, '#0d2a18');
  west.rectFn(a0, a0 + 26, 71, 83, (a, z) => (z === 71 ? '#2f9d55' : z === 82 ? '#7dffb0' : '#3fc774'));
  const man: ReadonlyArray<readonly [number, number]> = [[4, 9], [4, 8], [3, 7], [4, 7], [5, 7], [2, 6], [4, 6], [6, 6], [3, 5], [5, 5], [2, 4], [6, 4]];
  for (const [da, dz] of man) west.px(a0 + 1 + da, 71 + dz - 3, '#f2fff6');
  west.rect(a0 + 12, a0 + 22, 76, 77, '#f2fff6');
  west.line(a0 + 22, 76, a0 + 19, 79, '#f2fff6');
  west.line(a0 + 22, 76, a0 + 19, 73, '#f2fff6');
  const e0 = 8 * 32 + 8;
  west.rect(e0 - 1, e0 + 9, 22, 48, 'rgba(25,20,45,0.22)');
  west.rect(e0 + 1, e0 + 7, 26, 31, '#2b2f3a');
  west.rect(e0, e0 + 8, 24, 44, '#c8372d');
  west.rect(e0, e0 + 2, 24, 44, '#e8574a');
  west.rect(e0 + 6, e0 + 8, 24, 44, '#8f2219');
  west.rect(e0 + 1, e0 + 7, 44, 47, '#2b2f3a');
  west.rect(e0 + 1, e0 + 7, 32, 38, '#f4f1ea');
  west.rect(e0 + 3, e0 + 5, 34, 36, '#c8372d');
  west.rect(e0 + 6, e0 + 10, 46, 47, '#14161d');
  void ctx;
}
