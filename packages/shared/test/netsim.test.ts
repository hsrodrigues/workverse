import { describe, expect, it } from 'vitest';
import {
  LIMITS,
  TopoBuilder,
  applyOp,
  bitsToMask,
  browse,
  buildContext,
  defaultTopology,
  edgeNatDhcp,
  ifaceViews,
  lanSimple,
  maskBits,
  nslookup,
  parseCidr,
  parseIp,
  ping,
  primaryIp,
  routeTable,
  safeDomain,
  safeName,
  testInternet,
  traceroute,
  twoVlans,
  validateTopology,
  vlanTable,
  type InvStation,
  type NetOp,
  type Topology,
} from '../src';

const clone = <T>(t: T): T => JSON.parse(JSON.stringify(t)) as T;
const dev = (t: Topology, name: string) => t.devices.find((d) => d.name === name)!;
const id = (t: Topology, name: string) => dev(t, name).id;
const p = (t: Topology, from: string, to: string) => ping(t, id(t, from), to);
const iface = (t: Topology, name: string, i = 'Gig0/0') => dev(t, name).ifaces.find((x) => x.name === i)!;
const cableOf = (t: Topology, name: string, i = 'Gig0/0') => t.cables.find((c) => (c.a.dev === id(t, name) && c.a.iface === i) || (c.b.dev === id(t, name) && c.b.iface === i))!;
const code = (r: { failure?: { code: string } }) => r.failure?.code;

describe('enderecos', () => {
  it('parseIp rejeita lixo', () => {
    expect(parseIp('10.0.0.1')).toBe(167772161);
    for (const s of ['256.1.1.1', '1.2.3', '1.2.3.4.5', '01.2.3.4', ' 1.2.3.4', '1.2.3.4 ', 'a.b.c.d', '', '1..2.3', '1.2.3.-4']) expect(parseIp(s)).toBeNull();
    expect(parseIp(null)).toBeNull();
  });
  it('mascaras', () => {
    expect(maskBits('255.255.255.0')).toBe(24);
    expect(maskBits('/30')).toBe(30);
    expect(maskBits('255.0.255.0')).toBeNull();
    expect(maskBits('255.255.255.1')).toBeNull();
    expect(maskBits('/33')).toBeNull();
    expect(bitsToMask(0)).toBe('0.0.0.0');
    expect(bitsToMask(16)).toBe('255.255.0.0');
  });
  it('cidr, nomes e dominios', () => {
    expect(parseCidr('any')).toEqual({ net: 0, bits: 0 });
    expect(parseCidr('10.0.0.5/24')).toEqual({ net: parseIp('10.0.0.0'), bits: 24 });
    expect(parseCidr('10.0.0.0/40')).toBeNull();
    expect(safeName('  PC  01 ')).toBe('PC 01');
    for (const s of ['', 'a\u0000b', 'a‮b', 'a​b', '<script>', 'x'.repeat(33), '-abc', 'a\nb']) expect(safeName(s)).toBeNull();
    expect(safeDomain('Exemplo.SIM')).toBe('exemplo.sim');
    expect(safeDomain('semponto')).toBeNull();
    expect(safeDomain('a_b.sim')).toBeNull();
  });
});

