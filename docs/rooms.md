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

Porta na parede oeste da recepção (placa **TI**), volta para `(1,5)` da recepção. Aberta à organização por padrão (`access: 'org'`, sem visitantes) e compatível com todo o controle de acesso (equipe/convite/privada). Visual (redesign "NOC premium", paleta grafite/azul-marinho + ciano, âmbar só para alerta): piso de porcelanato escuro com juntas finas e brilho em faixas (sem ruído), faixas de LED guia em corredores definidos, tapete grafite do descanso e plataforma do NOC (`theme.fx: 'tech'`, `floor`/`techFx` em `roomArt.ts`); paredes de painéis modulares escuros com friso ciano fino, rodapé técnico e placas de segurança pintadas acima das máquinas (`techPixel`/`techSign`); luz de teto = calhas lineares de LED frio suspensas (`TECH_BARS` em `dayLighting.ts`, desenhadas acima da camada de tom da noite, apagam com o interruptor, com poças de luz em bandas no piso); racks uniformes com porta perfurada, coluna de LEDs de status (verde, um âmbar por rack, vermelho no superaquecimento) e bandeja de cabos no topo; videowall limpo com cabeçalho (SALA DA TI · NOC, uptime, relógio), mapa-múndi em pontos com rotas e painéis de latência, tráfego e saúde (`furnitureTech.ts`); mesa de comando com teclados retroiluminados. As luminárias de piso soltas foram removidas.

Móveis novos (`furniture.ts` + `furnitureTech.ts`): `server_rack` (LEDs que piscam: a cena troca 2 sprites, ver `blinkers` em `WorldScene.ts`), `command_desk` (3 segmentos formam a ferradura, monitores com telas vivas), `ergo_chair`, `videowall` (5x1 na parede), `arch_board`, `hardware_bench` e `espresso` (entrega café como a cafeteira, `FURNI_HOLDS`). O tipo de sala `it` entra em `RoomType`. Testes: `packages/shared/test/ti.test.ts` e os de layout/interruptor/editor, que varrem todas as salas.

### Equipes que passam mesmo com a sala trancada
Cada sala pode ter "equipes que passam" (`room_settings.pass_team_ids`, migração `0007_room_pass_teams.sql`; também no JSON e na memória; `RoomSetting.passTeamIds`). Sem escolha vale o padrão da sala: a Sala da TI deixa passar a equipe/setor cujo nome normalizado (sem acento/caixa) é `ti` ou `tecnologia da informacao` (`DEFAULT_PASS_TEAM_NAMES` em `roomConfig.ts`); `[]` = ninguém. Regras (todas no servidor, uma decisão só em `World.canEnter`): vale para acesso restrito (`team`/`invited`/`private`), para a sala trancada pela staff (`lock`; sala `close`/fechada não deixa ninguém) e para token de mídia (`forbidden_room`) e navegador de salas (cadeado). Só equipes da própria organização contam (id de outra org é recusado com `bad_team`). Visitantes continuam barrados em salas que não os admitem; staff admin em serviço e donos/admins passam como antes. Ao trancar com gente de fora dentro, os de fora vão para a sala inicial e a TI fica (na tranca da staff isso só acontece em salas que têm equipes que passam). Edição: aba **Acesso** do painel de decoração (caixas "Entram mesmo com a sala trancada"), mensagem `room_access_set { passTeamIds }`. Testes: `apps/server/test/roomsPass.test.ts`.


### Máquinas de lanches, bebidas e micro-ondas

Móveis usáveis de 1x1 encostados na parede (`WALL_BACKED_KINDS`), categoria Copa no editor e sem restrição de tipo de sala: `snack_machine` (entrega `snack`, pacote de salgadinho), `soda_machine` (`soda`, latinha) e `microwave` (`meal`, marmita). O uso passa pelas regras de `interact` (distância, rate limit) e `FURNI_HOLDS` define o item; `HeldItem` ganhou `snack`, `soda` e `meal` (atividade `holding:<item>`, visível a todos, 25 s de `HOLD_MS`). O micro-ondas tem atraso (`FURNI_DELAY_MS`, 3 s): a luz acende (estado `furni`), o item só vai para a mão depois, e andar para longe cancela. Desenho em `furniture.ts` (`vendingMachine`; o display das máquinas pisca via `blinkers`); itens na mão em `avatar/held.ts` e `drawers/specials.ts` (`sp.snack`, `sp.can`, `sp.lunchbox`, poses full/adapted/hidden como o copo; o gesto de comer reutiliza o de beber). Posições: copa (micro-ondas ao lado da bancada, máquinas na parede oeste), recepção (lanches no canto noroeste) e Sala da TI (lanches, bebidas e micro-ondas na parede norte). Salas já personalizadas mantêm a lista própria: peças novas não aparecem nelas, mas podem ser colocadas pelo editor. Testes: `packages/shared/test/machines.test.ts` e `apps/server/test/machines.test.ts`.

