import type { AvatarV2 } from './items/types';

/**
 * The appearance of a player on the wire and on disk is the version 2 model (`items/`): references to items and
 * palette colors, never images. Old index-based configs are still accepted everywhere an avatar enters the system
 * (`sanitizeAvatar` / `migrateLegacyAvatar` convert them automatically). See docs/avatar-items.md.
 */
export type AvatarConfig = AvatarV2;
