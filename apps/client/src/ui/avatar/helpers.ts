import { equippedOf, type AvatarV2, type Equipped, type ItemSlot } from '@workverse/shared';

/** What the avatar wears in a slot (single fields and lists), if anything. */
export function wornInSlot(a: AvatarV2, slot: ItemSlot): Equipped | undefined {
  return equippedOf(a).find((e) => e.item.slot === slot);
}
