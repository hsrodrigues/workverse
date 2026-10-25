import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { ServerMessage } from '@workverse/shared';
import Fastify from 'fastify';
import { createApp, type AppOptions } from '../src/app';
import { registerMediaRoutes } from '../src/media';
import { MemoryAccountStore } from '../src/store';
import { World, type Connection } from '../src/world';
import { MemoryUsageStore, resolveEconomyConfig, HEARTBEAT_TIMEOUT_MS } from '../src/mediaEconomy';

const apps: FastifyInstance[] = [];
afterEach(async () => {
  for (const a of apps.splice(0)) await a.close();
});

class Conn implements Connection {
  strikes = 0;
  player?: Connection['player'];
  inbox: ServerMessage[] = [];
  send(m: ServerMessage) {
    this.inbox.push(m);
  }
  close() {}
  last<T extends ServerMessage['t']>(t: T) {
    return [...this.inbox].reverse().find((m) => m.t === t) as Extract<ServerMessage, { t: T }> | undefined;
  }
}

async function setup(opts: Partial<AppOptions> = {}) {
  let now = Date.UTC(2026, 9, 15, 15, 0, 0);
  const usage = new MemoryUsageStore();
  const store = new MemoryAccountStore();
  const world = new World({ store, allowDevLogin: true, clock: () => now, mediaEconomy: opts.mediaEconomy, mediaUsageStore: usage });
  const app = Fastify();
  apps.push(app);
  app.decorateRequest('auth', null);
  registerMediaRoutes(app, { store, world, guard: undefined as never, clock: () => now, secureCookies: false, allowDevLogin: true, allowedOrigins: [] });
  const enter = (name: string, room = 'office') => {
    const c = new Conn();
    world.handle(c, { t: 'hello', name });
    world.handle(c, { t: 'join', roomId: room });
    return c;
  };
  const token = (name: string, room = 'office') => app.inject({ method: 'POST', url: '/api/media/token', payload: { roomId: room, devName: name } });
  const rep = (c: Conn, mic = false, cam = false) => world.handle(c, { t: 'media_report', connected: true, mic, cam, screen: false });
  return { app, world, usage, enter, token, rep, advance: (ms: number) => (now += ms), now: () => now };
}

describe('economia de midia: limites na emissao do token', () => {
  it('limita pessoas conectadas por sala com mensagem em pt-BR', async () => {
    const { enter, token } = await setup({ mediaEconomy: { maxPeoplePerRoom: 2 } });
    enter('Ana');
    enter('Beto');
    enter('Caio');
    expect((await token('Ana')).statusCode).toBe(200);
    expect((await token('Beto')).statusCode).toBe(200);
    const r = await token('Caio');
    expect(r.statusCode).toBe(409);
    expect(r.json().error.code).toBe('media_room_full');
    expect(r.json().error.message).toMatch(/cheia/);
    // quem ja tem sessao renova sem ser barrado
    expect((await token('Ana')).statusCode).toBe(200);
  });

  it('so N publicadores de video; os demais ficam so com audio', async () => {
    const { enter, token, rep } = await setup({ mediaEconomy: { maxVideoPublishers: 1 } });
    const a = enter('Ana');
    const b = enter('Beto');
    expect((await token('Ana')).json().rights).toBe('all');
    expect((await token('Beto')).json().rights).toBe('all');
    rep(a, true, true);
    const limited = (await token('Beto')).json();
    expect(limited.rights).toBe('audio');
    expect(limited.notice).toMatch(/limite/);
    // video dinamico: Beto ja conectado tenta ligar a camera -> negado, com erro claro
    rep(b, true, true);
    expect(b.inbox.find((m) => m.t === 'error' && m.code === 'media_video_limit')).toBeTruthy();
    // Ana liga so audio: vaga abre
    rep(a, true, false);
    expect((await token('Beto')).json().rights).toBe('all');
  });

  it('avisa a sala quem publica (media_active), sem depender do LiveKit', async () => {
    const { enter, token, rep } = await setup();
    const a = enter('Ana');
    const b = enter('Beto');
    await token('Ana');
    rep(a, true);
    expect(b.last('media_active')!.publishers).toEqual([a.player!.id]);
    rep(a, false);
    expect(b.last('media_active')!.publishers).toEqual([]);
    rep(a, true);
    const c = enter('Caio');
    expect(c.last('media_active')!.publishers).toEqual([a.player!.id]);
  });

  it('o relato de midia nao conta como atividade (ausencia automatica continua valendo)', async () => {
    const { world, enter, advance, now } = await setup();
    const a = enter('Ana');
    advance(6 * 60_000);
    world.tick(now());
    expect(a.player!.status).toBe('away');
    world.handle(a, { t: 'media_report', connected: false, mic: false, cam: false, screen: false });
    expect(a.player!.status).toBe('away');
  });

  it('modo economia (staff): salas comuns so audio, politica enviada a todos', async () => {
    const { world, enter, token } = await setup();
    const a = enter('Ana');
    await token('Ana');
    world.media.setStrict(true);
    expect(a.last('media_policy')!.strict).toBe(true);
    const r = (await token('Ana')).json();
    expect(r.rights).toBe('audio');
    expect(r.strict).toBe(true);
    world.media.setStrict(false);
    expect((await token('Ana')).json().rights).toBe('all');
  });

  it('MEDIA_ECONOMY=off: sem limites de pessoas/video e token de 10 min', async () => {
    const cfg = resolveEconomyConfig({ MEDIA_ECONOMY: 'off' } as never);
    expect(cfg.enabled).toBe(false);
    expect(cfg.tokenTtlSeconds).toBe(600);
    expect(resolveEconomyConfig({} as never).tokenTtlSeconds).toBe(1800);
    const { world, enter, token, rep } = await setup({ mediaEconomy: { ...cfg, maxPeoplePerRoom: 1, maxVideoPublishers: 1 } });
    const a = enter('Ana');
    enter('Beto');
    expect((await token('Ana')).statusCode).toBe(200);
    expect((await token('Beto')).statusCode).toBe(200);
    rep(a, true, true);
    expect((await token('Beto')).json().rights).toBe('all');
    expect(world.media.policy().economy).toBe(false);
  });
});

