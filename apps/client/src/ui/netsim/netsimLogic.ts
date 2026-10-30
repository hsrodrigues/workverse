import {
  browse,
  buildContext,
  ifaceViews,
  isHostKind,
  isIp,
  isL2Kind,
  isRouterKind,
  maskBits,
  nslookup,
  parseCidr,
  ping,
  routeTable,
  testInternet,
  traceroute,
  vlanTable,
  ipStr,
  normMask,
  type Device,
  type NetOp,
  type SimResult,
  type Topology,
} from '@workverse/shared';

/** Logica pura do simulador de rede no cliente (terminal, formatacao, geometria). Testada sem React. O motor e o mesmo do servidor. */

export type LineKind = 'out' | 'err' | 'ok' | 'dim' | 'cmd';
export interface TermLine {
  text: string;
  kind: LineKind;
}
export interface TermOutcome {
  lines: TermLine[];
  /** Edicoes a enviar ao servidor (so quem pode editar). */
  ops?: NetOp[];
  clear?: boolean;
}

const out = (text: string, kind: LineKind = 'out'): TermLine => ({ text, kind });
export const DENIED = 'Permissão negada: somente a equipe de TI altera a rede (você está em modo leitura).';

export const HELP_LINES: readonly string[] = [
  'Comandos (tudo é simulado, nada sai do WorkVerse):',
  '  ip addr | ifconfig | show interfaces      ver interfaces e IPs',
  '  ip addr add 192.168.1.10/24 [dev Gig0/0]   definir IP     (TI)',
  '  ifconfig Gig0/0 192.168.1.10 [netmask M]   definir IP     (TI)',
  '  gateway 192.168.1.1 | dns 8.8.8.8          host           (TI)',
  '  dhcp on|off [Gig0/0]                        cliente DHCP   (TI)',
  '  ip route | show ip route                    tabela de rotas',
  '  ip route add 10.2.0.0/24 via 10.1.0.2       rota estática  (TI)',
  '  ip route add default via 203.0.113.1       rota padrão    (TI)',
  '  ip route del 10.2.0.0/24                    remover rota   (TI)',
  '  show vlan | vlan Gig0/1 20 | trunk Gig0/24  VLANs no switch (TI)',
  '  shutdown Gig0/1 | no shutdown Gig0/1        porta          (TI)',
  '  nat on|off | nat inside|outside Gig0/1      NAT no roteador (TI)',
  '  ping <ip|nome> | traceroute <ip|nome>       testes',
  '  nslookup exemplo.sim | curl http://exemplo.sim | navegar exemplo.sim',
  '  testar                                      diagnóstico "Testar internet"',
  '  hostname | clear | help',
];

const DEFAULT_TEST = '8.8.8.8';

function findIface(d: Device, tok: string | undefined): string | null {
  if (!tok) return null;
  const t = tok.toLowerCase();
  const direct = d.ifaces.find((i) => i.name.toLowerCase() === t);
  if (direct) return direct.name;
  const m = /^(?:eth|en|gi|gig|fa)(\d+)$/.exec(t);
  if (m) return d.ifaces[Number(m[1])]?.name ?? null;
  return null;
}
const primaryName = (d: Device): string => d.ifaces.find((i) => i.ip || i.dhcp)?.name ?? d.ifaces[0]!.name;

/** Linhas de um resultado de ping (estilo Linux simplificado). */
export function formatPing(r: SimResult, target: string): TermLine[] {
  const lines: TermLine[] = [out(`PING ${r.resolved ? `${target} (${r.resolved})` : target}: 4 pacotes simulados`, 'dim')];
  if (r.ok) {
    const base = r.ms ?? 1;
    const ip = r.resolved ?? target;
    for (let n = 1; n <= 4; n++) lines.push(out(`resposta de ${ip}: seq=${n} tempo=${base + ((n * 7) % 3)}ms`, 'ok'));
    lines.push(out('4 enviados, 4 recebidos, 0% de perda', 'ok'));
  } else {
    lines.push(out(`${r.summary}`, 'err'));
    lines.push(out('4 enviados, 0 recebidos, 100% de perda', 'err'));
    lines.push(out('Dica: o botão "Testar internet" mostra o passo a passo.', 'dim'));
  }
  return lines;
}

export function formatTraceroute(r: SimResult, target: string): TermLine[] {
  const lines: TermLine[] = [out(`traceroute para ${target}, máx. 30 saltos (simulado)`, 'dim')];
  r.hops.forEach((h, i) => lines.push(out(`${String(i + 1).padStart(2)}  ${h.device}  ${h.ip ?? ''}  ${(r.ms ?? 2) + i}ms`, 'ok')));
  if (!r.ok) {
    lines.push(out(`${String(r.hops.length + 1).padStart(2)}  * * *`, 'err'));
    lines.push(out(r.summary, 'err'));
  } else lines.push(out('Destino alcançado.', 'ok'));
  return lines;
}

