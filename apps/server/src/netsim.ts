import { randomUUID } from 'node:crypto';
import {
  HOST_KINDS,
  NETSIM_IT_ONLY_MESSAGE,
  NETSIM_MAX_OPS,
  applyOp,
  browse,
  buildContext,
  defaultTopology,
  ifaceViews,
  isNetsimAction,
  isNetsimMessageType,
  nslookup,
  ping,
  testInternet,
  traceroute,
  validateTopology,
  type ClientMessage,
  type HostKind,
  type InvStation,
  type NetOp,
  type NetsimAction,
  type NetsimErrorCode,
  type NetsimStatePayload,
  type ServerMessage,
  type SimResult,
  type Topology,
} from '@workverse/shared';
import { TokenBucket } from './limiter';
import { ChallengeService } from './netsimChallenges';
import type { NetsimRow } from './netsimStore';
import type { Player, RoomInstance } from './room';
import type { AccountStore } from './store';

/**
 * Simulador de rede da Sala da TI (docs/netsim.md). Uma topologia por organizacao, versionada. Tudo e simulado: nenhum
 * pacote real, socket ou fetch. Qualquer membro (nao visitante) ve e testa em modo leitura; so a equipe de TI, dono/admin e a
 * staff em servico editam. Edicoes sao validadas pelo mesmo motor puro do cliente (packages/shared/src/netsim).
 */

export interface NetsimHost {
  store: AccountStore;
  clock: () => number;
  log: (event: string, data?: Record<string, unknown>) => void;
  /** Equipe de TI da org, dono/admin ou staff em servico. */
  isIT(p: Player): boolean;
  playerOf(accountId: string): Player | undefined;
  /** Estacoes de trabalho (inventario) de UMA organizacao. */
  stations(orgId: string): InvStation[];
  canEnter(p: Player, roomId: string): boolean;
}

/** Estacoes (`computer`, `command_desk`, `hardware_bench`) de cada sala, com o mesmo id `sala/peca` do inventario. */
export function stationsOf(rooms: ReadonlyMap<string, RoomInstance>): InvStation[] {
  const out: InvStation[] = [];
  for (const [roomId, room] of rooms) {
    const def = room.built.def;
    for (const f of def.furniture) {
      if (!(HOST_KINDS as readonly string[]).includes(f.kind)) continue;
      out.push({ id: `${roomId}/${f.id}`, kind: f.kind as HostKind, roomId, roomName: def.name, x: f.x, y: f.y });
    }
  }
  return out;
}

const UNDO_DEPTH = 12;
const DEV_ID = /^[a-z][a-z0-9]{0,11}$/;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁩﻿]/;
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 1e9;

export interface HostNet {
  ip?: string;
  link: boolean;
  internet: boolean;
  device: string;
}

export class NetsimService {
  private readonly undo = new Map<string, Topology[]>();
  private readonly subs = new Map<string, Set<string>>();
  private readonly buckets = new Map<string, TokenBucket>();
  private readonly hostCache = new Map<string, { version: number; hosts: Map<string, HostNet> }>();

  /** Desafios "Conserte a rede": sandbox por pessoa, nunca toca a topologia real da org. */
  private readonly challenges: ChallengeService;

  constructor(private readonly host: NetsimHost) {
    this.challenges = new ChallengeService(host);
  }

