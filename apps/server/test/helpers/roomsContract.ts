import { describe, expect, it } from 'vitest';
import type { AccountStore } from '../../src/store';

export interface RoomsHandle {
  store: AccountStore;
  /** Waits for asynchronous writes (no-op for memory). */
  settle(): Promise<void>;
  /** Opens a NEW store over the same storage (a server restart). */
  reopen(): Promise<AccountStore>;
}

/** What every persistent store must keep about rooms: customized layouts, access policies and invitations, per organization. */
export function roomsStoreContract(label: string, make: () => Promise<RoomsHandle>) {
  describe(`contrato de salas: ${label}`, () => {
    async function seed(h: RoomsHandle) {
      const { store } = h;
      const boss = store.create({ email: 'chefe@x.com', displayName: 'Chefe', passwordHash: 'scrypt$x' });
      const ana = store.create({ email: 'ana@x.com', displayName: 'Ana', passwordHash: 'scrypt$x' });
      for (const id of ['orgA', 'orgB']) {
        store.orgs.putOrg({ id, slug: id.toLowerCase(), name: id, settings: {}, createdAt: 1 });
        store.orgs.putTeam({ id: `${id}-t`, orgId: id, name: 'Alfa', color: '#112233' });
      }
      return { boss, ana };
    }

    it('keeps layout (with version), access and invitations after a restart, separated by organization', async () => {
      const h = await make();
      const { boss, ana } = await seed(h);
      const furniture = [{ id: 'u1', kind: 'plant' as const, x: 3, y: 4, dir: 0 }];
      h.store.orgs.putRoomLayout({ orgId: 'orgA', roomId: 'lounge', version: 3, furniture, updatedBy: boss.id, updatedAt: 1000 });
      h.store.orgs.putRoomLayout({ orgId: 'orgA', roomId: 'office', version: 5, furniture: null, updatedBy: boss.id, updatedAt: 2000 });
      h.store.orgs.putRoomSetting({ orgId: 'orgA', roomId: 'meeting1', access: 'team', teamId: 'orgA-t', updatedBy: boss.id, updatedAt: 3000 });
      h.store.orgs.putRoomInvite({ orgId: 'orgA', roomId: 'private', accountId: ana.id, invitedBy: boss.id, createdAt: 4000, expiresAt: 9000 });
      h.store.orgs.putRoomInvite({ orgId: 'orgA', roomId: 'meeting2', accountId: ana.id, invitedBy: boss.id, createdAt: 4000, expiresAt: null });
      await h.settle();

      const again = await h.reopen();
      expect(again.orgs.getRoomLayout('orgA', 'lounge')).toEqual({ orgId: 'orgA', roomId: 'lounge', version: 3, furniture, updatedBy: boss.id, updatedAt: 1000 });
      expect(again.orgs.getRoomLayout('orgA', 'office')).toMatchObject({ version: 5, furniture: null });
      expect(again.orgs.getRoomSetting('orgA', 'meeting1')).toMatchObject({ access: 'team', teamId: 'orgA-t' });
      expect(again.orgs.getRoomInvite('orgA', 'private', ana.id)).toMatchObject({ invitedBy: boss.id, createdAt: 4000, expiresAt: 9000 });
      expect(again.orgs.getRoomInvite('orgA', 'meeting2', ana.id)?.expiresAt).toBeNull();
      // nothing leaks into the other organization
      expect(again.orgs.roomLayoutsOf('orgB')).toEqual([]);
      expect(again.orgs.roomSettingsOf('orgB')).toEqual([]);
      expect(again.orgs.allRoomInvitesOf('orgB')).toEqual([]);
      expect(again.orgs.roomInvitesOf('orgA', 'private')).toHaveLength(1);
    });

    it('updates in place (the version grows) and removes invitations for good', async () => {
      const h = await make();
      const { boss, ana } = await seed(h);
      for (let v = 1; v <= 4; v++) {
        h.store.orgs.putRoomLayout({ orgId: 'orgA', roomId: 'lounge', version: v, furniture: v % 2 ? [{ id: `u${v}`, kind: 'rug' as const, x: 1, y: 1, dir: 0 }] : null, updatedBy: boss.id, updatedAt: v });
      }
      h.store.orgs.putRoomInvite({ orgId: 'orgA', roomId: 'private', accountId: ana.id, invitedBy: boss.id, createdAt: 1, expiresAt: 5 });
      h.store.orgs.deleteRoomInvite('orgA', 'private', ana.id);
      h.store.orgs.putRoomInvite({ orgId: 'orgA', roomId: 'meeting1', accountId: ana.id, invitedBy: boss.id, createdAt: 2, expiresAt: 7 });
      h.store.orgs.putRoomInvite({ orgId: 'orgA', roomId: 'meeting1', accountId: ana.id, invitedBy: boss.id, createdAt: 3, expiresAt: 8 });
      await h.settle();
      const again = await h.reopen();
      expect(again.orgs.getRoomLayout('orgA', 'lounge')).toMatchObject({ version: 4, furniture: null });
      expect(again.orgs.getRoomInvite('orgA', 'private', ana.id)).toBeUndefined();
      expect(again.orgs.getRoomInvite('orgA', 'meeting1', ana.id)).toMatchObject({ createdAt: 3, expiresAt: 8 });
    });
  });
}
