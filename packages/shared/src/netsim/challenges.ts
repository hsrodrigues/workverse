import { browse, buildContext, nslookup, ping, testInternet } from './engine';
import { TopoBuilder } from './templates';
import type { Device, SimResult, Topology } from './types';

/**
 * Desafios "Conserte a rede" (docs/netsim.md). Cada desafio traz uma topologia com FALHAS PLANTADAS, objetivos verificaveis pelo
 * proprio motor, dicas progressivas e pontuacao. Tudo puro e deterministico; a solucao de referencia fica em
 * `challengeSolutions.ts` (so os testes a usam) e prova que cada desafio e resolvivel.
 */

export type Difficulty = 'facil' | 'medio' | 'dificil';
export const DIFFICULTY_LABEL: Record<Difficulty, string> = { facil: 'Fácil', medio: 'Médio', dificil: 'Difícil' };

export type ObjectiveAction = 'ping' | 'browse' | 'internet' | 'nslookup';
export interface Objective {
  id: string;
  /** Texto mostrado ao jogador. */
  text: string;
  action: ObjectiveAction;
  /** NOME do dispositivo de origem. */
  src: string;
  target?: string;
  /** true: o teste precisa funcionar. false: o acesso precisa estar BLOQUEADO. */
  expect: boolean;
  /** Exige que a simulacao nao tenha nenhum aviso (ex.: IP duplicado). */
  noWarn?: boolean;
}

export interface Challenge {
  id: string;
  title: string;
  story: string;
  difficulty: Difficulty;
  /** Tempo de referencia (segundos) para o bonus de tempo. */
  parSec: number;
  objectives: Objective[];
  /** 3 dicas progressivas (cada uma custa pontos, ver HINT_COST). */
  hints: [string, string, string];
  build: () => Topology;
}

// ---------------------------------------------------------------- pontuacao

export const DIFFICULTY_BASE: Record<Difficulty, number> = { facil: 40, medio: 60, dificil: 80 };
export const HINT_COST: readonly [number, number, number] = [5, 10, 15];
export const FAIL_COST = 2;
export const FAIL_COST_MAX = 10;
export const TIME_BONUS_MAX = 20;
export const MIN_SCORE = 10;
export const MAX_HINTS = 3;

export interface ScoreInput {
  difficulty: Difficulty;
  hints: number;
  failedChecks: number;
  elapsedSec: number;
  parSec: number;
}
export interface ScoreBreakdown {
  base: number;
  hintPenalty: number;
  failPenalty: number;
  timeBonus: number;
  score: number;
}

/** Base por dificuldade, menos dicas e verificacoes erradas, mais bonus de tempo (cheio ate o tempo de referencia, zero a partir de 3x). */
export function scoreChallenge(i: ScoreInput): ScoreBreakdown {
  const base = DIFFICULTY_BASE[i.difficulty];
  const hints = Math.max(0, Math.min(MAX_HINTS, Math.floor(i.hints)));
  const hintPenalty = HINT_COST.slice(0, hints).reduce((a, b) => a + b, 0);
  const failPenalty = Math.min(FAIL_COST_MAX, Math.max(0, Math.floor(i.failedChecks)) * FAIL_COST);
  const par = Math.max(1, i.parSec);
  const t = Math.max(0, i.elapsedSec);
  const timeBonus = t <= par ? TIME_BONUS_MAX : t >= par * 3 ? 0 : Math.round((TIME_BONUS_MAX * (par * 3 - t)) / (par * 2));
  const score = Math.max(MIN_SCORE, Math.min(100, base + timeBonus - hintPenalty - failPenalty));
  return { base, hintPenalty, failPenalty, timeBonus, score };
}

// ---------------------------------------------------------------- objetivos

export interface ObjectiveResult {
  id: string;
  ok: boolean;
  /** Por que nao passou (resumo curto do motor). */
  detail: string;
}

