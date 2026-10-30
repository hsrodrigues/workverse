import { isIp, normMask, parseCidr, safeDomain, safeName } from './addr';
import {
  ACL_PROTOS,
  LIMITS,
  isDeviceKind,
  isL2Kind,
  isRouterKind,
  type AclRule,
  type Cable,
  type Device,
  type DhcpPool,
  type Iface,
  type PublicHost,
  type Route,
  type Service,
  type Topology,
} from './types';

export type Validated<T> = { ok: true; value: T } | { ok: false; error: string };
const bad = (error: string): { ok: false; error: string } => ({ ok: false, error });
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const ID = /^[a-z][a-z0-9]{0,11}$/;
const IFACE = /^[A-Za-z][A-Za-z0-9]{0,11}(\/\d{1,3}){1,2}(\.\d{1,4})?$/;
export const isVlan = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 4094;
const isPort = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 65535;
const INV_ID = /^[A-Za-z0-9_-]{1,32}\/[A-Za-z0-9_-]{1,32}$/;

function ipField(v: unknown, label: string): Validated<string | undefined> {
  if (v === undefined || v === null || v === '') return { ok: true, value: undefined };
  if (!isIp(v)) return bad(`${label}: endereço IPv4 inválido.`);
  return { ok: true, value: v as string };
}

export function validateIface(raw: unknown, kind: Device['kind']): Validated<Iface> {
  if (!isObj(raw)) return bad('Interface inválida.');
  const name = raw.name;
  if (typeof name !== 'string' || !IFACE.test(name)) return bad('Nome de interface inválido.');
  const out: Iface = { name };
  const ip = ipField(raw.ip, `${name}: IP`);
  if (!ip.ok) return ip;
  if (ip.value !== undefined) {
    const mask = normMask(raw.mask);
    if (!mask) return bad(`${name}: máscara inválida.`);
    out.ip = ip.value;
    out.mask = mask;
  } else if (raw.mask !== undefined && raw.mask !== null && raw.mask !== '') {
    const mask = normMask(raw.mask);
    if (!mask) return bad(`${name}: máscara inválida.`);
    out.mask = mask;
  }
  if (raw.dhcp === true) out.dhcp = true;
  if (raw.shutdown === true) out.shutdown = true;
  if (raw.mode !== undefined) {
    if (raw.mode !== 'access' && raw.mode !== 'trunk') return bad(`${name}: modo deve ser access ou trunk.`);
    if (!isL2Kind(kind) && !(raw.mode === 'access')) return bad(`${name}: trunk só existe em switch e access point.`);
    out.mode = raw.mode;
  }
  if (raw.vlan !== undefined && raw.vlan !== null) {
    if (!isVlan(raw.vlan)) return bad(`${name}: VLAN deve estar entre 1 e 4094.`);
    out.vlan = raw.vlan;
  }
  if (raw.allowed !== undefined && raw.allowed !== null) {
    if (!Array.isArray(raw.allowed) || raw.allowed.length > 64 || !raw.allowed.every(isVlan)) return bad(`${name}: lista de VLANs permitidas inválida.`);
    const set = [...new Set(raw.allowed as number[])].sort((a, b) => a - b);
    if (set.length > 0) out.allowed = set;
  }
  if (raw.nat !== undefined && raw.nat !== null) {
    if (raw.nat !== 'inside' && raw.nat !== 'outside') return bad(`${name}: NAT deve ser inside ou outside.`);
    if (!isRouterKind(kind)) return bad(`${name}: NAT só em roteador ou firewall.`);
    out.nat = raw.nat;
  }
  if (raw.parent !== undefined && raw.parent !== null) {
    if (typeof raw.parent !== 'string' || !IFACE.test(raw.parent) || raw.parent.includes('.')) return bad(`${name}: interface-mãe inválida.`);
    if (!isVlan(raw.vlan)) return bad(`${name}: subinterface precisa de uma VLAN.`);
    if (name !== `${raw.parent}.${raw.vlan}`) return bad(`${name}: nome da subinterface deve ser ${raw.parent}.${raw.vlan}.`);
    out.parent = raw.parent;
  }
  return { ok: true, value: out };
}

function validateRoute(raw: unknown): Validated<Route> {
  if (!isObj(raw)) return bad('Rota inválida.');
  const mask = normMask(raw.mask);
  if (!isIp(raw.net) || !mask || !isIp(raw.via)) return bad('Rota estática: rede, máscara e próximo salto precisam ser IPv4 válidos.');
  return { ok: true, value: { net: raw.net as string, mask, via: raw.via as string } };
}

