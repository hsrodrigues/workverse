import { DEVICE_LABEL, LIMITS, emptyTopology, isDeviceKind, type Device, type DeviceKind, type Iface, type PublicHost, type Topology } from './types';
import { validateTopology } from './validate';

/** Edicoes atomicas da topologia. Cada operacao e validada pelo mesmo validador estrito do servidor. */

const gig = (prefix: string, from: number, n: number): Iface[] => Array.from({ length: n }, (_, k) => ({ name: `${prefix}/${from + k}` }));

export const DEFAULT_PUBLIC_HOSTS: PublicHost[] = [
  { ip: '8.8.8.8', name: 'DNS Google Sim', dns: true },
  { ip: '1.1.1.1', name: 'DNS Um Sim', dns: true },
  { ip: '198.51.100.10', name: 'Exemplo', domains: ['exemplo.sim', 'www.exemplo.sim'], ports: [80, 443] },
  { ip: '198.51.100.20', name: 'Busca Sim', domains: ['busca.sim'], ports: [80, 443] },
  { ip: '198.51.100.30', name: 'Noticias Sim', domains: ['noticias.sim'], ports: [80, 443] },
  { ip: '198.51.100.40', name: 'WorkVerse Sim', domains: ['workverse.sim'], ports: [443] },
];

export function createDevice(kind: DeviceKind, id: string, name: string, x: number, y: number): Device {
  const d: Device = { id, name, kind, x, y, ifaces: [] };
  switch (kind) {
    case 'pc':
    case 'laptop':
    case 'printer':
      d.ifaces = gig('Gig0', 0, 1);
      break;
    case 'server':
      d.ifaces = gig('Gig0', 0, 2);
      d.services = [{ proto: 'tcp', port: 80 }, { proto: 'tcp', port: 443 }, { proto: 'tcp', port: 22 }];
      break;
    case 'switch':
      d.ifaces = gig('Gig0', 1, 24);
      break;
    case 'ap':
      d.ifaces = gig('Gig0', 0, 4);
      break;
    case 'router':
    case 'firewall':
      d.ifaces = gig('Gig0', 0, 4);
      break;
    case 'internet':
      d.ifaces = gig('Gig0', 0, 4);
      d.publicHosts = DEFAULT_PUBLIC_HOSTS.map((h) => ({ ...h, ...(h.domains ? { domains: [...h.domains] } : {}), ...(h.ports ? { ports: [...h.ports] } : {}) }));
      break;
  }
  return d;
}

export type NetOp =
  | { op: 'addDevice'; kind: DeviceKind; name?: string; x: number; y: number }
  | { op: 'removeDevice'; id: string }
  | { op: 'moveDevice'; id: string; x: number; y: number }
  | { op: 'renameDevice'; id: string; name: string }
  | { op: 'setDevice'; id: string; patch: Record<string, unknown> }
  | { op: 'setIface'; id: string; iface: string; patch: Record<string, unknown> }
  | { op: 'addSubif'; id: string; parent: string; vlan: number }
  | { op: 'removeSubif'; id: string; iface: string }
  | { op: 'addCable'; a: { dev: string; iface: string }; b: { dev: string; iface: string } }
  | { op: 'removeCable'; id: string }
  | { op: 'setCable'; id: string; up: boolean }
  | { op: 'addRoute'; id: string; route: Record<string, unknown> }
  | { op: 'removeRoute'; id: string; index: number }
  | { op: 'addAcl'; id: string; rule: Record<string, unknown>; index?: number }
  | { op: 'removeAcl'; id: string; index: number }
  | { op: 'moveAcl'; id: string; from: number; to: number }
  | { op: 'setPool'; id: string; pool: Record<string, unknown>; index?: number }
  | { op: 'removePool'; id: string; index: number }
  | { op: 'setServices'; id: string; services: unknown[] }
  | { op: 'setDnsRecord'; id: string; domain: string; ip: string | null }
  | { op: 'setPublicHost'; id: string; host: Record<string, unknown> }
  | { op: 'removePublicHost'; id: string; ip: string };

export const NET_OP_NAMES = [
  'addDevice', 'removeDevice', 'moveDevice', 'renameDevice', 'setDevice', 'setIface', 'addSubif', 'removeSubif', 'addCable', 'removeCable',
  'setCable', 'addRoute', 'removeRoute', 'addAcl', 'removeAcl', 'moveAcl', 'setPool', 'removePool', 'setServices', 'setDnsRecord',
  'setPublicHost', 'removePublicHost',
] as const;

