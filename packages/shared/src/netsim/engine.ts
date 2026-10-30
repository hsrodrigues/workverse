import { cidrHas, cidrStr, inNet, isIp, isNetworkOrBroadcast, isPrivateIp, maskBits, networkOf, parseCidr, parseIp, ipStr, sameSubnet, safeDomain } from './addr';
import { LIMITS, isHostKind, isL2Kind, isRouterKind, type AclRule, type Cable, type Device, type FailCode, type Failure, type Hop, type Iface, type SimResult, type Step, type Topology } from './types';

/**
 * Motor da simulacao. Puro e deterministico: nada de I/O, relogio ou aleatoriedade.
 * Camada 2: propagacao de quadros por switches/APs respeitando cabos, shutdown, VLAN access/trunk.
 * Camada 3: gateway do host, tabela de rotas do roteador (conectadas + estaticas, maior prefixo), NAT de sobrecarga, ACL ordenada, TTL.
 * Limites assumidos (simplificacoes): sem STP (lacos de camada 2 so sao cortados), sem protocolos dinamicos (RIP/OSPF/BGP),
 * sem IPv6, sem MTU/fragmentacao, sem estado de TCP; NAT so de origem (sobrecarga); ARP e implicito.
 */

export interface Lease {
  ip: string;
  mask: string;
  gateway?: string;
  dns?: string;
  server: string;
}

export interface Endpoint {
  dev: string;
  iface: string;
  ip: string;
  /** Switches/APs atravessados ate chegar aqui. */
  via: string[];
}
interface Peer {
  dev: string;
  iface: string;
  cable: Cable;
}

export interface Ctx {
  topo: Topology;
  dev: Map<string, Device>;
  peer: Map<string, Peer>;
  leases: Map<string, Lease>;
  /** Mensagens do DHCP por cliente (`dev|iface`) quando nao houve concessao. */
  dhcpNotes: Map<string, string>;
}

const key = (d: string, i: string) => `${d}|${i}`;

export function buildContext(topo: Topology): Ctx {
  const dev = new Map(topo.devices.map((d) => [d.id, d]));
  const peer = new Map<string, Peer>();
  for (const c of topo.cables) {
    peer.set(key(c.a.dev, c.a.iface), { dev: c.b.dev, iface: c.b.iface, cable: c });
    peer.set(key(c.b.dev, c.b.iface), { dev: c.a.dev, iface: c.a.iface, cable: c });
  }
  const ctx: Ctx = { topo, dev, peer, leases: new Map(), dhcpNotes: new Map() };
  computeLeases(ctx);
  return ctx;
}

const ifaceOf = (d: Device, name: string): Iface | undefined => d.ifaces.find((i) => i.name === name);
const physName = (i: Iface) => i.parent ?? i.name;

/** IP e mascara efetivos da interface (estatico ou concedido). */
export function effIp(ctx: Ctx, d: Device, i: Iface): { ip: string; mask: string } | undefined {
  if (i.dhcp) {
    const l = ctx.leases.get(key(d.id, i.name));
    return l ? { ip: l.ip, mask: l.mask } : undefined;
  }
  return i.ip && i.mask ? { ip: i.ip, mask: i.mask } : undefined;
}

export interface LinkState {
  up: boolean;
  code?: FailCode;
  reason?: string;
}
/** A interface esta "up"? (desligado, shutdown, cabo ausente/solto, outra ponta shutdown/desligada). */
export function linkState(ctx: Ctx, d: Device, i: Iface): LinkState {
  const down = (code: FailCode, reason: string): LinkState => ({ up: false, code, reason });
  if (d.off) return down('device-off', `${d.name} está desligado`);
  const phys = i.parent ? ifaceOf(d, i.parent) : i;
  if (!phys) return down('iface-down', `interface ${i.name} sem interface-mãe`);
  if (phys.shutdown) return down('iface-down', `${phys.name} de ${d.name} está desativada (shutdown)`);
  if (i.parent && i.shutdown) return down('iface-down', `${i.name} de ${d.name} está desativada (shutdown)`);
  const p = ctx.peer.get(key(d.id, phys.name));
  if (!p) return down('cable-down', `cabo desconectado em ${phys.name} de ${d.name}`);
  if (!p.cable.up) return down('cable-down', `cabo solto entre ${phys.name} de ${d.name} e ${ctx.dev.get(p.dev)?.name ?? '?'} ${p.iface}`);
  const pd = ctx.dev.get(p.dev);
  const pi = pd && ifaceOf(pd, p.iface);
  if (!pd || !pi) return down('cable-down', `cabo sem destino em ${phys.name} de ${d.name}`);
  if (pd.off) return down('device-off', `${pd.name}, do outro lado do cabo em ${phys.name}, está desligado`);
  if (pi.shutdown) return down('iface-down', `${p.iface} de ${pd.name} (outro lado do cabo) está desativada`);
  return { up: true };
}

// ---------------------------------------------------------------- camada 2

export interface Segment {
  eps: Endpoint[];
  notes: string[];
}