  /** O mundo chama isto para toda mensagem `netsim_*`. Devolve false se a mensagem for malformada (vira strike). */
  handle(p: Player, msg: ClientMessage, now: number): boolean {
    if (!isNetsimMessageType(msg.t)) return false;
    if (p.role === 'guest') {
      this.err(p, undefined, 'guest', 'Visitantes não têm acesso ao simulador de rede.');
      return true;
    }
    switch (msg.t) {
      case 'netsim_challenges':
      case 'netsim_challenge_start':
      case 'netsim_challenge_edit':
      case 'netsim_challenge_check':
      case 'netsim_challenge_hint':
      case 'netsim_challenge_quit':
        return this.challenges.handle(p, msg, now);
      case 'netsim_get':
        this.subscribe(p);
        this.sendState(p);
        return true;
      case 'netsim_edit': {
        if (!isInt(msg.rid) || !isInt(msg.base) || !Array.isArray(msg.ops) || msg.ops.length < 1 || msg.ops.length > NETSIM_MAX_OPS) return false;
        if (msg.ops.some((o) => typeof o !== 'object' || o === null || typeof (o as { op?: unknown }).op !== 'string')) return false;
        return this.edit(p, msg.rid, msg.base, msg.ops as NetOp[], now);
      }
      case 'netsim_undo':
      case 'netsim_reset': {
        if (!isInt(msg.rid) || !isInt(msg.base)) return false;
        return msg.t === 'netsim_undo' ? this.undoLast(p, msg.rid, msg.base, now) : this.reset(p, msg.rid, msg.base, now);
      }
      case 'netsim_run': {
        if (!isInt(msg.rid) || !isNetsimAction(msg.action) || typeof msg.src !== 'string' || !DEV_ID.test(msg.src)) return false;
        if (msg.target !== undefined && (typeof msg.target !== 'string' || msg.target.length > 80 || CONTROL.test(msg.target))) return false;
        return this.run(p, msg.rid, msg.action, msg.src, msg.target, now);
      }
      default:
        return false;
    }
  }

  // ---------------------------------------------------------------- estado

  private bucket(accountId: string, kind: 'edit' | 'run', now: number): TokenBucket {
    const k = `${kind} ${accountId}`;
    let b = this.buckets.get(k);
    if (!b) {
      if (this.buckets.size > 2000) for (const [key, v] of this.buckets) if (v.isIdle(now)) this.buckets.delete(key);
      b = kind === 'edit' ? new TokenBucket(10, 3, now) : new TokenBucket(12, 3, now);
      this.buckets.set(k, b);
    }
    return b;
  }

  /** Topologia atual da org: a gravada ou, se nunca editada, o modelo padrao gerado do inventario (versao 0). */
  current(orgId: string): { row: NetsimRow | undefined; topology: Topology; version: number; omitted: number } {
    const row = this.host.store.netsim.get(orgId);
    if (row) return { row, topology: row.topology, version: row.version, omitted: 0 };
    const d = defaultTopology(this.host.stations(orgId));
    return { row: undefined, topology: d.topo, version: 0, omitted: d.omitted };
  }

  private nameOf(accountId: string): string {
    return this.host.store.getById(accountId)?.displayName ?? '';
  }

  /** Quem nao e da TI nao ve dispositivos ligados a estacoes de salas em que nao pode entrar (privadas). */
  private hiddenIds(p: Player, topo: Topology): Set<string> {
    const hidden = new Set<string>();
    if (this.host.isIT(p)) return hidden;
    const memo = new Map<string, boolean>();
    for (const d of topo.devices) {
      if (!d.inventoryId) continue;
      const room = d.inventoryId.split('/')[0]!;
      let ok = memo.get(room);
      if (ok === undefined) memo.set(room, (ok = this.host.canEnter(p, room)));
      if (!ok) hidden.add(d.id);
    }
    return hidden;
  }

  private payload(p: Player): NetsimStatePayload {
    const cur = this.current(p.orgId);
    const hidden = this.hiddenIds(p, cur.topology);
    const topology: Topology = hidden.size
      ? { ...cur.topology, devices: cur.topology.devices.filter((d) => !hidden.has(d.id)), cables: cur.topology.cables.filter((c) => !hidden.has(c.a.dev) && !hidden.has(c.b.dev)) }
      : cur.topology;
    return {
      version: cur.version,
      topology,
      canEdit: this.host.isIT(p),
      canUndo: (this.undo.get(p.orgId)?.length ?? 0) > 0,
      updatedAt: cur.row?.updatedAt ?? 0,
      updatedBy: cur.row ? this.nameOf(cur.row.updatedBy) : '',
      omitted: cur.omitted,
    };
  }

  private subscribe(p: Player) {
    let s = this.subs.get(p.orgId);
    if (!s) this.subs.set(p.orgId, (s = new Set()));
    s.add(p.accountId);
  }

