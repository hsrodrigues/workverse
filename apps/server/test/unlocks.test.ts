import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { ServerMessage } from '@workverse/shared';
import { createApp } from '../src/app';
import { MemoryAccountStore } from '../src/store';
import { World, type Connection } from '../src/world';
import { parseUnlockKey } from '../src/wardrobe';

const apps: FastifyInstance[] = [];
afterEach(async () => {
  for (const a of apps.splice(0)) await a.close();
});

const PASSWORD = 'correct horse battery';

async function setup() {
  const store = new MemoryAccountStore();
  const { app } = await createApp({ store, tickMs: 50, authLimits: { failDelayMs: 0 } });
  apps.push(app);
  const reg = async (email: string, displayName: string) => {
    const res = await app.inject({ method: 'POST', url: '/api/register', payload: { email, password: PASSWORD, displayName } });
    expect(res.statusCode).toBe(201);
    const raw = res.headers['set-cookie'];
    return (Array.isArray(raw) ? raw[0] : String(raw)).split(';')[0]!;
  };
  return { app, store, reg };
}

const grant = (app: FastifyInstance, cookie: string, payload: object) =>
  app.inject({ method: 'POST', url: '/api/admin/unlocks', payload, headers: { cookie } });

describe('admin unlocks', () => {
  it('lets an owner grant and revoke keys, and rejects members, strangers and bad keys', async () => {
    const { app, store, reg } = await setup();
    const owner = await reg('owner@example.com', 'Dona');
    const member = await reg('beto@example.com', 'Beto');
    const target = store.getByEmail('beto@example.com')!;

    expect((await app.inject({ method: 'POST', url: '/api/admin/unlocks', payload: { email: 'beto@example.com', key: 'staff' } })).statusCode).toBe(401);
    // a plain member cannot grant anything, not even to himself
    expect((await grant(app, member, { email: 'beto@example.com', key: 'event:natal' })).statusCode).toBe(403);
    expect(target.unlocks ?? []).toEqual([]);

    const ok = await grant(app, owner, { email: 'beto@example.com', key: 'achievement:coffee-lover' });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ ok: true, changed: true, unlocks: ['achievement:coffee-lover'] });
    expect((await grant(app, owner, { accountId: target.id, key: 'achievement:coffee-lover' })).json().changed).toBe(false);
    expect((await grant(app, owner, { accountId: target.id, key: 'achievement:coffee-lover', revoke: true })).json().unlocks).toEqual([]);
    expect((await grant(app, owner, { accountId: target.id, key: 'item:sp.mug_gold' })).json().unlocks).toEqual(['item:sp.mug_gold']);

    for (const key of ['', 'tudo', 'item:nao.existe', 'staff; drop', 42]) {
      expect((await grant(app, owner, { accountId: target.id, key })).statusCode, String(key)).toBe(400);
    }
    expect((await grant(app, owner, { accountId: 'nope', key: 'event:natal' })).statusCode).toBe(404);
    // o cracha de staff nao se concede por unlock: so Account.staff (docs/staff.md)
    for (const key of ['staff', 'item:sp.badge_staff']) expect((await grant(app, owner, { accountId: target.id, key })).statusCode, key).toBe(400);
  });

  it('validates keys', () => {
    expect(parseUnlockKey('staff').ok).toBe(false);
    expect(parseUnlockKey('item:sp.badge_staff').ok).toBe(false);
    expect(parseUnlockKey('event:natal').ok).toBe(true);
    expect(parseUnlockKey('item:sp.mug_gold').ok).toBe(true);
    expect(parseUnlockKey('item:x').ok).toBe(false);
    expect(parseUnlockKey('Staff').ok).toBe(false);
  });
});

class FakeConn implements Connection {
  strikes = 0;
  accountId?: string;
  player?: Connection['player'];
  inbox: ServerMessage[] = [];
  send(m: ServerMessage) {
    this.inbox.push(m);
  }
  close() {}
}

describe('/desbloquear (development only)', () => {
  const run = (dev: boolean) => {
    const store = new MemoryAccountStore();
    const world = new World({ store, allowDevLogin: dev, clock: () => 1_000_000 });
    const c = new FakeConn();
    world.handle(c, { t: 'hello', name: 'Ana' } as never);
    world.handle(c, { t: 'join' } as never);
    return { store, world, c };
  };

  it('grants keys to yourself when dev login is on', () => {
    const { store, world, c } = run(true);
    world.handle(c, { t: 'chat', text: '/desbloquear todos' } as never);
    expect(store.getByName('Ana')!.unlocks).toContain('event:natal');
    expect(store.getByName('Ana')!.unlocks).not.toContain('staff');
    world.handle(c, { t: 'chat', text: '/desbloquear item:nada' } as never);
    expect((c.inbox.at(-1) as { text: string }).text).toMatch(/inexistente/);
  });

  it('is just chat text when dev login is off', () => {
    const { store, world, c } = run(false);
    // without dev login the name-only hello is refused: no session, nothing to unlock
    expect(c.player).toBeUndefined();
    expect(store.getByName('Ana')).toBeUndefined();
    void world;
  });
});