describe('economia de midia: contador mensal', () => {
  it('soma minutos de participante, alerta em 70/90 e bloqueia em 100%', async () => {
    const { world, enter, token, rep, advance, now } = await setup({ mediaEconomy: { monthlyMinutes: 10 } });
    const a = enter('Ana');
    const b = enter('Beto');
    await token('Ana');
    await token('Beto');
    const step = () => {
      advance(30_000);
      rep(a);
      rep(b);
      world.media.sweep(now());
    };
    rep(a);
    rep(b);
    for (let i = 0; i < 6; i++) step(); // 2 pessoas x 3 min = 6 min
    expect(world.media.usage().usedMinutes).toBeCloseTo(6, 0);
    expect(world.media.usage().level).toBe('ok');
    step(); // 7 min
    expect(world.media.usage().level).toBe('warn70');
    step();
    step(); // 9 min
    expect(world.media.usage().level).toBe('warn90');
    for (let i = 0; i < 3 && world.media.usage().level !== 'exceeded'; i++) step();
    expect(world.media.usage().level).toBe('exceeded');
    // 100%: nenhum token novo, mensagem clara, todos avisados e as sessoes encerradas
    const r = await token('Ana');
    expect(r.statusCode).toBe(503);
    expect(r.json().error.code).toBe('media_quota');
    expect(r.json().error.message).toMatch(/volta no dia 1/);
    expect(a.last('media_policy')!.quotaExceeded).toBe(true);
    expect(world.media.sessionCount).toBe(0);
  });

  it('persiste e vira o mes zerando contador e alertas', async () => {
    const { world, enter, token, rep, advance, now, usage } = await setup({ mediaEconomy: { monthlyMinutes: 100 } });
    const a = enter('Ana');
    await token('Ana');
    rep(a);
    advance(60_000);
    rep(a);
    world.media.flush(now());
    expect(usage.saved!.month).toBe('2026-10');
    expect(usage.saved!.minutes).toBeCloseTo(1, 1);
    advance(20 * 24 * 3600_000);
    const u = world.media.usage(now());
    expect(u.month).toBe('2026-11');
    expect(u.usedMinutes).toBe(0);
    expect(u.history[0]).toMatchObject({ month: '2026-10' });
  });

  it('sessao sem batimento e encerrada (heartbeat) e para de contar', async () => {
    const { world, enter, token, rep, advance, now } = await setup();
    const a = enter('Ana');
    await token('Ana');
    rep(a);
    advance(HEARTBEAT_TIMEOUT_MS + 5000);
    world.media.sweep(now());
    expect(world.media.sessionCount).toBe(0);
  });

  it('sair da sala encerra a sessao e a /metrics expoe o contador', async () => {
    const { world, enter, token } = await setup();
    const a = enter('Ana');
    await token('Ana');
    expect(world.media.sessionCount).toBe(1);
    world.enterRoom(a.player!, 'reception');
    expect(world.media.sessionCount).toBe(0);
    const { app } = await createApp({ store: new MemoryAccountStore(), allowDevLogin: true });
    apps.push(app);
    const m = (await app.inject({ url: '/metrics' })).body;
    expect(m).toContain('workverse_media_minutes_month');
    expect(m).toContain('workverse_media_sessions_active');
  });
});