  private sendState(p: Player, rid?: number) {
    p.send({ t: 'netsim_state', ...(rid !== undefined ? { rid } : {}), ...this.payload(p) });
  }

  private broadcast(orgId: string, except?: string, rid?: number) {
    const s = this.subs.get(orgId);
    if (!s) return;
    for (const id of [...s]) {
      const pl = this.host.playerOf(id);
      if (!pl || pl.orgId !== orgId || pl.role === 'guest') {
        s.delete(id);
        continue;
      }
      this.sendState(pl, id === except ? rid : undefined);
    }
  }

  private err(p: Player, rid: number | undefined, code: NetsimErrorCode, message: string) {
    p.send({ t: 'netsim_error', ...(rid !== undefined ? { rid } : {}), code, message });
  }

  private audit(p: Player, action: string, detail: string) {
    this.host.store.appendAudit({
      id: randomUUID(),
      at: this.host.clock(),
      actorId: p.accountId,
      actor: p.name,
      level: p.staff && p.onDuty ? p.staff : null,
      action,
      targetId: `${p.orgId}/netsim`,
      target: 'Simulador de rede',
      detail: detail.slice(0, 300),
    });
    this.host.log(action, { org: p.orgId, by: p.accountId, detail });
  }

  /** Confere permissao, taxa e versao. Devolve o estado atual quando pode seguir. */
  private gate(p: Player, rid: number, base: number, now: number): ReturnType<NetsimService['current']> | null {
    if (!this.host.isIT(p)) {
      this.err(p, rid, 'it_only', NETSIM_IT_ONLY_MESSAGE);
      return null;
    }
    if (!this.bucket(p.accountId, 'edit', now).take(now)) {
      this.err(p, rid, 'rate_limited', 'Calma! Muitas alterações seguidas na rede.');
      return null;
    }
    const cur = this.current(p.orgId);
    if (cur.version !== base) {
      this.err(p, rid, 'conflict', 'A rede foi alterada por outra pessoa. Atualizei com a versão mais recente; refaça a alteração.');
      this.sendState(p, rid);
      return null;
    }
    return cur;
  }

  private commit(p: Player, prev: Topology, next: Topology, version: number, rid: number, now: number) {
    const stack = this.undo.get(p.orgId) ?? [];
    stack.push(prev);
    if (stack.length > UNDO_DEPTH) stack.shift();
    this.undo.set(p.orgId, stack);
    this.host.store.netsim.put({ orgId: p.orgId, version, topology: next, updatedBy: p.accountId, updatedAt: now });
    this.broadcast(p.orgId, p.accountId, rid);
  }

  // ---------------------------------------------------------------- escrita (so TI)

  private edit(p: Player, rid: number, base: number, ops: NetOp[], now: number): boolean {
    const cur = this.gate(p, rid, base, now);
    if (!cur) return true;
    let topo = cur.topology;
    for (const op of ops) {
      const r = applyOp(topo, op);
      if (!r.ok) {
        this.err(p, rid, 'invalid', r.error);
        return true;
      }
      topo = r.topo;
    }
    this.commit(p, cur.topology, topo, cur.version + 1, rid, now);
    const kinds = ops.filter((o) => o.op !== 'moveDevice');
    if (kinds.length > 0) this.audit(p, 'netsim.edit', `v${cur.version + 1}; ${kinds.map(describeOp).join(', ')}`);
    return true;
  }

  private undoLast(p: Player, rid: number, base: number, now: number): boolean {
    const cur = this.gate(p, rid, base, now);
    if (!cur) return true;
    const stack = this.undo.get(p.orgId);
    const prev = stack?.pop();
    if (!prev) {
      this.err(p, rid, 'nothing_to_undo', 'Não há nada para desfazer.');
      return true;
    }
    const v = validateTopology(prev);
    if (!v.ok) {
      this.err(p, rid, 'invalid', v.error);
      return true;
    }
    this.host.store.netsim.put({ orgId: p.orgId, version: cur.version + 1, topology: v.value, updatedBy: p.accountId, updatedAt: now });
    this.audit(p, 'netsim.undo', `v${cur.version + 1}`);
    this.broadcast(p.orgId, p.accountId, rid);
    return true;
  }

