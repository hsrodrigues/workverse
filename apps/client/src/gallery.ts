/** Dev-only art gallery: http://localhost:5173/gallery.html (no server or login needed). */
import { DEFAULT_AVATAR, ROOM_DEFS, buildRoom, footprint, randomAvatar, tileToScreen, type AvatarConfig, type BuiltRoom, type Furniture } from '@workverse/shared';
import { FH, FRAME_COUNT, FW, VIEWS, buildAvatarSheet } from './game/avatarRenderer';
import { renderFurniture } from './game/furniture';
import { THEMES, renderFloor, renderWalls, type Theme } from './game/roomArt';

const app = document.getElementById('app')!;
const SCALE = 4;
const AVATAR_SCALE = 3;

function section(title: string) {
  const h = document.createElement('h2');
  h.textContent = title;
  app.appendChild(h);
}

function show(canvas: HTMLCanvasElement, scale = 1, name?: string) {
  const c = document.createElement('canvas');
  c.width = canvas.width * scale;
  c.height = canvas.height * scale;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(canvas, 0, 0, c.width, c.height);
  if (name) c.dataset.name = name;
  app.appendChild(c);
}

/** Crops transparent margins so tall sprites do not waste screen space. */
function trimmed(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const ctx = canvas.getContext('2d')!;
  const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  let x0 = width, y0 = height, x1 = 0, y1 = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (data[(y * width + x) * 4 + 3] > 0) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  const c = document.createElement('canvas');
  c.width = Math.max(1, x1 - x0 + 1);
  c.height = Math.max(1, y1 - y0 + 1);
  c.getContext('2d')!.drawImage(canvas, x0, y0, c.width, c.height, 0, 0, c.width, c.height);
  return c;
}

function avatarStrip(cfg: AvatarConfig, view: number) {
  const sheet = buildAvatarSheet(cfg);
  const c = document.createElement('canvas');
  c.width = FW * FRAME_COUNT;
  c.height = FH;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(sheet, 0, view * FH, FW * FRAME_COUNT, FH, 0, 0, FW * FRAME_COUNT, FH);
  show(c, AVATAR_SCALE);
}

section('Avatar padrão: ' + VIEWS.join(', ') + ' (2 parado, 6 passos, 2 sentado, 3 acenos)');
VIEWS.forEach((_, i) => avatarStrip(DEFAULT_AVATAR, i));

section('Variações');
let seed = 7;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
for (let i = 0; i < 10; i++) {
  const sheet = buildAvatarSheet(randomAvatar(rand));
  const c = document.createElement('canvas');
  c.width = FW * 4;
  c.height = FH;
  for (let v = 0; v < 4; v++) c.getContext('2d')!.drawImage(sheet, 0, v * FH, FW, FH, v * FW, 0, FW, FH);
  show(c, 2);
}

section('Móveis');
const kinds: Furniture[] = [
  { id: 'a', kind: 'desk', x: 0, y: 0, dir: 0 },
  { id: 'a2', kind: 'computer', x: 0, y: 0, dir: 0 },
  { id: 'a3', kind: 'computer', x: 1, y: 0, dir: 3 },
  { id: 'b', kind: 'chair', x: 0, y: 0, dir: 1 },
  { id: 'c', kind: 'chair', x: 0, y: 0, dir: 3 },
  { id: 'd', kind: 'sofa', x: 0, y: 0, dir: 1 },
  { id: 'd1b', kind: 'sofa', x: 0, y: 0, dir: 0 },
  { id: 'e', kind: 'plant', x: 0, y: 0, dir: 0 },
  { id: 'f', kind: 'bookshelf', x: 0, y: 0, dir: 0 },
  { id: 'g', kind: 'table', x: 0, y: 0, dir: 0 },
  { id: 'h', kind: 'coffee', x: 0, y: 0, dir: 1 },
  { id: 'i', kind: 'rug', x: 0, y: 0, dir: 0 },
];
for (const f of kinds) show(trimmed(renderFurniture(f, f.id === 'a2').canvas), 3);