/** Todos os enderecos L3 no mesmo dominio de broadcast da interface `iface` de `d` (exceto ela mesma). */
export function l2Segment(ctx: Ctx, d: Device, iface: Iface): Segment {
  const eps: Endpoint[] = [];
  const notes: string[] = [];
  const note = (s: string) => {
    if (notes.length < 6 && !notes.includes(s)) notes.push(s);
  };
  const phys = iface.parent ?? iface.name;
  const start = ctx.peer.get(key(d.id, phys));
  if (!start) return { eps, notes };
  if (!start.cable.up || linkState(ctx, d, iface).up === false) {
    const ls = linkState(ctx, d, iface);
    if (ls.reason) note(ls.reason);
    return { eps, notes };
  }
  type Q = { dev: string; port: string; tag: number; via: string[] };
  const queue: Q[] = [{ dev: start.dev, port: start.iface, tag: iface.parent ? (iface.vlan ?? 0) : 0, via: [] }];
  const seen = new Set<string>();
  while (queue.length > 0 && seen.size < 4000) {
    const q = queue.shift()!;
    const nd = ctx.dev.get(q.dev);
    const pi = nd && ifaceOf(nd, q.port);
    if (!nd || !pi || nd.off || pi.shutdown) {
      if (nd?.off) note(`${nd.name} está desligado`);
      else if (nd && pi?.shutdown) note(`${q.port} de ${nd.name} está desativada (shutdown)`);
      continue;
    }
    if (isL2Kind(nd.kind)) {
      // ingresso
      let vlan: number;
      if (pi.mode === 'trunk') {
        vlan = q.tag || 1;
        if (pi.allowed?.length && !pi.allowed.includes(vlan)) {
          note(`VLAN ${vlan} não é permitida no trunk ${q.port} de ${nd.name}`);
          continue;
        }
      } else {
        if (q.tag) {
          note(`${q.port} de ${nd.name} é access (VLAN ${pi.vlan ?? 1}) e recebeu quadro marcado com VLAN ${q.tag}: descartado`);
          continue;
        }
        vlan = pi.vlan ?? 1;
      }
      const sk = `${nd.id}|${vlan}`;
      const sk2 = `${sk}|${q.port}`;
      if (seen.has(sk2)) continue;
      seen.add(sk2);
      let out = 0;
      for (const o of nd.ifaces) {
        if (o.name === q.port || o.shutdown) continue;
        const p = ctx.peer.get(key(nd.id, o.name));
        if (!p || !p.cable.up) continue;
        let tag: number;
        if (o.mode === 'trunk') {
          if (o.allowed?.length && !o.allowed.includes(vlan)) continue;
          tag = vlan === 1 ? 0 : vlan;
        } else {
          if ((o.vlan ?? 1) !== vlan) continue;
          tag = 0;
        }
        out++;
        queue.push({ dev: p.dev, port: p.iface, tag, via: q.via.includes(nd.name) ? q.via : [...q.via, nd.name] });
      }
      if (out === 0) note(`VLAN ${vlan} não tem outras portas em ${nd.name}`);
      continue;
    }
    // dispositivo L3: o quadro so e aceito pela interface certa
    const cands = nd.ifaces.filter((i) => (q.tag === 0 ? i.name === q.port : i.parent === q.port && i.vlan === q.tag));
    if (cands.length === 0) {
      note(q.tag ? `${nd.name} não tem subinterface para VLAN ${q.tag} em ${q.port}` : `${nd.name} ${q.port} espera quadros marcados (subinterfaces)`);
      continue;
    }
    for (const c of cands) {
      if (c.shutdown) continue;
      if (nd.id === d.id && c.name === iface.name) continue;
      const e = effIp(ctx, nd, c);
      eps.push({ dev: nd.id, iface: c.name, ip: e?.ip ?? '', via: q.via });
    }
  }
  return { eps: eps.filter((e) => e.ip !== ''), notes };
}

// ---------------------------------------------------------------- DHCP

function poolRange(ctx: Ctx, srv: Device, pi: number): { ok: true; start: number; end: number; mask: string; ifaceIp: string } | { ok: false; why: string } {
  const p = srv.dhcp![pi]!;
  const itf = ifaceOf(srv, p.iface);
  if (!itf) return { ok: false, why: `o pool usa a interface ${p.iface}, que não existe em ${srv.name}` };
  const e = effIp(ctx, srv, itf);
  if (!e) return { ok: false, why: `${srv.name} ${p.iface} não tem IP` };
  const s = parseIp(p.start);
  const en = parseIp(p.end);
  if (s === null || en === null || s > en) return { ok: false, why: `pool ${p.start}-${p.end} é inválido` };
  if (!inNet(p.start, e.ip, e.mask) || !inNet(p.end, e.ip, e.mask)) return { ok: false, why: `o pool ${p.start}-${p.end} está fora da rede de ${p.iface} (${e.ip}/${maskBits(e.mask)})` };
  return { ok: true, start: s, end: en, mask: e.mask, ifaceIp: e.ip };
}

function computeLeases(ctx: Ctx): void {
  const used = new Map<string, Set<number>>(); // por servidor|pool
  for (const d of ctx.topo.devices) {
    if (d.off || !isHostKind(d.kind)) continue;
    for (const i of d.ifaces) {
      if (!i.dhcp) continue;
      const k = key(d.id, i.name);
      const ls = linkState(ctx, d, i);
      if (!ls.up) {
        ctx.dhcpNotes.set(k, `DHCP: ${ls.reason}`);
        continue;
      }
      // servidores no segmento: descobre pelos enderecos estaticos dos vizinhos
      const seg = l2Segment(ctx, d, i);
      const servers = seg.eps.map((e) => ({ e, sd: ctx.dev.get(e.dev)! })).filter((x) => x.sd.dhcp?.some((p) => p.iface === x.e.iface));
      if (servers.length === 0) {
        ctx.dhcpNotes.set(k, `DHCP: nenhum servidor DHCP responde neste segmento${seg.notes.length ? ` (${seg.notes[0]})` : ''}`);
        continue;
      }
      let done = false;
      const why: string[] = [];
      for (const { e, sd } of servers) {
        sd.dhcp!.forEach((p, pi) => {
          if (done || p.iface !== e.iface) return;
          const r = poolRange(ctx, sd, pi);
          if (!r.ok) {
            why.push(`${sd.name}: ${r.why}`);
            return;
          }
          const uk = key(sd.id, String(pi));
          const taken = used.get(uk) ?? new Set<number>();
          // enderecos fixos no segmento tambem estao ocupados
          const fixed = new Set<number>();
          for (const x of seg.eps) {
            const n = parseIp(x.ip);
            if (n !== null) fixed.add(n);
          }
          const mine = parseIp(r.ifaceIp);
          if (mine !== null) fixed.add(mine);
          for (let n = r.start; n <= r.end; n++) {
            if (taken.has(n) || fixed.has(n) || isNetworkOrBroadcast(ipStr(n), r.mask)) continue;
            taken.add(n);
            used.set(uk, taken);
            ctx.leases.set(k, { ip: ipStr(n), mask: r.mask, ...(p.gateway ? { gateway: p.gateway } : {}), ...(p.dns ? { dns: p.dns } : {}), server: sd.name });
            done = true;
            return;
          }
          why.push(`${sd.name}: pool ${p.start}-${p.end} esgotado`);
        });
        if (done) break;
      }
      if (!done) ctx.dhcpNotes.set(k, `DHCP: sem concessão (${why.join('; ') || 'pool não corresponde a esta interface'})`);
    }
  }
}

