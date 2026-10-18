/**
 * Teste de carga progressivo do WorkVerse.
 *
 *   npm run loadtest                       # degraus 10,25,50,100,200,400,800 (20 s cada), para no 1o degrau reprovado
 *   npm run loadtest -- --steps 10,50 --hold 10
 *   npm run loadtest -- --continue         # nao para quando um degrau reprova
 *
 * O proprio script sobe um servidor ISOLADO (porta 3401, ALLOW_DEV_LOGIN=1, DATA_DIR temporario,
 * METRICS_TOKEN aleatorio, LiveKit apontando para uma porta morta) e o derruba no fim. Nao toca em
 * 3001/5173/7880. Os bots usam o login so-por-nome (nao ha rate limit de IP no caminho WebSocket;
 * os limites por jogador - move/chat/misc - continuam ativos e os bots respeitam taxas humanas).
 *
 * Por degrau mede: RTT de ping/pong, tempo move -> 'path' proprio, mensagens/s e bytes/s, perda,
 * quedas inesperadas, CPU/RSS do servidor e latencias internas (via /metrics).
 * Saida: docs/load-report.md e docs/load-report.json. Detalhes em docs/load-testing.md.
 *
 * Opcoes: --activity (x taxa de acoes dos bots) --steps --hold (s) --settle (s) --rate (conexoes/s na rampa) --port --continue
 *         --p95 (ms, limite) --out (diretorio dos relatorios)
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import WebSocket from 'ws';
import { ROOM_DEFS, buildRoom, isWalkable, type ClientMessage, type ServerMessage } from '@workverse/shared';

const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : fallback;
};
const flag = (name: string) => process.argv.includes(`--${name}`);

const PORT = Number(arg('port', '3401'));
const STEPS = arg('steps', '10,25,50,100,200,400,800').split(',').map(Number).filter((n) => n > 0);
const HOLD_S = Number(arg('hold', '20'));
const SETTLE_S = Number(arg('settle', '3'));
const RAMP_PER_S = Number(arg('rate', '50'));
const ACTIVITY = Number(arg('activity', '1')); // multiplica a taxa de acoes dos bots (estresse alem do humano)
const P95_LIMIT_MS = Number(arg('p95', '150'));
const LOSS_LIMIT = 0.005; // 0,5% das mensagens medidas sem resposta
const GEN_LAG_LIMIT_MS = 30; // acima disso o proprio gerador de carga distorce a medicao
const here = dirname(fileURLToPath(import.meta.url));
const serverDir = resolve(here, '..');
const outDir = resolve(arg('out', resolve(here, '../../../docs')));

// ---- servidor de teste --------------------------------------------------------

const token = randomBytes(16).toString('hex');
const dataDir = mkdtempSync(resolve(tmpdir(), 'workverse-load-'));
let server: ChildProcess | undefined;
let serverStderr = '';
let serverExited = false;

async function startServer() {
  server = spawn(process.execPath, ['--import', 'tsx', 'src/main.ts'], {
    cwd: serverDir,
    env: {
      ...process.env,
      NODE_ENV: 'development',
      PORT: String(PORT),
      HOST: '127.0.0.1',
      ALLOW_DEV_LOGIN: '1',
      DATA_DIR: dataDir,
      METRICS_TOKEN: token,
      // Nada de LiveKit real durante o teste.
      LIVEKIT_URL: 'ws://127.0.0.1:9',
      PUBLIC_LIVEKIT_URL: 'ws://127.0.0.1:9',
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  server.stderr?.on('data', (d: Buffer) => {
    serverStderr = (serverStderr + d.toString()).slice(-4000);
  });
  server.on('exit', () => {
    serverExited = true;
  });
  for (let i = 0; i < 120; i++) {
    if (serverExited) throw new Error(`servidor de teste terminou ao iniciar:\n${serverStderr}`);
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/health`);
      if (r.ok) return;
    } catch {
      /* ainda subindo */
    }
    await sleep(250);
  }
  throw new Error('servidor de teste nao respondeu em 30 s');
}

