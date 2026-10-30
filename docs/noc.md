# Painel NOC (monitoramento da Sala da TI)

Painel "NOC · Monitoramento" com gráficos de verdade, aberto na estação (mesa de comando) que fica **de frente ao videowall** da Sala da TI. O videowall e a tela dessa estação também desenham sparklines com os números reais.

## Quem vê

Mesma regra do inventário de PCs (`World.isIT`, ver `docs/it-inventory.md`): equipe de TI da organização, donos, admins e staff da plataforma em serviço. Visitantes (guest) nunca. Quem não é da TI e usa a estação ouve no chat "Acesso restrito à equipe de TI." e nada abre.

Dois escopos no `noc_result`:

| Escopo | Quem | O que recebe |
| --- | --- | --- |
| `org` | equipe de TI | só a própria organização; do processo, apenas uptime e carga relativa do tick; da mídia, só as conexões ativas das salas da própria org e o nível da cota (ok / 70% / 90% / esgotada), sem minutos |
| `full` | owner, admin da org e staff em serviço | tudo do `org` mais memória (heap MB), tempo do tick (médio/máx), mensagens WS/s, e os minutos do mês da cota de mídia (a cota é da plataforma inteira) |

Isolamento: o coletor guarda séries separadas por organização e `view()` só lê a da organização de quem pergunta. As salas também passam pelo mesmo filtro de acesso do mundo (`canEnter`): salas restritas que a pessoa não pode entrar não aparecem. Não há dados pessoais: só contagens e nomes de sala; os eventos não citam pessoas.

## A estação "de frente ao videowall"

`nocStation(furniture)` (`packages/shared/src/noc.ts`) é uma regra geométrica estável: entre as `command_desk` e `computer`, a que está **no lado para onde a frente do videowall aponta** e mais centrada nele (menor `lateral*2 + distância`, mesa de comando preferida). Mudar o layout da sala ou os ids não quebra. Só vale na sala `ti`. A mesa de comando passou a ser `usable` (clicável); as outras mesas de comando (as laterais da ferradura) não abrem nada.

## Protocolo

- servidor -> cliente: `noc_open` (abre o painel; só para quem pode) e `noc_result` (`NocView`, ver `packages/shared/src/noc.ts`).
- cliente -> servidor: `noc_query { window: 15 | 60 | 360 }`. Validação estrita (campo extra, tipo errado ou janela fora da lista = strike). Política `room.enter`; o mundo checa o papel (visitantes e não-TI recebem `error it_only`). Limite: rajada de 8 e 1 consulta a cada 2 s (`Player.nocBucket`), resposta `rate_limited`. O painel consulta a cada 5 s.

## Coletor (apps/server/src/noc.ts)

- Amostra a cada 30 s (`NOC_SAMPLE_MS`, mínimo 100 ms, só para testes/aceleração) dentro do `World.tick`; custo desprezível.
- Anéis de tamanho fixo (`Float32Array`, 720 amostras = 6 h): pessoas online por organização, ocupação por sala, temperatura e meta do ar por sala com ar-condicionado (a da TI em destaque; meta ausente quando o ar está desligado), conexões de mídia da organização, e do processo: heap, tempo médio do tick, mensagens WS/s e minutos do mês.
- Limites de memória: no máximo 64 organizações, 24 salas e 40 eventos por organização; organização ou sala que some do mundo é esquecida.
- Eventos: entrada/saída em massa (variação de 5 ou mais pessoas entre amostras), superaquecimento e normalização por sala com ar, cota de mídia passando de 70%, 90% e esgotada (aviso de plataforma, sem números).
- `recordTick()` é chamado por `app.ts` com a duração real do tick; `countMessage()` por `World.handle` (contador agregado, sem rótulos).
- Janelas: o servidor devolve no máximo 120 pontos por série (média por grupo) e o `stepMs` entre eles.

## Cliente

- `ui/noc/NocPanel.tsx`: seletor de janela (15 min / 1 h / 6 h), indicador "ao vivo", cartões: Pessoas online (linha com área), Ocupação por sala (barras horizontais), Temperatura da Sala da TI (gauge + linha da temperatura + meta em degraus âmbar, e as outras salas com ar), Mídia (minutos e conexões; "desligada" se a economia estiver off), Servidor, Linha do tempo de eventos. Funciona em 390 px (uma coluna), `role="img"` com resumo em cada gráfico, `role="radiogroup"`/`meter`, Esc fecha.
- `ui/noc/NocCharts.tsx` (SVG à mão, sem biblioteca, largura medida com `ResizeObserver` para o texto ficar nítido) e `ui/noc/nocLogic.ts` (escalas, ticks "bonitos", caminhos, formatação pt-BR; testado em `apps/client/test/noc-logic.test.ts`).
- Tema: ciano de destaque e âmbar de alerta.

## No mundo (videowall e estação)

`game/nocLive.ts` amostra a cada 30 s o que o cliente **já recebe** (soma da população visível e a temperatura do clima da sala): sem consulta extra e sem exigir permissão. O videowall (painéis "pessoas online", temperatura e números) e os três monitores da estação de frente a ele desenham essas séries (`game/nocScreens.ts`). O desenho é refeito só quando o digest das séries muda (`opt >= 1_000_000` em `renderFurniture`; o cache guarda só os 12 mais recentes e as texturas antigas saem do Phaser). Sem custo por quadro. `?nocLive=1000` acelera a amostragem no navegador (testes).

Observação: o número da parede é a população das salas que a pessoa pode ver; o painel NOC mostra o total da organização.

## Limitações

- Os dados ficam só em memória: reiniciar o servidor zera o histórico (por desenho; sem banco).
- A hora dos eventos usa o relógio do navegador de quem vê.
- A cota de mídia é da plataforma (um único contador): por isso os minutos só aparecem no escopo `full`.
