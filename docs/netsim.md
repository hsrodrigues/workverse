# Simulador de rede (Sala da TI)

Painel **Rede**, estilo Packet Tracer, dentro do WorkVerse. **Tudo é simulado**: o motor não abre sockets, não faz `fetch` e não toca a rede real nem a internet. Os "sites" (`exemplo.sim`, `busca.sim`...) e os DNS (`8.8.8.8`, `1.1.1.1`) existem só dentro da nuvem "Internet" do modelo.

## Como abrir

- Na Sala da TI, use o `noc_console` ou um `server_rack`. A equipe de TI abre o inventário e, nele, o botão **Rede (simulador)**. Os demais membros (não visitantes) ouvem a recusa do inventário e o painel Rede abre em **modo leitura**.
- Visitantes (`guest`) nunca têm acesso.

## Quem pode o quê

| Papel | Ver e testar | Editar |
| --- | --- | --- |
| Equipe TI da org (regra `ti` / `tecnologia da informacao`, a mesma do inventário), dono, admin, staff em serviço | sim | sim |
| Membro comum | sim (leitura) | não (`it_only`) |
| Visitante | não | não |

Quem não é da TI não vê dispositivos ligados a estações de salas em que não pode entrar (salas privadas), e não consegue sondá-los por nome. Isolamento total entre organizações: uma topologia por org; o cliente nunca informa a org.

## Modelo (packages/shared/src/netsim)

- Dispositivos: pc, laptop, servidor, switch (24 portas), roteador, firewall, access point (4 portas), "Internet" (nuvem, uma por topologia), impressora.
- Interfaces `Gig0/0`..., cabos (conectado/solto), por interface: IPv4 + máscara, DHCP cliente, shutdown, access/trunk + VLAN + VLANs permitidas (switch/AP), papel de NAT (inside/outside), subinterfaces 802.1Q (router-on-a-stick, `Gig0/0.10`).
- Host: gateway e DNS. Roteador/firewall: rotas estáticas (incluindo padrão), NAT de sobrecarga, ACL ordenada (permit/deny por protocolo, origem, destino e porta, política padrão permit/deny), servidor DHCP por interface (pools). Servidor: serviços abertos e registros DNS locais. Nuvem: hosts públicos, domínios e DNS.
- Limites: 80 dispositivos, 200 cabos, 40 interfaces por dispositivo, 40 rotas, 40 regras de ACL, 6 pools, 8 operações por edição. Validação estrita (`validateTopology`): IPv4 sem zeros à esquerda, máscara contígua, VLAN 1-4094, nomes sem caracteres de controle/bidi/ZWSP e únicos, cabos coerentes, campos desconhecidos descartados.

## Motor (puro e determinístico)

`ping`, `traceroute`, `browse` (DNS + TCP 80/443), `nslookup` e `testInternet` (4 etapas: gateway, IP público, DNS, site). Camada 2 por propagação de quadros em switches/APs respeitando cabo, shutdown, VLAN e trunk (com proteção contra laços; sem STP). Camada 3 por gateway do host, tabela de rotas (conectadas + estáticas, maior prefixo), TTL, ACL, NAT de origem e volta da resposta (o caminho de volta também é simulado). Cada resultado traz passos explicados ("Falhou no R1: sem rota para 8.8.8.8", "Bloqueado pela ACL em FW1, regra 2", "cabo solto entre Gig0/0 de PC2 e SW1 Gig0/2", "o gateway X está fora da sub-rede do host", "Internet descartou o pacote: endereço privado (falta NAT)").

### Limitações honestas

Sem RIP/OSPF/BGP, IPv6, STP, MTU/fragmentação, estado de TCP, NAT de destino/port forwarding, DHCP relay nem IP de gerência em switches. ARP é implícito. Concessões DHCP são recalculadas a cada simulação (determinísticas por ordem dos dispositivos; não há tempo de concessão). Um host com vários IPs usa o primeiro. Não é uma simulação de desempenho: a latência é fictícia.

## Servidor (apps/server/src/netsim.ts)

- Mensagens: `netsim_get` (abre/assina), `netsim_edit` (lote atômico de até 8 operações com `base` = versão vista), `netsim_undo`, `netsim_reset` (volta ao modelo padrão do inventário) e `netsim_run` (ping/traceroute/browse/nslookup/internet). Respostas: `netsim_state` (também enviada a quem está com o painel aberto), `netsim_result`, `netsim_error` (`it_only`, `conflict`, `invalid`, `rate_limited`, `not_found`, `nothing_to_undo`, `guest`).
- Conflito: versão diferente da atual devolve o estado novo e `conflict`. Versão 0 = modelo padrão ainda não editado; a primeira edição grava a versão 1.
- Rate limit por conta (edições e testes), mensagens validadas estritamente (strike para lixo), auditoria `netsim.edit` / `netsim.undo` / `netsim.reset` (mover dispositivos não é auditado). Desfazer guarda até 12 estados **em memória** (perdidos ao reiniciar o servidor); cada desfazer vira uma nova versão.
- A topologia padrão é gerada do inventário real: cada `computer`/`command_desk`/`hardware_bench` vira um PC com o IP do inventário, ligado ao switch da sala (VLAN própria), `SW-CORE`, roteador de borda `R-BORDA` (router-on-a-stick + NAT) e `Internet`. Estações além do limite ficam de fora (aviso no painel). Salas novas só entram ao **Restaurar padrão**.
- Inventário: depois da primeira edição, cada PC mostra o IP e o estado de rede (link e internet) vindos da topologia.