function validateAcl(raw: unknown): Validated<AclRule> {
  if (!isObj(raw)) return bad('Regra de ACL inválida.');
  if (raw.action !== 'permit' && raw.action !== 'deny') return bad('ACL: ação deve ser permit ou deny.');
  if (typeof raw.proto !== 'string' || !(ACL_PROTOS as readonly string[]).includes(raw.proto)) return bad('ACL: protocolo deve ser ip, icmp, tcp ou udp.');
  if (!parseCidr(raw.src) || !parseCidr(raw.dst)) return bad('ACL: origem e destino devem ser "any", um IP ou CIDR.');
  const rule: AclRule = { action: raw.action, proto: raw.proto as AclRule['proto'], src: raw.src as string, dst: raw.dst as string };
  if (raw.port !== undefined && raw.port !== null) {
    if (!isPort(raw.port)) return bad('ACL: porta inválida.');
    if (rule.proto !== 'tcp' && rule.proto !== 'udp') return bad('ACL: porta só vale para tcp/udp.');
    rule.port = raw.port;
  }
  return { ok: true, value: rule };
}

function validatePool(raw: unknown): Validated<DhcpPool> {
  if (!isObj(raw)) return bad('Pool DHCP inválido.');
  if (typeof raw.iface !== 'string' || !IFACE.test(raw.iface)) return bad('Pool DHCP: interface inválida.');
  if (!isIp(raw.start) || !isIp(raw.end)) return bad('Pool DHCP: início e fim precisam ser IPv4.');
  const gw = ipField(raw.gateway, 'Pool DHCP: gateway');
  if (!gw.ok) return gw;
  const dns = ipField(raw.dns, 'Pool DHCP: DNS');
  if (!dns.ok) return dns;
  const p: DhcpPool = { iface: raw.iface, start: raw.start as string, end: raw.end as string };
  if (gw.value) p.gateway = gw.value;
  if (dns.value) p.dns = dns.value;
  return { ok: true, value: p };
}

function validatePublicHost(raw: unknown): Validated<PublicHost> {
  if (!isObj(raw)) return bad('Host público inválido.');
  const name = safeName(raw.name);
  if (!isIp(raw.ip) || !name) return bad('Host público: IP ou nome inválido.');
  const h: PublicHost = { ip: raw.ip as string, name };
  if (raw.domains !== undefined) {
    if (!Array.isArray(raw.domains) || raw.domains.length > LIMITS.domainsPerHost) return bad('Host público: domínios inválidos.');
    const ds: string[] = [];
    for (const d of raw.domains) {
      const s = safeDomain(d);
      if (!s) return bad('Host público: domínio inválido.');
      ds.push(s);
    }
    if (ds.length) h.domains = ds;
  }
  if (raw.ports !== undefined) {
    if (!Array.isArray(raw.ports) || raw.ports.length > 8 || !raw.ports.every(isPort)) return bad('Host público: portas inválidas.');
    h.ports = raw.ports as number[];
  }
  if (raw.dns === true) h.dns = true;
  return { ok: true, value: h };
}

