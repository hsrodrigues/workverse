import type { NetOp } from './ops';
import type { Topology } from './types';

/**
 * Solucoes de referencia dos desafios (lista de operacoes). Servem para PROVAR nos testes que cada desafio e resolvivel e que
 * os objetivos falham sem elas. NAO sao exportadas pelo indice do pacote nem enviadas ao cliente.
 */

type Solution = (t: Topology) => NetOp[];

const id = (t: Topology, name: string): string => {
  const d = t.devices.find((x) => x.name === name);
  if (!d) throw new Error(`sem dispositivo ${name}`);
  return d.id;
};
const cableOf = (t: Topology, name: string): string => {
  const dev = id(t, name);
  const c = t.cables.find((x) => x.a.dev === dev || x.b.dev === dev);
  if (!c) throw new Error(`sem cabo em ${name}`);
  return c.id;
};

export const SOLUTIONS: Record<string, Solution> = {
  'gateway-errado': (t) => [{ op: 'setDevice', id: id(t, 'PC-FIN-01'), patch: { gateway: '192.168.1.1' } }],
  'mascara-errada': (t) => [{ op: 'setIface', id: id(t, 'PC-REC-01'), iface: 'Gig0/0', patch: { mask: '255.255.255.0' } }],
  'cabo-solto': (t) => [
    { op: 'setCable', id: cableOf(t, 'PC-RH-01'), up: true },
    { op: 'setIface', id: id(t, 'SW1'), iface: 'Gig0/2', patch: { shutdown: false } },
  ],
  'vlan-trocada': (t) => [{ op: 'setIface', id: id(t, 'SW1'), iface: 'Gig0/2', patch: { mode: 'access', vlan: 10 } }],
  'trunk-sem-vlan': (t) => [{ op: 'setIface', id: id(t, 'SW1'), iface: 'Gig0/24', patch: { allowed: [10, 20] } }],
  'dhcp-sem-pool': (t) => [{ op: 'setPool', id: id(t, 'R1'), pool: { iface: 'Gig0/1', start: '192.168.1.100', end: '192.168.1.150', gateway: '192.168.1.1', dns: '8.8.8.8' } }],
  'rota-padrao': (t) => [{ op: 'addRoute', id: id(t, 'R1'), route: { net: '0.0.0.0', mask: '0.0.0.0', via: '203.0.113.1' } }],
  'nat-desligado': (t) => [
    { op: 'setDevice', id: id(t, 'R1'), patch: { natEnabled: true } },
    { op: 'setIface', id: id(t, 'R1'), iface: 'Gig0/1', patch: { nat: 'inside' } },
  ],
  'dns-interno': (t) => [
    { op: 'setDevice', id: id(t, 'PC-FIN-01'), patch: { dns: '192.168.1.5' } },
    { op: 'setDnsRecord', id: id(t, 'SRV-DNS'), domain: 'intranet.workverse.local', ip: '192.168.1.20' },
  ],
  'acl-financeiro': (t) => [
    { op: 'addAcl', id: id(t, 'R1'), index: 0, rule: { action: 'permit', proto: 'tcp', src: '192.168.10.0/24', dst: '192.168.30.10', port: 443 } },
    { op: 'setDevice', id: id(t, 'SRV-FIN'), patch: { gateway: '192.168.30.1' } },
  ],
  'ip-duplicado': (t) => [{ op: 'setIface', id: id(t, 'IMP-FIN'), iface: 'Gig0/0', patch: { ip: '192.168.1.60' } }],
  'segunda-feira': (t) => [
    { op: 'addRoute', id: id(t, 'R1'), route: { net: '0.0.0.0', mask: '0.0.0.0', via: '203.0.113.1' } },
    { op: 'setDevice', id: id(t, 'R1'), patch: { natEnabled: true } },
    { op: 'setPool', id: id(t, 'R1'), index: 0, pool: { iface: 'Gig0/1', start: '192.168.1.100', end: '192.168.1.150', gateway: '192.168.1.1', dns: '8.8.8.8' } },
  ],
};
