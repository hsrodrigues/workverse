# Monitoramento

## Endpoint `GET /metrics`

Formato texto Prometheus, implementado em `apps/server/src/metrics.ts` (sem dependencias).

- `METRICS_TOKEN` definido: exige `Authorization: Bearer <token>` (401 caso contrario).
- Sem token em desenvolvimento: aberto. **Em producao (`NODE_ENV=production`) sem token a rota nao existe (404).**
- Exponha `/metrics` so na rede interna; o proxy reverso nao deve publica-lo.

Exemplo de scrape:

```yaml
scrape_configs:
  - job_name: workverse
    metrics_path: /metrics
    authorization: { type: Bearer, credentials_file: /etc/prometheus/workverse.token }
    static_configs: [{ targets: ['workverse:3001'] }]
```

## Metricas

| Metrica | Tipo | Significado |
|---|---|---|
| `workverse_ws_connections_active` / `_total` | gauge / counter | conexoes WebSocket abertas / aceitas |
| `workverse_players_online` | gauge | sessoes vivas |
| `workverse_room_players{room}` | gauge | jogadores por sala |
| `workverse_ws_messages_received_total{type}` | counter | mensagens do cliente por tipo |
| `workverse_ws_messages_sent_total{type}` | counter | mensagens do servidor por tipo (conta cada destinatario) |
| `workverse_ws_received_bytes_total`, `workverse_ws_sent_bytes_total` | counter | bytes (caracteres JSON) |
| `workverse_errors_total{kind}` | counter | `parse`, `oversize`, `handler`, `socket`, `error_msg:<codigo>` |
| `workverse_rate_limited_total` | counter | respostas `rate_limited` enviadas |
| `workverse_sessions_total{event}` | counter | `start` / `end` |
| `workverse_room_enters_total{room}` | counter | entradas em sala |
| `workverse_tick_duration_ms` | histogram | duracao de `World.tick()` |
| `workverse_handler_duration_ms{type}` | histogram | duracao de `World.handle()` por tipo |
| `process_cpu_seconds_total`, `process_resident_memory_bytes`, `nodejs_heap_used_bytes` | gauge | processo |
| `nodejs_eventloop_lag_p99_ms`, `_max_ms` | gauge | atraso do event loop desde o inicio (resolucao ~10-16 ms no Windows: um piso de ~20 ms e artefato) |

Rotulos vindos do cliente sao restritos a `[a-z_]{1,24}` e limitados a 64 series por metrica.

## Alertas sugeridos

- `histogram_quantile(0.95, rate(workverse_tick_duration_ms_bucket[5m])) > 20` por 5 min (o tick roda a cada 100 ms).
- `histogram_quantile(0.95, sum by (le) (rate(workverse_handler_duration_ms_bucket[5m]))) > 10`.
- `rate(process_cpu_seconds_total[5m]) > 0.7` (processo e single-thread).
- `nodejs_eventloop_lag_p99_ms > 100`.
- `rate(workverse_errors_total{kind=~"handler|socket"}[5m]) > 0`; `handler` indica bug.
- `rate(workverse_rate_limited_total[5m]) > 5` (cliente abusivo ou bug de cliente).
- `workverse_room_players` proximo da capacidade (40/30/40) por muito tempo: salas lotadas (`error_msg:room_full`).
- `process_resident_memory_bytes` crescendo de forma monotona por horas (vazamento).
- `up == 0` ou `/health` falhando.

## Painel (Grafana) — paineis sugeridos

Jogadores online (`workverse_players_online`), jogadores por sala, msg/s enviadas e recebidas por tipo (`rate(...[1m])`), p50/p95 de tick e handler, CPU (`rate(process_cpu_seconds_total[1m])`), RSS, lag do event loop, taxa de erros por `kind`. Monte-os como painel de series temporais com essas consultas.

## Logs estruturados

Pino em JSON no stdout (`logger: true` em `main.ts`). Eventos de auditoria tem `msg: "audit"` e o campo `event`: `session.start`, `session.end`, `room.enter` e eventos de palco/midia. Erros: `message handler failed`, `socket error`, `request failed`. Filtre por `"msg":"audit"` e `level>=50` (erros). Nao ha dados sensiveis nos eventos (nome de exibicao e ids apenas).

## O que observar

1. Tick e handler p95 (custo do servidor autoritativo); 2. CPU de um nucleo; 3. mensagens enviadas/s versus jogadores (crescimento quadratico por sala indica broadcast caro); 4. `rate_limited` e `bad_message`; 5. RSS; 6. quedas de conexao (`session.end` sem logout).

## Teste de carga

```
npm run loadtest                              # degraus 10,25,50,100,200,400,800
npm run loadtest -- --steps 10,50 --hold 10   # personalizado
npm run loadtest -- --continue                # nao para no primeiro degrau reprovado
npm run loadtest -- --activity 5              # bots 5x mais ativos (estresse)
```

O script sobe um servidor proprio na porta 3401 (`ALLOW_DEV_LOGIN=1`, dados temporarios, token de metricas aleatorio), nao toca em 3001/5173/7880 e o encerra no fim. Limites: p95 < 150 ms, 0 quedas inesperadas. Gera `docs/load-report.md` e `docs/load-report.json`. Nenhuma variavel de ambiente de producao foi enfraquecida: o login por nome via WebSocket nao tem rate limit por IP, e os limites por jogador continuam ativos. Interpretacao em [load-testing.md](load-testing.md).