export function formatSteps(r: SimResult): TermLine[] {
  return r.steps.map((s) => out(`${s.kind === 'ok' ? '✔' : s.kind === 'fail' ? '✘' : s.kind === 'warn' ? '!' : '·'} ${s.text}`, s.kind === 'ok' ? 'ok' : s.kind === 'fail' ? 'err' : s.kind === 'warn' ? 'err' : 'out'));
}

function showInterfaces(topo: Topology, d: Device): TermLine[] {
  const lines: TermLine[] = [];
  const ctx = buildContext(topo);
  for (const v of ifaceViews(topo, d.id, ctx)) {
    const addr = v.ip ? `${v.ip}/${v.bits}` : 'sem IP';
    lines.push(out(`${v.name.padEnd(10)} ${v.up ? 'UP  ' : 'DOWN'} ${addr}${v.dhcp ? ' (DHCP)' : ''}`, v.up ? 'out' : 'err'));
    if (!v.up && v.reason) lines.push(out(`           motivo: ${v.reason}`, 'dim'));
    if (v.note) lines.push(out(`           ${v.note}`, 'dim'));
  }
  if (isHostKind(d.kind)) {
    lines.push(out(`gateway: ${d.gateway ?? '(nenhum)'}   dns: ${d.dns ?? '(nenhum)'}`, 'dim'));
  }
  if (isL2Kind(d.kind)) lines.push(out('Switch/AP: camada 2, sem IP de gerência nesta simulação.', 'dim'));
  return lines;
}

function showRoutes(topo: Topology, d: Device): TermLine[] {
  const ctx = buildContext(topo);
  if (isHostKind(d.kind)) {
    const v = ifaceViews(topo, d.id, ctx).find((x) => x.ip);
    const lines: TermLine[] = [];
    if (v?.ip) lines.push(out(`${v.ip}/${v.bits} conectada em ${v.name}`));
    lines.push(out(d.gateway ? `default via ${d.gateway}` : 'sem rota padrão (gateway não configurado)', d.gateway ? 'out' : 'err'));
    return lines;
  }
  if (isL2Kind(d.kind)) return [out('Switch/AP não roteia pacotes IP.', 'dim')];
  const t = routeTable(ctx, d);
  if (t.length === 0) return [out('Tabela de rotas vazia.', 'err')];
  return t.map((r) => {
    const len = maskBits(r.mask) ?? 0;
    const via = r.kind === 'S' ? `[1/0] via ${r.via}${r.iface ? `, ${r.iface}` : ''}` : `is directly connected, ${r.iface}`;
    return out(`${r.kind}${r.active ? ' ' : '!'} ${r.net}/${len} ${via}${r.active ? '' : '  (inativa)'}`, r.active ? 'out' : 'err');
  });
}

function showVlan(topo: Topology, d: Device): TermLine[] {
  if (!isL2Kind(d.kind)) return [out('show vlan só funciona em switch/AP.', 'err')];
  const lines = [out('VLAN  Portas (access)', 'dim')];
  for (const v of vlanTable(topo, d.id)) lines.push(out(`${String(v.vlan).padEnd(5)} ${v.ports.join(', ')}`));
  const trunks = d.ifaces.filter((i) => i.mode === 'trunk');
  if (trunks.length) lines.push(out(`Trunks: ${trunks.map((i) => `${i.name}${i.allowed?.length ? ` (VLANs ${i.allowed.join(',')})` : ' (todas)'}`).join('; ')}`, 'dim'));
  return lines;
}

