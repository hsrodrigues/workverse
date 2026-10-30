import {
  NOC_MASS_DELTA,
  NOC_MAX_EVENTS,
  NOC_MAX_ORGS,
  NOC_MAX_ROOMS,
  NOC_SAMPLE_MS,
  Ring,
  downsample,
  seriesStats,
  windowSamples,
  type NocClimateView,
  type NocEvent,
  type NocMediaView,
  type NocRoomView,
  type NocServerView,
  type NocView,
  type NocWindow,
  type QuotaLevel,
} from '@workverse/shared';

/**
 * Coletor de metricas do painel NOC (docs/noc.md). Amostra a cada `sampleMs` (30 s) e guarda aneis de tamanho FIXO (~6 h):
 * pessoas por organizacao, ocupacao e temperatura por sala, conexoes de midia por organizacao e, no processo, memoria,
 * tempo do tick e mensagens/s. Tudo em memoria; nada de dados pessoais (so contagens e nomes de sala). O isolamento por
 * organizacao e estrutural: cada organizacao tem as suas series e `view()` so le as dela.
 */

export interface NocSampleRoom {
  id: string;
  name: string;
  count: number;
  capacity: number;
  /** Presente so nas salas com ar-condicionado. */
  climate?: { temp: number; target: number; on: boolean; overheat: boolean };
  /** A Sala da TI (destaque no painel). */
  it?: boolean;
}
export interface NocSampleOrg {
  orgId: string;
  rooms: NocSampleRoom[];
}
export interface NocMediaSample {
  usedMinutes: number;
  limitMinutes: number;
  percent: number;
  level: QuotaLevel;
  /** Conexoes ativas por organizacao. */
  connections: ReadonlyMap<string, number>;
}
export interface NocHost {
  clock(): number;
  /** Estado atual das organizacoes ativas (ver World). */
  sample(): NocSampleOrg[];
  /** null: economia de midia desligada. */
  media(): NocMediaSample | null;
  /** Memoria do processo em MB (injetavel nos testes). */
  heapMb?(): number;
}
export interface NocOptions {
  sampleMs?: number;
  /** Orcamento de um tick do servidor em ms, para a "carga relativa" (padrao 100). */
  tickBudgetMs?: number;
}

interface RoomSeries {
  name: string;
  capacity: number;
  count: Ring;
  last: number;
}
interface ClimateSeries {
  name: string;
  it: boolean;
  temp: Ring;
  target: Ring;
  last: { temp: number; target: number; on: boolean; overheat: boolean };
}
interface OrgSeries {
  online: Ring;
  media: Ring;
  rooms: Map<string, RoomSeries>;
  climate: Map<string, ClimateSeries>;
  events: NocEvent[];
  lastPeople: number | null;
}

const QUOTA_RANK: Record<QuotaLevel, number> = { ok: 0, warn70: 1, warn90: 2, exceeded: 3 };
const QUOTA_TEXT: Record<QuotaLevel, string> = {
  ok: '',
  warn70: 'Cota mensal de áudio e vídeo da plataforma passou de 70%.',
  warn90: 'Cota mensal de áudio e vídeo da plataforma passou de 90%.',
  exceeded: 'Cota mensal de áudio e vídeo da plataforma esgotada.',
};

export class NocCollector {
  readonly sampleMs: number;
  private readonly tickBudgetMs: number;
  private readonly orgs = new Map<string, OrgSeries>();
  private readonly startedAt: number;
  private lastSampleAt = 0;
  // processo (so para o escopo `full`)
  private readonly heap = new Ring();
  private readonly tickAvg = new Ring();
  private readonly msgs = new Ring();
  private readonly mediaMinutes = new Ring();
  private tickSum = 0;
  private tickCount = 0;
  private tickMax = 0;
  private lastTickMax = 0;
  private lastTickAvg = 0;
  private lastMsgsPerSec = 0;
  private msgCount = 0;
  private quotaLevel: QuotaLevel = 'ok';
  private lastMedia: NocMediaSample | null = null;

  constructor(
    private readonly host: NocHost,
    opts: NocOptions = {},
  ) {
    this.sampleMs = Math.max(100, Math.floor(opts.sampleMs ?? NOC_SAMPLE_MS));
    this.tickBudgetMs = opts.tickBudgetMs ?? 100;
    this.startedAt = host.clock();
  }

  /** Chamado a cada tick do mundo: so amostra quando o intervalo passou (barato). */
  tick(now: number = this.host.clock()): void {
    if (this.lastSampleAt !== 0 && now - this.lastSampleAt < this.sampleMs) return;
    this.sampleNow(now);
  }

