import { hostLabels, roomCode, type HostKind } from '../inventory';
import { createDevice } from './ops';
import { LIMITS, emptyTopology, type Device, type DeviceKind, type Topology } from './types';
import { validateTopology } from './validate';

/** Construtor simples de topologias (modelos padrao, desafios e testes). */
export class TopoBuilder {
  topo: Topology = emptyTopology();
  add(kind: DeviceKind, name: string, x = 0, y = 0, patch: Partial<Device> = {}): Device {
    const d = createDevice(kind, `d${++this.topo.seq}`, name, x, y);
    Object.assign(d, patch);
    this.topo.devices.push(d);
    return d;
  }
  iface(d: Device, name: string) {
    const i = d.ifaces.find((x) => x.name === name);
    if (!i) throw new Error(`sem interface ${name} em ${d.name}`);
    return i;
  }
  ip(d: Device, name: string, ip: string, mask = '255.255.255.0') {
    Object.assign(this.iface(d, name), { ip, mask });
    return this;
  }
  cable(a: Device, ai: string, b: Device, bi: string, up = true) {
    this.iface(a, ai);
    this.iface(b, bi);
    this.topo.cables.push({ id: `c${++this.topo.seq}`, a: { dev: a.id, iface: ai }, b: { dev: b.id, iface: bi }, up });
    return this;
  }
  sub(d: Device, parent: string, vlan: number, ip: string, mask = '255.255.255.0') {
    d.ifaces.push({ name: `${parent}.${vlan}`, parent, vlan, ip, mask });
    return this;
  }
  build(): Topology {
    const v = validateTopology(this.topo);
    if (!v.ok) throw new Error(`topologia inválida: ${v.error}`);
    return v.value;
  }
}

/** LAN simples: 1 switch, 2 PCs e 1 servidor na mesma rede 192.168.1.0/24. Sem roteador. */
export function lanSimple(): Topology {
  const b = new TopoBuilder();
  const sw = b.add('switch', 'SW1', 300, 140);
  const pc1 = b.add('pc', 'PC1', 140, 260, { });
  const pc2 = b.add('pc', 'PC2', 300, 260);
  const srv = b.add('server', 'SRV1', 460, 260);
  b.ip(pc1, 'Gig0/0', '192.168.1.10').ip(pc2, 'Gig0/0', '192.168.1.11').ip(srv, 'Gig0/0', '192.168.1.20');
  b.cable(pc1, 'Gig0/0', sw, 'Gig0/1').cable(pc2, 'Gig0/0', sw, 'Gig0/2').cable(srv, 'Gig0/0', sw, 'Gig0/3');
  return b.build();
}

/** Duas VLANs (10 e 20) em um switch, com roteador-on-a-stick (subinterfaces 802.1Q). */
export function twoVlans(): Topology {
  const b = new TopoBuilder();
  const r = b.add('router', 'R1', 300, 40);
  const sw = b.add('switch', 'SW1', 300, 160);
  const a1 = b.add('pc', 'PC-A1', 140, 280, { gateway: '192.168.10.1' });
  const a2 = b.add('pc', 'PC-A2', 260, 280, { gateway: '192.168.10.1' });
  const b1 = b.add('pc', 'PC-B1', 380, 280, { gateway: '192.168.20.1' });
  const b2 = b.add('pc', 'PC-B2', 500, 280, { gateway: '192.168.20.1' });
  b.ip(a1, 'Gig0/0', '192.168.10.11').ip(a2, 'Gig0/0', '192.168.10.12').ip(b1, 'Gig0/0', '192.168.20.11').ip(b2, 'Gig0/0', '192.168.20.12');
  b.sub(r, 'Gig0/0', 10, '192.168.10.1').sub(r, 'Gig0/0', 20, '192.168.20.1');
  b.cable(r, 'Gig0/0', sw, 'Gig0/24');
  Object.assign(b.iface(sw, 'Gig0/24'), { mode: 'trunk' });
  for (const [d, port, vlan] of [[a1, 'Gig0/1', 10], [a2, 'Gig0/2', 10], [b1, 'Gig0/3', 20], [b2, 'Gig0/4', 20]] as const) {
    b.cable(d, 'Gig0/0', sw, port);
    Object.assign(b.iface(sw, port), { mode: 'access', vlan });
  }
  return b.build();
}

/** Borda: LAN 192.168.1.0/24 com DHCP no roteador, NAT para a Internet (203.0.113.0/30). */
export function edgeNatDhcp(): Topology {
  const b = new TopoBuilder();
  const net = b.add('internet', 'Internet', 300, 20);
  const r = b.add('router', 'R1', 300, 120, { natEnabled: true });
  const sw = b.add('switch', 'SW1', 300, 220);
  const pc1 = b.add('pc', 'PC1', 160, 330);
  const pc2 = b.add('pc', 'PC2', 300, 330);
  const lap = b.add('laptop', 'NB1', 440, 330);
  b.ip(net, 'Gig0/0', '203.0.113.1', '255.255.255.252');
  b.ip(r, 'Gig0/0', '203.0.113.2', '255.255.255.252').ip(r, 'Gig0/1', '192.168.1.1');
  r.ifaces.find((i) => i.name === 'Gig0/0')!.nat = 'outside';
  r.ifaces.find((i) => i.name === 'Gig0/1')!.nat = 'inside';
  r.routes = [{ net: '0.0.0.0', mask: '0.0.0.0', via: '203.0.113.1' }];
  r.dhcp = [{ iface: 'Gig0/1', start: '192.168.1.100', end: '192.168.1.150', gateway: '192.168.1.1', dns: '8.8.8.8' }];
  for (const d of [pc1, pc2, lap]) d.ifaces[0]!.dhcp = true;
  b.cable(net, 'Gig0/0', r, 'Gig0/0').cable(r, 'Gig0/1', sw, 'Gig0/24');
  b.cable(pc1, 'Gig0/0', sw, 'Gig0/1').cable(pc2, 'Gig0/0', sw, 'Gig0/2').cable(lap, 'Gig0/0', sw, 'Gig0/3');
  return b.build();
}