export type OpResult = { ok: true; topo: Topology } | { ok: false; error: string };
const err = (error: string): OpResult => ({ ok: false, error });
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isIdx = (v: unknown, max: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < max;

const DEVICE_PATCH_KEYS = ['gateway', 'dns', 'off', 'natEnabled', 'aclDefault'] as const;
const IFACE_PATCH_KEYS = ['ip', 'mask', 'dhcp', 'shutdown', 'mode', 'vlan', 'allowed', 'nat'] as const;

function mergePatch(target: Record<string, unknown>, patch: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const k of Object.keys(patch)) if (!keys.includes(k)) return `Campo não editável: ${k.slice(0, 20)}.`;
  for (const k of keys) {
    if (!(k in patch)) continue;
    const v = patch[k];
    if (v === null || v === '' || v === false) delete target[k];
    else target[k] = v;
  }
  return null;
}

function uniqueName(topo: Topology, base: string): string {
  const taken = new Set(topo.devices.map((d) => d.name.toLocaleLowerCase('pt-BR')));
  if (!taken.has(base.toLocaleLowerCase('pt-BR'))) return base;
  for (let n = 2; n < 1000; n++) {
    const c = `${base}-${n}`;
    if (!taken.has(c.toLocaleLowerCase('pt-BR'))) return c;
  }
  return `${base}-x`;
}

