/**
 * Metricas em formato texto Prometheus, sem dependencias (nao ha prom-client no projeto e o
 * necessario cabe em ~200 linhas). Um registro por `createApp`, para os testes nao compartilharem estado.
 *
 * A instrumentacao e feita por hooks chamados pela camada de rede (app.ts); world.ts e room.ts
 * nao conhecem as metricas. Rate limits sao contados pelo codigo de erro `rate_limited` enviado ao cliente.
 */
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';

type Labels = Record<string, string>;

const esc = (v: string) => v.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"');
const fmtLabels = (l: Labels) => {
  const keys = Object.keys(l);
  return keys.length === 0 ? '' : `{${keys.map((k) => `${k}="${esc(l[k])}"`).join(',')}}`;
};
const labelKey = (l: Labels) => JSON.stringify(Object.entries(l).sort(([a], [b]) => (a < b ? -1 : 1)));

/** Bounds label cardinality: client-controlled strings (message types, codes) cannot grow memory without limit. */
const MAX_SERIES = 64;

class Family {
  constructor(
    readonly name: string,
    readonly help: string,
    readonly type: 'counter' | 'gauge' | 'histogram',
  ) {}
  header() {
    return `# HELP ${this.name} ${this.help}\n# TYPE ${this.name} ${this.type}\n`;
  }
}

export class Counter extends Family {
  private readonly values = new Map<string, { labels: Labels; v: number }>();
  constructor(name: string, help: string) {
    super(name, help, 'counter');
  }
  inc(labels: Labels = {}, by = 1): void {
    const k = labelKey(labels);
    let s = this.values.get(k);
    if (!s) {
      if (this.values.size >= MAX_SERIES) return this.inc({ ...Object.fromEntries(Object.keys(labels).map((l) => [l, 'other'])) }, by);
      s = { labels, v: 0 };
      this.values.set(k, s);
    }
    s.v += by;
  }
  get(labels: Labels = {}) {
    return this.values.get(labelKey(labels))?.v ?? 0;
  }
  render() {
    let out = this.header();
    if (this.values.size === 0) out += `${this.name} 0\n`;
    for (const { labels, v } of this.values.values()) out += `${this.name}${fmtLabels(labels)} ${v}\n`;
    return out;
  }
}

export class Gauge extends Family {
  private value = 0;
  constructor(
    name: string,
    help: string,
    /** When set, evaluated at scrape time and may return labelled series. */
    private readonly collect?: () => number | Array<{ labels: Labels; v: number }>,
  ) {
    super(name, help, 'gauge');
  }
  set(v: number) {
    this.value = v;
  }
  inc(by = 1) {
    this.value += by;
  }
  dec(by = 1) {
    this.value -= by;
  }
  render() {
    let out = this.header();
    const r = this.collect ? this.collect() : this.value;
    if (typeof r === 'number') out += `${this.name} ${r}\n`;
    else for (const { labels, v } of r) out += `${this.name}${fmtLabels(labels)} ${v}\n`;
    return out;
  }
}

export class Histogram extends Family {
  private readonly series = new Map<string, { labels: Labels; counts: number[]; sum: number; count: number }>();
  constructor(
    name: string,
    help: string,
    private readonly buckets: number[],
  ) {
    super(name, help, 'histogram');
  }
  observe(value: number, labels: Labels = {}): void {
    const k = labelKey(labels);
    let s = this.series.get(k);
    if (!s) {
      if (this.series.size >= MAX_SERIES) return this.observe(value, Object.fromEntries(Object.keys(labels).map((l) => [l, 'other'])));
      s = { labels, counts: new Array(this.buckets.length).fill(0), sum: 0, count: 0 };
      this.series.set(k, s);
    }
    for (let i = 0; i < this.buckets.length; i++) if (value <= this.buckets[i]) s.counts[i]++;
    s.sum += value;
    s.count++;
  }
  render() {
    let out = this.header();
    for (const { labels, counts, sum, count } of this.series.values()) {
      this.buckets.forEach((b, i) => (out += `${this.name}_bucket${fmtLabels({ ...labels, le: String(b) })} ${counts[i]}\n`));
      out += `${this.name}_bucket${fmtLabels({ ...labels, le: '+Inf' })} ${count}\n`;
      out += `${this.name}_sum${fmtLabels(labels)} ${sum}\n${this.name}_count${fmtLabels(labels)} ${count}\n`;
    }
    return out;
  }
}

const MS_BUCKETS = [0.1, 0.25, 0.5, 1, 2.5, 5, 10, 25, 50, 100, 250, 1000];
/** Message type / error code: lowercase snake_case only, anything else is reported as `invalid`. */
const safeLabel = (s: unknown) => (typeof s === 'string' && /^[a-z_]{1,24}$/.test(s) ? s : 'invalid');

export interface MetricsSource {
  onlineCount: number;
  population(): Record<string, number>;
}

export class ServerMetrics {
  private readonly families: Array<{ render(): string }> = [];
  private readonly loopDelay = monitorEventLoopDelay({ resolution: 10 });
  private readonly startedAt = Date.now();

