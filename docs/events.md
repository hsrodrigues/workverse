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
| Dia do Profissional de TI (`diati`) | 19/10 | 18 a 20/10 |
| Black Friday (`blackfriday`, opcional) | sexta apos a 4a quinta de novembro | 3 dias antes e depois; so com `WORKVERSE_OPTIONAL_EVENTS=blackfriday` ou forcado |

## Ativacao
- Servidor (`apps/server/src/eventsService.ts`): data do relogio + controle manual. Manda `{ t: 'events', active, forced, disabled }` no login e a cada mudanca (virada do dia no `tick`, ou staff). Controles manuais ficam em memoria (reiniciar volta ao automatico).
- Staff: aba **Eventos** do painel (ou `/evento <id> on|off|auto`), mensagem `staff_event`, acao `events.control` (nivel moderador); conceder/revogar itens usa `staff_item` (`item.grant`, administrador). Tudo vai para o log de auditoria (`event.on|off|auto`).
- Cliente: usa a lista do servidor (ou a data do PC sem conexao). `?event=halloween` (ou `a,b`) forca para teste. Preferencia da pessoa: menu do botao de ciclo de dia > "Decoracao de evento" (`localStorage wv.eventDecor`).

## Decoracao
`apps/client/src/game/eventDecor.ts` (montagem, animacao, luz) + `eventArt.ts` (pixel art original, chapada em 2-3 tons, borda escura de 1px, sem blur/dithering). Onde pode ir: `packages/shared/src/eventLayout.ts` (`planEventDecor`): objetos de chao so em cantos/encostos livres que mantem a sala conectada e deixam acesso a moveis; parede so em trechos sem porta, janela, peca de parede ou interruptor; a faixa alta (faixa, guirlanda, bandeirolas) tambem evita split de A/C, TV, telao, relogio e quadro branco.

### Assinatura e densidade
Cada evento tem uma peca **assinatura** grande (tela 96x144) no melhor canto da sala e pecas de apoio:

| Evento | Assinatura | Apoio / parede / janela |
|---|---|---|
| Natal | arvore grande com presentes, luzinhas piscando | boneco de neve, pilhas de presentes, guirlanda com luzinhas em bandas, coroas, neve caindo, neve na janela |
| Halloween | abobora-lanterna grande (chama tremula) | caldeirao, lapide, fantasma, aboboras, teias, morcegos, lua e morcego na janela |
| Ano Novo | arco de baloes com letreiro vivo | champanhe, presentes, faixa, estrelas, confete caindo, fogos pela janela a noite |
| Pascoa | coelho gigante + cesto de ovos | pintinho, cesto, coelhinho, ovos/coelhos de parede, borboletas na janela |
| Carnaval | mascara grande com penas | surdo, baloes, bandeirolas, serpentinas, confete, confete na janela |
| Festa Junina | fogueira grande animada | milho, fardo de feno, lanternas, bandeirolas, baloes de papel subindo na janela a noite |
| Namorados | arco de rosas com coracao | vaso, ursinho, baloes, coracoes, coracoes subindo na janela |
| Criancas | torre de blocos A-B-C-1-2 com estrela | ursinho, baloes, presentes, pipa na janela |
| Trabalho | engrenagens com capacete (discreto) | caixa de ferramentas, baloes |
| Aniversario | bolo de 3 andares com velas | baloes, presentes, serpentinas, confete |
| Black Friday | letreiro neon dourado | presentes, baloes |
| Dia da TI | holograma grande (Sala da TI e a principal) | ver abaixo |

Densidade (`decorLevel`): 3 = recepcao e escritorio (mais objetos de chao, de parede e particulas), 2 = copa, auditorio, TI e salas grandes, 1 = salas pequenas (so uma assinatura reduzida e bandeirolas, sem faixa curta nem particulas). Os itens de parede se espalham de forma regular e simetrica (`spreadSlots`), sem sorteio.

### Eventos simultaneos
`eventStack`: o de maior prioridade desenha a assinatura (um nivel mais enxuto); os demais so reforcam com bandeirolas.

### Luz e movimento
- A decoracao tem circuito proprio (**luz de festa**): luzinhas e brilhos nao apagam com o interruptor de teto; ficam mais fortes quando a sala esta escura (noite ou interruptor desligado) e mais suaves de dia. O tint do evento acompanha o ciclo dia/noite.
- Luzinhas das guirlandas piscam em 3 bandas (uma por vez); chamas/arvore/arco trocam de quadro; confete e neve caem em particulas de 1-2 px (14 no nivel 2, 26 no nivel 3), uma unica `Graphics` a ~15 quadros/s; vista da janela tem efeito proprio. Tudo respeita `prefers-reduced-motion` (quadro unico, particulas congeladas).
- **Ano Novo**: o letreiro do arco (e um relogio de parede quando ha 2 tiles livres) conta ate 00:00 de 31/12 para 01/01 (`newYearCountdown`, hora do PC); depois da virada (1 e 2 de janeiro) pisca "FELIZ ANO NOVO". Fora da janela (evento forcado) conta ate a proxima meia-noite local.

## Itens de avatar
`packages/shared/src/items/eventItems.ts` (desenhos em `drawers/events.ts`): chapeu de bruxa e fantasia de abobora (Halloween), mascara de Carnaval, oculos de Ano Novo, orelhas de coelho (Pascoa), chifres de rena (Natal); o gorro de Natal (`sp.santa_hat`) foi liberado. Enquanto o evento esta ativo o servidor concede `event:<id>` a todos (`wardrobe.ts`); quem esta vestindo o item o mantem depois do evento.

## Dia do Profissional de TI (`diati`)
Ativo sozinho de 18 a 20/10 (prioridade 66; tema neon azul/ciano/verde-matriz); a staff liga/desliga no painel Eventos ou com `?event=diati`. Decoração (`eventDecor.ts` + `eventArt.ts`, pixel art original): faixa "FELIZ DIA DO PROFISSIONAL DE TI", cabos de rede/fibra no alto da parede, nebulosa e estrelas nas janelas, quadro DON'T PANIC, cartaz "Já tentou desligar e ligar de novo?", placa 42, painel de ponte, toalha no gancho, plaquinha "Funciona na minha máquina", e no chão holograma, robozinhos, cupcake com bandeirinha SUDO, xícara de chá com estrelas, placa 42 e balões. A Sala da TI é a principal (`recipe.rich`: até 8 objetos de chão e 6 de parede). Itens de avatar `event:diati`: `ev.tee_answer` (camiseta 42), `ev.towel`, `ev.bridge_headset`, `ev.hacker_shades`, `ev.comm_badge`, `ev.alien_antennae`.
