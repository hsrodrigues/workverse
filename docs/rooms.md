# Salas

As salas são definidas como dados em `packages/shared/src/rooms.ts` (`ROOM_DEFS`). O servidor e o cliente leem a mesma lista; o painel **Salas** do HUD mostra todas com a população atual e a lotação (`maxPlayers`).

| id | Nome | `type` | Lotação | Observação |
| --- | --- | --- | --- | --- |
| `office` | Escritório Compartilhado | `office` | 40 | open space |
| `lounge` | Copa e Lounge | `lounge` | 30 | |
| `auditorium` | Auditório | `auditorium` | 40 | palco, telão e plateia |
| `reception` | Recepção Central | `reception` | 50 | hub: portas para todas as salas |
| `team` | Sala de Equipe | `team` | 12 | mesa grande, lousa, TV, sofá |
| `meeting1` | Sala de Reunião 1 | `meeting` | 12 | mesa, TV, lousa, divisória de vidro |
| `meeting2` | Sala de Reunião 2 | `meeting` | 8 | versão menor |
| `private` | Sala Privada | `private` | 4 | escritório fechado, mesa e sofá |
| `focus` | Espaço de Concentração | `focus` | 8 | baias individuais, "silêncio" |
| `ti` | Sala da TI | `it` | 16 | centro de comando: videowall, mesa de comando em ferradura, corredor de racks, bancada de hardware, café premium |

## Portais

A **Recepção Central** é o hub: tem uma porta para cada uma das outras nove salas, e todas elas têm uma porta de volta para a recepção (os testes em `packages/shared/test/shared.test.ts` garantem portais bidirecionais, tiles de chegada livres e alcançáveis). Escritório, Copa e Auditório mantêm também as portas que já tinham entre si.

Portas só existem nas paredes norte (`y = 0`) e oeste (`x = 0`). O tile de chegada (`toX`, `toY`) é o tile ao lado da porta de retorno da sala de destino.

## Acesso às salas (aplicado no servidor)

`RoomDef.access`: `org` (padrão; `private` quando `type` é `private`), `team` (só a equipe `accessTeamId`), `invited` (convite) e `private` (convite, e o nome some para quem não tem acesso). Donos/admins da organização e staff admin em serviço sempre entram. A decisão é uma só (`World.canEnter` + `can('room.enter')`) e vale em `join`, portal, reconexão (última sala inválida cai na recepção), token de mídia e na varredura periódica.

- Convites: tabela `room_invites` (conta, quem convidou, validade opcional). Convite expirado ou removido **expulsa** quem está dentro (`kicked_room`) e derruba o token de mídia (LiveKit `removeParticipant`).
- A política por organização fica em `room_settings`; escritório e recepção devem ficar abertos.
- O navegador de salas recebe `rooms` do servidor: cadeado nas restritas, sem população nem ocupantes das inacessíveis (`population` também é filtrado por pessoa).
- Mensagens WS: `room_access_get/set`, `room_invite_add/remove`, `meeting_invite` (DM com botão Entrar).

## Editor de salas ("Modo decoração")

Permissão `room.furnish` (owner/admin) ou staff admin em serviço. Mensagens `furnish_apply` (lote de até 30 operações `add/update/remove` com `base` = versão; versão antiga = `conflict`) e `furnish_reset`. A validação é a mesma no cliente e no servidor (`packages/shared/src/furnish.ts`): dentro do piso, sem sobreposição, objetos de parede só em y=0/x=0, peças por tipo de sala, limite de 250, e prova com `findPath` que a entrada alcança portas, assentos e usáveis e que nenhum piso fica isolado. Avisos (sofá olhando para a parede etc.) vêm de `layoutRules.ts` e não bloqueiam. Aplicação ao vivo: `RoomInstance.applyLayout` reposiciona quem ficou sobre peça bloqueante, levanta quem estava em assento removido e difunde `furniture_changed`. Persistência: `room_furniture` (migração 0005; o layout base nunca é alterado; restaurar grava `furniture = NULL` e a versão continua crescendo). Tudo isolado por organização.

## Sala de entrada padrão

`DEFAULT_ROOM_ID` continua `office`: contas existentes e os testes de armazenamento persistem `office` como `lastRoom`. Para novos usuários entrarem pela recepção basta trocar a constante para `'reception'` (e ajustar os testes que assumem `office`, como `apps/server/test/*.test.ts`).

## Adicionar uma sala