## Persistência

Migração `0010_netsim.sql`: `netsim_topologies` (uma linha por org, `version`, JSON validado) e `netsim_progress` (progresso dos desafios por conta; a migração `0011` acrescenta `hints`). Stores em memória, JSON e PostgreSQL com o contrato `apps/server/test/helpers/netsimContract.ts` (inclui PG real e `ON DELETE CASCADE`).

## Painel (apps/client/src/ui/netsim)

SVG da topologia com ícones pixel art originais, arrastar (TI), cabos com LEDs verde/vermelho, ferramenta Cabo (clique em dois dispositivos; usa a primeira interface livre), paleta, desfazer, restaurar padrão, zoom e lista de dispositivos (acessível por teclado e celular). Abas: **Propriedades** (IP, máscara, DHCP, gateway, DNS, VLAN/trunk, NAT, rotas, subinterfaces, DHCP, ACL), **Terminal** por dispositivo e **Testar** (botão "Testar internet", ping e navegar com explicação passo a passo). Os testes rodam no cliente com o mesmo motor puro.

Comandos do terminal: `help`, `ip addr`, `ifconfig`, `ip addr add 10.0.0.2/24 [dev Gig0/0]`, `gateway`, `dns`, `dhcp on|off`, `ip route [add|del] ...`, `show ip route`, `show vlan`, `vlan Gig0/1 20`, `trunk Gig0/24`, `shutdown` / `no shutdown`, `nat on|off`, `nat inside|outside`, `ping`, `traceroute`, `nslookup`, `curl`/`navegar`, `testar`, `hostname`, `clear`. Comandos que alteram só valem para a TI (os demais recebem "Permissão negada").

## Desafios "Conserte a rede"

Aba **Desafios** no painel Rede (botão ao lado de "Rede da organização"). São 12 desafios (fácil, médio, difícil) em `packages/shared/src/netsim/challenges.ts`: gateway errado, máscara errada, cabo solto e porta desativada, PC na VLAN errada, trunk sem VLAN, DHCP sem pool, rota padrão faltando, NAT desligado, DNS interno com registro errado, ACL bloqueando o servidor financeiro (e o RH precisa continuar bloqueado), IP duplicado e um "caos" com três falhas juntas.

- **Desafio** = história curta em pt-BR, topologia com falhas plantadas, **objetivos** verificáveis pelo próprio motor (ping, navegar, DNS, "Testar internet"; objetivos negativos como "o RH NÃO acessa o servidor financeiro" e `noWarn` para avisos de IP duplicado), 3 dicas progressivas e tempo de referência. Remover ou renomear um dispositivo nunca satisfaz um objetivo.
- **Pontuação** (`scoreChallenge`): base 40/60/80 (fácil/médio/difícil) + bônus de tempo até +20 (cheio até o tempo de referência, zero a partir de 3x) − dicas (5, 10, 15) − 2 por verificação errada (teto 10); mínimo 10, máximo 100. O servidor calcula; a melhor pontuação nunca piora ao repetir.
- **Sandbox**: cada pessoa tem no máximo uma sessão em memória com uma **cópia** da topologia do desafio (perdida ao desconectar ou reiniciar). A rede real da organização nunca é lida nem alterada. Qualquer membro (não visitante) joga; a edição da rede real continua só da TI. O painel usa o mesmo canvas, propriedades, terminal e aba Testar, e uma aba **Objetivos** com ✔/✘ ao vivo (calculados no cliente com o mesmo motor; o servidor reavalia em **Verificar** e decide).
- **Mensagens**: `netsim_challenges` (lista com progresso da conta e placar → `netsim_challenges_state`), `netsim_challenge_start` (`resume: true` continua o sandbox), `netsim_challenge_edit` (lote de até 8 operações com `base`), `netsim_challenge_check` (→ `netsim_challenge_result` com objetivos, pontuação detalhada e recorde), `netsim_challenge_hint`, `netsim_challenge_quit`; a sessão volta em `netsim_challenge_session`. Validação estrita (strike para lixo), rate limit por conta (edição, verificação, controle), erros `no_session`, `not_found`, `conflict`, `invalid`, `rate_limited`.
- **Progresso**: tabela `netsim_progress` por conta e organização (melhor pontuação, tentativas = quantas vezes iniciou, dicas da melhor execução, quando resolveu pela primeira vez). Migração `0011_netsim_hints.sql` acrescenta `hints`. Contrato de testes nos stores memória, JSON e PostgreSQL real.
- **Placar** da organização: top 10 por pontos (soma das melhores pontuações dos resolvidos) com posição, nome de exibição, quantidade resolvida e pontos; quem não está entre os 10 aparece com a própria posição. Só nomes de exibição; quem saiu da organização ou é visitante não aparece. Cada resolução vira uma linha de auditoria `netsim.challenge`.
- **Solução de referência**: `challengeSolutions.ts` (só testes; não vai no pacote exportado nem para o cliente) prova por teste automatizado que cada desafio é resolvível e que falha sem a correção, inclusive pelo caminho completo no servidor.

Limitações: o sandbox não tem desfazer nem "restaurar padrão" (use Recomeçar); o catálogo é fixo no código (sem editor de desafios); o bônus de tempo usa o relógio do servidor desde o início da sessão.