export function leaseOf(ctx: Ctx, devId: string, ifaceName: string): Lease | undefined {
  return ctx.leases.get(key(devId, ifaceName));
}

// ---------------------------------------------------------------- roteamento

/** Interface principal de um host: a primeira com IP efetivo, senao a primeira. */
export function hostIface(ctx: Ctx, d: Device): Iface {
  return d.ifaces.find((i) => effIp(ctx, d, i)) ?? d.ifaces[0]!;
}
export function hostGateway(ctx: Ctx, d: Device, i: Iface): string | undefined {
  return (i.dhcp ? leaseOf(ctx, d.id, i.name)?.gateway : undefined) ?? d.gateway;
}
export function hostDns(ctx: Ctx, d: Device, i: Iface): string | undefined {
  return (i.dhcp ? leaseOf(ctx, d.id, i.name)?.dns : undefined) ?? d.dns;
}

interface Egress {
  iface: Iface;
  ip: string;
  nextHop: string;
  how: string;
}

const fail = (code: FailCode, text: string, device?: string): Failure => ({ code, text, ...(device ? { device } : {}) });
const bitsOf = (m: string) => maskBits(m) ?? 0;

export interface RouteEntry {
  net: string;
  mask: string;
  via?: string;
  iface?: string;
  kind: 'C' | 'S';
  active: boolean;
}
/** Tabela de rotas de um roteador/firewall (conectadas das interfaces up + estaticas com proximo salto alcancavel). */
export function routeTable(ctx: Ctx, d: Device): RouteEntry[] {
  const out: RouteEntry[] = [];
  const conn: Array<{ i: Iface; ip: string; mask: string }> = [];
  for (const i of d.ifaces) {
    const e = effIp(ctx, d, i);
    if (!e) continue;
    const up = linkState(ctx, d, i).up;
    const net = networkOf(e.ip, e.mask);
    if (net !== null) out.push({ net: ipStr(net), mask: e.mask, iface: i.name, kind: 'C', active: up });
    if (up) conn.push({ i, ...e });
  }
  for (const r of d.routes ?? []) {
    const c = conn.find((x) => sameSubnet(x.ip, r.via, x.mask));
    out.push({ net: r.net, mask: r.mask, via: r.via, ...(c ? { iface: c.i.name } : {}), kind: 'S', active: !!c });
  }
  return out;
}

function lookup(ctx: Ctx, d: Device, dst: string): { eg: Egress } | { err: Failure } {
  if (isHostKind(d.kind)) {
    const i = hostIface(ctx, d);
    const e = effIp(ctx, d, i);
    if (!e) {
      const n = ctx.dhcpNotes.get(key(d.id, i.name));
      return { err: fail(i.dhcp ? 'dhcp' : 'no-ip', i.dhcp ? `${d.name} não tem endereço IP: ${n ?? 'DHCP não concedeu'}.` : `${d.name} não tem endereço IP configurado em ${i.name}.`, d.name) };
    }
    const ls = linkState(ctx, d, i);
    if (!ls.up) return { err: fail(ls.code ?? 'iface-down', `Falhou em ${d.name}: ${ls.reason}.`, d.name) };
    if (sameSubnet(dst, e.ip, e.mask)) return { eg: { iface: i, ip: e.ip, nextHop: dst, how: `${dst} está na mesma sub-rede (${e.ip}/${bitsOf(e.mask)})` } };
    const gw = hostGateway(ctx, d, i);
    if (!gw) return { err: fail('no-gateway', `Falhou em ${d.name}: ${dst} está fora da sub-rede ${ipStr(networkOf(e.ip, e.mask)!)}/${bitsOf(e.mask)} e não há gateway configurado.`, d.name) };
    if (!sameSubnet(gw, e.ip, e.mask)) return { err: fail('gateway-off-subnet', `Falhou em ${d.name}: o gateway ${gw} está fora da sub-rede do host (${e.ip}/${bitsOf(e.mask)}).`, d.name) };
    return { eg: { iface: i, ip: e.ip, nextHop: gw, how: `${dst} está fora da sub-rede: usa o gateway ${gw}` } };
  }
  // roteador / firewall / nuvem
  let best: { len: number; kindRank: number; eg: Egress } | null = null;
  const table = routeTable(ctx, d);
  for (const r of table) {
    if (!r.active || !inNet(dst, r.net, r.mask)) continue;
    const len = bitsOf(r.mask);
    const i = ifaceOf(d, r.iface ?? '');
    if (!i) continue;
    const ip = effIp(ctx, d, i)!.ip;
    const eg: Egress = r.kind === 'C' ? { iface: i, ip, nextHop: dst, how: `rede conectada ${r.net}/${len} (${i.name})` } : { iface: i, ip, nextHop: r.via!, how: `rota estática ${r.net}/${len} via ${r.via} (${i.name})` };
    const rank = r.kind === 'C' ? 0 : 1;
    if (!best || len > best.len || (len === best.len && rank < best.kindRank)) best = { len, kindRank: rank, eg };
  }
  if (best) return { eg: best.eg };
  // dica: rota estatica inativa?
  const inactive = table.find((r) => !r.active && inNet(dst, r.net, r.mask));
  if (inactive?.kind === 'S' && inactive.via) {
    for (const i of d.ifaces) {
      const e = effIp(ctx, d, i);
      if (!e || !sameSubnet(e.ip, inactive.via, e.mask)) continue;
      const ls = linkState(ctx, d, i);
      if (!ls.up) return { err: fail(ls.code ?? 'iface-down', `Falhou no ${d.name}: sem rota para ${dst}: a rota via ${inactive.via} está inativa porque ${ls.reason}.`, d.name) };
    }
  }
  const hint = inactive ? (inactive.kind === 'S' ? ` (a rota ${inactive.net}/${bitsOf(inactive.mask)} via ${inactive.via} está inativa: o próximo salto não está em uma rede conectada ativa)` : ` (a interface ${inactive.iface} da rede ${inactive.net}/${bitsOf(inactive.mask)} está down)`) : '';
  return { err: fail('no-route', `Falhou no ${d.name}: sem rota para ${dst}${hint}.`, d.name) };
}