describe('LAN simples', () => {
  it('ping entre PCs e ate o servidor funciona', () => {
    const t = lanSimple();
    const r = p(t, 'PC1', '192.168.1.11');
    expect(r.ok).toBe(true);
    expect(r.summary).toMatch(/Resposta de 192\.168\.1\.11/);
    expect(r.steps.some((s) => /SW1/.test(s.text))).toBe(true);
    expect(p(t, 'PC2', 'SRV1').ok).toBe(true);
  });
  it('e deterministico', () => {
    const t = lanSimple();
    expect(JSON.stringify(p(t, 'PC1', '192.168.1.20'))).toBe(JSON.stringify(p(t, 'PC1', '192.168.1.20')));
  });
  it('IP inexistente na mesma rede: sem resposta ARP', () => {
    const r = p(lanSimple(), 'PC1', '192.168.1.99');
    expect(r.ok).toBe(false);
    expect(code(r)).toBe('no-arp');
    expect(r.summary).toMatch(/Falhou em PC1/);
  });
  it('cabo solto aponta a porta', () => {
    const t = lanSimple();
    cableOf(t, 'PC2').up = false;
    const r = p(t, 'PC1', '192.168.1.11');
    expect(code(r)).toBe('cable-down');
    expect(r.summary).toMatch(/PC2/);
    expect(r.summary).toMatch(/Gig0\/0/);
  });
  it('cabo removido na origem', () => {
    const t = lanSimple();
    t.cables = t.cables.filter((c) => c.a.dev !== id(t, 'PC1'));
    const r = p(t, 'PC1', '192.168.1.11');
    expect(code(r)).toBe('cable-down');
    expect(r.summary).toMatch(/cabo desconectado em Gig0\/0 de PC1/);
  });
  it('porta do switch em shutdown', () => {
    const t = lanSimple();
    iface(t, 'SW1', 'Gig0/2').shutdown = true;
    const r = p(t, 'PC1', '192.168.1.11');
    expect(r.ok).toBe(false);
    expect(r.summary).toMatch(/desativada|shutdown/);
  });
  it('dispositivo desligado', () => {
    const t = lanSimple();
    dev(t, 'PC2').off = true;
    expect(p(t, 'PC1', '192.168.1.11').ok).toBe(false);
    expect(code(p(t, 'PC2', '192.168.1.10'))).toBe('device-off');
  });
  it('IP duplicado gera aviso', () => {
    const t = lanSimple();
    iface(t, 'SRV1').ip = '192.168.1.11';
    const r = p(t, 'PC1', '192.168.1.11');
    expect(r.steps.some((s) => s.kind === 'warn' && /duplicado/.test(s.text))).toBe(true);
  });
  it('VLAN diferente isola', () => {
    const t = lanSimple();
    iface(t, 'SW1', 'Gig0/2').vlan = 30;
    const r = p(t, 'PC1', '192.168.1.11');
    expect(code(r)).toBe('no-arp');
    expect(r.summary).toMatch(/camada 2|VLAN/);
  });
  it('ping para si mesmo', () => {
    expect(p(lanSimple(), 'PC1', '192.168.1.10').ok).toBe(true);
  });
  it('switch como origem nao e suportado; alvo invalido', () => {
    const t = lanSimple();
    expect(code(p(t, 'SW1', '192.168.1.10'))).toBe('unsupported');
    expect(code(p(t, 'PC1', '$$$'))).toBe('bad-target');
    expect(code(p(t, 'PC1', ''))).toBe('bad-target');
    expect(code(ping(t, 'zzz', '1.1.1.1'))).toBe('no-device');
  });
  it('sem IP', () => {
    const t = lanSimple();
    delete iface(t, 'PC1').ip;
    expect(code(p(t, 'PC1', '192.168.1.11'))).toBe('no-ip');
  });
  it('fora da sub-rede sem gateway / gateway fora da sub-rede', () => {
    const t = lanSimple();
    expect(code(p(t, 'PC1', '8.8.8.8'))).toBe('no-gateway');
    dev(t, 'PC1').gateway = '10.9.9.9';
    const r = p(t, 'PC1', '8.8.8.8');
    expect(code(r)).toBe('gateway-off-subnet');
    expect(r.summary).toMatch(/gateway 10\.9\.9\.9 está fora da sub-rede/);
  });
  it('mascara diferente muda a sub-rede do host', () => {
    const t = lanSimple();
    iface(t, 'PC1').mask = '255.255.255.252';
    expect(code(p(t, 'PC1', '192.168.1.20'))).toBe('no-gateway');
  });
  it('dois PCs direto por cabo', () => {
    const b = new TopoBuilder();
    const a = b.add('pc', 'A');
    const c = b.add('pc', 'B');
    b.ip(a, 'Gig0/0', '10.0.0.1').ip(c, 'Gig0/0', '10.0.0.2').cable(a, 'Gig0/0', c, 'Gig0/0');
    expect(ping(b.build(), a.id, '10.0.0.2').ok).toBe(true);
  });
  it('lacos de camada 2 nao travam', () => {
    const t = lanSimple();
    const b = new TopoBuilder();
    b.topo = t;
    const sw2 = b.add('switch', 'SW2');
    b.cable(dev(t, 'SW1'), 'Gig0/10', sw2, 'Gig0/1').cable(dev(t, 'SW1'), 'Gig0/11', sw2, 'Gig0/2');
    expect(p(b.build(), 'PC1', '192.168.1.11').ok).toBe(true);
  });
});

describe('duas VLANs com roteador-on-a-stick', () => {
  it('mesma VLAN e entre VLANs funcionam', () => {
    const t = twoVlans();
    expect(p(t, 'PC-A1', '192.168.10.12').ok).toBe(true);
    const r = p(t, 'PC-A1', '192.168.20.11');
    expect(r.ok).toBe(true);
    expect(r.steps.some((s) => /R1/.test(s.text) && /Gig0\/0\.20/.test(s.text))).toBe(true);
    expect(p(t, 'PC-B2', '192.168.10.11').ok).toBe(true);
  });
  it('gateway errado', () => {
    const t = twoVlans();
    dev(t, 'PC-A1').gateway = '192.168.10.254';
    const r = p(t, 'PC-A1', '192.168.20.11');
    expect(code(r)).toBe('no-arp');
    expect(r.summary).toMatch(/gateway 192\.168\.10\.254/);
  });
  it('porta na VLAN trocada', () => {
    const t = twoVlans();
    iface(t, 'SW1', 'Gig0/1').vlan = 20;
    expect(p(t, 'PC-A1', '192.168.10.12').ok).toBe(false);
    expect(p(t, 'PC-A1', '192.168.20.11').ok).toBe(false);
  });
  it('trunk sem a VLAN', () => {
    const t = twoVlans();
    iface(t, 'SW1', 'Gig0/24').allowed = [10];
    expect(p(t, 'PC-A1', '192.168.10.12').ok).toBe(true);
    const r = p(t, 'PC-B1', '192.168.10.11');
    expect(r.ok).toBe(false);
    expect(r.summary).toMatch(/VLAN 20|gateway/);
  });
  it('porta do PC virou trunk: quadro sem tag cai na VLAN 1', () => {
    const t = twoVlans();
    iface(t, 'SW1', 'Gig0/1').mode = 'trunk';
    expect(p(t, 'PC-A1', '192.168.10.12').ok).toBe(false);
  });
  it('sem subinterface da VLAN', () => {
    const t = twoVlans();
    dev(t, 'R1').ifaces = dev(t, 'R1').ifaces.filter((i) => i.name !== 'Gig0/0.20');
    const r = p(t, 'PC-A1', '192.168.20.11');
    expect(r.ok).toBe(false);
    expect(code(r)).toBe('no-route');
  });
  it('ACL entre VLANs bloqueia por regra e ordem', () => {
    const t = twoVlans();
    dev(t, 'R1').acl = [
      { action: 'permit', proto: 'icmp', src: '192.168.10.11', dst: 'any' },
      { action: 'deny', proto: 'ip', src: '192.168.10.0/24', dst: '192.168.20.0/24' },
    ];
    expect(p(t, 'PC-A1', '192.168.20.11').ok).toBe(true);
    const r = p(t, 'PC-A2', '192.168.20.11');
    expect(code(r)).toBe('acl-deny');
    expect(r.summary).toMatch(/regra 2/);
    // reordenando, a regra deny vem primeiro
    dev(t, 'R1').acl!.reverse();
    expect(p(t, 'PC-A1', '192.168.20.11').summary).toMatch(/regra 1/);
  });
  it('ACL por porta tcp', () => {
    const t = twoVlans();
    const b = new TopoBuilder();
    b.topo = t;
    const srv = b.add('server', 'SRV', 0, 0, { gateway: '192.168.20.1' });
    b.ip(srv, 'Gig0/0', '192.168.20.50');
    b.cable(srv, 'Gig0/0', dev(t, 'SW1'), 'Gig0/5');
    Object.assign(iface(t, 'SW1', 'Gig0/5'), { mode: 'access', vlan: 20 });
    dev(t, 'R1').acl = [{ action: 'deny', proto: 'tcp', src: 'any', dst: '192.168.20.50', port: 443 }];
    const t2 = b.build();
    expect(browse(t2, id(t2, 'PC-A1'), 'http://192.168.20.50').ok).toBe(true);
    const r = browse(t2, id(t2, 'PC-A1'), 'https://192.168.20.50');
    expect(code(r)).toBe('acl-deny');
    expect(browse(t2, id(t2, 'PC-A1'), 'http://192.168.20.50:8080').summary).toMatch(/recusada/);
  });
  it('politica padrao deny', () => {
    const t = twoVlans();
    dev(t, 'R1').aclDefault = 'deny';
    dev(t, 'R1').acl = [{ action: 'permit', proto: 'icmp', src: '192.168.10.0/24', dst: '192.168.20.0/24' }];
    // o ping vai, mas a resposta (20 -> 10) cai na politica padrao
    const r = p(t, 'PC-A1', '192.168.20.11');
    expect(r.ok).toBe(false);
    expect(r.summary).toMatch(/política padrão/);
  });
});