// ---------------------------------------------------------------- topologia padrao a partir do inventario

export interface InvStation {
  /** `sala/peca`, mesmo id do inventario. */
  id: string;
  kind: HostKind;
  roomId: string;
  roomName: string;
  x: number;
  y: number;
}

/** PCs por switch de sala (24 portas, 1 de uplink). */
const PORTS_PER_ROOM = 23;

export interface DefaultTopo {
  topo: Topology;
  /** Estacoes que nao couberam nos limites. */
  omitted: number;
}

/**
 * Topologia inicial gerada do inventario real: cada estacao vira um PC com o IP do inventario, ligado ao switch da sua sala
 * (VLAN propria), os switches ao SW-CORE, este ao roteador de borda (router-on-a-stick, NAT) e ao "Internet".
 */
export function defaultTopology(stations: readonly InvStation[]): DefaultTopo {
  const b = new TopoBuilder();
  const net = b.add('internet', 'Internet', 520, 30);
  const r = b.add('router', 'R-BORDA', 520, 130, { natEnabled: true });
  const core = b.add('switch', 'SW-CORE', 520, 230);
  b.ip(net, 'Gig0/0', '203.0.113.1', '255.255.255.252');
  b.ip(r, 'Gig0/0', '203.0.113.2', '255.255.255.252');
  r.ifaces[0]!.nat = 'outside';
  r.routes = [{ net: '0.0.0.0', mask: '0.0.0.0', via: '203.0.113.1' }];
  b.cable(net, 'Gig0/0', r, 'Gig0/0').cable(r, 'Gig0/1', core, 'Gig0/24');
  Object.assign(b.iface(core, 'Gig0/24'), { mode: 'trunk' });

  const rooms = new Map<string, InvStation[]>();
  for (const s of stations) rooms.set(s.roomId, [...(rooms.get(s.roomId) ?? []), s]);
  const usedNets = new Set<number>();
  const usedNames = new Set(['internet', 'r-borda', 'sw-core']);
  let omitted = 0;
  let ri = 0;
  const maxRooms = 16;
  for (const [roomId, list] of rooms) {
    if (ri >= maxRooms) {
      omitted += list.length;
      continue;
    }
    const labels = hostLabels(roomId, list);
    // sub-rede 10.N.0.0/16 da sala; em colisao de N, procura o proximo livre
    const first = labels.get(list[0]!.id)!;
    let n = Number(first.ip.split('.')[1]);
    while (usedNets.has(n)) n = n >= 250 ? 20 : n + 1;
    usedNets.add(n);
    const vlan = 10 + ri * 10;
    let swName = `SW-${roomCode(roomId)}`;
    for (let k = 2; usedNames.has(swName.toLowerCase()); k++) swName = `SW-${roomCode(roomId)}-${k}`;
    usedNames.add(swName.toLowerCase());
    if (b.topo.devices.length + 2 > LIMITS.devices) {
      omitted += list.length;
      continue;
    }
    const col = ri % 6;
    const row = Math.floor(ri / 6);
    const sw = b.add('switch', swName, 120 + col * 290, 350 + row * 330);
    const corePort = `Gig0/${ri + 1}`;
    b.cable(sw, 'Gig0/24', core, corePort);
    Object.assign(b.iface(sw, 'Gig0/24'), { mode: 'trunk', allowed: [vlan] });
    Object.assign(b.iface(core, corePort), { mode: 'trunk', allowed: [vlan] });
    b.sub(r, 'Gig0/1', vlan, `10.${n}.0.1`, '255.255.0.0');
    r.ifaces.find((i) => i.name === `Gig0/1.${vlan}`)!.nat = 'inside';
    const sorted = [...list].sort((p, q) => p.y - q.y || p.x - q.x || p.id.localeCompare(q.id));
    let port = 1;
    sorted.forEach((s, k) => {
      if (port > PORTS_PER_ROOM || b.topo.devices.length >= LIMITS.devices) {
        omitted++;
        return;
      }
      const lab = labels.get(s.id)!;
      let name = lab.hostname;
      while (usedNames.has(name.toLowerCase())) name = `${name}-b`;
      usedNames.add(name.toLowerCase());
      const ipParts = lab.ip.split('.');
      const ip = `10.${n}.${ipParts[2]}.${ipParts[3]}`;
      const pc = b.add('pc', name, 20 + col * 290 + (k % 4) * 62, 350 + row * 330 + 90 + Math.floor(k / 4) * 58, { gateway: `10.${n}.0.1`, dns: '8.8.8.8', inventoryId: s.id });
      b.ip(pc, 'Gig0/0', ip, '255.255.0.0');
      pc.ifaces[0]!.ip = ip;
      const p = `Gig0/${port++}`;
      b.cable(pc, 'Gig0/0', sw, p);
      Object.assign(b.iface(sw, p), { mode: 'access', vlan });
    });
    ri++;
  }
  // IPs duplicados dentro de uma mesma sala nao ocorrem (posicao unica), mas garante validade
  return { topo: b.build(), omitted };
}