// ---------------------------------------------------------------- ACL / NAT

function aclEval(d: Device, p: Pkt): { allow: boolean; text?: string } {
  const rules: AclRule[] = d.acl ?? [];
  for (let n = 0; n < rules.length; n++) {
    const r = rules[n]!;
    if (r.proto !== 'ip' && r.proto !== p.proto) continue;
    const s = parseCidr(r.src);
    const t = parseCidr(r.dst);
    if (!s || !t || !cidrHas(s, p.src) || !cidrHas(t, p.dst)) continue;
    if (r.port !== undefined && r.port !== p.port) continue;
    const desc = `${r.action} ${r.proto} ${cidrStr(s)} ${cidrStr(t)}${r.port !== undefined ? ` porta ${r.port}` : ''}`;
    return r.action === 'permit' ? { allow: true, text: `regra ${n + 1} (${desc})` } : { allow: false, text: `regra ${n + 1} (${desc})` };
  }
  if (d.aclDefault === 'deny' && (d.kind === 'firewall' || d.kind === 'router')) return { allow: false, text: 'política padrão (deny)' };
  return { allow: true };
}

// ---------------------------------------------------------------- caminhada de pacotes

interface Pkt {
  src: string;
  dst: string;
  proto: 'icmp' | 'tcp' | 'udp';
  port?: number;
  ttl: number;
}
interface NatEntry {
  orig: string;
  xlat: string;
}
interface State {
  steps: Step[];
  hops: Hop[];
  nat: Map<string, NatEntry[]>;
  budget: number;
}
const newState = (): State => ({ steps: [], hops: [], nat: new Map(), budget: 400 });
const push = (st: State, kind: Step['kind'], text: string, device?: string) => st.steps.push({ kind, text, ...(device ? { device } : {}) });

interface Delivered {
  dev: Device;
  /** Host da nuvem que respondeu, quando o destino era um IP publico simulado. */
  pub?: NonNullable<Device['publicHosts']>[number];
  ingress?: Iface;
  /** Endereco de origem do pacote como chegou (apos NAT). */
  srcSeen: string;
  dstAddr: string;
  hopCount: number;
}

function owns(ctx: Ctx, d: Device, ip: string): { own: boolean; pub?: Delivered['pub'] } {
  for (const i of d.ifaces) if (effIp(ctx, d, i)?.ip === ip) return { own: true };
  const pub = d.publicHosts?.find((h) => h.ip === ip);
  if (pub) return { own: true, pub };
  return { own: false };
}

function whyNotFound(ctx: Ctx, cur: Device, eg: Egress, seg: Segment): Failure {
  const ls = linkState(ctx, cur, eg.iface);
  if (!ls.up) return fail(ls.code ?? 'cable-down', `Falhou em ${cur.name}: ${ls.reason}.`, cur.name);
  const label = cur.kind === 'router' || cur.kind === 'firewall' ? 'o próximo salto' : isHostKind(cur.kind) && eg.how.includes('gateway') ? 'o gateway' : 'o destino';
  // o IP existe em algum lugar?
  for (const d of ctx.topo.devices) {
    if (d.id === cur.id) continue;
    for (const i of d.ifaces) {
      if (effIp(ctx, d, i)?.ip !== eg.nextHop) continue;
      const l2 = linkState(ctx, d, i);
      if (!l2.up) return fail(l2.code ?? 'cable-down', `Falhou em ${cur.name}: ${label} ${eg.nextHop} (${d.name}) está inacessível: ${l2.reason}.`, d.name);
      const extra = seg.notes.length ? ` Detalhes: ${seg.notes.slice(0, 3).join('; ')}.` : '';
      return fail('no-arp', `Falhou em ${cur.name}: ${label} ${eg.nextHop} (${d.name}) existe, mas não está no mesmo segmento de camada 2 de ${eg.iface.name} (confira VLANs, trunks e cabos).${extra}`, cur.name);
    }
  }
  const extra = seg.notes.length ? ` Detalhes: ${seg.notes.slice(0, 3).join('; ')}.` : '';
  return fail('no-arp', `Falhou em ${cur.name}: ${label} ${eg.nextHop} não responde ao ARP em ${eg.iface.name} (nenhum dispositivo com esse IP neste segmento; IP errado?).${extra}`, cur.name);
}