describe('borda com NAT e DHCP', () => {
  it('clientes DHCP recebem IP e navegam', () => {
    const t = edgeNatDhcp();
    const ctx = buildContext(t);
    const ips = ['PC1', 'PC2', 'NB1'].map((n) => primaryIp(t, id(t, n), ctx));
    expect(ips).toEqual(['192.168.1.100', '192.168.1.101', '192.168.1.102']);
    const v = ifaceViews(t, id(t, 'PC1'), ctx)[0]!;
    expect(v.dhcp).toBe(true);
    expect(v.lease).toBe(true);
    const r = testInternet(t, id(t, 'PC1'));
    expect(r.ok).toBe(true);
    expect(r.steps.some((s) => /NAT traduz a origem 192\.168\.1\.100/.test(s.text))).toBe(true);
  });
  it('navegar ate um site e nslookup', () => {
    const t = edgeNatDhcp();
    const b = browse(t, id(t, 'PC1'), 'http://exemplo.sim');
    expect(b.ok).toBe(true);
    expect(b.resolved).toBe('198.51.100.10');
    expect(browse(t, id(t, 'PC1'), 'https://busca.sim').ok).toBe(true);
    expect(nslookup(t, id(t, 'PC1'), 'noticias.sim').resolved).toBe('198.51.100.30');
    const nx = nslookup(t, id(t, 'PC1'), 'naoexiste.sim');
    expect(nx.ok).toBe(false);
    expect(nx.summary).toMatch(/NXDOMAIN/);
    expect(browse(t, id(t, 'PC1'), 'workverse.sim').summary).toMatch(/recusada/); // so 443
    expect(browse(t, id(t, 'PC1'), 'https://workverse.sim').ok).toBe(true);
  });
  it('traceroute lista os saltos', () => {
    const t = edgeNatDhcp();
    const r = traceroute(t, id(t, 'PC1'), '8.8.8.8');
    expect(r.ok).toBe(true);
    expect(r.hops.map((h) => h.device)).toEqual(['R1', 'Internet']);
    expect(r.hops[0]!.ip).toBe('192.168.1.1');
  });
  it('sem NAT a Internet descarta o privado', () => {
    const t = edgeNatDhcp();
    dev(t, 'R1').natEnabled = false;
    const r = p(t, 'PC1', '8.8.8.8');
    expect(code(r)).toBe('private-dropped');
    expect(r.summary).toMatch(/NAT/);
  });
  it('NAT sem papel inside/outside nao traduz', () => {
    const t = edgeNatDhcp();
    delete iface(t, 'R1', 'Gig0/0').nat;
    expect(code(p(t, 'PC1', '8.8.8.8'))).toBe('private-dropped');
  });
  it('sem rota padrao: sem rota para 8.8.8.8 no roteador', () => {
    const t = edgeNatDhcp();
    dev(t, 'R1').routes = [];
    const r = p(t, 'PC1', '8.8.8.8');
    expect(code(r)).toBe('no-route');
    expect(r.summary).toBe('Falhou no R1: sem rota para 8.8.8.8.');
  });
  it('rota padrao com proximo salto errado fica inativa', () => {
    const t = edgeNatDhcp();
    dev(t, 'R1').routes = [{ net: '0.0.0.0', mask: '0.0.0.0', via: '198.18.0.1' }];
    const r = p(t, 'PC1', '8.8.8.8');
    expect(code(r)).toBe('no-route');
    expect(r.summary).toMatch(/inativa/);
    const rt = routeTable(buildContext(t), dev(t, 'R1'));
    expect(rt.some((e) => e.kind === 'S' && !e.active)).toBe(true);
  });
  it('rota padrao apontando para IP que nao responde', () => {
    const t = edgeNatDhcp();
    dev(t, 'R1').routes = [{ net: '0.0.0.0', mask: '0.0.0.0', via: '203.0.113.3' }];
    expect(code(p(t, 'PC1', '8.8.8.8'))).toBe('no-arp');
  });
  it('enlace de borda solto', () => {
    const t = edgeNatDhcp();
    cableOf(t, 'Internet').up = false;
    const r = testInternet(t, id(t, 'PC1'));
    expect(r.ok).toBe(false);
    expect(r.failure?.code).toBe('cable-down');
    expect(r.summary).toMatch(/Não alcança a Internet/);
  });
  it('ACL de saida bloqueia ICMP mas a navegacao continua', () => {
    const t = edgeNatDhcp();
    dev(t, 'R1').acl = [{ action: 'deny', proto: 'icmp', src: '192.168.1.0/24', dst: 'any' }];
    expect(code(p(t, 'PC1', '8.8.8.8'))).toBe('acl-deny');
    expect(browse(t, id(t, 'PC1'), 'http://exemplo.sim').ok).toBe(true); // DNS (udp) e HTTP (tcp) nao sao ICMP
  });
  it('DNS: sem servidor, servidor inalcancavel e bloqueado', () => {
    const t = edgeNatDhcp();
    dev(t, 'R1').dhcp![0]!.dns = undefined;
    delete dev(t, 'R1').dhcp![0]!.dns;
    const r = testInternet(t, id(t, 'PC1'));
    expect(r.ok).toBe(false);
    expect(r.summary).toMatch(/DNS/);
    expect(r.summary).toMatch(/não tem servidor DNS/);
    const t2 = edgeNatDhcp();
    dev(t2, 'R1').dhcp![0]!.dns = '9.9.9.9';
    expect(nslookup(t2, id(t2, 'PC1'), 'exemplo.sim').ok).toBe(false);
    const t3 = edgeNatDhcp();
    dev(t3, 'R1').acl = [{ action: 'deny', proto: 'udp', src: 'any', dst: 'any', port: 53 }];
    const r3 = testInternet(t3, id(t3, 'PC1'));
    expect(r3.ok).toBe(false);
    expect(r3.summary).toMatch(/IP funciona, mas o DNS falha/);
    expect(ping(t3, id(t3, 'PC1'), '8.8.8.8').ok).toBe(true);
  });
  it('DHCP: pool vazio, fora da rede, esgotado, sem servidor', () => {
    const t = edgeNatDhcp();
    dev(t, 'R1').dhcp = [];
    let r = testInternet(t, id(t, 'PC1'));
    expect(code(r)).toBe('dhcp');
    expect(r.summary).toMatch(/nenhum servidor DHCP/);

    const t2 = edgeNatDhcp();
    dev(t2, 'R1').dhcp![0]!.start = '10.9.9.1';
    dev(t2, 'R1').dhcp![0]!.end = '10.9.9.9';
    r = testInternet(t2, id(t2, 'PC1'));
    expect(code(r)).toBe('dhcp');
    expect(r.summary).toMatch(/fora da rede/);

    const t3 = edgeNatDhcp();
    dev(t3, 'R1').dhcp![0]!.end = '192.168.1.101';
    const ctx = buildContext(t3);
    expect(primaryIp(t3, id(t3, 'PC1'), ctx)).toBe('192.168.1.100');
    expect(primaryIp(t3, id(t3, 'PC2'), ctx)).toBe('192.168.1.101');
    expect(primaryIp(t3, id(t3, 'NB1'), ctx)).toBeUndefined();
    expect(ifaceViews(t3, id(t3, 'NB1'), ctx)[0]!.note).toMatch(/esgotado/);

    const t4 = edgeNatDhcp();
    cableOf(t4, 'R1', 'Gig0/1').up = false;
    expect(code(testInternet(t4, id(t4, 'PC1')))).toBe('dhcp');
  });
  it('DHCP: pool sobre IP fixo existente pula o endereco', () => {
    const t = edgeNatDhcp();
    const b = new TopoBuilder();
    b.topo = t;
    const s = b.add('server', 'SRV', 0, 0, { gateway: '192.168.1.1' });
    b.ip(s, 'Gig0/0', '192.168.1.100').cable(s, 'Gig0/0', dev(t, 'SW1'), 'Gig0/5');
    const t2 = b.build();
    expect(primaryIp(t2, id(t2, 'PC1'))).toBe('192.168.1.101');
  });
  it('DHCP sobre VLAN errada nao concede', () => {
    const t = edgeNatDhcp();
    iface(t, 'SW1', 'Gig0/1').vlan = 99;
    expect(primaryIp(t, id(t, 'PC1'))).toBeUndefined();
  });
  it('servidor DNS local e hosts publicos', () => {
    const t = edgeNatDhcp();
    const b = new TopoBuilder();
    b.topo = t;
    const s = b.add('server', 'DNS-LOCAL', 0, 0, { gateway: '192.168.1.1', dnsRecords: { 'intranet.sim': '192.168.1.200' } });
    b.ip(s, 'Gig0/0', '192.168.1.5').cable(s, 'Gig0/0', dev(t, 'SW1'), 'Gig0/6');
    const t2 = b.build();
    dev(t2, 'R1').dhcp![0]!.dns = '192.168.1.5';
    expect(nslookup(t2, id(t2, 'PC1'), 'intranet.sim').resolved).toBe('192.168.1.200');
    expect(nslookup(t2, id(t2, 'PC1'), 'exemplo.sim').summary).toMatch(/NXDOMAIN/);
  });
  it('roteador origina ping usando seu IP de saida', () => {
    const t = edgeNatDhcp();
    const r = p(t, 'R1', '8.8.8.8');
    expect(r.ok).toBe(true);
    const r2 = p(t, 'R1', '192.168.1.100');
    expect(r2.ok).toBe(true);
    dev(t, 'R1').routes = [];
    expect(code(p(t, 'R1', '172.16.0.1'))).toBe('no-route');
  });
  it('PC pinga o roteador (gateway) e o IP externo do roteador', () => {
    const t = edgeNatDhcp();
    expect(p(t, 'PC1', '192.168.1.1').ok).toBe(true);
    expect(p(t, 'PC1', '203.0.113.2').ok).toBe(true);
  });
  it('IP publico inexistente nao responde', () => {
    const r = p(edgeNatDhcp(), 'PC1', '9.9.9.9');
    expect(r.ok).toBe(false);
    expect(r.summary).toMatch(/Internet/);
  });
  it('firewall com ACL entre o roteador e a Internet', () => {
    const t = edgeNatDhcp();
    const b = new TopoBuilder();
    b.topo = t;
    const fw = b.add('firewall', 'FW1', 0, 0);
    // R1 --- FW1 --- Internet
    t.cables = t.cables.filter((c) => c.a.dev !== id(t, 'Internet'));
    b.ip(fw, 'Gig0/0', '198.18.0.2', '255.255.255.252').ip(fw, 'Gig0/1', '203.0.113.1', '255.255.255.252');
    // reaproveita: FW em linha com enderecos novos
    iface(t, 'Internet').ip = '198.18.0.1';
    iface(t, 'Internet').mask = '255.255.255.252';
    iface(t, 'R1', 'Gig0/0').ip = '203.0.113.2';
    fw.routes = [{ net: '0.0.0.0', mask: '0.0.0.0', via: '198.18.0.1' }];
    dev(t, 'Internet').routes = [{ net: '203.0.113.0', mask: '255.255.255.252', via: '198.18.0.2' }];
    fw.acl = [{ action: 'deny', proto: 'ip', src: 'any', dst: '8.8.8.8' }];
    b.cable(fw, 'Gig0/1', dev(t, 'R1'), 'Gig0/0').cable(fw, 'Gig0/0', dev(t, 'Internet'), 'Gig0/0');
    const t2 = b.build();
    const r = p(t2, 'PC1', '8.8.8.8');
    expect(code(r)).toBe('acl-deny');
    expect(r.summary).toMatch(/FW1/);
    expect(p(t2, 'PC1', '1.1.1.1').ok).toBe(true);
  });
});

