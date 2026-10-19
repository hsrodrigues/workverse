# Eventos e comemoracoes

Tabela e regras de data em `packages/shared/src/events.ts` (puro, testado): `activeEvents(date, overrides)`.

| Evento (id) | Data | Janela |
|---|---|---|
| Halloween (`halloween`) | 31/10 | 7 dias antes, 1 depois |
| Carnaval (`carnaval`) | terca = Pascoa - 47 dias | 4 dias antes (sexta) ate a terca |
| Ano Novo (`anonovo`) | 31/12 | 31/12 a 02/01 |
| Pascoa (`pascoa`) | Meeus/Jones/Butcher | 7 dias antes, 1 depois |
| Natal (`natal`) | 25/12 | 24 a 26/12 |
| Festa Junina (`junina`) | 24/06 | 01 a 30/06 |
| Dia dos Namorados (`namorados`) | 12/06 | 10 a 13/06 |
| Dia das Criancas (`criancas`) | 12/10 | 09 a 13/10 |
| Dia do Trabalho (`trabalho`) | 01/05 | 30/04 e 01/05 |
| Aniversario da empresa (`aniversario`) | `WORKVERSE_COMPANY_DATE` (`DD/MM`) | 3 dias antes e depois |
| Black Friday (`blackfriday`, opcional) | sexta apos a 4a quinta de novembro | 3 dias antes e depois; so com `WORKVERSE_OPTIONAL_EVENTS=blackfriday` ou forcado |

## Ativacao
- Servidor (`apps/server/src/eventsService.ts`): data do relogio + controle manual. Manda `{ t: 'events', active, forced, disabled }` no login e a cada mudanca (virada do dia no `tick`, ou staff). Controles manuais ficam em memoria (reiniciar volta ao automatico).
- Staff: aba **Eventos** do painel (ou `/evento <id> on|off|auto`), mensagem `staff_event`, acao `events.control` (nivel moderador); conceder/revogar itens usa `staff_item` (`item.grant`, administrador). Tudo vai para o log de auditoria (`event.on|off|auto`).
- Cliente: usa a lista do servidor (ou a data do PC sem conexao). `?event=halloween` (ou `a,b`) forca para teste. Preferencia da pessoa: menu do botao de ciclo de dia > "Decoracao de evento" (`localStorage wv.eventDecor`).

## Decoracao
`apps/client/src/game/eventDecor.ts` + `eventArt.ts` (pixel art original). Onde pode ir: `packages/shared/src/eventLayout.ts` (`planEventDecor`): objetos de chao so em cantos/encostos livres que mantem a sala conectada e deixam acesso a moveis; parede so em trechos sem porta, janela, peca de parede ou interruptor. Brilhos seguem o ciclo dia/noite e o interruptor de luz.

## Itens de avatar
`packages/shared/src/items/eventItems.ts` (desenhos em `drawers/events.ts`): chapeu de bruxa e fantasia de abobora (Halloween), mascara de Carnaval, oculos de Ano Novo, orelhas de coelho (Pascoa), chifres de rena (Natal); o gorro de Natal (`sp.santa_hat`) foi liberado. Enquanto o evento esta ativo o servidor concede `event:<id>` a todos (`wardrobe.ts`); quem esta vestindo o item o mantem depois do evento.
