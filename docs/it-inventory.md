# Servidores da TI: inventário de PCs conectados

Na Sala da TI, clicar num **rack de servidor** (`server_rack`) ou no **console de monitoramento** (`noc_console`, só em salas do tipo TI) abre o painel "Servidores · Inventário de PCs" (terminal retrô, pt-BR, fecha com Esc ou ×).

## Quem vê
Só a equipe de TI da organização (mesma regra de `passTeamIds` da Sala da TI, mais o nome da equipe normalizado `ti` / `tecnologia da informacao`), donos, admins e staff da plataforma em serviço. Visitantes (guest) nunca. Quem não é da TI e usa o rack recebe no chat "Acesso restrito à equipe de TI.". O servidor valida tudo de novo: `inventory_query` e `inventory_action` exigem a permissão `dir.search` e a checagem de TI (`World.isIT`), com limite de 6 de rajada e 1/s.

## Protocolo
- `interact` num rack/console → o servidor manda `inventory_open` (TI) ou a recusa no chat.
- `inventory_query` → `inventory_result { hosts, rooms, depts, total, powered, busy, truncated }` (até 300 hosts).
- `inventory_action { host, action: 'ping' | 'reboot' }` → `inventory_action_result`. O ping devolve uma latência fictícia (1 a 9 ms); host desligado não responde. Reiniciar é cosmético: a pessoa sentada recebe um aviso divertido do sistema, ninguém é derrubado, e há 20 s de espera por alvo.

## O que é um host
Cada estação (`computer`, `command_desk`, `hardware_bench`) de cada sala da organização. `ONLINE` = alguém sentado trabalhando (mostra nome, setor, cargo e tempo de uso); `OCIOSO` = monitor ligado sem ninguém; `DESLIGADO`. Hostname e IP fictícios estáveis por sala e posição (`PC-ESC-03`, `CMD-TI-01`, `LAB-TI-01`; `10.<rede da sala>.<y+1>.<base do tipo + x>`), CPU simulada determinística (janela de 15 s). Funções em `packages/shared/src/inventory.ts`.

## Privacidade
Isolado por organização; sem e-mails nem ids de conta; staff invisível e contas desativadas/banidas não aparecem trabalhando; salas privadas/trancadas que quem consulta não pode entrar aparecem como "em uma sala privada" (host `PC-RES-nn`, sem sala, posição nem ações).

## Painel
Filtros por sala e por setor, busca por nome/hostname/IP (sem acento), contadores ligados/total e por sala, atualização a cada 5 s. **Localizar** (mesma sala) leva a câmera e pisca um marcador sobre a estação; em outra sala o botão é **Ir até a sala** (entra e localiza). **Ping** e **Reiniciar** mostram a resposta no terminal. Lógica pura em `apps/client/src/ui/inventory/inventoryLogic.ts`.