section('Novos móveis');
const novos: Furniture[] = [
  { id: 'n1', kind: 'cooler', x: 0, y: 0, dir: 1 },
  { id: 'n2', kind: 'bin', x: 0, y: 0, dir: 0 },
  { id: 'n3', kind: 'printer', x: 0, y: 0, dir: 0 },
  { id: 'n4', kind: 'printer', x: 0, y: 0, dir: 1 },
  { id: 'n5', kind: 'lamp', x: 0, y: 0, dir: 0 },
  { id: 'n6', kind: 'basket', x: 0, y: 0, dir: 0 },
  { id: 'n7', kind: 'divider', x: 0, y: 0, dir: 0 },
  { id: 'n8', kind: 'whiteboard', x: 0, y: 0, dir: 0 },
  { id: 'n9', kind: 'frame', x: 0, y: 0, dir: 0 },
  { id: 'n10', kind: 'frame', x: 1, y: 0, dir: 0 },
  { id: 'n11', kind: 'frame', x: 2, y: 0, dir: 0 },
  { id: 'n12', kind: 'whiteboard', x: 0, y: 0, dir: 1 },
];
for (const f of novos) show(trimmed(renderFurniture(f).canvas), 3);

section('Móveis modernos (copa, lounge e escritório)');
const modernos: Furniture[] = [
  { id: 'm1', kind: 'counter', x: 0, y: 0, dir: 0 },
  { id: 'm2', kind: 'coffee', x: 0, y: 0, dir: 1 },
  { id: 'm3', kind: 'fridge', x: 0, y: 0, dir: 1 },
  { id: 'm4', kind: 'armchair', x: 0, y: 0, dir: 1 },
  { id: 'm5', kind: 'armchair', x: 0, y: 0, dir: 0 },
  { id: 'm6', kind: 'pouf', x: 0, y: 0, dir: 1 },
  { id: 'm7', kind: 'pouf', x: 1, y: 0, dir: 1 },
  { id: 'm8', kind: 'stool', x: 0, y: 0, dir: 1 },
  { id: 'm9', kind: 'high_table', x: 0, y: 0, dir: 0 },
  { id: 'm10', kind: 'glass_divider', x: 0, y: 0, dir: 0 },
  { id: 'm11', kind: 'glass_divider', x: 0, y: 0, dir: 1 },
  { id: 'm12', kind: 'tv', x: 0, y: 0, dir: 0 },
  { id: 'm13', kind: 'clock', x: 0, y: 0, dir: 0 },
  { id: 'm14', kind: 'chair', x: 0, y: 0, dir: 1 },
  { id: 'm15', kind: 'chair', x: 1, y: 0, dir: 3 },
  { id: 'm16', kind: 'rug', x: 0, y: 0, dir: 0 },
  { id: 'm17', kind: 'rug', x: 1, y: 0, dir: 0 },
  { id: 'm18', kind: 'reception_desk', x: 0, y: 0, dir: 0 },
  { id: 'm19', kind: 'logo', x: 0, y: 0, dir: 0 },
  { id: 'net1', kind: 'router', x: 0, y: 0, dir: 0 },
  { id: 'net2', kind: 'rack', x: 0, y: 0, dir: 1 },
  { id: 'net3', kind: 'cable_tray', x: 0, y: 0, dir: 0 },
  { id: 'net4', kind: 'auditorium_seat', x: 0, y: 0, dir: 3 },
  { id: 'net5', kind: 'rug', x: 0, y: 0, dir: 1 },
  { id: 'net6', kind: 'router', x: 0, y: 0, dir: 1 },
  { id: 'tvs0', kind: 'tv_stand', x: 0, y: 0, dir: 0 },
  { id: 'tvs1', kind: 'tv_stand', x: 0, y: 0, dir: 1 },
  { id: 'tvs2', kind: 'tv_stand', x: 0, y: 0, dir: 2 },
  { id: 'ti1', kind: 'server_rack', x: 0, y: 0, dir: 1 },
  { id: 'ti2', kind: 'server_rack', x: 1, y: 0, dir: 1 },
  { id: 'ti3', kind: 'command_desk', x: 0, y: 0, dir: 0 },
  { id: 'ti4', kind: 'command_desk', x: 0, y: 0, dir: 1 },
  { id: 'ti5', kind: 'command_desk', x: 0, y: 0, dir: 3 },
  { id: 'ti6', kind: 'ergo_chair', x: 0, y: 0, dir: 1 },
  { id: 'ti7', kind: 'videowall', x: 0, y: 0, dir: 0 },
  { id: 'ti8', kind: 'arch_board', x: 0, y: 0, dir: 0 },
  { id: 'ti9', kind: 'hardware_bench', x: 0, y: 0, dir: 0 },
  { id: 'ti10', kind: 'espresso', x: 0, y: 0, dir: 0 },
  { id: 'vm1', kind: 'snack_machine', x: 0, y: 0, dir: 1 },
  { id: 'vm2', kind: 'soda_machine', x: 0, y: 0, dir: 1 },
  { id: 'vm3', kind: 'microwave', x: 0, y: 0, dir: 1 },
  { id: 'vm4', kind: 'snack_machine', x: 0, y: 0, dir: 0 },
  { id: 'vm5', kind: 'soda_machine', x: 0, y: 0, dir: 0 },
  { id: 'vm6', kind: 'microwave', x: 0, y: 0, dir: 0 },
];
for (const f of modernos) show(trimmed(renderFurniture(f).canvas), 3, `fu-${f.id}`);