/** Interpreta uma linha do terminal do dispositivo `d`. Funcao pura: nunca altera a topologia (edicoes voltam como `ops`). */
export function runTerminal(raw: string, env: { topo: Topology; dev: Device; canEdit: boolean }): TermOutcome {
  const { topo, dev: d } = env;
  const line = raw.trim().slice(0, 200);
  if (!line) return { lines: [] };
  const tok = line.split(/\s+/);
  const c0 = tok[0]!.toLowerCase();
  const rest = tok.slice(1);
  const edit = (ops: NetOp[], okText: string): TermOutcome => (env.canEdit ? { lines: [out(okText, 'dim')], ops } : { lines: [out(DENIED, 'err')] });
  const bad = (msg: string): TermOutcome => ({ lines: [out(msg, 'err')] });
  const ctx = () => buildContext(topo);
  const canPacket = !isL2Kind(d.kind) && d.kind !== 'internet';
  const needPacket = (): TermOutcome | null => (canPacket ? null : bad(`${d.name} não gera pacotes IP: use um PC, servidor ou roteador.`));

  switch (c0) {
    case 'help':
    case 'ajuda':
    case '?':
      return { lines: HELP_LINES.map((t) => out(t, 'dim')) };
    case 'clear':
    case 'cls':
      return { lines: [], clear: true };
    case 'hostname':
      return { lines: [out(d.name)] };
    case 'ifconfig':
    case 'ipconfig': {
      if (rest.length === 0) return { lines: showInterfaces(topo, d) };
      const name = findIface(d, rest[0]);
      if (!name) return bad(`interface desconhecida: ${rest[0]}`);
      if (!isIp(rest[1])) return { lines: showInterfaces(topo, d) };
      const mi = rest.findIndex((x) => x.toLowerCase() === 'netmask');
      const mask = mi >= 0 ? normMask(rest[mi + 1]) : (d.ifaces.find((i) => i.name === name)?.mask ?? '255.255.255.0');
      if (!mask) return bad('máscara inválida (ex.: 255.255.255.0 ou /24)');
      return edit([{ op: 'setIface', id: d.id, iface: name, patch: { ip: rest[1], mask, dhcp: false } }], `${name}: ${rest[1]}/${maskBits(mask)}`);
    }
    case 'ip': {
      const sub = (rest[0] ?? '').toLowerCase();
      if (sub === 'a' || sub === 'addr' || sub === 'address') {
        if ((rest[1] ?? '').toLowerCase() === 'add') {
          const m = /^(\d+\.\d+\.\d+\.\d+)\/(\d{1,2})$/.exec(rest[2] ?? '');
          if (!m || !isIp(m[1]) || Number(m[2]) > 32) return bad('uso: ip addr add 192.168.1.10/24 [dev Gig0/0]');
          const di = rest.findIndex((x) => x === 'dev');
          const name = di >= 0 ? findIface(d, rest[di + 1]) : primaryName(d);
          if (!name) return bad(`interface desconhecida: ${rest[di + 1] ?? ''}`);
          return edit([{ op: 'setIface', id: d.id, iface: name, patch: { ip: m[1], mask: `/${m[2]}`, dhcp: false } }], `${name}: ${m[1]}/${m[2]}`);
        }
        if ((rest[1] ?? '').toLowerCase() === 'del') {
          const di = rest.findIndex((x) => x === 'dev');
          const name = di >= 0 ? findIface(d, rest[di + 1]) : primaryName(d);
          if (!name) return bad('interface desconhecida');
          return edit([{ op: 'setIface', id: d.id, iface: name, patch: { ip: null, mask: null } }], `${name}: IP removido`);
        }
        return { lines: showInterfaces(topo, d) };
      }
      if (sub === 'route' || sub === 'r') return routeCmd(rest.slice(1), env, edit, bad, () => showRoutes(topo, d));
      return bad('uso: ip addr | ip route');
    }
    case 'route':
      return { lines: showRoutes(topo, d) };
    case 'show': {
      const what = rest.join(' ').toLowerCase();
      if (what === 'ip route' || what === 'route') return { lines: showRoutes(topo, d) };
      if (what === 'vlan' || what === 'vlans') return { lines: showVlan(topo, d) };
      if (what.startsWith('interf') || what === 'ip interface brief' || what === 'ip int brief') return { lines: showInterfaces(topo, d) };
      return bad('show: use "show ip route", "show vlan" ou "show interfaces".');
    }
    case 'gateway':
    case 'gw': {
      if (!isHostKind(d.kind)) return bad('gateway só se configura em hosts (use rotas no roteador).');
      if (rest[0] === 'none' || rest[0] === 'limpar') return edit([{ op: 'setDevice', id: d.id, patch: { gateway: null } }], 'gateway removido');
      if (!isIp(rest[0])) return bad('uso: gateway 192.168.1.1');
      return edit([{ op: 'setDevice', id: d.id, patch: { gateway: rest[0] } }], `gateway ${rest[0]}`);
    }
    case 'dns': {
      if (!isHostKind(d.kind)) return bad('dns só se configura em hosts.');
      if (rest[0] === 'none' || rest[0] === 'limpar') return edit([{ op: 'setDevice', id: d.id, patch: { dns: null } }], 'dns removido');
      if (!isIp(rest[0])) return bad('uso: dns 8.8.8.8');
      return edit([{ op: 'setDevice', id: d.id, patch: { dns: rest[0] } }], `dns ${rest[0]}`);
    }
    case 'dhcp': {
      const on = (rest[0] ?? '').toLowerCase();
      if (on !== 'on' && on !== 'off') return bad('uso: dhcp on|off [Gig0/0]');
      if (!isHostKind(d.kind)) return bad('só hosts são clientes DHCP (o servidor DHCP se configura no painel do roteador).');
      const name = rest[1] ? findIface(d, rest[1]) : primaryName(d);
      if (!name) return bad('interface desconhecida');
      return edit([{ op: 'setIface', id: d.id, iface: name, patch: { dhcp: on === 'on' } }], `${name}: DHCP ${on}`);
    }
    case 'shutdown':
    case 'noshutdown': {
      const name = findIface(d, rest[0]);
      if (!name) return bad('uso: shutdown Gig0/1');
      return edit([{ op: 'setIface', id: d.id, iface: name, patch: { shutdown: c0 === 'shutdown' } }], `${name}: ${c0 === 'shutdown' ? 'desativada' : 'ativada'}`);
    }
    case 'no': {
      if ((rest[0] ?? '').toLowerCase() !== 'shutdown') return bad('uso: no shutdown Gig0/1');
      const name = findIface(d, rest[1]);
      if (!name) return bad('uso: no shutdown Gig0/1');
      return edit([{ op: 'setIface', id: d.id, iface: name, patch: { shutdown: false } }], `${name}: ativada`);
    }
    case 'vlan': {
      if (!isL2Kind(d.kind)) return bad('vlan só em switch/AP.');
      const name = findIface(d, rest[0]);
      const n = Number(rest[1]);
      if (!name || !Number.isInteger(n) || n < 1 || n > 4094) return bad('uso: vlan Gig0/1 20   (VLAN 1 a 4094)');
      return edit([{ op: 'setIface', id: d.id, iface: name, patch: { mode: 'access', vlan: n } }], `${name}: access VLAN ${n}`);
    }
    case 'trunk': {
      if (!isL2Kind(d.kind)) return bad('trunk só em switch/AP.');
      const name = findIface(d, rest[0]);
      if (!name) return bad('uso: trunk Gig0/24');
      return edit([{ op: 'setIface', id: d.id, iface: name, patch: { mode: 'trunk' } }], `${name}: trunk`);
    }
    case 'nat': {
      if (!isRouterKind(d.kind) || d.kind === 'internet') return bad('NAT só em roteador/firewall.');
      const w = (rest[0] ?? '').toLowerCase();
      if (w === 'on' || w === 'off') return edit([{ op: 'setDevice', id: d.id, patch: { natEnabled: w === 'on' } }], `NAT ${w}`);
      if (w === 'inside' || w === 'outside') {
        const name = findIface(d, rest[1]);
        if (!name) return bad('uso: nat inside|outside Gig0/1');
        return edit([{ op: 'setIface', id: d.id, iface: name, patch: { nat: w } }], `${name}: NAT ${w}`);
      }
      return bad('uso: nat on|off | nat inside|outside Gig0/1');
    }
    case 'ping': {
      const np = needPacket();
      if (np) return np;
      const t = rest[0] ?? '';
      if (!t) return bad('uso: ping <ip|nome>');
      return { lines: formatPing(ping(topo, d.id, t, ctx()), t) };
    }
    case 'traceroute':
    case 'tracert': {
      const np = needPacket();
      if (np) return np;
      const t = rest[0] ?? '';
      if (!t) return bad('uso: traceroute <ip|nome>');
      return { lines: formatTraceroute(traceroute(topo, d.id, t, ctx()), t) };
    }
    case 'nslookup':
    case 'dig': {
      const np = needPacket();
      if (np) return np;
      if (!rest[0]) return bad('uso: nslookup exemplo.sim');
      const r = nslookup(topo, d.id, rest[0], ctx());
      return { lines: [...formatSteps(r).filter((s) => s.kind !== 'dim'), out(r.ok ? `Nome: ${rest[0]}  Endereço: ${r.resolved}` : r.summary, r.ok ? 'ok' : 'err')] };
    }
    case 'curl':
    case 'wget':
    case 'navegar':
    case 'browse': {
      const np = needPacket();
      if (np) return np;
      const url = rest.filter((x) => !x.startsWith('-'))[0];
      if (!url) return bad('uso: curl http://exemplo.sim');
      const r = browse(topo, d.id, url, ctx());
      return { lines: [...formatSteps(r)] };
    }
    case 'testar':
    case 'test': {
      const np = needPacket();
      if (np) return np;
      return { lines: formatSteps(testInternet(topo, d.id, ctx())) };
    }
    default:
      return bad(`comando não reconhecido: ${tok[0]!.slice(0, 30)}. Digite help.`);
  }
}

