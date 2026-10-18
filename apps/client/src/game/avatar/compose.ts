import { colorHex, equippedOf, type AvatarV2, type ItemSlot, type Pose } from '@workverse/shared';
import {
  FRAME_COUNT,
  FRAME_DRINK,
  FRAME_TYPE,
  FRAME_SIT,
  FRAME_WALK,
  FRAME_WAVE,
  armPart,
  createCtx,
  headPart,
  makeRig,
  neckPart,
  type HoldSpec,
  type Look,
  type Resolved,
  type V3,
  type View,
} from './engine';
import { tonesOf } from './recolor';
import { getDrawer, type Emitter } from './registry';
import './drawers';
import { HELD_HEX, HELD_ITEM_DEFS } from './held';
import type { HeldItem } from '@workverse/shared';

/** The pose items are asked about: typing is a seated pose and drinking a standing one (items have no pose of their own for them). */
export const poseOfFrame = (frame: number): Pose =>
  frame >= FRAME_DRINK ? 'idle' : frame >= FRAME_TYPE ? 'sit' : frame >= FRAME_WAVE ? 'wave' : frame >= FRAME_SIT ? 'sit' : frame >= FRAME_WALK ? 'walk' : 'idle';

const warned = new Set<string>();

const lum = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
};

/** Dark eyes vanish on deep skin tones: when the contrast is too low the eyes are drawn light (like the glint). */
function eyeHex(hex: string, skinHex: string): string {
  return Math.abs(lum(hex) - lum(skinHex)) < 0.16 ? '#f1ece2' : hex;
}

/** Resolves colors and drops what has no art for this pose/view (never a broken sprite). */
function resolveLook(av: AvatarV2, pose: Pose, view: View, held: HeldItem | null): Look {
  const list: Resolved[] = [];
  for (const e of equippedOf(av)) {
    const item = e.item;
    if (item.poses[pose] === 'hidden') continue;
    if (item.views && !item.views.includes(view)) continue;
    if (!getDrawer(item.drawer)) {
      if (!warned.has(item.drawer)) {
        warned.add(item.drawer);
        console.warn(`[avatar] no drawer registered for "${item.drawer}" (item ${item.id}); it will not be drawn.`);
      }
      continue;
    }
    let hex = item.palette ? colorHex(item.palette, e.ref.color) : '#8a8f9a';
    if (item.slot === 'eyes') hex = eyeHex(hex, colorHex('skin', av.skin));
    list.push({ item, ref: e.ref, hex, t: tonesOf(hex) });
  }
  // A cup taken from the environment replaces whatever the avatar wears in the hand slot (unless there is no art for the pose).
  if (held) {
    const item = HELD_ITEM_DEFS[held];
    if (item.poses[pose] !== 'hidden') {
      const hex = HELD_HEX[held];
      for (let i = list.length - 1; i >= 0; i--) if (list[i].item.slot === 'hand') list.splice(i, 1);
      list.push({ item, ref: { id: item.id }, hex, t: tonesOf(hex) });
    }
  }
  const bySlot = new Map<ItemSlot, Resolved>(list.map((r) => [r.item.slot, r]));
  return { skinHex: colorHex('skin', av.skin), list, get: (s) => bySlot.get(s) };
}

interface Part {
  d: number;
  draw: () => void;
}

/**
 * Renders one frame (64x128, feet anchored at (32,100)) as ABGR pixels. `held` puts a cup of the environment (coffee mug,
 * glass of water) in the hand. Both hands are on the keyboard while typing, so nothing is held in those frames.
 */
export function renderFrame(av: AvatarV2, view: View, frame: number, held: HeldItem | null = null): Uint32Array {
  const f = Math.max(0, Math.min(FRAME_COUNT - 1, frame));
  const pose = poseOfFrame(f);
  const look = resolveLook(av, pose, view, f >= FRAME_TYPE && f < FRAME_DRINK ? null : held);

  let hold: HoldSpec | null = null;
  for (const r of look.list) {
    const h = getDrawer(r.item.drawer)?.hold?.(pose, r);
    if (h) hold = h;
  }
  const rig = makeRig(f, view, hold);
  const c = createCtx(look, view, rig, pose);
  c.hatted = !!look.get('head');

  // sleeves: the outermost garment that has them
  for (const slot of ['outer', 'top'] as const) {
    const r = look.get(slot);
    const sl = r && getDrawer(r.item.drawer)?.sleeve?.(r);
    if (r && sl) {
      c.sleeve = { it: r, ...sl };
      break;
    }
  }

  const parts: Part[] = [];
  const legLayers: { garment: ((i: 0 | 1) => void)[]; shoe: ((i: 0 | 1) => void)[] } = { garment: [], shoe: [] };
  const emit: Emitter = {
    part: (d, draw) => parts.push({ d, draw }),
    leg: (layer, draw) => legLayers[layer].push(draw),
  };
  for (const r of look.list) getDrawer(r.item.drawer)!.draw(c, r, emit);

  const dep = (p: V3) => p[2] * c.cs - p[0] * c.sn;
  const sit = rig.sit;
  // legs: before the torso when standing (the shirt hem overlaps the trousers), in front when sitting
  for (const i of [0, 1] as const) {
    const mean = (dep(rig.hip[i]) + dep(rig.knee[i]) + dep(rig.ankle[i])) / 3;
    parts.push({
      d: (sit ? 40 : -50) + mean,
      draw: () => {
        for (const g of legLayers.garment) g(i);
        for (const s of legLayers.shoe) s(i);
      },
    });
  }
  parts.push({ d: -0.2, draw: () => neckPart(c) });
  for (const i of [0, 1] as const) {
    const mean = (dep(rig.shoulder[i]) + dep(rig.elbow[i]) + dep(rig.wrist[i])) / 3;
    parts.push({ d: (sit ? 100 : 0.3) + mean, draw: () => armPart(c, i) });
  }
  parts.push({ d: 20, draw: () => headPart(c) });

  parts.sort((a, b) => a.d - b.d);
  for (const p of parts) p.draw();
  return c.buf;
}