## Corredor / Hall 2 e as nove salas novas

A recepção tem poucas paredes livres (portas só nas paredes norte e oeste), então ela ganhou **uma** porta (oeste, y = 1) para o **Corredor / Hall 2** (`hall2`, tipo `hall`, nunca reservável). O corredor (20x7) concentra as nove portas na parede norte (x = 2, 4, ... 18, nesta ordem) e cada sala devolve ao corredor pela porta oeste, chegando ao tile logo abaixo da sua porta (x, 1). As salas ficam em `packages/shared/src/roomsExtra.ts` (ids de móvel estáveis por sala: `sala-prefixoN`) e as peças novas em `apps/client/src/game/furnitureRooms.ts`.

| Sala | id / tipo | Tamanho | Acesso | Reserva padrão | Destaques |
|---|---|---|---|---|---|
| Sala de Treinamento | `training` | 14x10 | org | sim | 16 carteiras voltadas para a TV (apresentação por TV), mesa do instrutor, quadros brancos, ar |
| RH / Atendimento | `rh` (`hr`) | 10x8 | org | sim | balcão de atendimento com PC, 2 cadeiras de entrevista, estante, quadro de avisos |
| Diretoria | `board` | 14x10 | convite (`invited`) | **nunca** | mesa longa de nogueira com 14 poltronas, aparador com bebidas, TV; a equipe "Diretoria" passa mesmo trancada |
| Laboratório / Dev | `lab` | 14x10 | org | não | 5 bancadas de vários monitores (hosts de PC), racks, impressoras 3D, bancada de hardware, café |
| Refeitório | `cafeteria` | 16x10 | org | não | 4 mesas de almoço com bancos, self-service (entrega refeição), geladeiras, micro-ondas, máquinas |
| Sala de Jogos | `games` | 14x10 | org | não | ping-pong, 2 pebolins e 4 fliperamas **jogáveis** (balão + animação), sofá e pufes |
| Terraço | `terrace` | 16x10 | org | não | **área aberta**: sem teto, sem interruptor e sem ar (há guarda-sol, jardim e guarda-corpo); varal de luzinhas acende à noite |
| Biblioteca / Silenciosa | `library` | 12x10 | org | não | estantes altas, mesas de estudo; **sala silenciosa** (ver abaixo) |
| Estúdio / Podcast | `studio` | 10x8 | org | não | mesa redonda com 4 microfones, painéis acústicos, câmera em tripé, luz de **NO AR** |

Regras comuns: toda sala tem interruptor de luz, ar-condicionado e termostato, exceto o Terraço (só luzinhas). Placas das portas: TREINO, RH, DIRETORIA, LAB, REFEITÓRIO, JOGOS, TERRAÇO, BIBLIOTECA, ESTÚDIO. Lotação (`maxPlayers`) entre 60% dos assentos e metade do piso (testado). Reserváveis por padrão: Sala Privada, Treinamento e RH (`DEFAULT_BOOKABLE_ROOM_IDS`); salas de equipe/convite não podem ser reservadas nem se a organização tentar (`booking_room_set` recusa), porque reservar ignora equipe e convite.

- **Terraço**: o tema `open` desliga as luminárias de teto; o varal (festão nas paredes e dois fios em diagonal) é desenhado em `dayLighting.ts` e só brilha quando escurece. O guarda-corpo (`railing`) cerca as bordas sul e leste.
- **Biblioteca silenciosa**: `SILENT_ROOM_IDS` faz `publishRights` devolver `none`: ninguém recebe microfone, câmera ou tela ali (o token de mídia sai sem permissão de publicar). O aviso "Silêncio" está na descrição da sala.
- **Estúdio**: a luz de NO AR (`on_air`) é só do cliente: acende quando algum jogador da sala tem o microfone ligado (`mediaIndicators`).
- **Jogos**: `FURNI_PLAY` define o balão de cada jogo; a peça anima por `PLAY_MS` e há uma partida por vez. O self-service usa `FURNI_HOLDS.buffet = meal` com frase própria (`FURNI_CHAT`).
- **Hosts**: estações de PC novas (computador do instrutor e do RH, mesas de comando do Laboratório) entram no inventário e no "Restaurar padrão" da rede (agora até 16 salas com PCs).
- **Decoração de eventos**: os testes garantem vagas de chão e parede sem colidir em cada sala nova (`packages/shared/test/hall2.test.ts`).