  /** Duracao de um tick do servidor (medida pela camada de rede). */
  recordTick(ms: number): void {
    if (!Number.isFinite(ms) || ms < 0) return;
    this.tickSum += ms;
    this.tickCount++;
    if (ms > this.tickMax) this.tickMax = ms;
  }

  /** Uma mensagem WebSocket recebida (contador agregado, sem rotulos). */
  countMessage(): void {
    this.msgCount++;
  }

  private seriesOf(orgId: string): OrgSeries | undefined {
    let s = this.orgs.get(orgId);
    if (!s) {
      if (this.orgs.size >= NOC_MAX_ORGS) return undefined;
      s = { online: new Ring(), media: new Ring(), rooms: new Map(), climate: new Map(), events: [], lastPeople: null };
      this.orgs.set(orgId, s);
    }
    return s;
  }

  private event(s: OrgSeries, at: number, kind: NocEvent['kind'], level: NocEvent['level'], text: string): void {
    s.events.push({ at, kind, level, text });
    if (s.events.length > NOC_MAX_EVENTS) s.events.splice(0, s.events.length - NOC_MAX_EVENTS);
  }

  /** Coleta uma amostra agora (publico para os testes). */
  sampleNow(now: number = this.host.clock()): void {
    const dt = this.lastSampleAt === 0 ? this.sampleMs : Math.max(1, now - this.lastSampleAt);
    this.lastSampleAt = now;

    // processo
    this.lastTickAvg = this.tickCount > 0 ? this.tickSum / this.tickCount : 0;
    this.lastTickMax = this.tickMax;
    this.lastMsgsPerSec = Math.round((this.msgCount / (dt / 1000)) * 100) / 100;
    this.heap.push(Math.round((this.host.heapMb ? this.host.heapMb() : process.memoryUsage().heapUsed / 1048576) * 10) / 10);
    this.tickAvg.push(Math.round(this.lastTickAvg * 1000) / 1000);
    this.msgs.push(this.lastMsgsPerSec);
    this.tickSum = 0;
    this.tickCount = 0;
    this.tickMax = 0;
    this.msgCount = 0;

    // midia (a cota e da plataforma inteira)
    const media = this.host.media();
    this.lastMedia = media;
    let rose: QuotaLevel | null = null;
    if (media) {
      this.mediaMinutes.push(media.usedMinutes);
      if (QUOTA_RANK[media.level] > QUOTA_RANK[this.quotaLevel]) rose = media.level;
      this.quotaLevel = media.level;
    } else {
      this.mediaMinutes.push(Number.NaN);
      this.quotaLevel = 'ok';
    }

    const seen = new Set<string>();
    for (const org of this.host.sample()) {
      const s = this.seriesOf(org.orgId);
      if (!s) continue;
      seen.add(org.orgId);
      const people = org.rooms.reduce((n, r) => n + r.count, 0);
      s.online.push(people);
      if (s.lastPeople !== null) {
        const d = people - s.lastPeople;
        if (d >= NOC_MASS_DELTA) this.event(s, now, 'mass_join', 'info', `${d} pessoas entraram em poucos instantes (${people} online).`);
        else if (-d >= NOC_MASS_DELTA) this.event(s, now, 'mass_leave', 'info', `${-d} pessoas saíram em poucos instantes (${people} online).`);
      }
      s.lastPeople = people;
      s.media.push(media ? (media.connections.get(org.orgId) ?? 0) : Number.NaN);
      if (rose) this.event(s, now, 'quota', rose === 'warn70' ? 'warn' : 'alert', QUOTA_TEXT[rose]);

      const liveRooms = new Set<string>();
      for (const r of org.rooms) {
        let rs = s.rooms.get(r.id);
        if (!rs) {
          if (s.rooms.size >= NOC_MAX_ROOMS) continue;
          rs = { name: r.name, capacity: r.capacity, count: new Ring(), last: 0 };
          s.rooms.set(r.id, rs);
        }
        liveRooms.add(r.id);
        rs.name = r.name;
        rs.capacity = r.capacity;
        rs.last = r.count;
        rs.count.push(r.count);
      }
      for (const id of s.rooms.keys()) if (!liveRooms.has(id)) s.rooms.delete(id);

      const liveAir = new Set<string>();
      for (const r of org.rooms) {
        if (!r.climate) continue;
        let cs = s.climate.get(r.id);
        if (!cs) {
          if (s.climate.size >= NOC_MAX_ROOMS) continue;
          cs = { name: r.name, it: !!r.it, temp: new Ring(), target: new Ring(), last: { ...r.climate } };
          s.climate.set(r.id, cs);
        }
        liveAir.add(r.id);
        cs.name = r.name;
        cs.it = !!r.it;
        cs.temp.push(r.climate.temp);
        cs.target.push(r.climate.on ? r.climate.target : Number.NaN);
        if (r.climate.overheat && !cs.last.overheat) this.event(s, now, 'overheat', 'alert', `Superaquecimento: ${r.name} passou do limite (${r.climate.temp.toFixed(1)} °C).`);
        else if (!r.climate.overheat && cs.last.overheat) this.event(s, now, 'overheat_clear', 'info', `Temperatura normalizada em ${r.name} (${r.climate.temp.toFixed(1)} °C).`);
        cs.last = { ...r.climate };
      }
      for (const id of s.climate.keys()) if (!liveAir.has(id)) s.climate.delete(id);
    }
    // organizacao que sumiu do mundo: libera a memoria
    for (const id of this.orgs.keys()) if (!seen.has(id)) this.orgs.delete(id);
  }

