/**
 * Simulador de rede da Sala da TI. TUDO e simulado: nenhuma funcao daqui abre socket, faz fetch ou toca a rede real.
 * Modelo de dados (JSON puro, serializavel) + limites.
 */

export const DEVICE_KINDS = ['pc', 'laptop', 'server', 'switch', 'router', 'firewall', 'ap', 'internet', 'printer'] as const;
export type DeviceKind = (typeof DEVICE_KINDS)[number];
export const isDeviceKind = (v: unknown): v is DeviceKind => typeof v === 'string' && (DEVICE_KINDS as readonly string[]).includes(v);

export const DEVICE_LABEL: Record<DeviceKind, string> = {
  pc: 'PC',
  laptop: 'Notebook',
  server: 'Servidor',
  switch: 'Switch',
  router: 'Roteador',
  firewall: 'Firewall',
  ap: 'Access point',
  internet: 'Internet',
  printer: 'Impressora',
};

/** Dispositivos de camada 2 (so encaminham quadros; sem IP de gerencia nesta simulacao). */
export const isL2Kind = (k: DeviceKind): boolean => k === 'switch' || k === 'ap';
/** Dispositivos que encaminham pacotes IP entre redes. */
export const isRouterKind = (k: DeviceKind): boolean => k === 'router' || k === 'firewall' || k === 'internet';
export const isHostKind = (k: DeviceKind): boolean => k === 'pc' || k === 'laptop' || k === 'server' || k === 'printer';

export const LIMITS = {
  devices: 80,
  cables: 200,
  ifacesPerDevice: 40,
  routes: 40,
  acl: 40,
  pools: 6,
  services: 12,
  publicHosts: 24,
  dnsRecords: 40,
  domainsPerHost: 6,
  nameLen: 32,
  ttl: 30,
  coord: 4000,
} as const;

export type IfaceMode = 'access' | 'trunk';
export type NatRole = 'inside' | 'outside';

export interface Iface {
  name: string;
  /** IPv4 estatico (ponto-decimal). Ignorado se `dhcp`. */
  ip?: string;
  /** Mascara em ponto-decimal (`255.255.255.0`). */
  mask?: string;
  /** Cliente DHCP (PC/notebook/impressora/servidor). */
  dhcp?: boolean;
  shutdown?: boolean;
  /** Portas de switch/AP. Padrao: access na VLAN 1. */
  mode?: IfaceMode;
  vlan?: number;
  /** Trunk: VLANs permitidas (vazio = todas). */
  allowed?: number[];
  /** Roteador/firewall: papel para NAT. */
  nat?: NatRole;
  /** Subinterface 802.1Q (router-on-a-stick): nome da fisica; `vlan` e a tag. */
  parent?: string;
}

export interface Route {
  net: string;
  mask: string;
  via: string;
}

export type AclProto = 'ip' | 'icmp' | 'tcp' | 'udp';
export const ACL_PROTOS: readonly AclProto[] = ['ip', 'icmp', 'tcp', 'udp'];
export interface AclRule {
  action: 'permit' | 'deny';
  proto: AclProto;
  /** `any`, IP ou CIDR (`10.1.0.0/24`). */
  src: string;
  dst: string;
  /** Porta de destino (tcp/udp). */
  port?: number;
}

export interface DhcpPool {
  /** Interface do servidor que atende o pool (define a rede e a mascara). */
  iface: string;
  start: string;
  end: string;
  gateway?: string;
  dns?: string;
}

export interface Service {
  proto: 'tcp' | 'udp';
  port: number;
}

/** Hosts "da Internet" simulada (somente na nuvem). */
export interface PublicHost {
  ip: string;
  name: string;
  domains?: string[];
  ports?: number[];
  /** Responde consultas DNS (porta 53) com os dominios de toda a nuvem. */
  dns?: boolean;
}

export interface Device {
  id: string;
  name: string;
  kind: DeviceKind;
  x: number;
  y: number;
  ifaces: Iface[];
  /** Hosts: gateway e DNS estaticos. */
  gateway?: string;
  dns?: string;
  /** Desligado: nao responde nem encaminha. */
  off?: boolean;
  routes?: Route[];
  /** NAT (sobrecarga) ligado: traduz origem de `inside` para o IP da `outside`. */
  natEnabled?: boolean;
  dhcp?: DhcpPool[];
  acl?: AclRule[];
  aclDefault?: 'permit' | 'deny';
  services?: Service[];
  /** Servidor DNS local: nome -> IP. */
  dnsRecords?: Record<string, string>;
  publicHosts?: PublicHost[];
  /** Liga ao inventario real (`sala/peca`). */
  inventoryId?: string;
}

export interface CableEnd {
  dev: string;
  iface: string;
}
export interface Cable {
  id: string;
  a: CableEnd;
  b: CableEnd;
  /** false = cabo "desconectado" (solto). */
  up: boolean;
}

export interface Topology {
  devices: Device[];
  cables: Cable[];
  /** Contador para ids novos (`d12`, `c7`). */
  seq: number;
}

export const emptyTopology = (): Topology => ({ devices: [], cables: [], seq: 0 });

// ---------- resultados da simulacao ----------

export type StepKind = 'info' | 'ok' | 'fail' | 'warn';
export interface Step {
  kind: StepKind;
  text: string;
  device?: string;
}

export type FailCode =
  | 'no-device'
  | 'device-off'
  | 'no-ip'
  | 'no-gateway'
  | 'gateway-off-subnet'
  | 'iface-down'
  | 'cable-down'
  | 'no-arp'
  | 'no-route'
  | 'acl-deny'
  | 'ttl'
  | 'refused'
  | 'dns'
  | 'private-dropped'
  | 'dhcp'
  | 'dup-ip'
  | 'no-reply'
  | 'bad-target'
  | 'unsupported';

export interface Failure {
  code: FailCode;
  device?: string;
  text: string;
}

export interface Hop {
  n: number;
  device: string;
  ip?: string;
  /** Interface de entrada, quando houver. */
  iface?: string;
  note?: string;
}

export interface SimResult {
  ok: boolean;
  summary: string;
  steps: Step[];
  hops: Hop[];
  failure?: Failure;
  /** Latencia fictícia (ms), so quando ok. */
  ms?: number;
  /** IP resolvido (DNS) quando o alvo era um nome. */
  resolved?: string;
}