/** Roda um objetivo no motor. Dispositivo removido ou renomeado nunca satisfaz o objetivo. */
export function evaluateObjective(topo: Topology, o: Objective, ctx = buildContext(topo)): ObjectiveResult {
  const src: Device | undefined = topo.devices.find((d) => d.name === o.src);
  if (!src) return { id: o.id, ok: false, detail: `O dispositivo ${o.src} não existe mais na rede.` };
  let r: SimResult;
  const t = o.target ?? '';
  if (o.action === 'internet') r = testInternet(topo, src.id, ctx);
  else if (o.action === 'ping') r = ping(topo, src.id, t, ctx);
  else if (o.action === 'browse') r = browse(topo, src.id, t, ctx);
  else r = nslookup(topo, src.id, t, ctx);
  const warned = !!o.noWarn && r.steps.some((s) => s.kind === 'warn');
  const ok = r.ok === o.expect && !warned;
  let detail = '';
  if (!ok) {
    if (warned) detail = r.steps.find((s) => s.kind === 'warn')?.text ?? 'A simulação gerou um aviso.';
    else if (o.expect) detail = r.summary;
    else detail = 'O acesso ainda está liberado, mas deveria estar bloqueado.';
  }
  return { id: o.id, ok, detail };
}

export function evaluateObjectives(topo: Topology, ch: Pick<Challenge, 'objectives'>): ObjectiveResult[] {
  const ctx = buildContext(topo);
  return ch.objectives.map((o) => evaluateObjective(topo, o, ctx));
}

export const allPassed = (rs: readonly ObjectiveResult[]): boolean => rs.length > 0 && rs.every((r) => r.ok);

// ---------------------------------------------------------------- construcao das topologias

const DEFAULT_ROUTE = { net: '0.0.0.0', mask: '0.0.0.0', via: '203.0.113.1' };

interface EdgeOpts {
  nat?: boolean;
  route?: boolean;
  insideRole?: boolean;
}

/** Internet + roteador de borda R1 (Gig0/0 externo 203.0.113.2/30). `Gig0/1` e a porta para a LAN. */
function edge(b: TopoBuilder, o: EdgeOpts = {}) {
  const { nat = true, route = true } = o;
  const net = b.add('internet', 'Internet', 300, 20);
  const r = b.add('router', 'R1', 300, 110, nat ? { natEnabled: true } : {});
  b.ip(net, 'Gig0/0', '203.0.113.1', '255.255.255.252');
  b.ip(r, 'Gig0/0', '203.0.113.2', '255.255.255.252');
  b.iface(r, 'Gig0/0').nat = 'outside';
  if (route) r.routes = [{ ...DEFAULT_ROUTE }];
  b.cable(net, 'Gig0/0', r, 'Gig0/0');
  return { net, r };
}

/** Borda + LAN unica 192.168.1.0/24 (R1 Gig0/1 = 192.168.1.1) com o switch SW1 (uplink na porta 24). */
function lanSite(b: TopoBuilder, o: EdgeOpts = {}) {
  const e = edge(b, o);
  const sw = b.add('switch', 'SW1', 300, 210);
  b.ip(e.r, 'Gig0/1', '192.168.1.1');
  if (o.insideRole !== false) b.iface(e.r, 'Gig0/1').nat = 'inside';
  b.cable(e.r, 'Gig0/1', sw, 'Gig0/24');
  return { ...e, sw };
}

/** Host com IP fixo na LAN 192.168.1.0/24. */
function lanHost(b: TopoBuilder, kind: 'pc' | 'laptop' | 'server' | 'printer', name: string, ip: string, sw: Device, port: string, x: number, y = 330, gw: string | null = '192.168.1.1', dns: string | null = '8.8.8.8') {
  const d = b.add(kind, name, x, y, { ...(gw && kind !== 'printer' ? { gateway: gw } : {}), ...(dns && kind !== 'printer' ? { dns } : {}) });
  b.ip(d, 'Gig0/0', ip);
  b.cable(d, 'Gig0/0', sw, port);
  return d;
}

/** Borda + switch com router-on-a-stick: VLAN 10 (192.168.10.0/24) e 20 (192.168.20.0/24) pela porta 24 (trunk). */
function vlanSite(b: TopoBuilder, o: { allowed?: number[]; withServers?: boolean } = {}) {
  const e = edge(b);
  const sw = b.add('switch', 'SW1', 300, 210);
  b.cable(e.r, 'Gig0/1', sw, 'Gig0/24');
  Object.assign(b.iface(sw, 'Gig0/24'), { mode: 'trunk', ...(o.allowed ? { allowed: o.allowed } : {}) });
  const vlans = o.withServers ? [10, 20, 30] : [10, 20];
  for (const v of vlans) {
    b.sub(e.r, 'Gig0/1', v, `192.168.${v}.1`);
    b.iface(e.r, `Gig0/1.${v}`).nat = 'inside';
  }
  return { ...e, sw };
}

