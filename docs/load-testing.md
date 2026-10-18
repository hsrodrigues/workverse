# Teste de carga: resultados e interpretacao

Dados brutos: [load-report.md](load-report.md) / `load-report.json` (sobrescritos a cada `npm run loadtest`). Como rodar: [monitoring.md](monitoring.md#teste-de-carga).

## Resultado da rodada registrada (Windows, Node 24, um processo, bots e servidor na mesma maquina)

- Todos os degraus 10 a 800 passaram: ping p95 <= 3 ms, move->path p95 <= 5,2 ms, 0 quedas, perda ~0.
- **Capacidade real e 110 jogadores em sala** (office 40 + lounge 30 + auditorium 40, `maxPlayers` em `packages/shared/src/rooms.ts`). Acima disso os bots recebem `room_full` e ficam conectados sem sala (200: 110/90, 400: 110/290, 800: 110/690). Portanto os degraus 200+ medem conexoes ociosas, nao mais carga de jogo: o limite pratico hoje e a lotacao das salas, nao a CPU.
- Servidor com 110 em sala: ~7% de um nucleo, tick p95 <= 0,5 ms, handler p95 <= 5 ms, RSS 103 a 132 MB (800 conexoes).
- A coluna "lag do loop" (~20 ms) e piso do timer do Windows, e o gerador mostra o mesmo valor: nao e carga.

## Limitacoes e pendencias

- Teste de estresse com bots 5x mais ativos (`--activity 5`) nao foi concluido: uma tentativa anterior usou argumento invalido (`1,1`) e produziu numeros sem sentido (descartados), e a nova tentativa falhou porque `packages/shared/src/stage.ts` estava com erro de sintaxe vindo de edicao de outro agente. Repetir apos estabilizar.
- Para testar mais de 110 jogadores ativos seria preciso aumentar `maxPlayers` ou criar instancias de sala; fora do escopo.
- Bots e servidor dividem a CPU; para numeros de producao rode o gerador em outra maquina (o relatorio traz o lag do gerador para detectar saturacao).

## Gargalos candidatos (sem evidencia de problema nas medicoes; nao alterados)

1. `JsonFileAccountStore.create()` faz `flush()` sincrono do arquivo inteiro a cada conta nova: custo O(contas) por cadastro. Nao apareceu na rampa de 50 conexoes/s com 800 contas, mas cresce com a base; migrar para banco resolve.
2. `conn.send` serializa (`JSON.stringify`) a mesma mensagem uma vez por destinatario no broadcast. Um cache por objeto de mensagem eliminaria o trabalho repetido; so vale se `handler`/CPU subirem em estresse.
3. `view()` e `freeTileNear` sao O(n) por entrada em sala; irrelevantes com salas de ate 40.