function stopServer() {
  if (server && !serverExited) server.kill();
  try {
    rmSync(dataDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---- /metrics -------------------------------------------------------------------

type Scrape = Map<string, number>;

async function scrape(): Promise<Scrape | null> {
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/metrics`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) });
    const out: Scrape = new Map();
    for (const line of (await r.text()).split('\n')) {
      if (!line || line.startsWith('#')) continue;
      const sp = line.lastIndexOf(' ');
      out.set(line.slice(0, sp), Number(line.slice(sp + 1)));
    }
    return out;
  } catch {
    return null;
  }
}

const sumPrefix = (s: Scrape, prefix: string) => {
  let t = 0;
  for (const [k, v] of s) if (k.startsWith(prefix)) t += v;
  return t;
};

/** Quantile from the delta of a Prometheus histogram (upper bound of the bucket that crosses q). */
function histQuantile(a: Scrape, b: Scrape, name: string, q: number): number {
  const byLe = new Map<number, number>();
  let total = 0;
  for (const [k, v] of b) {
    if (!k.startsWith(`${name}_bucket{`)) continue;
    const le = /le="([^"]+)"/.exec(k)?.[1];
    if (!le) continue;
    const d = v - (a.get(k) ?? 0);
    const key = le === '+Inf' ? Infinity : Number(le);
    byLe.set(key, (byLe.get(key) ?? 0) + d);
  }
  total = byLe.get(Infinity) ?? 0;
  if (total <= 0) return 0;
  for (const le of [...byLe.keys()].sort((x, y) => x - y)) if ((byLe.get(le) ?? 0) >= q * total) return le === Infinity ? 1000 : le;
  return 0;
}

// ---- estatisticas -----------------------------------------------------------------

const pct = (xs: number[], p: number) => {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
};

interface Window {
  active: boolean;
  ping: number[];
  pingSent: number;
  move: number[];
  moveSent: number;
  moveBlocked: number;
  recv: number;
  recvBytes: number;
  errors: Record<string, number>;
}
const newWindow = (): Window => ({ active: false, ping: [], pingSent: 0, move: [], moveSent: 0, moveBlocked: 0, recv: 0, recvBytes: 0, errors: {} });
let win = newWindow();
let drops = 0;
let connectFails = 0;
let closing = false;

// ---- bots -----------------------------------------------------------------------------

const ROOM_PATTERN = ['office', 'lounge', 'auditorium', 'office', 'auditorium', 'office', 'lounge', 'auditorium', 'office', 'lounge', 'auditorium']; // 4:3:4 ~ 40:30:40
const built = new Map(ROOM_DEFS.map((d) => [d.id, buildRoom(d)]));
const phrases = ['Bom dia, time!', 'Alguem viu o relatorio?', 'Cafe na copa', 'Daily em 5 minutos', 'Boa ideia!', 'Ja volto'];
const rand = (min: number, max: number) => min + Math.random() * (max - min);

class Bot {
  ws!: WebSocket;
  id?: string;
  state: 'connecting' | 'session' | 'inroom' | 'roomless' | 'failed' | 'closed' = 'connecting';
  private timers: NodeJS.Timeout[] = [];
  private pendingMoves: { at: number; counted: boolean }[] = [];
  readonly roomId: string;

  constructor(readonly index: number) {
    this.roomId = ROOM_PATTERN[index % ROOM_PATTERN.length];
  }

  private send(m: ClientMessage) {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  start() {
    this.ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
    this.ws.on('open', () => this.send({ t: 'hello', name: `LT-${String(this.index + 1).padStart(4, '0')}` }));
    this.ws.on('message', (raw) => this.onMessage(raw as Buffer));
    this.ws.on('close', () => {
      this.timers.forEach(clearInterval);
      if (!closing && this.state !== 'closed') drops++;
      if (this.state === 'connecting') connectFails++;
      this.state = 'closed';
    });
    this.ws.on('error', () => undefined);
  }

  private onMessage(raw: Buffer) {
    if (win.active) {
      win.recv++;
      win.recvBytes += raw.length;
    }
    const msg = JSON.parse(raw.toString()) as ServerMessage;
    switch (msg.t) {
      case 'session':
        this.id = msg.id;
        this.state = 'session';
        this.send({ t: 'join', roomId: this.roomId });
        break;
      case 'room':
        this.state = 'inroom';
        this.begin();
        break;
      case 'pong':
        if (win.active && msg.ts > 0) win.ping.push(Date.now() - msg.ts);
        break;
      case 'path':
        if (msg.id === this.id) {
          const p = this.pendingMoves.shift();
          if (p?.counted) win.move.push(performance.now() - p.at);
        }
        break;
      case 'error':
        if (msg.code === 'room_full') this.state = 'roomless';
        if (msg.code === 'blocked') {
          const p = this.pendingMoves.shift();
          if (p?.counted) win.moveBlocked++;
        }
        if (win.active) win.errors[msg.code] = (win.errors[msg.code] ?? 0) + 1;
        break;
      default:
    }
  }

  /** Human-like rates: walk every 4-8 s, chat every 20-40 s, emote every 30-60 s, ping every 2 s. */
  private begin() {
    const every = (ms: number, jitter: number, fn: () => void) => {
      const loop = () => {
        const t = setTimeout(() => {
          fn();
          loop();
        }, (ms + Math.random() * jitter) / (ms === 2000 ? 1 : ACTIVITY));
        this.timers.push(t as unknown as NodeJS.Timeout);
      };
      loop();
    };
    const room = built.get(this.roomId)!;
    every(4000, 4000, () => {
      const x = Math.floor(Math.random() * room.grid.width);
      const y = Math.floor(Math.random() * room.grid.height);
      if (!isWalkable(room.grid, x, y) || room.portalAt.has(y * room.grid.width + x)) return;
      this.pendingMoves.push({ at: performance.now(), counted: win.active });
      if (win.active) win.moveSent++;
      if (this.pendingMoves.length > 4) this.pendingMoves.shift();
      this.send({ t: 'move', x, y });
    });
    every(20_000, 20_000, () => this.send({ t: 'chat', text: phrases[Math.floor(Math.random() * phrases.length)] }));
    every(30_000, 30_000, () => this.send({ t: 'emote', emote: 'wave' }));
    every(2000, 100, () => {
      if (win.active) win.pingSent++;
      this.send({ t: 'ping', ts: Date.now() });
    });
  }

  close() {
    this.state = 'closed';
    this.timers.forEach(clearTimeout);
    this.ws.close();
  }
}

// ---- degraus -----------------------------------------------------------------------------

interface StepResult {
  bots: number;
  inRoom: number;
  roomless: number;
  handshakeFailed: number;
  drops: number;
  connectFails: number;
  windowSeconds: number;
  recvMsgPerSec: number;
  recvKBPerSec: number;
  serverSentMsgPerSec: number;
  serverRecvMsgPerSec: number;
  pingP50: number;
  pingP95: number;
  pingP99: number;
  pingSamples: number;
  moveP50: number;
  moveP95: number;
  moveP99: number;
  moveSamples: number;
  pingLoss: number;
  moveLoss: number;
  deliveryLoss: number;
  serverCpuPct: number;
  serverRssMB: number;
  serverHeapMB: number;
  tickP95Ms: number;
  tickP99Ms: number;
  handlerP95Ms: number;
  loopLagP99Ms: number;
  loopLagMaxMs: number;
  generatorLagP99Ms: number;
  errors: Record<string, number>;
  failures: string[];
  pass: boolean;
}

const bots: Bot[] = [];
const genLag = monitorEventLoopDelay({ resolution: 10 });

async function runStep(target: number): Promise<StepResult> {
  const dropsBefore = drops;
  const failsBefore = connectFails;
  // rampa
  const gap = 1000 / RAMP_PER_S;
  while (bots.length < target) {
    const b = new Bot(bots.length);
    bots.push(b);
    b.start();
    await sleep(gap);
  }
  // espera todos terminarem o handshake (em sala, lotada ou falha)
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline && bots.some((b) => b.state === 'connecting' || b.state === 'session')) await sleep(250);
  await sleep(SETTLE_S * 1000);

  // janela de medicao
  win = newWindow();
  genLag.reset();
  const s0 = await scrape();
  const t0 = performance.now();
  win.active = true;
  await sleep(HOLD_S * 1000);
  win.active = false;
  const t1 = performance.now();
  const s1 = await scrape();
  await sleep(2000); // respostas em voo
  const seconds = (t1 - t0) / 1000;

  const inRoom = bots.filter((b) => b.state === 'inroom').length;
  const roomless = bots.filter((b) => b.state === 'roomless').length;
  const handshakeFailed = bots.filter((b) => b.state === 'connecting' || b.state === 'session').length;
  const pingSamples = win.ping.length;
  const moveSamples = win.move.length;
  const pingLoss = win.pingSent ? Math.max(0, 1 - pingSamples / win.pingSent) : 0;
  const answeredMoves = moveSamples + win.moveBlocked;
  const moveLoss = win.moveSent ? Math.max(0, 1 - answeredMoves / win.moveSent) : 0;

  let serverSent = NaN;
  let serverRecv = NaN;
  let cpuPct = NaN;
  let rss = NaN;
  let heap = NaN;
  let tickP95 = NaN;
  let tickP99 = NaN;
  let handlerP95 = NaN;
  let lagP99 = NaN;
  let lagMax = NaN;
  if (s0 && s1) {
    serverSent = (sumPrefix(s1, 'workverse_ws_messages_sent_total{') - sumPrefix(s0, 'workverse_ws_messages_sent_total{')) / seconds;
    serverRecv = (sumPrefix(s1, 'workverse_ws_messages_received_total{') - sumPrefix(s0, 'workverse_ws_messages_received_total{')) / seconds;
    cpuPct = ((s1.get('process_cpu_seconds_total')! - s0.get('process_cpu_seconds_total')!) / seconds) * 100;
    rss = s1.get('process_resident_memory_bytes')! / 1048576;
    heap = s1.get('nodejs_heap_used_bytes')! / 1048576;
    tickP95 = histQuantile(s0, s1, 'workverse_tick_duration_ms', 0.95);
    tickP99 = histQuantile(s0, s1, 'workverse_tick_duration_ms', 0.99);
    handlerP95 = histQuantile(s0, s1, 'workverse_handler_duration_ms', 0.95);
    lagP99 = s1.get('nodejs_eventloop_lag_p99_ms')!;
    lagMax = s1.get('nodejs_eventloop_lag_max_ms')!;
  }
  const recvRate = win.recv / seconds;
  // Entrega: o que o servidor enviou na janela vs. o que os bots receberam (so ha bots como clientes WS).
  const deliveryLoss = Number.isFinite(serverSent) && serverSent > 0 ? Math.max(0, 1 - recvRate / serverSent) : NaN;

  const r: StepResult = {
    bots: bots.filter((b) => b.state !== 'closed').length,
    inRoom,
    roomless,
    handshakeFailed,
    drops: drops - dropsBefore,
    connectFails: connectFails - failsBefore,
    windowSeconds: Math.round(seconds),
    recvMsgPerSec: recvRate,
    recvKBPerSec: win.recvBytes / seconds / 1024,
    serverSentMsgPerSec: serverSent,
    serverRecvMsgPerSec: serverRecv,
    pingP50: pct(win.ping, 50),
    pingP95: pct(win.ping, 95),
    pingP99: pct(win.ping, 99),
    pingSamples,
    moveP50: pct(win.move, 50),
    moveP95: pct(win.move, 95),
    moveP99: pct(win.move, 99),
    moveSamples,
    pingLoss,
    moveLoss,
    deliveryLoss,
    serverCpuPct: cpuPct,
    serverRssMB: rss,
    serverHeapMB: heap,
    tickP95Ms: tickP95,
    tickP99Ms: tickP99,
    handlerP95Ms: handlerP95,
    loopLagP99Ms: lagP99,
    loopLagMaxMs: lagMax,
    generatorLagP99Ms: genLag.count ? genLag.percentile(99) / 1e6 : 0,
    errors: win.errors,
    failures: [],
    pass: true,
  };
  if (!(r.pingP95 < P95_LIMIT_MS)) r.failures.push(`ping p95 ${fmt(r.pingP95)} ms >= ${P95_LIMIT_MS} ms`);
  if (!(r.moveP95 < P95_LIMIT_MS)) r.failures.push(`move->path p95 ${fmt(r.moveP95)} ms >= ${P95_LIMIT_MS} ms`);
  if (r.drops > 0) r.failures.push(`${r.drops} queda(s) inesperada(s)`);
  if (r.connectFails > 0 || r.handshakeFailed > 0) r.failures.push(`${r.connectFails + r.handshakeFailed} falha(s) de conexao/handshake`);
  if (r.pingLoss > LOSS_LIMIT || r.moveLoss > LOSS_LIMIT) r.failures.push(`perda ping ${(r.pingLoss * 100).toFixed(2)}% / move ${(r.moveLoss * 100).toFixed(2)}% > 0,5%`);
  if (serverExited) r.failures.push('servidor encerrou');
  r.pass = r.failures.length === 0;
  // Se o gerador esta saturado, a medicao nao e confiavel: avisa sem reprovar o servidor.
  if (r.generatorLagP99Ms > GEN_LAG_LIMIT_MS) r.failures.push(`AVISO: gerador de carga saturado (lag p99 ${fmt(r.generatorLagP99Ms)} ms); latencias superestimadas`);
  return r;
}

function fmt(n: number, digits = 1) {
  return Number.isFinite(n) ? n.toFixed(digits) : 'n/d';
}

// ---- relatorio ------------------------------------------------------------------------------

function report(results: StepResult[], startedAt: Date) {
  const firstFail = results.find((r) => !r.pass);
  const lastOk = [...results].reverse().find((r) => r.pass);
  const json = {
    startedAt: startedAt.toISOString(),
    node: process.version,
    platform: `${process.platform} ${process.arch}`,
    limits: { p95Ms: P95_LIMIT_MS, unexpectedDrops: 0, lossMax: LOSS_LIMIT },
    config: { steps: STEPS, holdSeconds: HOLD_S, settleSeconds: SETTLE_S, rampPerSecond: RAMP_PER_S, port: PORT },
    firstFailingStep: firstFail?.bots ?? null,
    lastPassingStep: lastOk?.bots ?? null,
    steps: results,
  };
  const rows = results.map(
    (r) =>
      `| ${r.bots} | ${r.inRoom}/${r.roomless} | ${fmt(r.recvMsgPerSec, 0)} | ${fmt(r.recvKBPerSec, 0)} | ${fmt(r.pingP50)} / ${fmt(r.pingP95)} / ${fmt(r.pingP99)} | ${fmt(r.moveP50)} / ${fmt(r.moveP95)} / ${fmt(r.moveP99)} | ${fmt(r.pingLoss * 100, 2)} / ${fmt(r.moveLoss * 100, 2)} / ${fmt(r.deliveryLoss * 100, 2)} | ${r.drops} | ${fmt(r.serverCpuPct, 0)} | ${fmt(r.serverRssMB, 0)} | ${fmt(r.tickP95Ms, 2)} | ${fmt(r.handlerP95Ms, 2)} | ${fmt(r.loopLagP99Ms)} | ${fmt(r.generatorLagP99Ms)} | ${r.pass ? 'OK' : 'FALHA'} |`,
  );
  const md = `# Relatorio de teste de carga

Gerado por \`npm run loadtest\` em ${startedAt.toISOString()} (Node ${process.version}, ${process.platform} ${process.arch}). Nao edite a mao: a execucao seguinte sobrescreve este arquivo. Analise e interpretacao: [load-testing.md](load-testing.md).

- Servidor: processo isolado na porta ${PORT}, um unico processo Node, \`ALLOW_DEV_LOGIN=1\`, \`DATA_DIR\` temporario, logs de auditoria do pino desligados da tela (stdout descartado).
- Cada degrau: rampa de ${RAMP_PER_S} conexoes/s, ${SETTLE_S} s de estabilizacao, janela de medicao de ${HOLD_S} s.
- Bots: andam a cada 4-8 s, falam a cada 20-40 s, emote a cada 30-60 s, ping a cada 2 s. Distribuidos em office/lounge/auditorium na proporcao das capacidades (40/30/40).
- Limites aceitaveis: p95 < ${P95_LIMIT_MS} ms (ping e move->path), 0 quedas inesperadas, 0 falhas de handshake, perda de respostas <= 0,5%.

| Bots | Em sala / sem sala (lotada) | msg/s recebidas | KB/s recebidos | Ping ms p50/p95/p99 | move->path ms p50/p95/p99 | Perda % ping/move/entrega | Quedas | CPU srv % | RSS MB | tick p95 ms | handler p95 ms | lag loop srv p99 ms | lag gerador p99 ms | Veredito |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
${rows.join('\n')}

Legenda: "Perda entrega" compara mensagens enviadas pelo servidor (\`/metrics\`) com as recebidas pelos bots na janela (indicativo; erro de borda de poucos %). tick/handler p95 sao o limite superior do bucket do histograma. CPU e % de um nucleo.

${
  firstFail
    ? `**Primeiro degrau reprovado: ${firstFail.bots} bots** — ${firstFail.failures.join('; ')}.\n`
    : '**Nenhum degrau reprovou nos limites definidos.**\n'
}${lastOk ? `**Maior degrau aprovado: ${lastOk.bots} bots.**\n` : ''}
${results.filter((r) => r.failures.length).map((r) => `- ${r.bots} bots: ${r.failures.join('; ')}`).join('\n')}
`;
  mkdirSync(outDir, { recursive: true });
  writeFileSync(resolve(outDir, 'load-report.json'), JSON.stringify(json, null, 2));
  writeFileSync(resolve(outDir, 'load-report.md'), md);
  console.log(`[loadtest] relatorios em ${resolve(outDir, 'load-report.md')}`);
}

// ---- main ------------------------------------------------------------------------------------

async function main() {
  const startedAt = new Date();
  console.log(`[loadtest] iniciando servidor isolado na porta ${PORT}...`);
  await startServer();
  genLag.enable();
  const results: StepResult[] = [];
  try {
    for (const n of STEPS) {
      console.log(`[loadtest] degrau ${n} bots...`);
      const r = await runStep(n);
      results.push(r);
      console.log(
        `[loadtest]   ${r.pass ? 'OK   ' : 'FALHA'} ping p95=${fmt(r.pingP95)}ms move p95=${fmt(r.moveP95)}ms cpu=${fmt(r.serverCpuPct, 0)}% rss=${fmt(r.serverRssMB, 0)}MB drops=${r.drops} msg/s=${fmt(r.recvMsgPerSec, 0)}${r.failures.length ? ` | ${r.failures.join('; ')}` : ''}`,
      );
      report(results, startedAt);
      if (!r.pass && !flag('continue')) break;
    }
  } finally {
    closing = true;
    bots.forEach((b) => b.close());
    genLag.disable();
    await sleep(500);
    stopServer();
  }
}

process.on('SIGINT', () => {
  closing = true;
  stopServer();
  process.exit(130);
});
main().then(
  () => process.exit(0),
  (err) => {
    console.error('[loadtest] erro:', err);
    stopServer();
    process.exit(1);
  },
);