function vlanHost(b: TopoBuilder, kind: 'pc' | 'server', name: string, vlan: number, host: number, sw: Device, port: string, portVlan: number, x: number, y = 330) {
  const d = b.add(kind, name, x, y, { gateway: `192.168.${vlan}.1`, dns: '8.8.8.8' });
  b.ip(d, 'Gig0/0', `192.168.${vlan}.${host}`);
  b.cable(d, 'Gig0/0', sw, port);
  Object.assign(b.iface(sw, port), { mode: 'access', vlan: portVlan });
  return d;
}

const internetOk = (src: string, text: string): Objective => ({ id: `net-${src}`, text, action: 'internet', src, expect: true });

// ---------------------------------------------------------------- catalogo

export const CHALLENGES: readonly Challenge[] = [
  {
    id: 'gateway-errado',
    title: 'Financeiro sem internet',
    story: 'O Financeiro está sem internet! O PC-FIN-01 abre as pastas do escritório, mas nenhum site carrega. O PC ao lado, o PC-FIN-02, funciona normalmente. Descubra o que há de diferente.',
    difficulty: 'facil',
    parSec: 180,
    objectives: [
      internetOk('PC-FIN-01', 'PC-FIN-01 passa no teste "Testar internet"'),
      { id: 'browse', text: 'PC-FIN-01 abre http://exemplo.sim', action: 'browse', src: 'PC-FIN-01', target: 'http://exemplo.sim', expect: true },
    ],
    hints: [
      'Use "Testar internet" no PC-FIN-01 e leia em qual etapa falha. Compare as configurações dele com as do PC-FIN-02.',
      'O PC fala com a própria rede, mas para sair dela precisa de um gateway. Confira o gateway do PC-FIN-01 e o IP do roteador R1 na rede 192.168.1.0/24.',
      'O gateway do PC-FIN-01 está como 192.168.1.254, mas o R1 responde em 192.168.1.1. Troque o gateway para 192.168.1.1.',
    ],
    build() {
      const b = new TopoBuilder();
      const { sw } = lanSite(b);
      lanHost(b, 'pc', 'PC-FIN-01', '192.168.1.10', sw, 'Gig0/1', 170, 330, '192.168.1.254');
      lanHost(b, 'pc', 'PC-FIN-02', '192.168.1.11', sw, 'Gig0/2', 430);
      return b.build();
    },
  },
  {
    id: 'mascara-errada',
    title: 'Recepção isolada',
    story: 'A recepção não consegue abrir o servidor de arquivos nem a internet depois que alguém "arrumou" o PC-REC-01. O IP parece certo... será?',
    difficulty: 'facil',
    parSec: 180,
    objectives: [
      { id: 'ping-srv', text: 'PC-REC-01 alcança o SRV-ARQ (ping)', action: 'ping', src: 'PC-REC-01', target: 'SRV-ARQ', expect: true },
      internetOk('PC-REC-01', 'PC-REC-01 passa no teste "Testar internet"'),
    ],
    hints: [
      'Veja as interfaces do PC-REC-01 (comando ip addr). Todos os campos de rede precisam combinar com a LAN 192.168.1.0/24.',
      'A máscara define o tamanho da rede. Com uma máscara muito pequena, o gateway 192.168.1.1 fica "fora" da rede do PC.',
      'Troque a máscara do PC-REC-01 de 255.255.255.252 para 255.255.255.0.',
    ],
    build() {
      const b = new TopoBuilder();
      const { sw } = lanSite(b);
      const pc = lanHost(b, 'pc', 'PC-REC-01', '192.168.1.30', sw, 'Gig0/1', 170);
      b.iface(pc, 'Gig0/0').mask = '255.255.255.252';
      lanHost(b, 'server', 'SRV-ARQ', '192.168.1.20', sw, 'Gig0/2', 430);
      return b.build();
    },
  },
  {
    id: 'cabo-solto',
    title: 'O RH desapareceu da rede',
    story: 'Depois da faxina de ontem, o RH ficou sem impressora e um dos PCs perdeu a internet. Ninguém mexeu em configuração nenhuma... só em cabos e portas.',
    difficulty: 'facil',
    parSec: 180,
    objectives: [
      { id: 'ping-imp', text: 'PC-RH-01 alcança a IMP-RH (ping)', action: 'ping', src: 'PC-RH-01', target: 'IMP-RH', expect: true },
      internetOk('PC-RH-02', 'PC-RH-02 passa no teste "Testar internet"'),
    ],
    hints: [
      'Dois problemas físicos, em dois PCs diferentes. Olhe os LEDs dos cabos no desenho: vermelho significa sem sinal.',
      'Um cabo está solto (selecione-o e reconecte). No outro caso o cabo está bom, mas a porta do switch SW1 foi desativada (shutdown).',
      'Reconecte o cabo do PC-RH-01 e ative a porta Gig0/2 do SW1 (comando "no shutdown Gig0/2" ou desmarque "Desativada").',
    ],
    build() {
      const b = new TopoBuilder();
      const { sw } = lanSite(b);
      lanHost(b, 'pc', 'PC-RH-01', '192.168.1.10', sw, 'Gig0/1', 130);
      lanHost(b, 'pc', 'PC-RH-02', '192.168.1.11', sw, 'Gig0/2', 300);
      lanHost(b, 'printer', 'IMP-RH', '192.168.1.50', sw, 'Gig0/3', 470);
      b.topo.cables.find((c) => c.a.dev === b.topo.devices.find((d) => d.name === 'PC-RH-01')!.id)!.up = false;
      b.iface(sw, 'Gig0/2').shutdown = true;
      return b.build();
    },
  },
  {
    id: 'vlan-trocada',
    title: 'PC na VLAN errada',
    story: 'O PC-FIN-02 foi trocado de lugar e agora não enxerga o PC-FIN-01 nem a internet, embora o IP esteja certo. O eletricista plugou o cabo em outra porta do switch.',
    difficulty: 'medio',
    parSec: 300,
    objectives: [
      { id: 'ping-fin', text: 'PC-FIN-02 alcança o PC-FIN-01 (ping)', action: 'ping', src: 'PC-FIN-02', target: 'PC-FIN-01', expect: true },
      internetOk('PC-FIN-02', 'PC-FIN-02 passa no teste "Testar internet"'),
    ],
    hints: [
      'O IP e o gateway estão corretos. Veja em qual porta do SW1 o PC-FIN-02 está ligado e a qual VLAN essa porta pertence (comando show vlan no SW1).',
      'O Financeiro usa a VLAN 10 (192.168.10.0/24). A porta onde o PC-FIN-02 está ligado foi configurada para a VLAN do RH.',
      'No SW1, mude a porta Gig0/2 para access na VLAN 10 (comando "vlan Gig0/2 10").',
    ],
    build() {
      const b = new TopoBuilder();
      const { sw } = vlanSite(b);
      vlanHost(b, 'pc', 'PC-FIN-01', 10, 11, sw, 'Gig0/1', 10, 130);
      vlanHost(b, 'pc', 'PC-FIN-02', 10, 12, sw, 'Gig0/2', 20, 300);
      vlanHost(b, 'pc', 'PC-RH-01', 20, 11, sw, 'Gig0/3', 20, 470);
      return b.build();
    },
  },
  {
    id: 'trunk-sem-vlan',
    title: 'O RH não sai da VLAN',
    story: 'Depois de endurecer o switch, o Financeiro continua normal, mas o RH inteiro ficou sem internet e sem falar com o gateway. O trunk até o roteador parece conectado.',
    difficulty: 'medio',
    parSec: 300,
    objectives: [
      internetOk('PC-RH-01', 'PC-RH-01 (VLAN 20) passa no teste "Testar internet"'),
      internetOk('PC-FIN-01', 'PC-FIN-01 (VLAN 10) continua com internet'),
    ],
    hints: [
      'As portas dos PCs estão certas. O que muda entre o Financeiro e o RH é a VLAN. Veja a porta de uplink do SW1 (Gig0/24) na aba Propriedades.',
      'O trunk só deixa passar algumas VLANs (lista de VLANs permitidas). A VLAN do RH ficou de fora.',
      'No SW1, edite o trunk Gig0/24 e permita as VLANs 10 e 20 (ou deixe a lista vazia para permitir todas).',
    ],
    build() {
      const b = new TopoBuilder();
      const { sw } = vlanSite(b, { allowed: [10] });
      vlanHost(b, 'pc', 'PC-FIN-01', 10, 11, sw, 'Gig0/1', 10, 170);
      vlanHost(b, 'pc', 'PC-RH-01', 20, 11, sw, 'Gig0/2', 20, 430);
      return b.build();
    },
  },
  {
    id: 'dhcp-sem-pool',
    title: 'Notebooks sem endereço',
    story: 'Chegaram notebooks novos para a equipe de vendas. Eles estão configurados para pegar IP automático (DHCP), mas todos ficam sem endereço e sem internet.',
    difficulty: 'medio',
    parSec: 300,
    objectives: [
      internetOk('NB-VEN-01', 'NB-VEN-01 recebe IP e passa no teste "Testar internet"'),
      internetOk('NB-VEN-02', 'NB-VEN-02 recebe IP e passa no teste "Testar internet"'),
    ],
    hints: [
      'No notebook, veja a interface: o motivo da falta de IP aparece ali. Quem deveria entregar endereços na LAN?',
      'O roteador R1 é o servidor DHCP da rede 192.168.1.0/24, mas não tem nenhum pool configurado.',
      'No R1, crie um pool DHCP na interface Gig0/1: início 192.168.1.100, fim 192.168.1.150, gateway 192.168.1.1, DNS 8.8.8.8.',
    ],
    build() {
      const b = new TopoBuilder();
      const { sw } = lanSite(b);
      for (const [name, port, x] of [['NB-VEN-01', 'Gig0/1', 170], ['NB-VEN-02', 'Gig0/2', 430]] as const) {
        const d = b.add('laptop', name, x, 330);
        d.ifaces[0]!.dhcp = true;
        b.cable(d, 'Gig0/0', sw, port);
      }
      return b.build();
    },
  },
  {
    id: 'rota-padrao',
    title: 'A filial não sai para a internet',
    story: 'A filial funciona internamente, mas ninguém acessa a internet desde a troca do roteador. O link com a operadora (203.0.113.0/30) está de pé.',
    difficulty: 'medio',
    parSec: 300,
    objectives: [
      internetOk('PC-FIL-01', 'PC-FIL-01 passa no teste "Testar internet"'),
      { id: 'busca', text: 'PC-FIL-02 abre http://busca.sim', action: 'browse', src: 'PC-FIL-02', target: 'http://busca.sim', expect: true },
    ],
    hints: [
      'Rode o teste no PC e veja onde para. Depois, no R1, olhe a tabela de rotas (show ip route).',
      'O R1 só conhece as redes ligadas a ele. Para tudo o que não conhece, precisa de uma rota padrão apontando para a operadora.',
      'No R1, adicione a rota padrão 0.0.0.0/0 via 203.0.113.1 (comando "ip route add default via 203.0.113.1").',
    ],
    build() {
      const b = new TopoBuilder();
      const { sw } = lanSite(b, { route: false });
      lanHost(b, 'pc', 'PC-FIL-01', '192.168.1.10', sw, 'Gig0/1', 170);
      lanHost(b, 'pc', 'PC-FIL-02', '192.168.1.11', sw, 'Gig0/2', 430);
      return b.build();
    },
  },
  {
    id: 'nat-desligado',
    title: 'A internet que só vai e não volta',
    story: 'O R1 está com rota e link certos, mas os sites nunca respondem. A operadora diz que está recebendo os pacotes com endereços internos (privados) e os descarta.',
    difficulty: 'medio',
    parSec: 300,
    objectives: [
      internetOk('PC-LOJ-01', 'PC-LOJ-01 passa no teste "Testar internet"'),
      { id: 'browse', text: 'PC-LOJ-02 abre http://noticias.sim', action: 'browse', src: 'PC-LOJ-02', target: 'http://noticias.sim', expect: true },
    ],
    hints: [
      'O teste falha na Internet, não no roteador. Leia a mensagem: o que a operadora faz com endereços 192.168.x.x?',
      'Endereços privados precisam ser traduzidos para o IP público do R1 (NAT). Veja se o NAT está ligado e se as interfaces têm o papel certo (inside/outside).',
      'No R1, ligue o NAT (comando "nat on") e marque a Gig0/1 como inside ("nat inside Gig0/1"). A Gig0/0 já é outside.',
    ],
    build() {
      const b = new TopoBuilder();
      const { sw } = lanSite(b, { nat: false, insideRole: false });
      lanHost(b, 'pc', 'PC-LOJ-01', '192.168.1.10', sw, 'Gig0/1', 170);
      lanHost(b, 'pc', 'PC-LOJ-02', '192.168.1.11', sw, 'Gig0/2', 430);
      return b.build();
    },
  },
  {
    id: 'dns-interno',
    title: 'A intranet não abre',
    story: 'Os sites da internet abrem, mas a intranet (intranet.workverse.local) não. O servidor SRV-INTRA está no ar e o time de TI jura que o DNS interno SRV-DNS tem o registro.',
    difficulty: 'medio',
    parSec: 300,
    objectives: [
      { id: 'intranet', text: 'PC-FIN-01 abre http://intranet.workverse.local', action: 'browse', src: 'PC-FIN-01', target: 'http://intranet.workverse.local', expect: true },
      { id: 'exemplo', text: 'PC-FIN-01 abre http://exemplo.sim', action: 'browse', src: 'PC-FIN-01', target: 'http://exemplo.sim', expect: true },
    ],
    hints: [
      'Use "nslookup intranet.workverse.local" no PC-FIN-01 e veja qual servidor DNS ele pergunta e o que responde.',
      'Há dois erros: o PC pergunta a um DNS público, que não conhece nomes internos, e o registro da intranet no SRV-DNS aponta para um IP onde não há servidor.',
      'No PC-FIN-01, use o DNS 192.168.1.5 (comando "dns 192.168.1.5"). No SRV-DNS, corrija o registro intranet.workverse.local para 192.168.1.20.',
    ],
    build() {
      const b = new TopoBuilder();
      const { sw } = lanSite(b);
      lanHost(b, 'pc', 'PC-FIN-01', '192.168.1.10', sw, 'Gig0/1', 130);
      const dns = lanHost(b, 'server', 'SRV-DNS', '192.168.1.5', sw, 'Gig0/2', 300);
      dns.dnsRecords = { 'intranet.workverse.local': '192.168.1.200', 'exemplo.sim': '198.51.100.10' };
      lanHost(b, 'server', 'SRV-INTRA', '192.168.1.20', sw, 'Gig0/3', 470);
      return b.build();
    },
  },
  {
    id: 'acl-financeiro',
    title: 'O servidor do Financeiro',
    story: 'A TI bloqueou o servidor financeiro (SRV-FIN, VLAN 30) para todo mundo, mas agora o próprio Financeiro também não acessa. O RH não pode acessá-lo de jeito nenhum, e o servidor perdeu o caminho de volta.',
    difficulty: 'dificil',
    parSec: 480,
    objectives: [
      { id: 'fin-ok', text: 'PC-FIN-01 abre https://192.168.30.10 (servidor financeiro)', action: 'browse', src: 'PC-FIN-01', target: 'https://192.168.30.10', expect: true },
      { id: 'rh-bloq', text: 'PC-RH-01 NÃO consegue acessar o servidor financeiro', action: 'browse', src: 'PC-RH-01', target: 'https://192.168.30.10', expect: false },
      internetOk('PC-RH-01', 'PC-RH-01 continua com internet'),
    ],
    hints: [
      'Teste o acesso a partir do PC-FIN-01 e leia o motivo da falha. Há mais de um problema; resolva um de cada vez.',
      'Uma regra de ACL no R1 bloqueia todo o tráfego para a VLAN 30. Libere só o que o Financeiro precisa, sem abrir para o RH. Depois confira o gateway do SRV-FIN.',
      'No R1, insira no topo da ACL "permit tcp 192.168.10.0/24 → 192.168.30.10 porta 443", mantendo o deny. No SRV-FIN, o gateway correto é 192.168.30.1.',
    ],
    build() {
      const b = new TopoBuilder();
      const { r, sw } = vlanSite(b, { withServers: true });
      vlanHost(b, 'pc', 'PC-FIN-01', 10, 11, sw, 'Gig0/1', 10, 100);
      vlanHost(b, 'pc', 'PC-RH-01', 20, 11, sw, 'Gig0/2', 20, 280);
      const srv = vlanHost(b, 'server', 'SRV-FIN', 30, 10, sw, 'Gig0/3', 30, 470);
      srv.gateway = '192.168.30.254';
      r.acl = [{ action: 'deny', proto: 'ip', src: 'any', dst: '192.168.30.0/24' }];
      return b.build();
    },
  },
  {
    id: 'ip-duplicado',
    title: 'Dois com o mesmo IP',
    story: 'A intranet abre "às vezes" e quando abre dá erro de conexão recusada. Na semana passada instalaram uma impressora nova no Financeiro. Coincidência?',
    difficulty: 'dificil',
    parSec: 480,
    objectives: [
      { id: 'browse', text: 'PC-FIN-01 abre http://192.168.1.20 (SRV-INTRA)', action: 'browse', src: 'PC-FIN-01', target: 'http://192.168.1.20', expect: true },
      { id: 'sem-aviso', text: 'O ping de PC-FIN-01 para 192.168.1.20 funciona sem avisos de IP duplicado', action: 'ping', src: 'PC-FIN-01', target: '192.168.1.20', expect: true, noWarn: true },
    ],
    hints: [
      'Faça o teste e leia os avisos amarelos nos passos: o motor mostra o que responde ao ARP.',
      'Dois dispositivos da mesma rede estão usando o IP 192.168.1.20. Descubra quais olhando o IP de cada um.',
      'A impressora IMP-FIN está com 192.168.1.20, o mesmo do SRV-INTRA. Mude o IP da impressora para um livre, como 192.168.1.60.',
    ],
    build() {
      const b = new TopoBuilder();
      const { sw } = lanSite(b);
      lanHost(b, 'pc', 'PC-FIN-01', '192.168.1.10', sw, 'Gig0/1', 130);
      lanHost(b, 'printer', 'IMP-FIN', '192.168.1.20', sw, 'Gig0/2', 300);
      lanHost(b, 'server', 'SRV-INTRA', '192.168.1.20', sw, 'Gig0/3', 470);
      return b.build();
    },
  },
  {
    id: 'segunda-feira',
    title: 'Segunda-feira de caos',
    story: 'O escritório inteiro abriu sem internet. Um técnico "reorganizou" o roteador de borda no fim de semana e saiu sem deixar anotações. Os notebooks pegam IP, mas nada mais funciona. Pode haver mais de um erro.',
    difficulty: 'dificil',
    parSec: 480,
    objectives: [
      internetOk('NB-01', 'NB-01 recebe IP e passa no teste "Testar internet"'),
      { id: 'busca', text: 'NB-02 abre http://busca.sim', action: 'browse', src: 'NB-02', target: 'http://busca.sim', expect: true },
      { id: 'ns', text: 'NB-01 resolve workverse.sim (nslookup)', action: 'nslookup', src: 'NB-01', target: 'workverse.sim', expect: true },
    ],
    hints: [
      'Resolva um problema por vez, sempre com "Testar internet" no NB-01. Cada correção faz o teste avançar uma etapa.',
      'Verifique no R1: a rota para a operadora, o NAT e o pool DHCP (principalmente o DNS que ele entrega aos notebooks).',
      'No R1: adicione a rota padrão via 203.0.113.1, ligue o NAT e corrija o DNS do pool DHCP para 8.8.8.8 (8.8.4.4 não existe nesta internet simulada).',
    ],
    build() {
      const b = new TopoBuilder();
      const { r, sw } = lanSite(b, { nat: false, route: false });
      r.dhcp = [{ iface: 'Gig0/1', start: '192.168.1.100', end: '192.168.1.150', gateway: '192.168.1.1', dns: '8.8.4.4' }];
      for (const [name, port, x] of [['NB-01', 'Gig0/1', 170], ['NB-02', 'Gig0/2', 430]] as const) {
        const d = b.add('laptop', name, x, 330);
        d.ifaces[0]!.dhcp = true;
        b.cable(d, 'Gig0/0', sw, port);
      }
      return b.build();
    },
  },
];

export const getChallenge = (id: unknown): Challenge | undefined => (typeof id === 'string' ? CHALLENGES.find((c) => c.id === id) : undefined);

/** Dados publicos (sem funcao `build`) para listas. */
export interface ChallengeInfo {
  id: string;
  title: string;
  story: string;
  difficulty: Difficulty;
  parSec: number;
  objectives: Objective[];
}
export const challengeInfo = (c: Challenge): ChallengeInfo => ({ id: c.id, title: c.title, story: c.story, difficulty: c.difficulty, parSec: c.parSec, objectives: c.objectives });