  readonly connectionsTotal = this.add(new Counter('workverse_ws_connections_total', 'WebSocket connections accepted.'));
  readonly connectionsActive = this.add(new Gauge('workverse_ws_connections_active', 'Open WebSocket connections.'));
  readonly received = this.add(new Counter('workverse_ws_messages_received_total', 'Client messages received, by type.'));
  readonly receivedBytes = this.add(new Counter('workverse_ws_received_bytes_total', 'Bytes received over WebSocket.'));
  readonly sent = this.add(new Counter('workverse_ws_messages_sent_total', 'Server messages sent, by type.'));
  readonly sentBytes = this.add(new Counter('workverse_ws_sent_bytes_total', 'Bytes sent over WebSocket.'));
  readonly errors = this.add(new Counter('workverse_errors_total', 'Errors, by kind (parse, oversize, handler, socket, error_msg:<code>).'));
  readonly rateLimited = this.add(new Counter('workverse_rate_limited_total', 'Messages answered with a rate_limited error.'));
  readonly sessions = this.add(new Counter('workverse_sessions_total', 'Session events (start/end).'));
  readonly roomEnters = this.add(new Counter('workverse_room_enters_total', 'Room entries, by room.'));
  readonly tickMs = this.add(new Histogram('workverse_tick_duration_ms', 'World tick duration in milliseconds.', MS_BUCKETS));
  readonly handlerMs = this.add(new Histogram('workverse_handler_duration_ms', 'World.handle duration in milliseconds, by message type.', MS_BUCKETS));

  constructor(source: MetricsSource) {
    this.add(new Gauge('workverse_players_online', 'Players with a live session.', () => source.onlineCount));
    this.add(
      new Gauge('workverse_room_players', 'Players per room.', () =>
        Object.entries(source.population()).map(([room, v]) => ({ labels: { room }, v })),
      ),
    );
    this.add(new Gauge('workverse_uptime_seconds', 'Seconds since the app started.', () => (Date.now() - this.startedAt) / 1000));
    this.add(new Gauge('process_cpu_seconds_total', 'User + system CPU time of the process in seconds (monotonic).', () => {
      const u = process.cpuUsage();
      return (u.user + u.system) / 1e6;
    }));
    this.add(new Gauge('process_resident_memory_bytes', 'Resident set size.', () => process.memoryUsage().rss));
    this.add(new Gauge('nodejs_heap_used_bytes', 'V8 heap in use.', () => process.memoryUsage().heapUsed));
    this.add(new Gauge('nodejs_eventloop_lag_p99_ms', 'Event loop delay p99 since start (ms).', () => (this.loopDelay.count ? this.loopDelay.percentile(99) / 1e6 : 0)));
    this.add(new Gauge('nodejs_eventloop_lag_max_ms', 'Event loop delay max since start (ms).', () => (this.loopDelay.count ? this.loopDelay.max / 1e6 : 0)));
    this.loopDelay.enable();
  }

  private add<T extends { render(): string }>(f: T): T {
    this.families.push(f);
    return f;
  }

  stop() {
    this.loopDelay.disable();
  }

  // ---- hooks used by app.ts -------------------------------------------------

  connOpen() {
    this.connectionsTotal.inc();
    this.connectionsActive.inc();
  }
  connClose() {
    this.connectionsActive.dec();
  }
  recv(type: unknown, bytes: number) {
    this.received.inc({ type: safeLabel(type) });
    this.receivedBytes.inc({}, bytes);
  }
  handled(type: unknown, ms: number) {
    this.handlerMs.observe(ms, { type: safeLabel(type) });
  }
  send(msg: { t: string; code?: string }, bytes: number) {
    this.sent.inc({ type: safeLabel(msg.t) });
    this.sentBytes.inc({}, bytes);
    if (msg.t === 'error') {
      const code = safeLabel(msg.code);
      this.errors.inc({ kind: `error_msg:${code}` });
      if (code === 'rate_limited') this.rateLimited.inc();
    }
  }
  error(kind: 'parse' | 'oversize' | 'handler' | 'socket') {
    this.errors.inc({ kind });
  }
  tick(ms: number) {
    this.tickMs.observe(ms);
  }
  /** Receives the `log(event, data)` audit events of World/StageManager. */
  audit(event: string, data?: Record<string, unknown>) {
    if (event === 'session.start') this.sessions.inc({ event: 'start' });
    else if (event === 'session.end') this.sessions.inc({ event: 'end' });
    else if (event === 'room.enter' && typeof data?.room === 'string') this.roomEnters.inc({ room: safeLabel(data.room.replace(/[^a-z]/g, '_')) });
  }

  render(): string {
    return this.families.map((f) => f.render()).join('');
  }
}

/**
 * GET /metrics. With METRICS_TOKEN set it requires `Authorization: Bearer <token>`.
 * In production without a token the endpoint does not exist (404), so nothing leaks by accident.
 */
export function registerMetricsRoute(app: FastifyInstance, metrics: ServerMetrics, opts: { token?: string; production: boolean }) {
  const token = opts.token?.trim() || undefined;
  if (opts.production && !token) return;
  const expected = token ? Buffer.from(token) : undefined;
  app.get('/metrics', async (req, reply) => {
    if (expected) {
      const given = Buffer.from((req.headers.authorization ?? '').replace(/^Bearer\s+/i, ''));
      if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
        return reply.code(401).header('www-authenticate', 'Bearer').send({ error: { code: 'unauthorized', message: 'Token invalido.' } });
      }
    }
    return reply.header('content-type', 'text/plain; version=0.0.4; charset=utf-8').send(metrics.render());
  });
}