describe('laco de roteamento', () => {
  it('TTL expira', () => {
    const b = new TopoBuilder();
    const pc = b.add('pc', 'PC', 0, 0, { gateway: '10.0.0.1' });
    const r1 = b.add('router', 'RA');
    const r2 = b.add('router', 'RB');
    b.ip(pc, 'Gig0/0', '10.0.0.10').ip(r1, 'Gig0/0', '10.0.0.1').ip(r1, 'Gig0/1', '10.1.0.1').ip(r2, 'Gig0/0', '10.1.0.2');
    r1.routes = [{ net: '0.0.0.0', mask: '0.0.0.0', via: '10.1.0.2' }];
    r2.routes = [{ net: '0.0.0.0', mask: '0.0.0.0', via: '10.1.0.1' }];
    b.cable(pc, 'Gig0/0', r1, 'Gig0/0').cable(r1, 'Gig0/1', r2, 'Gig0/0');
    const t = b.build();
    const r = ping(t, pc.id, '172.20.0.5');
    expect(r.ok).toBe(false);
    expect(['ttl']).toContain(code(r));
  });
  it('duas redes via rotas estaticas em dois roteadores', () => {
    const b = new TopoBuilder();
    const a = b.add('pc', 'A', 0, 0, { gateway: '10.0.0.1' });
    const c = b.add('pc', 'B', 0, 0, { gateway: '10.2.0.1' });
    const r1 = b.add('router', 'R1');
    const r2 = b.add('router', 'R2');
    b.ip(a, 'Gig0/0', '10.0.0.10').ip(c, 'Gig0/0', '10.2.0.10');
    b.ip(r1, 'Gig0/0', '10.0.0.1').ip(r1, 'Gig0/1', '10.1.0.1').ip(r2, 'Gig0/0', '10.1.0.2').ip(r2, 'Gig0/1', '10.2.0.1');
    b.cable(a, 'Gig0/0', r1, 'Gig0/0').cable(r1, 'Gig0/1', r2, 'Gig0/0').cable(r2, 'Gig0/1', c, 'Gig0/0');
    const t = b.build();
    expect(ping(t, a.id, '10.2.0.10').summary).toMatch(/sem rota para 10\.2\.0\.10/);
    dev(t, 'R1').routes = [{ net: '10.2.0.0', mask: '255.255.255.0', via: '10.1.0.2' }];
    // volta tambem precisa de rota
    const half = ping(t, a.id, '10.2.0.10');
    expect(half.ok).toBe(false);
    expect(half.summary).toMatch(/resposta não voltou/);
    dev(t, 'R2').routes = [{ net: '10.0.0.0', mask: '255.255.255.0', via: '10.1.0.1' }];
    const ok = ping(t, a.id, '10.2.0.10');
    expect(ok.ok).toBe(true);
    expect(traceroute(t, a.id, '10.2.0.10').hops.map((h) => h.device)).toEqual(['R1', 'R2', 'B']);
  });
  it('maior prefixo vence', () => {
    const b = new TopoBuilder();
    const a = b.add('pc', 'A', 0, 0, { gateway: '10.0.0.1' });
    const r1 = b.add('router', 'R1');
    const r2 = b.add('router', 'R2');
    const r3 = b.add('router', 'R3');
    const h = b.add('pc', 'H', 0, 0, { gateway: '10.3.0.1' });
    b.ip(a, 'Gig0/0', '10.0.0.10').ip(r1, 'Gig0/0', '10.0.0.1').ip(r1, 'Gig0/1', '10.1.0.1').ip(r1, 'Gig0/2', '10.9.0.1');
    b.ip(r2, 'Gig0/0', '10.1.0.2').ip(r2, 'Gig0/1', '10.3.0.1').ip(r3, 'Gig0/0', '10.9.0.2');
    b.ip(h, 'Gig0/0', '10.3.0.10');
    b.cable(a, 'Gig0/0', r1, 'Gig0/0').cable(r1, 'Gig0/1', r2, 'Gig0/0').cable(r1, 'Gig0/2', r3, 'Gig0/0').cable(r2, 'Gig0/1', h, 'Gig0/0');
    r1.routes = [
      { net: '0.0.0.0', mask: '0.0.0.0', via: '10.9.0.2' },
      { net: '10.3.0.0', mask: '255.255.255.0', via: '10.1.0.2' },
    ];
    r2.routes = [{ net: '10.0.0.0', mask: '255.255.255.0', via: '10.1.0.1' }];
    const t = b.build();
    expect(traceroute(t, a.id, '10.3.0.10').hops.map((x) => x.device)).toEqual(['R1', 'R2', 'H']);
  });
});

