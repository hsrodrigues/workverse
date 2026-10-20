/**
 * Autoping: enquanto o servidor esta de pe, ele chama o PROPRIO endereco publico (`PUBLIC_URL` + `/health`) de tempos em
 * tempos. Em hospedagens gratuitas que dormem sem trafego de fora (Render free: ~15 min), isso conta como requisicao
 * externa (passa pelo proxy da plataforma) e adia o sono. LIMITES honestos: so funciona ENQUANTO o servidor esta
 * acordado (nao o acorda depois que dormiu), nao burla o limite mensal de horas do plano, e cabe a quem publica conferir
 * os termos do provedor. Seguranca: so chama o host de PUBLIC_URL, caminho fixo `/health`, sem seguir redirecionamentos.
 */

export const KEEPALIVE_DEFAULT_MINUTES = 10;
export const KEEPALIVE_MIN_MINUTES = 1;
export const KEEPALIVE_MAX_MINUTES = 14;
/** Timeout de cada chamada. */
export const KEEPALIVE_TIMEOUT_MS = 10_000;
/** Uma linha de resumo por janela (sem barulho no log). */
export const KEEPALIVE_SUMMARY_MS = 60 * 60_000;
export const KEEPALIVE_USER_AGENT = 'WorkVerse-keepalive';

export interface KeepaliveConfig {
  enabled: boolean;
  /** Endereco completo chamado (https://host/health); vazio se desligado. */
  url: string;
  intervalMs: number;
  /** Por que esta ligado/desligado (log e testes). */
  reason: string;
}

const isLocalHost = (h: string) => {
  const x = h.toLowerCase().replace(/^\[|\]$/g, '');
  return x === 'localhost' || x === '127.0.0.1' || x === '::1' || x === '0.0.0.0' || x.endsWith('.localhost');
};

/** Funcao pura: decide se liga e com que intervalo. */
export function resolveKeepaliveConfig(env: NodeJS.ProcessEnv): KeepaliveConfig {
  const off = (reason: string): KeepaliveConfig => ({ enabled: false, url: '', intervalMs: 0, reason });
  const mode = (env.KEEPALIVE ?? '').trim().toLowerCase();
  if (['off', '0', 'false', 'no'].includes(mode)) return off('KEEPALIVE=off');
  const forced = ['on', '1', 'true', 'yes'].includes(mode);
  if (!forced && env.NODE_ENV !== 'production') return off('fora de producao');
  let u: URL;
  try {
    u = new URL((env.PUBLIC_URL ?? '').trim());
  } catch {
    return off('PUBLIC_URL ausente ou invalida');
  }
  if (u.protocol !== 'https:') return off('PUBLIC_URL nao e https');
  if (isLocalHost(u.hostname)) return off('PUBLIC_URL e local');
  const raw = (env.KEEPALIVE_MINUTES ?? '').trim();
  let minutes = KEEPALIVE_DEFAULT_MINUTES;
  if (raw !== '') {
    const n = Number(raw);
    if (Number.isFinite(n)) minutes = Math.min(KEEPALIVE_MAX_MINUTES, Math.max(KEEPALIVE_MIN_MINUTES, n));
  }
  return { enabled: true, url: `${u.origin}/health`, intervalMs: Math.round(minutes * 60_000), reason: forced ? 'KEEPALIVE=on' : 'producao' };
}

export interface KeepaliveDeps {
  fetch?: typeof fetch;
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (h: unknown) => void;
  now?: () => number;
  log?: (msg: string) => void;
  /** Chamado a cada ping bem-sucedido (o pet "bate o coracao"). */
  onBeat?: () => void;
}

export interface Keepalive {
  /** Faz um ping agora; resolve true se deu certo. Nunca lanca. */
  ping(): Promise<boolean>;
  stop(): void;
  readonly stats: { ok: number; fail: number };
}

/** Inicia o autoping. Retorna null quando a config esta desligada. */
export function startKeepalive(cfg: KeepaliveConfig, deps: KeepaliveDeps = {}): Keepalive | null {
  if (!cfg.enabled) return null;
  const target = new URL(cfg.url);
  const doFetch = deps.fetch ?? fetch;
  const setI = deps.setInterval ?? ((fn: () => void, ms: number) => setInterval(fn, ms));
  const clearI = deps.clearInterval ?? ((h: unknown) => clearInterval(h as ReturnType<typeof setInterval>));
  const now = deps.now ?? Date.now;
  const log = deps.log ?? ((m: string) => console.log(m));
  const stats = { ok: 0, fail: 0 };
  let winOk = 0;
  let winFail = 0;
  let winStart = now();
  let stopped = false;

  const flushSummary = (force = false) => {
    if (!force && now() - winStart < KEEPALIVE_SUMMARY_MS) return;
    if (winOk + winFail > 0) log(`[workverse] keepalive: ${winOk} ok, ${winFail} falhas na ultima janela`);
    winOk = 0;
    winFail = 0;
    winStart = now();
  };

  const ping = async (): Promise<boolean> => {
    let ok = false;
    const ac = new AbortController();
    const to = setTimeout(() => ac.abort(), KEEPALIVE_TIMEOUT_MS);
    try {
      // URL reconstruida a cada vez a partir do host fixo; redirecionamentos NUNCA sao seguidos.
      const res = await doFetch(new URL('/health', target.origin).toString(), {
        method: 'GET',
        redirect: 'manual',
        signal: ac.signal,
        headers: { 'user-agent': KEEPALIVE_USER_AGENT },
      });
      ok = res.status >= 200 && res.status < 300;
    } catch {
      ok = false;
    } finally {
      clearTimeout(to);
    }
    if (stopped) return ok;
    if (ok) {
      stats.ok++;
      winOk++;
      try {
        deps.onBeat?.();
      } catch {
        /* a reacao visual nunca derruba o ping */
      }
    } else {
      stats.fail++;
      winFail++;
    }
    flushSummary();
    return ok;
  };

  const handle = setI(() => void ping(), cfg.intervalMs);
  (handle as { unref?: () => void } | null)?.unref?.();
  return {
    ping,
    stats,
    stop() {
      if (stopped) return;
      stopped = true;
      clearI(handle);
      flushSummary(true);
    },
  };
}