export function validateDevice(raw: unknown): Validated<Device> {
  if (!isObj(raw)) return bad('Dispositivo inválido.');
  if (typeof raw.id !== 'string' || !ID.test(raw.id)) return bad('Id de dispositivo inválido.');
  const name = safeName(raw.name, LIMITS.nameLen);
  if (!name) return bad('Nome inválido (1 a 32 caracteres: letras, números, espaço, ponto, hífen, sublinhado).');
  if (!isDeviceKind(raw.kind)) return bad('Tipo de dispositivo inválido.');
  const kind = raw.kind;
  const x = raw.x;
  const y = raw.y;
  if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > LIMITS.coord || Math.abs(y) > LIMITS.coord) return bad('Posição inválida.');
  if (!Array.isArray(raw.ifaces) || raw.ifaces.length < 1 || raw.ifaces.length > LIMITS.ifacesPerDevice) return bad('Quantidade de interfaces inválida.');
  const ifaces: Iface[] = [];
  const seen = new Set<string>();
  for (const r of raw.ifaces) {
    const v = validateIface(r, kind);
    if (!v.ok) return v;
    if (seen.has(v.value.name)) return bad(`Interface duplicada: ${v.value.name}.`);
    seen.add(v.value.name);
    ifaces.push(v.value);
  }
  for (const i of ifaces) {
    if (i.parent) {
      if (!isRouterKind(kind)) return bad('Subinterfaces só em roteador ou firewall.');
      const p = ifaces.find((q) => q.name === i.parent);
      if (!p || p.parent) return bad(`Subinterface ${i.name}: interface-mãe ${i.parent} não existe.`);
    }
    if (i.dhcp && isL2Kind(kind)) return bad('Switch e access point não são clientes DHCP.');
    if (i.dhcp && isRouterKind(kind)) return bad('Cliente DHCP só em hosts (PC, notebook, servidor, impressora).');
  }
  const d: Device = { id: raw.id, name, kind, x: Math.round(x), y: Math.round(y), ifaces };
  const gw = ipField(raw.gateway, 'Gateway');
  if (!gw.ok) return gw;
  if (gw.value) d.gateway = gw.value;
  const dns = ipField(raw.dns, 'DNS');
  if (!dns.ok) return dns;
  if (dns.value) d.dns = dns.value;
  if (raw.off === true) d.off = true;
  if (raw.natEnabled === true) {
    if (!isRouterKind(kind)) return bad('NAT só em roteador ou firewall.');
    d.natEnabled = true;
  }
  if (raw.inventoryId !== undefined && raw.inventoryId !== null) {
    if (typeof raw.inventoryId !== 'string' || !INV_ID.test(raw.inventoryId)) return bad('Vínculo de inventário inválido.');
    d.inventoryId = raw.inventoryId;
  }
  if (raw.routes !== undefined) {
    if (!Array.isArray(raw.routes) || raw.routes.length > LIMITS.routes) return bad(`No máximo ${LIMITS.routes} rotas por dispositivo.`);
    if (raw.routes.length && !isRouterKind(kind)) return bad('Rotas estáticas só em roteador ou firewall.');
    const rs: Route[] = [];
    for (const r of raw.routes) {
      const v = validateRoute(r);
      if (!v.ok) return v;
      rs.push(v.value);
    }
    if (rs.length) d.routes = rs;
  }
  if (raw.acl !== undefined) {
    if (!Array.isArray(raw.acl) || raw.acl.length > LIMITS.acl) return bad(`No máximo ${LIMITS.acl} regras de ACL.`);
    if (raw.acl.length && kind !== 'router' && kind !== 'firewall') return bad('ACL só em roteador ou firewall.');
    const rs: AclRule[] = [];
    for (const r of raw.acl) {
      const v = validateAcl(r);
      if (!v.ok) return v;
      rs.push(v.value);
    }
    if (rs.length) d.acl = rs;
  }
  if (raw.aclDefault !== undefined) {
    if (raw.aclDefault !== 'permit' && raw.aclDefault !== 'deny') return bad('Política padrão da ACL deve ser permit ou deny.');
    if (raw.aclDefault === 'deny') d.aclDefault = 'deny';
  }
  if (raw.dhcp !== undefined) {
    if (!Array.isArray(raw.dhcp) || raw.dhcp.length > LIMITS.pools) return bad(`No máximo ${LIMITS.pools} pools DHCP.`);
    if (raw.dhcp.length && !(kind === 'router' || kind === 'firewall' || kind === 'server')) return bad('Servidor DHCP só em roteador, firewall ou servidor.');
    const ps: DhcpPool[] = [];
    for (const r of raw.dhcp) {
      const v = validatePool(r);
      if (!v.ok) return v;
      ps.push(v.value);
    }
    if (ps.length) d.dhcp = ps;
  }
  if (raw.services !== undefined) {
    if (!Array.isArray(raw.services) || raw.services.length > LIMITS.services) return bad('Serviços inválidos.');
    const ss: Service[] = [];
    for (const r of raw.services) {
      if (!isObj(r) || (r.proto !== 'tcp' && r.proto !== 'udp') || !isPort(r.port)) return bad('Serviço inválido.');
      ss.push({ proto: r.proto, port: r.port });
    }
    if (ss.length) d.services = ss;
  }
  if (raw.dnsRecords !== undefined) {
    if (!isObj(raw.dnsRecords)) return bad('Registros DNS inválidos.');
    const entries = Object.entries(raw.dnsRecords);
    if (entries.length > LIMITS.dnsRecords) return bad(`No máximo ${LIMITS.dnsRecords} registros DNS.`);
    if (entries.length && kind !== 'server') return bad('Registros DNS só em servidor.');
    const rec: Record<string, string> = {};
    for (const [k, v] of entries) {
      const dom = safeDomain(k);
      if (!dom || !isIp(v)) return bad('Registro DNS inválido (domínio ou IP).');
      rec[dom] = v as string;
    }
    if (entries.length) d.dnsRecords = rec;
  }
  if (raw.publicHosts !== undefined) {
    if (!Array.isArray(raw.publicHosts) || raw.publicHosts.length > LIMITS.publicHosts) return bad('Hosts públicos inválidos.');
    if (raw.publicHosts.length && kind !== 'internet') return bad('Hosts públicos só na nuvem Internet.');
    const hs: PublicHost[] = [];
    for (const r of raw.publicHosts) {
      const v = validatePublicHost(r);
      if (!v.ok) return v;
      hs.push(v.value);
    }
    if (hs.length) d.publicHosts = hs;
  }
  return { ok: true, value: d };
}