describe('consultas e vlanTable', () => {
  it('vlanTable agrupa portas', () => {
    const t = twoVlans();
    const v = vlanTable(t, id(t, 'SW1'));
    expect(v.find((x) => x.vlan === 10)!.ports).toEqual(['Gig0/1', 'Gig0/2']);
    expect(v.find((x) => x.vlan === 20)!.ports).toContain('Gig0/3');
    expect(v.find((x) => x.vlan === 1)!.ports).not.toContain('Gig0/24');
  });
  it('ifaceViews mostra motivo do link down', () => {
    const t = lanSimple();
    cableOf(t, 'PC1').up = false;
    const v = ifaceViews(t, id(t, 'PC1'))[0]!;
    expect(v.up).toBe(false);
    expect(v.reason).toMatch(/cabo solto/);
  });
});

describe('validacao estrita', () => {
  const base = () => clone(lanSimple());
  it('aceita topologias padrao e normaliza mascara /24', () => {
    for (const t of [lanSimple(), twoVlans(), edgeNatDhcp()]) expect(validateTopology(t).ok).toBe(true);
    const t = base();
    iface(t, 'PC1').mask = '/24';
    const v = validateTopology(t);
    expect(v.ok && v.value.devices[1]!.ifaces[0]!.mask).toBe('255.255.255.0');
  });
  it('rejeita IPs, mascaras e VLANs ruins', () => {
    const cases: Array<(t: Topology) => void> = [
      (t) => (iface(t, 'PC1').ip = '300.1.1.1'),
      (t) => (iface(t, 'PC1').mask = '255.0.255.0'),
      (t) => (dev(t, 'PC1').gateway = 'abc'),
      (t) => (dev(t, 'PC1').dns = '1.2.3'),
      (t) => (iface(t, 'SW1', 'Gig0/1').vlan = 5000),
      (t) => (iface(t, 'SW1', 'Gig0/1').vlan = 0),
      (t) => (iface(t, 'SW1', 'Gig0/1').allowed = [1, 4095]),
      (t) => (iface(t, 'SW1', 'Gig0/1').mode = 'bogus' as never),
      (t) => (iface(t, 'PC1').mode = 'trunk'),
      (t) => (dev(t, 'PC1').kind = 'bogus' as never),
      (t) => (dev(t, 'PC1').x = Number.NaN),
      (t) => (dev(t, 'PC1').x = 1e9),
      (t) => (dev(t, 'PC1').routes = [{ net: '1.1.1.0', mask: '255.255.255.0', via: '1.1.1.1' }]),
      (t) => (dev(t, 'PC1').acl = [{ action: 'permit', proto: 'ip', src: 'any', dst: 'any' }]),
      (t) => (dev(t, 'PC1').natEnabled = true),
      (t) => (iface(t, 'SW1', 'Gig0/1').dhcp = true),
      (t) => (t.cables[0]!.b.iface = 'Gig0/99'),
      (t) => (t.cables[0]!.a.dev = t.cables[0]!.b.dev),
      (t) => t.cables.push({ ...t.cables[0]!, id: 'c99' }),
    ];
    cases.forEach((mut, k) => {
      const t = base();
      mut(t);
      const v = validateTopology(t);
      expect(v.ok, `caso ${k}`).toBe(false);
    });
  });
  it('nomes: controle, bidi, ZWSP, duplicados', () => {
    for (const bad of ['PC‮1', 'PC​1', 'PC\n1', 'PC\u0007', '', ' ', 'a'.repeat(40), 'x<y>', '../../etc']) {
      const t = base();
      dev(t, 'PC1').name = bad;
      expect(validateTopology(t).ok, JSON.stringify(bad)).toBe(false);
    }
    const t = base();
    dev(t, 'PC2').name = 'pc1';
    const v = validateTopology(t);
    expect(!v.ok && v.error).toMatch(/Já existe/);
  });
  it('limites de dispositivos e cabos', () => {
    const b = new TopoBuilder();
    for (let i = 0; i < LIMITS.devices; i++) b.add('pc', `P${i}`);
    expect(validateTopology(b.topo).ok).toBe(true);
    b.topo.devices.push({ ...b.topo.devices[0]!, id: 'dx', name: 'extra' });
    expect(validateTopology(b.topo).ok).toBe(false);
    const c = new TopoBuilder();
    const sw = c.add('switch', 'S1');
    const sw2 = c.add('switch', 'S2');
    c.cable(sw, 'Gig0/1', sw2, 'Gig0/1');
    const t = c.build();
    t.cables = Array.from({ length: LIMITS.cables + 1 }, (_, k) => ({ ...t.cables[0]!, id: `c${k + 5}` }));
    expect(validateTopology(t).ok).toBe(false);
  });
  it('descarta campos desconhecidos e entradas lixo', () => {
    const t = base() as unknown as Record<string, unknown>;
    (t.devices as Array<Record<string, unknown>>)[0]!.__proto__x = 'x';
    (t.devices as Array<Record<string, unknown>>)[0]!.evil = 'x';
    const v = validateTopology(t);
    expect(v.ok && 'evil' in v.value.devices[0]!).toBe(false);
    for (const junk of [null, 1, 'x', [], {}, { devices: 1, cables: [] }]) expect(validateTopology(junk).ok).toBe(false);
  });
  it('interface com cabo duplicado', () => {
    const t = base();
    t.cables.push({ id: 'c77', a: { dev: id(t, 'PC1'), iface: 'Gig0/0' }, b: { dev: id(t, 'SRV1'), iface: 'Gig0/1' }, up: true });
    expect(validateTopology(t).ok).toBe(false);
  });
});

