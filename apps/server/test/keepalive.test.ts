import { describe, expect, it } from 'vitest';
import {
  KEEPALIVE_DEFAULT_MINUTES,
  KEEPALIVE_SUMMARY_MS,
  KEEPALIVE_USER_AGENT,
  resolveKeepaliveConfig,
  startKeepalive,
} from '../src/keepalive';

const prod = (extra: Record<string, string> = {}) => ({ NODE_ENV: 'production', PUBLIC_URL: 'https://workverse.example.com', ...extra }) as NodeJS.ProcessEnv;

/** Relogio/timers falsos: `fire()` roda o callback do intervalo registrado. */
function harness(env: NodeJS.ProcessEnv, fetchImpl?: typeof fetch) {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const logs: string[] = [];
  let beats = 0;
  let now = 0;
  const timers = new Map<number, { fn: () => void; ms: number }>();
  let nextId = 1;
  const cfg = resolveKeepaliveConfig(env);
  const ka = startKeepalive(cfg, {
    fetch:
      fetchImpl ??
      (async (url, init) => {
        calls.push({ url: String(url), init });
        return new Response('{"ok":true}', { status: 200 });
      }),
    setInterval: (fn, ms) => {
      const id = nextId++;
      timers.set(id, { fn, ms });
      return id;
    },
    clearInterval: (h) => void timers.delete(h as number),
    now: () => now,
    log: (m) => logs.push(m),
    onBeat: () => void beats++,
  });
  return { cfg, ka, calls, logs, timers, beats: () => beats, advance: (ms: number) => void (now += ms) };
}

describe('resolveKeepaliveConfig', () => {
  it('liga em producao com PUBLIC_URL https publica, a cada 10 min por padrao, sempre em /health', () => {
    const c = resolveKeepaliveConfig(prod());
    expect(c.enabled).toBe(true);
    expect(c.url).toBe('https://workverse.example.com/health');
    expect(c.intervalMs).toBe(KEEPALIVE_DEFAULT_MINUTES * 60_000);
  });

  it('usa so a origem de PUBLIC_URL (descarta caminho e query)', () => {
    expect(resolveKeepaliveConfig(prod({ PUBLIC_URL: 'https://a.example.com/algum/caminho?x=1' })).url).toBe('https://a.example.com/health');
  });

  it('fica desligado fora de producao, sem PUBLIC_URL, em http e em localhost', () => {
    expect(resolveKeepaliveConfig({ PUBLIC_URL: 'https://a.example.com' } as NodeJS.ProcessEnv).enabled).toBe(false);
    expect(resolveKeepaliveConfig({ NODE_ENV: 'production' } as NodeJS.ProcessEnv).enabled).toBe(false);
    expect(resolveKeepaliveConfig({ NODE_ENV: 'production', PUBLIC_URL: 'nao e url' } as NodeJS.ProcessEnv).enabled).toBe(false);
    expect(resolveKeepaliveConfig(prod({ PUBLIC_URL: 'http://a.example.com' })).enabled).toBe(false);
    for (const host of ['localhost', '127.0.0.1', '[::1]', 'app.localhost']) {
      expect(resolveKeepaliveConfig(prod({ PUBLIC_URL: `https://${host}:8080` })).enabled, host).toBe(false);
    }
  });

  it('KEEPALIVE=off desliga; KEEPALIVE=on forca fora de producao mas nunca para localhost nem http', () => {
    expect(resolveKeepaliveConfig(prod({ KEEPALIVE: 'off' })).enabled).toBe(false);
    expect(resolveKeepaliveConfig({ KEEPALIVE: 'on', PUBLIC_URL: 'https://a.example.com' } as NodeJS.ProcessEnv).enabled).toBe(true);
    expect(resolveKeepaliveConfig({ KEEPALIVE: 'on', PUBLIC_URL: 'https://localhost' } as NodeJS.ProcessEnv).enabled).toBe(false);
    expect(resolveKeepaliveConfig({ KEEPALIVE: 'on', PUBLIC_URL: 'http://a.example.com' } as NodeJS.ProcessEnv).enabled).toBe(false);
  });

  it('KEEPALIVE_MINUTES fica entre 1 e 14 (acima do sono de 15 min do plano gratuito)', () => {
    expect(resolveKeepaliveConfig(prod({ KEEPALIVE_MINUTES: '5' })).intervalMs).toBe(5 * 60_000);
    expect(resolveKeepaliveConfig(prod({ KEEPALIVE_MINUTES: '0' })).intervalMs).toBe(60_000);
    expect(resolveKeepaliveConfig(prod({ KEEPALIVE_MINUTES: '99' })).intervalMs).toBe(14 * 60_000);
    expect(resolveKeepaliveConfig(prod({ KEEPALIVE_MINUTES: 'abc' })).intervalMs).toBe(KEEPALIVE_DEFAULT_MINUTES * 60_000);
  });
});