export function validateCable(raw: unknown): Validated<Cable> {
  if (!isObj(raw) || typeof raw.id !== 'string' || !ID.test(raw.id) || !isObj(raw.a) || !isObj(raw.b)) return bad('Cabo inválido.');
  const end = (e: Record<string, unknown>) => (typeof e.dev === 'string' && ID.test(e.dev) && typeof e.iface === 'string' && IFACE.test(e.iface) ? { dev: e.dev, iface: e.iface } : null);
  const a = end(raw.a);
  const b = end(raw.b);
  if (!a || !b) return bad('Ponta de cabo inválida.');
  return { ok: true, value: { id: raw.id, a, b, up: raw.up !== false } };
}

/** Valida e normaliza uma topologia inteira (limites, unicidade de nomes, cabos coerentes). Reconstroi o objeto (campos extras somem). */
export function validateTopology(raw: unknown): Validated<Topology> {
  if (!isObj(raw) || !Array.isArray(raw.devices) || !Array.isArray(raw.cables)) return bad('Topologia inválida.');
  if (raw.devices.length > LIMITS.devices) return bad(`No máximo ${LIMITS.devices} dispositivos.`);
  if (raw.cables.length > LIMITS.cables) return bad(`No máximo ${LIMITS.cables} cabos.`);
  const devices: Device[] = [];
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const r of raw.devices) {
    const v = validateDevice(r);
    if (!v.ok) return v;
    const key = v.value.name.toLocaleLowerCase('pt-BR');
    if (ids.has(v.value.id)) return bad(`Id duplicado: ${v.value.id}.`);
    if (names.has(key)) return bad(`Já existe um dispositivo chamado "${v.value.name}".`);
    ids.add(v.value.id);
    names.add(key);
    devices.push(v.value);
  }
  const cables: Cable[] = [];
  const cids = new Set<string>();
  const used = new Set<string>();
  const byId = new Map(devices.map((d) => [d.id, d]));
  for (const r of raw.cables) {
    const v = validateCable(r);
    if (!v.ok) return v;
    const c = v.value;
    if (cids.has(c.id)) return bad(`Id de cabo duplicado: ${c.id}.`);
    cids.add(c.id);
    if (c.a.dev === c.b.dev) return bad('Não é possível ligar um dispositivo a ele mesmo.');
    for (const e of [c.a, c.b]) {
      const dev = byId.get(e.dev);
      const itf = dev?.ifaces.find((i) => i.name === e.iface);
      if (!dev || !itf) return bad(`Cabo ${c.id}: interface ${e.iface} não existe.`);
      if (itf.parent) return bad(`Cabo ${c.id}: subinterfaces não recebem cabo.`);
      const k = `${e.dev}|${e.iface}`;
      if (used.has(k)) return bad(`A interface ${e.iface} de ${dev.name} já tem um cabo.`);
      used.add(k);
    }
    cables.push(c);
  }
  const seq = typeof raw.seq === 'number' && Number.isInteger(raw.seq) && raw.seq >= 0 && raw.seq < 1e9 ? raw.seq : 0;
  // o contador nunca pode ficar abaixo de um id existente
  let maxN = 0;
  for (const x of [...devices.map((d) => d.id), ...cables.map((c) => c.id)]) {
    const n = Number(/(\d+)$/.exec(x)?.[1] ?? 0);
    if (n > maxN) maxN = n;
  }
  return { ok: true, value: { devices, cables, seq: Math.max(seq, maxN) } };
}