/** Leva um pacote de `start` ate o dono do IP de destino. */
function walk(ctx: Ctx, start: Device, pkt0: Pkt, st: State, record: boolean, tag: string): { ok: true; del: Delivered } | { ok: false; err: Failure } {
  const pkt: Pkt = { ...pkt0 };
  let cur = start;
  let ingress: Iface | null = null;
  let hopN = 0;
  const visitedStates = new Set<string>();
  for (let guard = 0; guard < 64; guard++) {
    if (--st.budget < 0) return { ok: false, err: fail('ttl', 'Simulação interrompida: caminho longo demais (possível laço).', cur.name) };
    if (ingress) {
      // NAT reverso na chegada
      if (cur.natEnabled) {
        const t = st.nat.get(cur.id)?.find((n) => n.xlat === pkt.dst);
        if (t) {
          push(st, 'info', `${tag}${cur.name}: NAT traduz o destino ${pkt.dst} de volta para ${t.orig}.`, cur.name);
          pkt.dst = t.orig;
        }
      }
      const o = owns(ctx, cur, pkt.dst);
      if (o.own) {
        return { ok: true, del: { dev: cur, ...(o.pub ? { pub: o.pub } : {}), ingress, srcSeen: pkt.src, dstAddr: pkt.dst, hopCount: hopN } };
      }
      if (!isRouterKind(cur.kind)) {
        return { ok: false, err: fail('no-reply', `${cur.name} recebeu um pacote para ${pkt.dst}, mas hosts não encaminham pacotes (o IP de destino não é o dele).`, cur.name) };
      }
      pkt.ttl--;
      if (pkt.ttl <= 0) return { ok: false, err: fail('ttl', `TTL expirou em ${cur.name} (possível laço de roteamento).`, cur.name) };
    } else {
      const o = owns(ctx, cur, pkt.dst);
      if (o.own) return { ok: true, del: { dev: cur, ...(o.pub ? { pub: o.pub } : {}), srcSeen: pkt.src || pkt.dst, dstAddr: pkt.dst, hopCount: 0 } };
    }
    // Internet: so entrega a hosts publicos; enderecos privados nunca sao roteados
    if (cur.kind === 'internet' && ingress) {
      if (isPrivateIp(pkt.dst)) return { ok: false, err: fail('private-dropped', `Internet descartou o pacote para ${pkt.dst}: endereço privado não é roteável na Internet (falta NAT no roteador de borda?).`, cur.name) };
    }
    const lk = lookup(ctx, cur, pkt.dst);
    if ('err' in lk) {
      if (cur.kind === 'internet') return { ok: false, err: fail(isPrivateIp(pkt.dst) ? 'private-dropped' : 'no-route', isPrivateIp(pkt.dst) ? `Internet descartou o pacote para ${pkt.dst}: endereço privado não é roteável (falta NAT no roteador de borda?).` : `Internet: não há host ${pkt.dst} na Internet simulada (sem resposta).`, cur.name) };
      return { ok: false, err: lk.err };
    }
    const eg = lk.eg;
    if (ingress) {
      push(st, 'info', `${tag}${cur.name}: ${eg.how} → sai por ${eg.iface.name}${eg.nextHop !== pkt.dst ? ` (próximo salto ${eg.nextHop})` : ''}.`, cur.name);
      if (cur.kind === 'router' || cur.kind === 'firewall') {
        const ev = aclEval(cur, pkt);
        if (!ev.allow) return { ok: false, err: fail('acl-deny', `Bloqueado pela ACL em ${cur.name}, ${ev.text} (${pkt.proto}${pkt.port !== undefined ? `/${pkt.port}` : ''} ${pkt.src} → ${pkt.dst}).`, cur.name) };
        if (ev.text) push(st, 'info', `${tag}${cur.name}: ACL permitiu pela ${ev.text}.`, cur.name);
      }
      if (cur.natEnabled && ingress.nat === 'inside' && eg.iface.nat === 'outside') {
        const list = st.nat.get(cur.id) ?? [];
        if (!list.some((n) => n.orig === pkt.src && n.xlat === eg.ip)) list.push({ orig: pkt.src, xlat: eg.ip });
        st.nat.set(cur.id, list);
        push(st, 'info', `${tag}${cur.name}: NAT traduz a origem ${pkt.src} → ${eg.ip}.`, cur.name);
        pkt.src = eg.ip;
      }
    } else {
      push(st, 'info', `${tag}${cur.name}: ${eg.how}.`, cur.name);
    }
    if (pkt.src === '') pkt.src = eg.ip;
    const seg = l2Segment(ctx, cur, eg.iface);
    const matches = seg.eps.filter((e) => e.ip === eg.nextHop && !ctx.dev.get(e.dev)!.off);
    const target = matches[0];
    if (!target) return { ok: false, err: whyNotFound(ctx, cur, eg, seg) };
    if (seg.eps.some((e) => e.ip === eg.ip)) push(st, 'warn', `${tag}IP duplicado: ${eg.ip} também está em outro dispositivo do mesmo segmento.`, cur.name);
    if (matches.length > 1) push(st, 'warn', `${tag}IP duplicado: ${eg.nextHop} responde em mais de um dispositivo; usando ${ctx.dev.get(target.dev)!.name}.`, cur.name);
    const nd = ctx.dev.get(target.dev)!;
    const ni = ifaceOf(nd, target.iface)!;
    push(st, 'info', `${tag}ARP: ${eg.nextHop} respondeu em ${nd.name} (${target.iface})${target.via.length ? ` passando por ${target.via.join(' → ')}` : ''}.`, nd.name);
    hopN++;
    if (record) st.hops.push({ n: st.hops.length + 1, device: nd.name, ip: target.ip, iface: target.iface });
    const sk = `${nd.id}|${ni.name}|${pkt.dst}|${pkt.src}`;
    if (visitedStates.has(sk) && isRouterKind(nd.kind)) return { ok: false, err: fail('ttl', `Laço de roteamento detectado em ${nd.name}.`, nd.name) };
    visitedStates.add(sk);
    cur = nd;
    ingress = ni;
  }
  return { ok: false, err: fail('ttl', 'Caminho longo demais.', cur.name) };
}