section('Clima (ar-condicionado, termostato) e console NOC');
const clima: Array<[Furniture, boolean, number]> = [
  [{ id: 'ac1', kind: 'ac_split', x: 0, y: 0, dir: 0 }, false, 23],
  [{ id: 'ac2', kind: 'ac_split', x: 0, y: 0, dir: 0 }, true, 22],
  [{ id: 'ac3', kind: 'ac_split', x: 0, y: 0, dir: 1 }, true, 18],
  // LED por modo (opt = indice do modo * 100 + meta): Eco verde, Ventilar branco, Auto ambar
  [{ id: 'ac2e', kind: 'ac_split', x: 0, y: 0, dir: 0 }, true, 124],
  [{ id: 'ac2f', kind: 'ac_split', x: 0, y: 0, dir: 0 }, true, 223],
  [{ id: 'ac2a', kind: 'ac_split', x: 0, y: 0, dir: 0 }, true, 322],
  [{ id: 'ac5e', kind: 'ac_floor', x: 0, y: 0, dir: 1 }, true, 124],
  [{ id: 'ac4', kind: 'ac_floor', x: 0, y: 0, dir: 1 }, false, 23],
  [{ id: 'ac5', kind: 'ac_floor', x: 0, y: 0, dir: 1 }, true, 20],
  [{ id: 'ac6', kind: 'ac_floor', x: 0, y: 0, dir: 0 }, true, 20],
  [{ id: 'th1', kind: 'thermostat', x: 0, y: 0, dir: 0 }, false, 2423],
  [{ id: 'th2', kind: 'thermostat', x: 0, y: 0, dir: 1 }, false, 3122],
  [{ id: 'noc1', kind: 'noc_console', x: 0, y: 0, dir: 0 }, false, 0],
  [{ id: 'noc2', kind: 'noc_console', x: 0, y: 0, dir: 0 }, true, 0],
  [{ id: 'noc3', kind: 'noc_console', x: 0, y: 0, dir: 1 }, false, 0],
  [{ id: 'hot1', kind: 'server_rack', x: 0, y: 0, dir: 1 }, true, 1],
  [{ id: 'hot2', kind: 'server_rack', x: 0, y: 0, dir: 1 }, false, 1],
];
for (const [f, on, opt] of clima) show(trimmed(renderFurniture(f, on, opt).canvas), 3, `fu-${f.id}`);

section('Salas (piso, paredes e sala completa)');
for (const def of ROOM_DEFS) {
  const room = buildRoom(def);
  const theme = THEMES[def.id] ?? THEMES.office;
  show(renderFloor(room, theme).canvas);
  show(renderWalls(room, theme).canvas);
  show(composeRoom(room, theme), 2, `room-${def.id}`);
}

/** Rough composite of a room (no avatars): floor, walls and furniture sorted by depth. */
function composeRoom(room: BuiltRoom, theme: Theme): HTMLCanvasElement {
  const floor = renderFloor(room, theme);
  const walls = renderWalls(room, theme);
  const c = document.createElement('canvas');
  c.width = walls.canvas.width;
  c.height = walls.canvas.height + 24;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#1b1830';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(floor.canvas, walls.ox - floor.ox, walls.oy - floor.oy);
  ctx.drawImage(walls.canvas, 0, 0);
  const items: { z: number; draw: () => void }[] = [];
  for (const f of room.def.furniture) {
    const s = renderFurniture(f, true);
    const fp = footprint(f);
    const o = tileToScreen(f.x, f.y);
    const dx = walls.ox + o.x - s.ax;
    const dy = walls.oy + o.y - s.ay;
    const z = f.kind === 'rug' ? -1 : f.x + f.y + (fp.w + fp.d) / 2 + (s.z0 > 0 ? 0.5 : 0);
    items.push({ z, draw: () => ctx.drawImage(s.canvas, dx, dy) });
    if (s.front) items.push({ z: z + 0.6, draw: () => ctx.drawImage(s.front!.canvas, dx, dy) });
  }
  items.sort((a, b) => a.z - b.z).forEach((i) => i.draw());
  return c;
}