## Ar-condicionado e temperatura

- Peças: `ac_split` (split de parede, 2 tiles, alto), `ac_floor` (torre de piso, bloqueia), `thermostat` (termostato de parede). Categoria **Clima** no editor de salas. Salas já personalizadas pela organização mantêm o layout próprio; as peças novas só ficam disponíveis na paleta.
- Posições padrão: Sala da TI (2 splits, 1 torre, termostato), escritório (3 splits), reunião 1 e 2, equipe, auditório, copa e recepção (1 split cada), sempre em parede livre (sem porta, quadro ou janela).
- Estado AUTORITATIVO no servidor, por sala e por organização (`RoomInstance.climate`, só em memória: reiniciar o servidor volta ao padrão: desligado, meta 23 °C, 24 °C; **exceção: a Sala da TI (`ti`) começa LIGADA em 22 °C e o ar dela fica sempre ligado**: o servidor ignora pedidos de desligar, de timer e do modo Ventilar nessa sala (a meta, o ventilador e as aletas seguem livres), com aviso no chat do sistema; a lista de salas assim é `ALWAYS_ON_CLIMATE_ROOMS` em `apps/server/src/room.ts`). O ar liga/desliga em conjunto (todas as unidades da sala seguem, mensagem `furni`); a meta e a temperatura vão na mensagem `climate` e no snapshot `room.climate`.
- **Controle remoto**: clicar no split, na torre ou no termostato abre o painel "Controle remoto" (React, `ui/climate/RemoteControl.tsx`; o servidor manda `climate_open` só para quem clicou). Tela LCD com a meta grande e a temperatura ambiente, ▲/▼ (18 a 26 °C), Liga/Desliga, modos (Frio, Eco, Ventilar, Auto), ventilador (Baixa, Média, Alta, Auto), aletas ligadas/desligadas e timer de desligamento (30 min, 1 h, 2 h) com contagem. Fecha com Esc, × ou clique fora; funciona no celular. O estado é um só por sala e age sobre todas as unidades.
- Mensagem `climate_set { power?, target?, mode?, fan?, swing?, timerMin? }` (validação estrita em `parseClimateSet`: meta inteira 18-26, modo/ventilador da lista, timer 0/30/60/120, campos extras = recusa; só quem está na sala; limite de taxa do jogador; sala sem ar responde `no_climate`). O servidor responde a todos com `climate { on, target, temp, overheat, mode, fan, swing, timerLeftMs }`.
- Efeito na simulação: Eco usa meta +2 e puxa a 60% da força; Ventilar não esfria (só brisa, e não impede o alerta de superaquecimento); o ventilador multiplica o esfriamento (Baixa 0,6, Média 1, Alta 1,6, Auto 1). O timer desliga no servidor (relógio injetável) e avisa no chat. No desenho: LED por modo (Frio azul, Eco verde, Ventilar branco, Auto âmbar), brisa mais rápida com o ventilador alto, aletas paradas com a oscilação desligada.
- Simulação (`shared/climate.ts`, passo de 5 s): a sala tende a `24 °C + 0,22 por pessoa + 0,7 por rack`; com o ar ligado desce até a meta (split 0,22 °C/passo, torre 0,4), nunca abaixo dela. A Sala da TI (10 racks) chega a ~31 °C sem ar: acima de 30 °C com o ar desligado liga o alerta (LEDs vermelhos piscando nos racks, chip vermelho no HUD e a linha de sistema "Sala da TI superaquecendo!", uma vez por episódio; o alerta só sai abaixo de 29 °C). Só visual, ninguém é punido.
- Cliente: display de LED desenhado no sprite (alvo), termostato com ambiente + meta, aletas, brisa em faixas nítidas e "ondas de som" (`climateFx.ts`), chip "🌡 24°C ❄ 23°" no HUD. Peças altas ou de parede são clicadas pelos pixels desenhados.

## Reserva temporaria

Salas reservaveis restringem o acesso durante a janela de uma reserva confirmada (dono, convidados, owners/admins e staff admin), sem alterar `access`; ver [bookings.md](bookings.md).