// ---------------------------------------------------------------- servicos / resposta

const jitter = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) % 3;
};
const msFor = (hops: number, seed: string) => 1 + hops * 2 + jitter(seed);

function serviceOpen(del: Delivered, proto: 'tcp' | 'udp', port: number): boolean {
  if (del.pub) return proto === 'tcp' ? (del.pub.ports ?? [80, 443]).includes(port) : port === 53 && !!del.pub.dns;
  if (proto === 'udp' && port === 53) return !!del.dev.dnsRecords;
  return !!del.dev.services?.some((s) => s.proto === proto && s.port === port);
}

interface Exchange {
  ok: boolean;
  err?: Failure;
  del?: Delivered;
  ms?: number;
  hops: number;
}

/** Pedido + resposta (ICMP echo, ou TCP/UDP: so entrega e portas abertas; resposta volta pelo caminho de roteamento do destino). */
function exchange(ctx: Ctx, src: Device, dstIp: string, proto: 'icmp' | 'tcp' | 'udp', port: number | undefined, st: State, record: boolean): Exchange {
  const fwd = walk(ctx, src, { src: '', dst: dstIp, proto, ...(port !== undefined ? { port } : {}), ttl: LIMITS.ttl }, st, record, '');
  if (!fwd.ok) return { ok: false, err: fwd.err, hops: st.hops.length };
  const del = fwd.del;
  push(st, 'ok', `${del.pub ? `${del.pub.name} (${del.pub.ip}) na Internet` : del.dev.name} recebeu o pedido${del.srcSeen ? ` de ${del.srcSeen}` : ''}.`, del.dev.name);
  if (port !== undefined && proto !== 'icmp' && !serviceOpen(del, proto, port)) {
    return { ok: false, err: fail('refused', `Conexão recusada por ${del.pub ? del.pub.name : del.dev.name}: nenhum serviço ${proto.toUpperCase()} escutando na porta ${port}.`, del.dev.name), del, hops: del.hopCount };
  }
  // resposta
  const replyFrom = del.pub ? del.pub.ip : del.dstAddr;
  const back = walk(ctx, del.dev, { src: replyFrom, dst: del.srcSeen, proto, ...(port !== undefined ? { port } : {}), ttl: LIMITS.ttl }, st, false, 'Resposta: ');
  if (!back.ok) {
    return { ok: false, err: { ...back.err, text: `O pedido chegou, mas a resposta não voltou. ${back.err.text}` }, del, hops: del.hopCount };
  }
  const ms = msFor(del.hopCount, `${src.id}>${dstIp}`);
  return { ok: true, del, ms, hops: del.hopCount };
}

// ---------------------------------------------------------------- API publica

function srcCheck(ctx: Ctx, srcId: string): { src: Device } | { err: SimResult } {
  const src = ctx.dev.get(srcId);
  const mk = (f: Failure, steps: Step[] = []): SimResult => ({ ok: false, summary: f.text, steps: [...steps, { kind: 'fail', text: f.text }], hops: [], failure: f });
  if (!src) return { err: mk(fail('no-device', 'Dispositivo de origem não encontrado.')) };
  if (src.off) return { err: mk(fail('device-off', `${src.name} está desligado.`, src.name)) };
  if (isL2Kind(src.kind) || src.kind === 'internet') return { err: mk(fail('unsupported', `${src.name} (${src.kind === 'internet' ? 'nuvem' : 'camada 2'}) não gera pacotes IP nesta simulação. Use um PC, servidor ou roteador como origem.`, src.name)) };
  return { src };
}

function finish(st: State, ok: boolean, okText: string, err?: Failure, extra: Partial<SimResult> = {}): SimResult {
  if (ok) push(st, 'ok', okText);
  else if (err) push(st, 'fail', err.text, err.device);
  return { ok, summary: ok ? okText : err!.text, steps: st.steps, hops: st.hops, ...(err ? { failure: err } : {}), ...extra };
}

function describeSource(ctx: Ctx, src: Device, st: State): void {
  if (isHostKind(src.kind)) {
    const i = hostIface(ctx, src);
    const e = effIp(ctx, src, i);
    if (e) {
      const gw = hostGateway(ctx, src, i);
      push(st, 'info', `Origem ${src.name}: ${i.name} ${e.ip}/${bitsOf(e.mask)}${i.dhcp ? ' (DHCP)' : ''}, gateway ${gw ?? 'nenhum'}.`, src.name);
    }
  } else {
    push(st, 'info', `Origem ${src.name} (${src.kind === 'firewall' ? 'firewall' : 'roteador'}).`, src.name);
  }
}