describe('startKeepalive', () => {
  it('nao inicia nada quando desligado (nenhum timer)', () => {
    const h = harness({ NODE_ENV: 'development', PUBLIC_URL: 'https://a.example.com' } as NodeJS.ProcessEnv);
    expect(h.ka).toBeNull();
    expect(h.timers.size).toBe(0);
  });

  it('agenda um unico timer no intervalo configurado e chama so o /health do host fixo', async () => {
    const h = harness(prod({ KEEPALIVE_MINUTES: '7' }));
    expect(h.timers.size).toBe(1);
    expect([...h.timers.values()][0]!.ms).toBe(7 * 60_000);
    expect(await h.ka!.ping()).toBe(true);
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0]!.url).toBe('https://workverse.example.com/health');
    expect((h.calls[0]!.init!.headers as Record<string, string>)['user-agent']).toBe(KEEPALIVE_USER_AGENT);
    expect(h.calls[0]!.init!.redirect).toBe('manual');
    expect(h.calls[0]!.init!.signal).toBeInstanceOf(AbortSignal);
    expect(h.beats()).toBe(1);
  });

  it('o disparo do timer faz a chamada', async () => {
    const h = harness(prod());
    [...h.timers.values()][0]!.fn();
    await new Promise((r) => setTimeout(r, 0));
    expect(h.calls).toHaveLength(1);
  });

  it('redirecionamento (3xx), erro HTTP e excecao contam como falha e nao disparam a batida', async () => {
    let mode: 'redirect' | 'error' | 'throw' = 'redirect';
    const h = harness(prod(), (async () => {
      if (mode === 'throw') throw new Error('rede caiu');
      return new Response('', { status: mode === 'redirect' ? 302 : 503, headers: { location: 'https://evil.example.org/' } });
    }) as unknown as typeof fetch);
    expect(await h.ka!.ping()).toBe(false);
    mode = 'error';
    expect(await h.ka!.ping()).toBe(false);
    mode = 'throw';
    expect(await h.ka!.ping()).toBe(false);
    expect(h.ka!.stats).toEqual({ ok: 0, fail: 3 });
    expect(h.beats()).toBe(0);
  });

  it('tolera falhas e volta a funcionar; uma linha de resumo por hora', async () => {
    let fail = true;
    const h = harness(prod(), (async () => (fail ? Promise.reject(new Error('x')) : new Response('ok'))) as unknown as typeof fetch);
    await h.ka!.ping();
    h.advance(10 * 60_000);
    fail = false;
    await h.ka!.ping();
    await h.ka!.ping();
    expect(h.logs).toHaveLength(0);
    h.advance(KEEPALIVE_SUMMARY_MS);
    await h.ka!.ping();
    expect(h.logs).toHaveLength(1);
    expect(h.logs[0]).toMatch(/3 ok, 1 falhas/);
  });

  it('a excecao de onBeat nao derruba o ping', async () => {
    const cfg = resolveKeepaliveConfig(prod());
    const ka = startKeepalive(cfg, {
      fetch: (async () => new Response('ok')) as unknown as typeof fetch,
      setInterval: () => 1,
      clearInterval: () => undefined,
      onBeat: () => {
        throw new Error('visual');
      },
      log: () => undefined,
    })!;
    expect(await ka.ping()).toBe(true);
  });

  it('stop limpa o timer, escreve o resumo pendente e nao conta pings atrasados', async () => {
    const h = harness(prod());
    await h.ka!.ping();
    h.ka!.stop();
    expect(h.timers.size).toBe(0);
    expect(h.logs).toHaveLength(1);
    h.ka!.stop(); // idempotente
    expect(h.logs).toHaveLength(1);
    await h.ka!.ping();
    expect(h.ka!.stats.ok).toBe(1);
  });

  it('o timer real nao segura o processo (unref)', () => {
    const cfg = resolveKeepaliveConfig(prod());
    let unrefCalled = false;
    const ka = startKeepalive(cfg, {
      fetch: (async () => new Response('ok')) as unknown as typeof fetch,
      setInterval: () => ({
        unref() {
          unrefCalled = true;
        },
      }),
      clearInterval: () => undefined,
    })!;
    expect(unrefCalled).toBe(true);
    ka.stop();
  });
});