function routeCmd(args: string[], env: { topo: Topology; dev: Device; canEdit: boolean }, edit: (ops: NetOp[], t: string) => TermOutcome, bad: (m: string) => TermOutcome, show: () => TermLine[]): TermOutcome {
  const d = env.dev;
  const verb = (args[0] ?? '').toLowerCase();
  if (!verb || verb === 'show') return { lines: show() };
  const dest = args[1] ?? '';
  const isDefault = dest === 'default';
  const cidr = isDefault ? { net: '0.0.0.0', bits: 0 } : (() => {
    const c = parseCidr(dest);
    return c && dest.includes('/') ? { net: ipStr(c.net), bits: c.bits } : null;
  })();
  if (verb === 'add') {
    if ((args[2] ?? '').toLowerCase() !== 'via' || !isIp(args[3]) || !cidr) return bad('uso: ip route add 10.2.0.0/24 via 10.1.0.2  |  ip route add default via 203.0.113.1');
    if (isHostKind(d.kind)) {
      if (!isDefault) return bad('hosts só têm rota padrão: use "ip route add default via <gateway>" ou "gateway <ip>".');
      return edit([{ op: 'setDevice', id: d.id, patch: { gateway: args[3]! } }], `gateway ${args[3]}`);
    }
    if (!isRouterKind(d.kind)) return bad('este dispositivo não roteia.');
    return edit([{ op: 'addRoute', id: d.id, route: { net: cidr.net, mask: `/${cidr.bits}`, via: args[3] } }], `rota ${cidr.net}/${cidr.bits} via ${args[3]}`);
  }
  if (verb === 'del' || verb === 'delete') {
    if (!cidr) return bad('uso: ip route del 10.2.0.0/24');
    if (isHostKind(d.kind) && isDefault) return edit([{ op: 'setDevice', id: d.id, patch: { gateway: null } }], 'gateway removido');
    const idx = (d.routes ?? []).findIndex((r) => r.net === cidr.net && maskBits(r.mask) === cidr.bits);
    if (idx < 0) return bad('rota não encontrada.');
    return edit([{ op: 'removeRoute', id: d.id, index: idx }], `rota ${cidr.net}/${cidr.bits} removida`);
  }
  return bad('uso: ip route [add|del] ...');
}