/** Resolve nome -> IP pelo DNS do host. Acrescenta passos em `st`. */
function resolveName(ctx: Ctx, src: Device, name: string, st: State): { ok: true; ip: string } | { ok: false; err: Failure } {
  if (isIp(name)) return { ok: true, ip: name };
  const dom = safeDomain(name);
  if (!dom) return { ok: false, err: fail('bad-target', `Destino inválido: "${name.slice(0, 40)}". Use um IP ou um domínio como exemplo.sim.`) };
  if (!isHostKind(src.kind)) return { ok: false, err: fail('dns', `${src.name} não tem cliente DNS nesta simulação; use o IP.`, src.name) };
  const i = hostIface(ctx, src);
  const dnsIp = hostDns(ctx, src, i);
  if (!dnsIp) return { ok: false, err: fail('dns', `Falhou a resolução de ${dom}: ${src.name} não tem servidor DNS configurado.`, src.name) };
  push(st, 'info', `DNS: ${src.name} pergunta ao servidor ${dnsIp} o endereço de ${dom}.`, src.name);
  const savedHops = st.hops;
  st.hops = [];
  const ex = exchange(ctx, src, dnsIp, 'udp', 53, st, false);
  st.hops = savedHops;
  if (!ex.ok) {
    const e = ex.err!;
    return { ok: false, err: fail(e.code === 'refused' ? 'dns' : e.code, `Falhou a resolução de ${dom}: servidor DNS ${dnsIp} inacessível. ${e.text}`, e.device) };
  }
  const del = ex.del!;
  let ans: string | undefined;
  if (del.pub) {
    // a nuvem responde por todos os dominios que conhece
    for (const h of del.dev.publicHosts ?? []) if (h.domains?.includes(dom)) ans = h.ip;
  } else ans = del.dev.dnsRecords?.[dom];
  if (!ans) return { ok: false, err: fail('dns', `Falhou a resolução de ${dom}: o servidor DNS ${dnsIp} respondeu NXDOMAIN (domínio não existe).`, del.dev.name) };
  push(st, 'ok', `DNS: ${dom} → ${ans}.`, del.dev.name);
  return { ok: true, ip: ans };
}

function targetIp(ctx: Ctx, src: Device, target: string, st: State): { ok: true; ip: string; name?: string } | { ok: false; err: Failure } {
  const t = target.trim();
  if (t.length === 0 || t.length > 80) return { ok: false, err: fail('bad-target', 'Informe o destino (IP ou nome).') };
  if (isIp(t)) return { ok: true, ip: t };
  // nome de dispositivo da topologia (apelido pratico no terminal)
  const byName = ctx.topo.devices.find((d) => d.name.toLocaleLowerCase('pt-BR') === t.toLocaleLowerCase('pt-BR'));
  if (byName && byName.id !== src.id) {
    const ip = byName.ifaces.map((i) => effIp(ctx, byName, i)?.ip).find(Boolean);
    if (!ip) return { ok: false, err: fail('no-ip', `${byName.name} não tem endereço IP.`, byName.name) };
    push(st, 'info', `Destino ${byName.name} → ${ip}.`);
    return { ok: true, ip, name: byName.name };
  }
  const r = resolveName(ctx, src, t, st);
  return r.ok ? { ok: true, ip: r.ip, name: t } : r;
}

export function ping(topo: Topology, srcId: string, target: string, ctx: Ctx = buildContext(topo)): SimResult {
  const c = srcCheck(ctx, srcId);
  if ('err' in c) return c.err;
  const st = newState();
  describeSource(ctx, c.src, st);
  const t = targetIp(ctx, c.src, target, st);
  if (!t.ok) return finish(st, false, '', t.err);
  const ex = exchange(ctx, c.src, t.ip, 'icmp', undefined, st, true);
  if (!ex.ok) return finish(st, false, '', ex.err, t.name ? { resolved: t.ip } : {});
  const ms = ex.ms!;
  return finish(st, true, `Resposta de ${t.ip}: tempo=${ms}ms TTL=${LIMITS.ttl - ex.hops}.`, undefined, { ms, ...(t.name ? { resolved: t.ip } : {}) });
}

export function traceroute(topo: Topology, srcId: string, target: string, ctx: Ctx = buildContext(topo)): SimResult {
  const c = srcCheck(ctx, srcId);
  if ('err' in c) return c.err;
  const st = newState();
  describeSource(ctx, c.src, st);
  const t = targetIp(ctx, c.src, target, st);
  if (!t.ok) return finish(st, false, '', t.err);
  const ex = exchange(ctx, c.src, t.ip, 'icmp', undefined, st, true);
  if (!ex.ok) return finish(st, false, '', ex.err);
  return finish(st, true, `Traceroute concluído: ${t.ip} alcançado em ${st.hops.length} salto(s).`, undefined, { ms: ex.ms! });
}

export function nslookup(topo: Topology, srcId: string, name: string, ctx: Ctx = buildContext(topo)): SimResult {
  const c = srcCheck(ctx, srcId);
  if ('err' in c) return c.err;
  const st = newState();
  describeSource(ctx, c.src, st);
  if (isIp(name)) return finish(st, false, '', fail('bad-target', 'nslookup espera um nome (ex.: exemplo.sim), não um IP.'));
  const r = resolveName(ctx, c.src, name, st);
  if (!r.ok) return finish(st, false, '', r.err);
  return finish(st, true, `${name.trim().toLowerCase()} → ${r.ip}`, undefined, { resolved: r.ip });
}

