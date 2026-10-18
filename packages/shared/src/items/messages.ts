import type { AvatarIssue, AvatarV2 } from './types';

/**
 * WebSocket messages of the avatar editor and the wardrobe. They are part of `ClientMessage` / `ServerMessage`
 * (see protocol.ts). `rid` is a request id echoed back in the answer so the editor can match it.
 * The old `{ t: 'avatar', avatar }` message keeps working (validated, broadcast, no answer).
 */
export interface OutfitView {
  id: string;
  name: string;
  avatar: AvatarV2;
  updatedAt: number;
  /** False when the outfit uses an item the account cannot wear anymore (retired, locked...). */
  usable: boolean;
  problems: string[];
}

export interface WardrobeState {
  /** The saved appearance. */
  avatar: AvatarV2;
  outfits: OutfitView[];
  /** The account's unlock keys (see items/access.ts); the editor uses them only for hints. */
  unlocks: string[];
  maxOutfits: number;
  /** True for quick-login accounts (no password): they live as long as the server data does. */
  devAccount: boolean;
}

export type AvatarClientMessage =
  /** Asks for the wardrobe state (answered with `wardrobe`). */
  | { t: 'wardrobe_get'; rid?: number }
  /** Saves the appearance; answered with `avatar_result`, and everybody in the room receives `avatar`. */
  | { t: 'avatar_save'; rid?: number; avatar: AvatarV2 }
  /** Creates an outfit, or overwrites the one with the same `id` (or the same name). Answered with `wardrobe`. */
  | { t: 'outfit_save'; rid?: number; name: string; avatar: AvatarV2; id?: string }
  | { t: 'outfit_delete'; rid?: number; id: string }
  /** Wears a saved outfit now (validated like a normal save). */
  | { t: 'outfit_apply'; rid?: number; id: string };

export type AvatarServerMessage =
  | { t: 'wardrobe'; rid?: number; state: WardrobeState }
  | { t: 'avatar_result'; rid?: number; ok: true; avatar: AvatarV2 }
  | { t: 'avatar_result'; rid?: number; ok: false; code: string; message: string; issues?: AvatarIssue[] };

const AVATAR_CLIENT_TYPES: ReadonlySet<string> = new Set(['wardrobe_get', 'avatar_save', 'outfit_save', 'outfit_delete', 'outfit_apply']);
export const isAvatarClientMessage = (t: unknown): boolean => typeof t === 'string' && AVATAR_CLIENT_TYPES.has(t);
