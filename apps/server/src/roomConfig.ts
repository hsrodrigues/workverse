import { ROOM_DEFS, roomAccessOf, validateLayout, type RoomDef } from '@workverse/shared';
import type { OrgStore, RoomInviteRow } from './orgStore';

/**
 * What an organization made of a room: base definition (ROOM_DEFS, never touched) + customized layout (`room_furniture`) +
 * access policy (`room_settings`). Everything is looked up by (org, room), so editing the room of one organization can never
 * reach another one. Pure reads over the OrgStore; writes go through RoomAdmin, which validates first.
 */

/** Rooms that must stay open to the whole organization: they are where people land and how everyone moves around. */
export const OPEN_ROOMS: readonly string[] = ['office', 'reception'];

export interface ResolvedRoom {
  def: RoomDef;
  /** Layout version (0 = never edited). */
  version: number;
  customized: boolean;
}

export class RoomConfig {
  constructor(
    private readonly orgs: OrgStore,
    private readonly log: (event: string, data?: Record<string, unknown>) => void = () => undefined,
  ) {}

  baseOf(roomId: string): RoomDef | undefined {
    return ROOM_DEFS.find((d) => d.id === roomId);
  }

  /** The room as this organization sees it. A stored layout that no longer validates (the base changed in a release) is ignored, not deleted. */
  resolve(orgId: string, base: RoomDef): ResolvedRoom {
    const layout = this.orgs.getRoomLayout(orgId, base.id);
    const setting = this.orgs.getRoomSetting(orgId, base.id);
    let furniture = base.furniture;
    let customized = false;
    if (layout?.furniture) {
      const check = validateLayout(base, layout.furniture, { noWarnings: true });
      if (check.ok) {
        furniture = layout.furniture.map((f) => ({ ...f }));
        customized = true;
      } else {
        this.log('room.layout_invalid', { org: orgId, room: base.id, reason: check.errors[0]?.message });
      }
    }
    const access = setting?.access ?? roomAccessOf(base);
    const def: RoomDef = { ...base, furniture, access, accessTeamId: access === 'team' ? (setting?.teamId ?? null) : null };
    return { def, version: layout?.version ?? 0, customized };
  }

  /** Live invitation of an account to a room: exists and has not expired. */
  liveInvite(orgId: string, roomId: string, accountId: string, now: number): RoomInviteRow | undefined {
    const row = this.orgs.getRoomInvite(orgId, roomId, accountId);
    return row && (row.expiresAt === null || row.expiresAt > now) ? row : undefined;
  }

  liveInvites(orgId: string, roomId: string, now: number): RoomInviteRow[] {
    return this.orgs.roomInvitesOf(orgId, roomId).filter((r) => r.expiresAt === null || r.expiresAt > now);
  }
}