describe('operacoes de edicao', () => {
  const must = (t: Topology, op: NetOp): Topology => {
    const r = applyOp(t, op);
    if (!r.ok) throw new Error(r.error);
    return r.topo;
  };
  it('montar uma rede do zero e fazer o ping falhar e depois funcionar', () => {
    let t = validateTopology({ devices: [], cables: [], seq: 0 }).ok ? ({ devices: [], cables: [], seq: 0 } as Topology) : lanSimple();
    t = must(t, { op: 'addDevice', kind: 'pc', name: 'A', x: 0, y: 0 });
    t = must(t, { op: 'addDevice', kind: 'router', name: 'R', x: 100, y: 0 });
    t = must(t, { op: 'addDevice', kind: 'pc', name: 'B', x: 200, y: 0 });
    const [a, r, c] = t.devices.map((d) => d.id) as [string, string, string];
    t = must(t, { op: 'addCable', a: { dev: a, iface: 'Gig0/0' }, b: { dev: r, iface: 'Gig0/0' } });
    t = must(t, { op: 'addCable', a: { dev: c, iface: 'Gig0/0' }, b: { dev: r, iface: 'Gig0/1' } });
    t = must(t, { op: 'setIface', id: a, iface: 'Gig0/0', patch: { ip: '10.0.0.2', mask: '/24' } });
    t = must(t, { op: 'setIface', id: c, iface: 'Gig0/0', patch: { ip: '10.0.1.2', mask: '255.255.255.0' } });
    t = must(t, { op: 'setIface', id: r, iface: 'Gig0/0', patch: { ip: '10.0.0.1', mask: '255.255.255.0' } });
    t = must(t, { op: 'setDevice', id: a, patch: { gateway: '10.0.0.1' } });
    t = must(t, { op: 'setDevice', id: c, patch: { gateway: '10.0.1.1' } });
    const before = ping(t, a, '10.0.1.2');
    expect(before.ok).toBe(false);
    t = must(t, { op: 'setIface', id: r, iface: 'Gig0/1', patch: { ip: '10.0.1.1', mask: '255.255.255.0' } });
    expect(ping(t, a, '10.0.1.2').ok).toBe(true);
  });
  it('nao altera a entrada e rejeita operacoes invalidas', () => {
    const t = lanSimple();
    const snap = JSON.stringify(t);
    expect(applyOp(t, { op: 'addDevice', kind: 'router', name: 'R', x: 1, y: 1 }).ok).toBe(true);
    expect(JSON.stringify(t)).toBe(snap);
    const bads: NetOp[] = [
      { op: 'addDevice', kind: 'bogus' as never, x: 0, y: 0 },
      { op: 'addDevice', kind: 'pc', name: 'PC1', x: 0, y: 0 },
      { op: 'removeDevice', id: 'nope' },
      { op: 'addCable', a: { dev: id(t, 'PC1'), iface: 'Gig0/0' }, b: { dev: id(t, 'SRV1'), iface: 'Gig0/1' } },
      { op: 'setIface', id: id(t, 'PC1'), iface: 'Gig0/0', patch: { ip: '1.2.3.999' } },
      { op: 'setIface', id: id(t, 'PC1'), iface: 'Gig0/0', patch: { evil: 1 } },
      { op: 'setDevice', id: id(t, 'PC1'), patch: { kind: 'router' } },
      { op: 'addRoute', id: id(t, 'PC1'), route: { net: '1.1.1.0', mask: '255.255.255.0', via: '1.1.1.1' } },
      { op: 'addSubif', id: id(t, 'PC1'), parent: 'Gig0/0', vlan: 10 },
      { op: 'bogus' } as never,
    ];
    for (const op of bads) expect(applyOp(t, op).ok, JSON.stringify(op)).toBe(false);
  });
  it('remover dispositivo apaga cabos; so uma nuvem Internet', () => {
    const t = edgeNatDhcp();
    const t2 = must(t, { op: 'removeDevice', id: id(t, 'SW1') });
    expect(t2.cables.length).toBe(1);
    expect(applyOp(t, { op: 'addDevice', kind: 'internet', x: 0, y: 0 }).ok).toBe(false);
  });
  it('ids de dispositivos e cabos nunca se repetem', () => {
    let t = lanSimple();
    t = must(t, { op: 'removeDevice', id: id(t, 'PC2') });
    t = must(t, { op: 'addDevice', kind: 'pc', x: 0, y: 0 });
    const ids = [...t.devices.map((d) => d.id), ...t.cables.map((c) => c.id)];
    expect(new Set(ids).size).toBe(ids.length);
  });
  it('rotas, ACL (inserir, mover, remover), DHCP e subinterfaces', () => {
    let t = edgeNatDhcp();
    const r = id(t, 'R1');
    t = must(t, { op: 'addRoute', id: r, route: { net: '172.16.0.0', mask: '/16', via: '192.168.1.50' } });
    expect(dev(t, 'R1').routes!.at(-1)!.mask).toBe('255.255.0.0');
    t = must(t, { op: 'removeRoute', id: r, index: 1 });
    t = must(t, { op: 'addAcl', id: r, rule: { action: 'deny', proto: 'icmp', src: 'any', dst: 'any' } });
    t = must(t, { op: 'addAcl', id: r, rule: { action: 'permit', proto: 'ip', src: 'any', dst: 'any' }, index: 0 });
    expect(dev(t, 'R1').acl![0]!.action).toBe('permit');
    t = must(t, { op: 'moveAcl', id: r, from: 0, to: 1 });
    expect(dev(t, 'R1').acl![0]!.action).toBe('deny');
    t = must(t, { op: 'removeAcl', id: r, index: 0 });
    expect(applyOp(t, { op: 'removeAcl', id: r, index: 9 }).ok).toBe(false);
    t = must(t, { op: 'removePool', id: r, index: 0 });
    t = must(t, { op: 'setPool', id: r, pool: { iface: 'Gig0/1', start: '192.168.1.50', end: '192.168.1.60' } });
    t = must(t, { op: 'addSubif', id: r, parent: 'Gig0/1', vlan: 30 });
    expect(dev(t, 'R1').ifaces.some((i) => i.name === 'Gig0/1.30')).toBe(true);
    t = must(t, { op: 'removeSubif', id: r, iface: 'Gig0/1.30' });
    expect(applyOp(t, { op: 'addAcl', id: r, rule: { action: 'permit', proto: 'icmp', src: 'any', dst: 'any', port: 9 } }).ok).toBe(false);
  });
  it('DHCP no cliente limpa IP estatico e vice-versa', () => {
    let t = lanSimple();
    const pc = id(t, 'PC1');
    t = must(t, { op: 'setIface', id: pc, iface: 'Gig0/0', patch: { dhcp: true } });
    expect(iface(t, 'PC1').ip).toBeUndefined();
    t = must(t, { op: 'setIface', id: pc, iface: 'Gig0/0', patch: { ip: '192.168.1.77', mask: '255.255.255.0' } });
    expect(iface(t, 'PC1').dhcp).toBeUndefined();
  });
  it('DNS local e hosts publicos', () => {
    let t = edgeNatDhcp();
    const net = id(t, 'Internet');
    t = must(t, { op: 'setPublicHost', id: net, host: { ip: '198.51.100.99', name: 'Novo', domains: ['novo.sim'], ports: [80] } });
    expect(browse(t, id(t, 'PC1'), 'http://novo.sim').ok).toBe(true);
    t = must(t, { op: 'removePublicHost', id: net, ip: '198.51.100.99' });
    expect(browse(t, id(t, 'PC1'), 'http://novo.sim').ok).toBe(false);
    expect(applyOp(t, { op: 'setPublicHost', id: net, host: { ip: '1.2.3.4', name: 'x', domains: ['sem ponto'] } }).ok).toBe(false);
  });
});

