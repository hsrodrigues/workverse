import type { ServerMessage } from '@workverse/shared';

/**
 * Numeros vivos para as telas da Sala da TI (videowall e estacao de frente a ele): pessoas online e temperatura da sala.
 * Vem do que o cliente JA recebe (populacao por sala e clima da sala), sem consulta extra e sem exigir permissao: o mesmo
 * dado do painel NOC, so que amostrado aqui a cada 30 s (barato; nada por quadro). `opt()` e um digest que muda so quando a
 * forma dos graficos muda, para o desenho em cache ser refeito apenas entao.
 */

export const NOC_LIVE_POINTS = 24;
/** `opt` de peca >= isto significa "desenho com dados vivos" (ver furniture.ts / WorldScene.optOf). */
export const NOC_LIVE_OPT_MIN = 1_000_000;

/** Serie curta com as ultimas amostras e um digest (`version`) da sua forma. */
export class LiveSeries {
  private readonly buf: number[] = [];
  version = 1;
  constructor(readonly cap: number = NOC_LIVE_POINTS) {}
  push(v: number): void {
    if (!Number.isFinite(v)) return;
    this.buf.push(Math.round(v * 10) / 10);
    if (this.buf.length > this.cap) this.buf.shift();
    let h = 2166136261;
    for (const x of this.buf) h = Math.imul(h ^ Math.round(x * 10), 16777619) >>> 0;
    this.version = (h % 899_999) + 1;
  }
  values(): number[] {
    return [...this.buf];
  }
  get length(): number {
    return this.buf.length;
  }
  last(): number | null {
    return this.buf.length ? this.buf[this.buf.length - 1]! : null;
  }
}

/** Pontos inteiros (x da esquerda, y para CIMA a partir de 0) numa caixa w x h. Serie constante ou de um ponto fica no meio. */
export function sparkPoints(values: readonly number[], w: number, h: number): Array<[number, number]> {
  const n = values.length;
  if (n === 0) return [];
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  const flat = hi - lo < 1e-9;
  if (flat) {
    lo -= 1;
    hi += 1;
  }
  return values.map((v, i) => [n === 1 ? Math.floor((w - 1) / 2) : Math.round((i / (n - 1)) * (w - 1)), Math.round(((v - lo) / (hi - lo)) * (h - 1))]);
}

const queryMs = (): number | null => {
  try {
    const q = Number(new URLSearchParams(location.search).get('nocLive'));
    return q >= 200 ? q : null;
  } catch {
    return null;
  }
};

class NocLive {
  readonly online = new LiveSeries();
  readonly temp = new LiveSeries();
  private latestPeople: number | null = null;
  private latestTemp: number | null = null;
  private readonly listeners = new Set<() => void>();
  private timer: ReturnType<typeof setInterval> | null = null;
  intervalMs = queryMs() ?? 30_000;

  /** Digest dos dois graficos (so muda quando a forma muda). */
  opt(): number {
    return NOC_LIVE_OPT_MIN + ((this.online.version * 31 + this.temp.version) % 899_999);
  }
  subscribe(l: () => void): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
  /** Le o que o servidor ja manda ao cliente. */
  observe(msg: ServerMessage): void {
    if (msg.t === 'room') {
      this.set(Object.values(msg.room.population).reduce((a, b) => a + b, 0), msg.room.climate?.temp ?? null);
    } else if (msg.t === 'population') this.set(Object.values(msg.population).reduce((a, b) => a + b, 0), null);
    else if (msg.t === 'climate') this.set(null, msg.temp);
  }
  private set(people: number | null, temp: number | null): void {
    const first = this.latestPeople === null && this.latestTemp === null;
    if (people !== null) this.latestPeople = people;
    if (temp !== null) this.latestTemp = temp;
    // a primeira leitura ja vira amostra (a tela nunca fica vazia); o resto entra no ritmo do relogio
    if (this.online.length === 0 && this.latestPeople !== null) this.commitOne('online');
    if (this.temp.length === 0 && this.latestTemp !== null) this.commitOne('temp');
    if (first && !this.timer) this.start();
  }
  private commitOne(which: 'online' | 'temp'): void {
    const s = which === 'online' ? this.online : this.temp;
    const v = which === 'online' ? this.latestPeople : this.latestTemp;
    if (v === null) return;
    const before = s.version;
    s.push(v);
    if (s.version !== before) for (const l of this.listeners) l();
  }
  /** Uma amostra de cada (chamado pelo relogio; publico para testes). */
  commit(): void {
    this.commitOne('online');
    this.commitOne('temp');
  }
  private start(): void {
    if (typeof setInterval !== 'function') return;
    this.timer = setInterval(() => this.commit(), this.intervalMs);
  }
}

export const nocLive = new NocLive();
