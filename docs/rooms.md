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

## Portais

A **Recepção Central** é o hub: tem uma porta para cada uma das outras oito salas, e todas elas têm uma porta de volta para a recepção (os testes em `packages/shared/test/shared.test.ts` garantem portais bidirecionais, tiles de chegada livres e alcançáveis). Escritório, Copa e Auditório mantêm também as portas que já tinham entre si.

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