  private reset(p: Player, rid: number, base: number, now: number): boolean {
    const cur = this.gate(p, rid, base, now);
    if (!cur) return true;
    const d = defaultTopology(this.host.stations(p.orgId));
    this.commit(p, cur.topology, d.topo, cur.version + 1, rid, now);
    this.audit(p, 'netsim.reset', `v${cur.version + 1}; modelo padrão do inventário (${d.topo.devices.length} dispositivos${d.omitted ? `, ${d.omitted} estações fora do limite` : ''})`);
    return true;
  }

  // ---------------------------------------------------------------- simulacao (leitura)

  private run(p: Player, rid: number, action: NetsimAction, src: string, target: string | undefined, now: number): boolean {
    if (!this.bucket(p.accountId, 'run', now).take(now)) {
      this.err(p, rid, 'rate_limited', 'Calma! Muitos testes seguidos.');
      return true;
    }
    const cur = this.current(p.orgId);
    const topo = cur.topology;
    const hidden = this.hiddenIds(p, topo);
    if (!topo.devices.some((d) => d.id === src) || hidden.has(src)) {
      this.err(p, rid, 'not_found', 'Dispositivo não encontrado.');
      return true;
    }
    const t = target?.trim();
    if (t && hidden.size > 0) {
      const key = t.toLocaleLowerCase('pt-BR');
      if (topo.devices.some((d) => hidden.has(d.id) && d.name.toLocaleLowerCase('pt-BR') === key)) {
        this.err(p, rid, 'not_found', 'Destino não encontrado.');
        return true;
      }
    }
    let result: SimResult;
    const ctx = buildContext(topo);
    if (action === 'internet') result = testInternet(topo, src, ctx);
    else if (!t) {
      result = { ok: false, summary: 'Informe o destino.', steps: [{ kind: 'fail', text: 'Informe o destino.' }], hops: [], failure: { code: 'bad-target', text: 'Informe o destino.' } };
    } else if (action === 'ping') result = ping(topo, src, t, ctx);
    else if (action === 'traceroute') result = traceroute(topo, src, t, ctx);
    else if (action === 'browse') result = browse(topo, src, t, ctx);
    else result = nslookup(topo, src, t, ctx);
    p.send({ t: 'netsim_result', rid, action, src, ...(t ? { target: t } : {}), result });
    return true;
  }

  // ---------------------------------------------------------------- inventario

  /** IP/estado de rede de cada estacao do inventario, vindo da topologia gravada (vazio enquanto a org nao editou nada). */
  hostNets(orgId: string): Map<string, HostNet> {
    const row = this.host.store.netsim.get(orgId);
    if (!row) return new Map();
    const cached = this.hostCache.get(orgId);
    if (cached && cached.version === row.version) return cached.hosts;
    const hosts = new Map<string, HostNet>();
    const topo = row.topology;
    const ctx = buildContext(topo);
    for (const d of topo.devices) {
      if (!d.inventoryId) continue;
      const v = ifaceViews(topo, d.id, ctx)[0];
      const internet = !d.off && testInternet(topo, d.id, ctx).ok;
      hosts.set(d.inventoryId, { ...(v?.ip ? { ip: v.ip } : {}), link: !!v?.up, internet, device: d.name });
    }
    this.hostCache.set(orgId, { version: row.version, hosts });
    return hosts;
  }

  forget(accountId: string) {
    for (const s of this.subs.values()) s.delete(accountId);
    this.challenges.forget(accountId);
  }
}

function describeOp(o: NetOp): string {
  const id = (o as { id?: string }).id;
  const bits: string[] = [o.op];
  if (id) bits.push(`(${id})`);
  if (o.op === 'addDevice') bits.push(`[${o.kind}${o.name ? ` ${String(o.name).slice(0, 20)}` : ''}]`);
  if (o.op === 'setIface') bits.push(`[${String(o.iface).slice(0, 12)}]`);
  return bits.join('');
}