  /** Quantas organizacoes e series estao guardadas (para o teste de limite de memoria). */
  stats(): { orgs: number; rings: number } {
    let rings = 4;
    for (const s of this.orgs.values()) rings += 2 + s.rooms.size + s.climate.size * 2;
    return { orgs: this.orgs.size, rings };
  }

  /**
   * A visao de UMA organizacao. `canSee` filtra as salas (so as que a pessoa pode entrar). `full` inclui o processo e os
   * minutos de midia da plataforma; senao so uptime e carga relativa.
   */
  view(orgId: string, windowMin: NocWindow, opts: { full: boolean; canSee: (roomId: string) => boolean }, now: number = this.host.clock()): NocView {
    const s = this.orgs.get(orgId);
    const n = windowSamples(windowMin, this.sampleMs);
    const slice = (r: Ring) => r.tail(n);
    const ds = (r: Ring) => downsample(slice(r));
    const raw = s ? Math.min(n, s.online.length) : 0;
    const online = s ? ds(s.online) : [];
    const stepMs = online.length > 0 ? Math.round((this.sampleMs * raw) / online.length) : this.sampleMs;
    const peakOf = (r: Ring) => seriesStats(slice(r))?.max ?? 0;

    const rooms: NocRoomView[] = [];
    const climate: NocClimateView[] = [];
    if (s) {
      for (const [id, r] of s.rooms) {
        if (!opts.canSee(id)) continue;
        rooms.push({ id, name: r.name, count: r.last, capacity: r.capacity, peak: peakOf(r.count) });
      }
      rooms.sort((a, b) => b.count - a.count || b.peak - a.peak || a.name.localeCompare(b.name));
      for (const [id, c] of s.climate) {
        if (!opts.canSee(id)) continue;
        climate.push({ id, name: c.name, it: c.it, temp: c.last.temp, target: c.last.target, on: c.last.on, overheat: c.last.overheat, temps: ds(c.temp), targets: ds(c.target) });
      }
      climate.sort((a, b) => Number(b.it) - Number(a.it) || a.name.localeCompare(b.name));
    }

    let media: NocMediaView | null = null;
    if (this.lastMedia && s) {
      media = { connections: { now: this.lastMedia.connections.get(orgId) ?? 0, values: ds(s.media) }, level: this.lastMedia.level };
      if (opts.full) media.minutes = { used: this.lastMedia.usedMinutes, limit: this.lastMedia.limitMinutes, percent: this.lastMedia.percent, values: downsample(slice(this.mediaMinutes)) };
    }

    const server: NocServerView = { uptimeSec: Math.max(0, Math.floor((now - this.startedAt) / 1000)), load: Math.min(1, Math.max(0, Math.round((this.lastTickAvg / this.tickBudgetMs) * 1000) / 1000)) };
    if (opts.full) {
      server.detail = {
        heapMb: this.heap.length > 0 ? Math.round(this.heap.last() * 10) / 10 : 0,
        tickMs: Math.round(this.lastTickAvg * 1000) / 1000,
        tickMaxMs: Math.round(this.lastTickMax * 1000) / 1000,
        msgsPerSec: this.lastMsgsPerSec,
        heap: ds(this.heap),
        tick: ds(this.tickAvg),
        msgs: ds(this.msgs),
      };
    }

    return {
      scope: opts.full ? 'full' : 'org',
      at: now,
      windowMin,
      sampleMs: this.sampleMs,
      stepMs,
      online: { now: s?.lastPeople ?? 0, peak: s ? peakOf(s.online) : 0, values: online },
      rooms,
      climate,
      media,
      server,
      events: s ? s.events.slice(-NOC_MAX_EVENTS).reverse() : [],
    };
  }
}