// ---------------------------------------------------------------- geometria / edicao

/** Primeira interface fisica livre (sem cabo) de um dispositivo, preferindo a que o chamador pedir. */
export function freeIface(topo: Topology, devId: string): string | null {
  const d = topo.devices.find((x) => x.id === devId);
  if (!d) return null;
  const used = new Set<string>();
  for (const c of topo.cables) {
    if (c.a.dev === devId) used.add(c.a.iface);
    if (c.b.dev === devId) used.add(c.b.iface);
  }
  return d.ifaces.find((i) => !i.parent && !used.has(i.name))?.name ?? null;
}

export function bounds(topo: Topology): { x: number; y: number; w: number; h: number } {
  if (topo.devices.length === 0) return { x: 0, y: 0, w: 600, h: 400 };
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const d of topo.devices) {
    x0 = Math.min(x0, d.x);
    y0 = Math.min(y0, d.y);
    x1 = Math.max(x1, d.x);
    y1 = Math.max(y1, d.y);
  }
  const pad = 60;
  return { x: x0 - pad, y: y0 - pad, w: Math.max(240, x1 - x0 + pad * 2 + 40), h: Math.max(200, y1 - y0 + pad * 2 + 40) };
}

/** Estado visual de um cabo: ok (verde) quando as duas pontas estao up; senao vermelho. */
export function cableState(topo: Topology, cableId: string): { up: boolean; reason?: string } {
  const c = topo.cables.find((x) => x.id === cableId);
  if (!c) return { up: false, reason: 'cabo inexistente' };
  const a = topo.devices.find((d) => d.id === c.a.dev);
  const b = topo.devices.find((d) => d.id === c.b.dev);
  if (!c.up) return { up: false, reason: 'cabo solto' };
  if (!a || !b || a.off || b.off) return { up: false, reason: 'dispositivo desligado' };
  if (a.ifaces.find((i) => i.name === c.a.iface)?.shutdown || b.ifaces.find((i) => i.name === c.b.iface)?.shutdown) return { up: false, reason: 'interface desativada' };
  return { up: true };
}
