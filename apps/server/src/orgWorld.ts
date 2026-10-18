import { ROOM_DEFS } from '@workverse/shared';
import { Player, RoomInstance } from './room';
import { StageManager, type PermissionSync } from './stage';

export interface OrgWorldHooks {
  /** A player walked into a portal. */
  onPortal(player: Player, toRoom: string, x: number, y: number): void;
  log?: (event: string, data?: Record<string, unknown>) => void;
  clock?: () => number;
  /** Pushes publish-permission changes to LiveKit (see media.ts); the org id travels as the 4th argument. */
  permissionSync?: PermissionSync;
}

/**
 * Everything live that belongs to ONE organization: its rooms (and the people standing in them), its
 * auditorium state and its population. Two organizations never share a RoomInstance, a StageManager or a counter,
 * so presence, chat, stage and slide images cannot leak between them by construction.
 */
export class OrgWorld {
  readonly rooms = new Map<string, RoomInstance>();
  readonly stage: StageManager;
  populationDirty = false;

  constructor(
    readonly id: string,
    hooks: OrgWorldHooks,
  ) {
    for (const def of ROOM_DEFS) {
      this.rooms.set(
        def.id,
        new RoomInstance(def, {
          onPortal: (player, portal) => hooks.onPortal(player, portal.toRoom, portal.toX, portal.toY),
          onChange: () => {
            this.populationDirty = true;
          },
          onPodium: (player) => this.stage.takeStage(player),
        }),
      );
    }
    const sync = hooks.permissionSync;
    this.stage = new StageManager({
      rooms: this.rooms,
      // The LiveKit room is `wv:${orgId}:${roomId}`; media.ts builds it from the org passed along.
      sync: sync ? (roomId, identity, rights) => sync(roomId, identity, rights, id) : undefined,
      log: hooks.log,
      clock: hooks.clock,
    });
  }

  population(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [id, r] of this.rooms) out[id] = r.players.size;
    return out;
  }

  *players(): Iterable<Player> {
    for (const room of this.rooms.values()) yield* room.players.values();
  }
}