1. Crie o `RoomDef` no fim de `rooms.ts` e inclua em `ROOM_DEFS` (a ordem importa: `ROOM_DEFS[0]` é usado por testes como o escritório).
2. Adicione portais de ida e volta com a recepção.
3. Crie um tema em `apps/client/src/game/roomArt.ts` (`THEMES[id]`: piso, paredes, rodapé).
4. Rode `npm test`: os testes de `packages/shared` verificam alcance de portais, assentos, objetos usáveis e tiles isolados.

## Móveis novos

- `reception_desk` (balcão de recepção, 3x1) e `logo` (placa na parede, 2x1), com construtores em `apps/client/src/game/furniture.ts` e entradas na galeria (`apps/client/src/gallery.ts`).
- `tv_stand` (TV com suporte, 2x1, bloqueia o caminho, usável): TV de tela plana sobre pedestal com rodinhas, a tela de apresentação das salas de reunião. `dir 0` mostra a tela para +y e `dir 1` para +x (pela regra de `furniFront`); `dir 2/3` mostram a traseira. Existe uma por sala (`KIND_MAX_PER_ROOM`) e só em salas de reunião, equipe, privada, foco, lounge e escritório (`KIND_ROOM_TYPES`). Veja [auditorium.md](auditorium.md#tv-nas-salas-de-reunião).

## TV de apresentação

Reunião 1, Reunião 2 e Sala de Equipe têm um `tv_stand` (ids `tvstand-*`, fixos para não deslocar os ids dos demais móveis) virado para a mesa. A TV decorativa de parede (`tv`) continua só decoração. Uma sala com `tv_stand` (e sem púlpito) é uma **sala com TV**: `presentationOf(def)` em `packages/shared/src/stage.ts` devolve `'tv'` (e `'stage'` para o auditório). A decisão vem sempre da lista de móveis atual da sala, então o editor de salas liga e desliga o modo ao adicionar ou remover a TV.

## Sala da TI (`ti`)

Porta na parede oeste da recepção (placa **TI**), volta para `(1,5)` da recepção. Aberta à organização por padrão (`access: 'org'`, sem visitantes) e compatível com todo o controle de acesso (equipe/convite/privada). Visual: piso escuro com faixas de LED, paredes de painéis metálicos com friso ciano (`theme.paper: 'tech'`, `fx: 'tech'` em `roomArt.ts`), brilhos ciano do videowall e dos racks (`dayLighting.ts`).

Móveis novos (`furniture.ts` + `furnitureTech.ts`): `server_rack` (LEDs que piscam: a cena troca 2 sprites, ver `blinkers` em `WorldScene.ts`), `command_desk` (3 segmentos formam a ferradura, monitores com telas vivas), `ergo_chair`, `videowall` (5x1 na parede), `arch_board`, `hardware_bench` e `espresso` (entrega café como a cafeteira, `FURNI_HOLDS`). O tipo de sala `it` entra em `RoomType`. Testes: `packages/shared/test/ti.test.ts` e os de layout/interruptor/editor, que varrem todas as salas.

### Equipes que passam mesmo com a sala trancada
Cada sala pode ter "equipes que passam" (`room_settings.pass_team_ids`, migração `0007_room_pass_teams.sql`; também no JSON e na memória; `RoomSetting.passTeamIds`). Sem escolha vale o padrão da sala: a Sala da TI deixa passar a equipe/setor cujo nome normalizado (sem acento/caixa) é `ti` ou `tecnologia da informacao` (`DEFAULT_PASS_TEAM_NAMES` em `roomConfig.ts`); `[]` = ninguém. Regras (todas no servidor, uma decisão só em `World.canEnter`): vale para acesso restrito (`team`/`invited`/`private`), para a sala trancada pela staff (`lock`; sala `close`/fechada não deixa ninguém) e para token de mídia (`forbidden_room`) e navegador de salas (cadeado). Só equipes da própria organização contam (id de outra org é recusado com `bad_team`). Visitantes continuam barrados em salas que não os admitem; staff admin em serviço e donos/admins passam como antes. Ao trancar com gente de fora dentro, os de fora vão para a sala inicial e a TI fica (na tranca da staff isso só acontece em salas que têm equipes que passam). Edição: aba **Acesso** do painel de decoração (caixas "Entram mesmo com a sala trancada"), mensagem `room_access_set { passTeamIds }`. Testes: `apps/server/test/roomsPass.test.ts`.


### Máquinas de lanches, bebidas e micro-ondas

Móveis usáveis de 1x1 encostados na parede (`WALL_BACKED_KINDS`), categoria Copa no editor e sem restrição de tipo de sala: `snack_machine` (entrega `snack`, pacote de salgadinho), `soda_machine` (`soda`, latinha) e `microwave` (`meal`, marmita). O uso passa pelas regras de `interact` (distância, rate limit) e `FURNI_HOLDS` define o item; `HeldItem` ganhou `snack`, `soda` e `meal` (atividade `holding:<item>`, visível a todos, 25 s de `HOLD_MS`). O micro-ondas tem atraso (`FURNI_DELAY_MS`, 3 s): a luz acende (estado `furni`), o item só vai para a mão depois, e andar para longe cancela. Desenho em `furniture.ts` (`vendingMachine`; o display das máquinas pisca via `blinkers`); itens na mão em `avatar/held.ts` e `drawers/specials.ts` (`sp.snack`, `sp.can`, `sp.lunchbox`, poses full/adapted/hidden como o copo; o gesto de comer reutiliza o de beber). Posições: copa (micro-ondas ao lado da bancada, máquinas na parede oeste), recepção (lanches no canto noroeste) e Sala da TI (lanches, bebidas e micro-ondas na parede norte). Salas já personalizadas mantêm a lista própria: peças novas não aparecem nelas, mas podem ser colocadas pelo editor. Testes: `packages/shared/test/machines.test.ts` e `apps/server/test/machines.test.ts`.

## Ar-condicionado e temperatura

- Peças: `ac_split` (split de parede, 2 tiles, alto), `ac_floor` (torre de piso, bloqueia), `thermostat` (termostato de parede). Categoria **Clima** no editor de salas. Salas já personalizadas pela organização mantêm o layout próprio; as peças novas só ficam disponíveis na paleta.
- Posições padrão: Sala da TI (2 splits, 1 torre, termostato), escritório (3 splits), reunião 1 e 2, equipe, auditório, copa e recepção (1 split cada), sempre em parede livre (sem porta, quadro ou janela).
- Estado AUTORITATIVO no servidor, por sala e por organização (`RoomInstance.climate`, só em memória: reiniciar o servidor volta ao padrão: desligado, meta 23 °C, 24 °C). O ar liga/desliga em conjunto (todas as unidades da sala seguem, mensagem `furni`); a meta e a temperatura vão na mensagem `climate` e no snapshot `room.climate`.
- **Controle remoto**: clicar no split, na torre ou no termostato abre o painel "Controle remoto" (React, `ui/climate/RemoteControl.tsx`; o servidor manda `climate_open` só para quem clicou). Tela LCD com a meta grande e a temperatura ambiente, ▲/▼ (18 a 26 °C), Liga/Desliga, modos (Frio, Eco, Ventilar, Auto), ventilador (Baixa, Média, Alta, Auto), aletas ligadas/desligadas e timer de desligamento (30 min, 1 h, 2 h) com contagem. Fecha com Esc, × ou clique fora; funciona no celular. O estado é um só por sala e age sobre todas as unidades.
- Mensagem `climate_set { power?, target?, mode?, fan?, swing?, timerMin? }` (validação estrita em `parseClimateSet`: meta inteira 18-26, modo/ventilador da lista, timer 0/30/60/120, campos extras = recusa; só quem está na sala; limite de taxa do jogador; sala sem ar responde `no_climate`). O servidor responde a todos com `climate { on, target, temp, overheat, mode, fan, swing, timerLeftMs }`.
- Efeito na simulação: Eco usa meta +2 e puxa a 60% da força; Ventilar não esfria (só brisa, e não impede o alerta de superaquecimento); o ventilador multiplica o esfriamento (Baixa 0,6, Média 1, Alta 1,6, Auto 1). O timer desliga no servidor (relógio injetável) e avisa no chat. No desenho: LED por modo (Frio azul, Eco verde, Ventilar branco, Auto âmbar), brisa mais rápida com o ventilador alto, aletas paradas com a oscilação desligada.
- Simulação (`shared/climate.ts`, passo de 5 s): a sala tende a `24 °C + 0,22 por pessoa + 0,7 por rack`; com o ar ligado desce até a meta (split 0,22 °C/passo, torre 0,4), nunca abaixo dela. A Sala da TI (10 racks) chega a ~31 °C sem ar: acima de 30 °C com o ar desligado liga o alerta (LEDs vermelhos piscando nos racks, chip vermelho no HUD e a linha de sistema "Sala da TI superaquecendo!", uma vez por episódio; o alerta só sai abaixo de 29 °C). Só visual, ninguém é punido.
- Cliente: display de LED desenhado no sprite (alvo), termostato com ambiente + meta, aletas, brisa em faixas nítidas e "ondas de som" (`climateFx.ts`), chip "🌡 24°C ❄ 23°" no HUD. Peças altas ou de parede são clicadas pelos pixels desenhados.