/** Aplica uma operacao a uma COPIA da topologia e valida o resultado inteiro. Nunca altera a entrada. */
export function applyOp(topo: Topology, op: NetOp): OpResult {
  if (!isObj(op) || typeof op.op !== 'string') return err('Operação inválida.');
  const t = clone(topo);
  const dev = (id: unknown) => (typeof id === 'string' ? t.devices.find((d) => d.id === id) : undefined);
  const nextId = (p: string) => `${p}${++t.seq}`;
  switch (op.op) {
    case 'addDevice': {
      if (!isDeviceKind(op.kind)) return err('Tipo de dispositivo inválido.');
      if (t.devices.length >= LIMITS.devices) return err(`Limite de ${LIMITS.devices} dispositivos atingido.`);
      if (op.kind === 'internet' && t.devices.some((d) => d.kind === 'internet')) return err('A topologia já tem uma nuvem Internet.');
      if (typeof op.x !== 'number' || typeof op.y !== 'number') return err('Posição inválida.');
      const name = op.name !== undefined ? op.name : uniqueName(t, DEVICE_LABEL[op.kind]);
      t.devices.push(createDevice(op.kind, nextId('d'), name, op.x, op.y));
      break;
    }
    case 'removeDevice': {
      if (!dev(op.id)) return err('Dispositivo não encontrado.');
      t.devices = t.devices.filter((d) => d.id !== op.id);
      t.cables = t.cables.filter((c) => c.a.dev !== op.id && c.b.dev !== op.id);
      break;
    }
    case 'moveDevice': {
      const d = dev(op.id);
      if (!d) return err('Dispositivo não encontrado.');
      d.x = op.x;
      d.y = op.y;
      break;
    }
    case 'renameDevice': {
      const d = dev(op.id);
      if (!d) return err('Dispositivo não encontrado.');
      d.name = op.name;
      break;
    }
    case 'setDevice': {
      const d = dev(op.id);
      if (!d || !isObj(op.patch)) return err('Dispositivo não encontrado.');
      const e = mergePatch(d as unknown as Record<string, unknown>, op.patch, DEVICE_PATCH_KEYS);
      if (e) return err(e);
      break;
    }
    case 'setIface': {
      const d = dev(op.id);
      const i = d?.ifaces.find((x) => x.name === op.iface);
      if (!d || !i || !isObj(op.patch)) return err('Interface não encontrada.');
      const p = { ...op.patch };
      // trocar para DHCP limpa o IP estatico; definir IP estatico desliga o DHCP
      if (p.dhcp === true) {
        p.ip = null;
        p.mask = null;
      } else if (typeof p.ip === 'string' && p.ip !== '' && !('dhcp' in p)) p.dhcp = false;
      const e = mergePatch(i as unknown as Record<string, unknown>, p, IFACE_PATCH_KEYS);
      if (e) return err(e);
      break;
    }
    case 'addSubif': {
      const d = dev(op.id);
      if (!d || !d.ifaces.some((i) => i.name === op.parent && !i.parent)) return err('Interface-mãe não encontrada.');
      if (typeof op.vlan !== 'number') return err('VLAN inválida.');
      d.ifaces.push({ name: `${op.parent}.${op.vlan}`, parent: op.parent, vlan: op.vlan });
      break;
    }
    case 'removeSubif': {
      const d = dev(op.id);
      const i = d?.ifaces.find((x) => x.name === op.iface);
      if (!d || !i?.parent) return err('Subinterface não encontrada.');
      d.ifaces = d.ifaces.filter((x) => x !== i);
      break;
    }
    case 'addCable': {
      if (t.cables.length >= LIMITS.cables) return err(`Limite de ${LIMITS.cables} cabos atingido.`);
      if (!isObj(op.a) || !isObj(op.b)) return err('Cabo inválido.');
      t.cables.push({ id: nextId('c'), a: { dev: String(op.a.dev), iface: String(op.a.iface) }, b: { dev: String(op.b.dev), iface: String(op.b.iface) }, up: true });
      break;
    }
    case 'removeCable': {
      if (!t.cables.some((c) => c.id === op.id)) return err('Cabo não encontrado.');
      t.cables = t.cables.filter((c) => c.id !== op.id);
      break;
    }
    case 'setCable': {
      const c = t.cables.find((x) => x.id === op.id);
      if (!c) return err('Cabo não encontrado.');
      c.up = op.up === true;
      break;
    }
    case 'addRoute': {
      const d = dev(op.id);
      if (!d) return err('Dispositivo não encontrado.');
      (d.routes ??= []).push(op.route as never);
      break;
    }
    case 'removeRoute': {
      const d = dev(op.id);
      if (!d || !isIdx(op.index, d.routes?.length ?? 0)) return err('Rota não encontrada.');
      d.routes!.splice(op.index, 1);
      break;
    }
    case 'addAcl': {
      const d = dev(op.id);
      if (!d) return err('Dispositivo não encontrado.');
      const list = (d.acl ??= []);
      const at = op.index === undefined ? list.length : op.index;
      if (!isIdx(at, list.length + 1)) return err('Posição da regra inválida.');
      list.splice(at, 0, op.rule as never);
      break;
    }
    case 'removeAcl': {
      const d = dev(op.id);
      if (!d || !isIdx(op.index, d.acl?.length ?? 0)) return err('Regra não encontrada.');
      d.acl!.splice(op.index, 1);
      break;
    }
    case 'moveAcl': {
      const d = dev(op.id);
      const n = d?.acl?.length ?? 0;
      if (!d || !isIdx(op.from, n) || !isIdx(op.to, n)) return err('Regra não encontrada.');
      const [r] = d.acl!.splice(op.from, 1);
      d.acl!.splice(op.to, 0, r!);
      break;
    }
    case 'setPool': {
      const d = dev(op.id);
      if (!d) return err('Dispositivo não encontrado.');
      const list = (d.dhcp ??= []);
      if (op.index === undefined) list.push(op.pool as never);
      else if (isIdx(op.index, list.length)) list[op.index] = op.pool as never;
      else return err('Pool não encontrado.');
      break;
    }
    case 'removePool': {
      const d = dev(op.id);
      if (!d || !isIdx(op.index, d.dhcp?.length ?? 0)) return err('Pool não encontrado.');
      d.dhcp!.splice(op.index, 1);
      break;
    }
    case 'setServices': {
      const d = dev(op.id);
      if (!d || !Array.isArray(op.services)) return err('Serviços inválidos.');
      d.services = op.services as never;
      break;
    }
    case 'setDnsRecord': {
      const d = dev(op.id);
      if (!d || typeof op.domain !== 'string') return err('Registro inválido.');
      const rec = (d.dnsRecords ??= {});
      const dom = op.domain.trim().toLowerCase();
      if (op.ip === null) delete rec[dom];
      else rec[dom] = op.ip;
      if (Object.keys(rec).length === 0) delete d.dnsRecords;
      break;
    }
    case 'setPublicHost': {
      const d = dev(op.id);
      if (!d || !isObj(op.host)) return err('Host inválido.');
      const list = (d.publicHosts ??= []);
      const k = list.findIndex((h) => h.ip === op.host.ip);
      if (k >= 0) list[k] = op.host as never;
      else list.push(op.host as never);
      break;
    }
    case 'removePublicHost': {
      const d = dev(op.id);
      if (!d || !d.publicHosts?.some((h) => h.ip === op.ip)) return err('Host não encontrado.');
      d.publicHosts = d.publicHosts.filter((h) => h.ip !== op.ip);
      if (!d.publicHosts.length) delete d.publicHosts;
      break;
    }
    default:
      return err('Operação desconhecida.');
  }
  const v = validateTopology(t);
  return v.ok ? { ok: true, topo: v.value } : err(v.error);
}

export { emptyTopology };