describe('topologia padrao a partir do inventario', () => {
  const stations = (): InvStation[] => {
    const out: InvStation[] = [];
    for (const [room, n] of [['office', 6], ['ti', 3], ['lounge', 2]] as const) {
      for (let k = 0; k < n; k++) out.push({ id: `${room}/f${k}`, kind: k === 0 && room === 'ti' ? 'command_desk' : 'computer', roomId: room, roomName: room, x: 2 + (k % 3) * 2, y: 3 + Math.floor(k / 3) * 2 });
    }
    return out;
  };
  it('gera PCs com IP do inventario, switch por sala, borda e internet', () => {
    const { topo, omitted } = defaultTopology(stations());
    expect(omitted).toBe(0);
    expect(topo.devices.filter((d) => d.kind === 'pc').length).toBe(11);
    expect(topo.devices.filter((d) => d.kind === 'switch').map((d) => d.name).sort()).toEqual(['SW-COP', 'SW-CORE', 'SW-ESC', 'SW-TI']);
    const esc = topo.devices.find((d) => d.name === 'PC-ESC-01')!;
    expect(esc.inventoryId).toBe('office/f0');
    expect(esc.ifaces[0]!.ip).toMatch(/^10\.\d+\.4\.\d+$/);
    expect(validateTopology(topo).ok).toBe(true);
  });
  it('PCs de salas diferentes se enxergam e navegam', () => {
    const { topo } = defaultTopology(stations());
    expect(ping(topo, id(topo, 'PC-ESC-01'), 'PC-ESC-02').ok).toBe(true);
    const cross = ping(topo, id(topo, 'PC-ESC-01'), 'PC-COP-01');
    expect(cross.ok).toBe(true);
    expect(cross.hops.map((h) => h.device)).toContain('R-BORDA');
    expect(testInternet(topo, id(topo, 'CMD-TI-01')).ok).toBe(true);
    expect(browse(topo, id(topo, 'PC-COP-02'), 'http://busca.sim').ok).toBe(true);
  });
  it('respeita o limite de dispositivos', () => {
    const many: InvStation[] = [];
    for (let k = 0; k < 150; k++) many.push({ id: `office/f${k}`, kind: 'computer', roomId: 'office', roomName: 'o', x: k % 20, y: Math.floor(k / 20) });
    const { topo, omitted } = defaultTopology(many);
    expect(topo.devices.length).toBeLessThanOrEqual(LIMITS.devices);
    expect(omitted).toBeGreaterThan(0);
    expect(validateTopology(topo).ok).toBe(true);
  });
  it('sem estacoes ainda gera borda e internet', () => {
    const { topo } = defaultTopology([]);
    expect(topo.devices.map((d) => d.name)).toEqual(['Internet', 'R-BORDA', 'SW-CORE']);
  });
  it('desempenho: 80 dispositivos, 100 testes rapidos', () => {
    const many: InvStation[] = [];
    for (let k = 0; k < 60; k++) many.push({ id: `office/f${k}`, kind: 'computer', roomId: k < 30 ? 'office' : 'lounge', roomName: 'o', x: k % 10, y: Math.floor(k / 10) });
    const { topo } = defaultTopology(many);
    const ctx = buildContext(topo);
    const t0 = Date.now();
    for (let k = 0; k < 100; k++) testInternet(topo, topo.devices.find((d) => d.kind === 'pc')!.id, ctx);
    expect(Date.now() - t0).toBeLessThan(3000);
  });
});
