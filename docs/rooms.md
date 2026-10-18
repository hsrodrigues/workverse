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

## Campos `type` e `access`

Dois campos opcionais de `RoomDef`, reservados para o controle de acesso por organização que ainda não existe no servidor:

- `type`: `'reception' | 'team' | 'meeting' | 'private' | 'focus' | 'lounge' | 'auditorium' | 'office'`.
- `access`: `'org' | 'team' | 'invite' | 'open'`. Ausente significa `'org'`.

**Hoje nenhum dos dois é aplicado: todas as salas são abertas.** Os valores já preenchidos indicam a intenção (por exemplo, `private` está como `invite`). Quando o servidor de organizações existir, a checagem deve ser feita ao entrar na sala, lendo `def.access`.

`guestAllowed` continua valendo como antes (visitantes só entram em salas que o definem; hoje: recepção, copa e auditório).

## Sala de entrada padrão

`DEFAULT_ROOM_ID` continua `office`: contas existentes e os testes de armazenamento persistem `office` como `lastRoom`. Para novos usuários entrarem pela recepção basta trocar a constante para `'reception'` (e ajustar os testes que assumem `office`, como `apps/server/test/*.test.ts`).

## Adicionar uma sala

1. Crie o `RoomDef` no fim de `rooms.ts` e inclua em `ROOM_DEFS` (a ordem importa: `ROOM_DEFS[0]` é usado por testes como o escritório).
2. Adicione portais de ida e volta com a recepção.
3. Crie um tema em `apps/client/src/game/roomArt.ts` (`THEMES[id]`: piso, paredes, rodapé).
4. Rode `npm test`: os testes de `packages/shared` verificam alcance de portais, assentos, objetos usáveis e tiles isolados.

## Móveis novos

- `reception_desk` (balcão de recepção, 3x1) e `logo` (placa na parede, 2x1), com construtores em `apps/client/src/game/furniture.ts` e entradas na galeria (`apps/client/src/gallery.ts`).
