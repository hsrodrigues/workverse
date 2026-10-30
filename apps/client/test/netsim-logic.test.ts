import { describe, expect, it } from 'vitest';
import { applyOp, edgeNatDhcp, lanSimple, twoVlans, type NetOp, type Topology } from '@workverse/shared';
import { DENIED, bounds, cableState, freeIface, runTerminal } from '../src/ui/netsim/netsimLogic';

const dev = (t: Topology, n: string) => t.devices.find((d) => d.name === n)!;
const term = (t: Topology, name: string, line: string, canEdit = true) => runTerminal(line, { topo: t, dev: dev(t, name), canEdit });
const text = (o: { lines: Array<{ text: string }> }) => o.lines.map((l) => l.text).join('\n');
/** Aplica as ops devolvidas ao terminal, como o servidor faria. */
function apply(t: Topology, ops: NetOp[] | undefined): Topology {
  let cur = t;
  for (const op of ops ?? []) {
    const r = applyOp(cur, op);
    if (!r.ok) throw new Error(r.error);
    cur = r.topo;
  }
  return cur;
}

describe('terminal simulado', () => {
  it('help lista os comandos e comando desconhecido orienta', () => {
    expect(text(term(lanSimple(), 'PC1', 'help'))).toMatch(/ping <ip\|nome>/);
    const o = term(lanSimple(), 'PC1', 'rm -rf /');
    expect(o.lines[0]!.kind).toBe('err');
    expect(text(o)).toMatch(/Digite help/);
    expect(term(lanSimple(), 'PC1', '   ').lines).toEqual([]);
    expect(term(lanSimple(), 'PC1', 'clear').clear).toBe(true);
  });

  it('ip addr / ifconfig mostram interface, estado e motivo quando está down', () => {
    const t = lanSimple();
    expect(text(term(t, 'PC1', 'ip addr'))).toMatch(/Gig0\/0\s+UP\s+192\.168\.1\.10\/24/);
    t.cables[0]!.up = false;
    const o = term(t, 'PC1', 'ifconfig');
    expect(text(o)).toMatch(/DOWN/);
    expect(text(o)).toMatch(/cabo solto/);
  });

  it('ping e traceroute com sucesso e falha explicada', () => {
    const t = edgeNatDhcp();
    expect(text(term(t, 'PC1', 'ping 8.8.8.8'))).toMatch(/4 enviados, 4 recebidos/);
    expect(text(term(t, 'PC1', 'traceroute 8.8.8.8'))).toMatch(/R1[\s\S]*Internet[\s\S]*Destino alcançado/);
    t.devices.find((d) => d.name === 'R1')!.routes = [];
    const f = term(t, 'PC1', 'ping 8.8.8.8');
    expect(text(f)).toMatch(/Falhou no R1: sem rota para 8\.8\.8\.8/);
    expect(text(f)).toMatch(/100% de perda/);
    expect(text(term(t, 'PC1', 'ping'))).toMatch(/uso: ping/);
    expect(text(term(t, 'SW1', 'ping 1.1.1.1'))).toMatch(/não gera pacotes/);
  });

  it('nslookup, curl/navegar e testar', () => {
    const t = edgeNatDhcp();
    expect(text(term(t, 'PC1', 'nslookup exemplo.sim'))).toMatch(/198\.51\.100\.10/);
    expect(text(term(t, 'PC1', 'nslookup naoexiste.sim'))).toMatch(/NXDOMAIN/);
    expect(text(term(t, 'PC1', 'curl http://exemplo.sim'))).toMatch(/200 OK/);
    expect(text(term(t, 'PC1', 'navegar exemplo.sim'))).toMatch(/200 OK/);
    expect(text(term(t, 'PC1', 'testar'))).toMatch(/Tudo certo/);
  });

  it('show ip route e show vlan', () => {
    const t = twoVlans();
    expect(text(term(t, 'R1', 'show ip route'))).toMatch(/C\s+192\.168\.10\.0\/24 is directly connected, Gig0\/0\.10/);
    expect(text(term(t, 'SW1', 'show vlan'))).toMatch(/10\s+Gig0\/1, Gig0\/2/);
    expect(text(term(t, 'PC-A1', 'ip route'))).toMatch(/default via 192\.168\.10\.1/);
    expect(text(term(t, 'PC-A1', 'show vlan'))).toMatch(/só funciona em switch/);
  });

  it('comandos de edição devolvem ops válidas; o serviço deixa a rede funcionar', () => {
    let t = lanSimple();
    // PC1 sem gateway não alcança fora; configura rota e gateway pelo terminal
    const o = term(t, 'PC1', 'ip addr add 192.168.1.50/24 dev Gig0/0');
    t = apply(t, o.ops);
    expect(dev(t, 'PC1').ifaces[0]!.ip).toBe('192.168.1.50');
    t = apply(t, term(t, 'PC1', 'gateway 192.168.1.1').ops);
    expect(dev(t, 'PC1').gateway).toBe('192.168.1.1');
    t = apply(t, term(t, 'PC1', 'dhcp on').ops);
    expect(dev(t, 'PC1').ifaces[0]!.dhcp).toBe(true);
    t = apply(t, term(t, 'PC1', 'dhcp off').ops);
    expect(dev(t, 'PC1').ifaces[0]!.dhcp).toBeUndefined();
    t = apply(t, term(t, 'SW1', 'vlan Gig0/2 30').ops);
    expect(dev(t, 'SW1').ifaces.find((i) => i.name === 'Gig0/2')).toMatchObject({ mode: 'access', vlan: 30 });
    expect(term(t, 'PC1', 'ping 192.168.1.11').lines.some((l) => /100% de perda/.test(l.text))).toBe(true);
    t = apply(t, term(t, 'SW1', 'trunk Gig0/3').ops);
    t = apply(t, term(t, 'SW1', 'shutdown Gig0/4').ops);
    expect(dev(t, 'SW1').ifaces.find((i) => i.name === 'Gig0/4')!.shutdown).toBe(true);
    t = apply(t, term(t, 'SW1', 'no shutdown Gig0/4').ops);
    expect(dev(t, 'SW1').ifaces.find((i) => i.name === 'Gig0/4')!.shutdown).toBeUndefined();
  });

  it('rotas: ip route add/del e rota padrão em host', () => {
    let t = edgeNatDhcp();
    t = apply(t, term(t, 'R1', 'ip route add 10.9.0.0/16 via 192.168.1.50').ops);
    expect(dev(t, 'R1').routes!.some((r) => r.net === '10.9.0.0' && r.mask === '255.255.0.0')).toBe(true);
    t = apply(t, term(t, 'R1', 'ip route del 10.9.0.0/16').ops);
    expect(dev(t, 'R1').routes).toHaveLength(1);
    expect(text(term(t, 'R1', 'ip route del 10.9.0.0/16'))).toMatch(/não encontrada/);
    t = apply(t, term(t, 'PC1', 'ip route add default via 192.168.1.1').ops);
    expect(dev(t, 'PC1').gateway).toBe('192.168.1.1');
    expect(text(term(t, 'PC1', 'ip route add 10.0.0.0/8 via 1.1.1.1'))).toMatch(/hosts só têm rota padrão/);
    t = apply(t, term(t, 'R1', 'nat off').ops);
    expect(dev(t, 'R1').natEnabled).toBeUndefined();
    t = apply(t, term(t, 'R1', 'nat inside Gig0/2').ops);
    expect(dev(t, 'R1').ifaces.find((i) => i.name === 'Gig0/2')!.nat).toBe('inside');
  });

  it('modo leitura: comandos que alteram são negados e não geram ops', () => {
    const t = lanSimple();
    for (const c of ['ip addr add 10.0.0.1/24', 'gateway 1.2.3.4', 'dns 8.8.8.8', 'dhcp on', 'ifconfig Gig0/0 10.0.0.9']) {
      const o = term(t, 'PC1', c, false);
      expect(o.ops, c).toBeUndefined();
      expect(text(o), c).toBe(DENIED);
    }
    expect(text(term(t, 'SW1', 'vlan Gig0/1 5', false))).toBe(DENIED);
    // leitura e testes continuam valendo
    expect(text(term(t, 'PC1', 'ping 192.168.1.11', false))).toMatch(/recebidos/);
  });

  it('entradas inválidas viram mensagem de uso, nunca ops', () => {
    const t = lanSimple();
    for (const c of ['ip addr add 999.1.1.1/24', 'ip addr add 10.0.0.1/40', 'ifconfig eth9 1.1.1.1', 'gateway abc', 'dns', 'vlan Gig0/1 5000', 'vlan Gig0/99 5', 'ip route add 1.1.1.0/24 via x', 'nat on']) {
      const o = term(t, c.startsWith('vlan') ? 'SW1' : 'PC1', c);
      expect(o.ops, c).toBeUndefined();
      expect(o.lines[0]!.kind, c).toBe('err');
    }
  });
});

describe('geometria e cabos', () => {
  it('freeIface escolhe a primeira porta sem cabo', () => {
    const t = lanSimple();
    const sw = dev(t, 'SW1');
    expect(freeIface(t, sw.id)).toBe('Gig0/4');
    expect(freeIface(t, dev(t, 'PC1').id)).toBeNull();
  });
  it('bounds cobre todos os dispositivos e cableState reflete cabo solto', () => {
    const t = twoVlans();
    const b = bounds(t);
    for (const d of t.devices) {
      expect(d.x).toBeGreaterThanOrEqual(b.x);
      expect(d.x).toBeLessThanOrEqual(b.x + b.w);
    }
    expect(cableState(t, t.cables[0]!.id).up).toBe(true);
    t.cables[0]!.up = false;
    expect(cableState(t, t.cables[0]!.id)).toMatchObject({ up: false, reason: 'cabo solto' });
    t.cables[0]!.up = true;
    dev(t, 'R1').off = true;
    expect(cableState(t, t.cables[0]!.id).reason).toBe('dispositivo desligado');
    expect(bounds({ devices: [], cables: [], seq: 0 }).w).toBeGreaterThan(0);
  });
});