const URL_RE = /^(?:(https?):\/\/)?([^\/:?#\s]{1,80})(?::(\d{1,5}))?(\/[^\s]{0,100})?$/i;
/** Navega ate um "site": DNS + TCP 80/443. Tudo simulado. */
export function browse(topo: Topology, srcId: string, url: string, ctx: Ctx = buildContext(topo)): SimResult {
  const c = srcCheck(ctx, srcId);
  if ('err' in c) return c.err;
  const st = newState();
  describeSource(ctx, c.src, st);
  const m = URL_RE.exec(url.trim());
  if (!m) return finish(st, false, '', fail('bad-target', 'Endereço inválido. Exemplo: http://exemplo.sim'));
  const scheme = (m[1] ?? 'http').toLowerCase();
  const port = m[3] ? Number(m[3]) : scheme === 'https' ? 443 : 80;
  if (port < 1 || port > 65535) return finish(st, false, '', fail('bad-target', 'Porta inválida.'));
  const host = m[2]!.toLowerCase();
  const t = targetIp(ctx, c.src, host, st);
  if (!t.ok) return finish(st, false, '', t.err);
  push(st, 'info', `HTTP: abrindo conexão TCP com ${t.ip}:${port}.`, c.src.name);
  const ex = exchange(ctx, c.src, t.ip, 'tcp', port, st, true);
  if (!ex.ok) return finish(st, false, '', ex.err);
  const site = ex.del!.pub?.name ?? ex.del!.dev.name;
  return finish(st, true, `${scheme.toUpperCase()} 200 OK — página de "${site}" (${t.ip}:${port}) carregada.`, undefined, { ms: ex.ms!, resolved: t.ip });
}

/** Diagnostico completo para o botao "Testar internet": config, gateway, IP publico, DNS e site. */
export function testInternet(topo: Topology, srcId: string, ctx: Ctx = buildContext(topo)): SimResult {
  const c = srcCheck(ctx, srcId);
  if ('err' in c) return c.err;
  const src = c.src;
  const steps: Step[] = [];
  const head = (n: number, s: string) => steps.push({ kind: 'info', text: `Etapa ${n}/4 — ${s}` });
  const stop = (r: SimResult, why: string): SimResult => {
    const failure = r.failure ?? fail('no-reply', r.summary);
    return { ok: false, summary: `${why} ${failure.text}`, steps: [...steps, { kind: 'fail', text: `Diagnóstico: ${why}` }], hops: r.hops, failure };
  };
  let hops: Hop[] = [];
  // 1 gateway
  head(1, 'Configuração e gateway');
  let gw: string | undefined;
  if (isHostKind(src.kind)) {
    const i = hostIface(ctx, src);
    gw = hostGateway(ctx, src, i);
    if (!effIp(ctx, src, i)) {
      const r = ping(topo, srcId, '127.0.0.1', ctx);
      steps.push(...r.steps);
      return stop(r, 'Sem endereço IP.');
    }
    if (!gw) {
      const r = ping(topo, srcId, '8.8.8.8', ctx);
      steps.push(...r.steps.filter((s) => s.kind !== 'ok'));
      return stop(r, 'Sem gateway.');
    }
    const r = ping(topo, srcId, gw, ctx);
    steps.push(...r.steps);
    if (!r.ok) return stop(r, 'Não alcança o gateway.');
  }
  head(2, 'Ping em 8.8.8.8 (IP na Internet simulada)');
  const p2 = ping(topo, srcId, '8.8.8.8', ctx);
  steps.push(...p2.steps);
  hops = p2.hops;
  if (!p2.ok) return stop(p2, 'Não alcança a Internet.');
  head(3, 'DNS: resolver exemplo.sim');
  const p3 = nslookup(topo, srcId, 'exemplo.sim', ctx);
  steps.push(...p3.steps);
  if (!p3.ok) return stop(p3, 'IP funciona, mas o DNS falha.');
  head(4, 'Navegar até http://exemplo.sim');
  const p4 = browse(topo, srcId, 'http://exemplo.sim', ctx);
  steps.push(...p4.steps);
  if (!p4.ok) return stop(p4, 'DNS funciona, mas o site não abre.');
  steps.push({ kind: 'ok', text: 'Tudo certo: gateway, Internet, DNS e navegação funcionam.' });
  return { ok: true, summary: 'Tudo certo: a Internet funciona neste dispositivo.', steps, hops, ms: p4.ms ?? p2.ms ?? 0 };
}

// ---------------------------------------------------------------- consultas para o terminal / UI

export interface IfaceView {
  name: string;
  ip?: string;
  mask?: string;
  bits?: number;
  up: boolean;
  reason?: string;
  dhcp?: boolean;
  lease?: boolean;
  note?: string;
}
export function ifaceViews(topo: Topology, devId: string, ctx: Ctx = buildContext(topo)): IfaceView[] {
  const d = ctx.dev.get(devId);
  if (!d) return [];
  return d.ifaces.map((i) => {
    const e = effIp(ctx, d, i);
    const ls = linkState(ctx, d, i);
    const note = i.dhcp ? ctx.dhcpNotes.get(key(d.id, i.name)) : undefined;
    return { name: i.name, ...(e ? { ip: e.ip, mask: e.mask, bits: bitsOf(e.mask) } : {}), up: ls.up, ...(ls.reason ? { reason: ls.reason } : {}), ...(i.dhcp ? { dhcp: true, lease: !!e } : {}), ...(note ? { note } : {}) };
  });
}

/** Portas por VLAN de um switch/AP. */
export function vlanTable(topo: Topology, devId: string): Array<{ vlan: number; ports: string[] }> {
  const d = topo.devices.find((x) => x.id === devId);
  if (!d || !isL2Kind(d.kind)) return [];
  const m = new Map<number, string[]>();
  for (const i of d.ifaces) {
    if (i.mode === 'trunk') continue;
    const v = i.vlan ?? 1;
    m.set(v, [...(m.get(v) ?? []), i.name]);
  }
  return [...m.entries()].sort((a, b) => a[0] - b[0]).map(([vlan, ports]) => ({ vlan, ports }));
}

/** IP principal de cada dispositivo (para o inventario). */
export function primaryIp(topo: Topology, devId: string, ctx: Ctx = buildContext(topo)): string | undefined {
  const d = ctx.dev.get(devId);
  if (!d) return undefined;
  for (const i of d.ifaces) {
    const e = effIp(ctx, d, i);
    if (e) return e.ip;
  }
  return undefined;
}
