# Relatorio de teste de carga

Gerado por `npm run loadtest` em 2026-10-17T22:35:34.900Z (Node v24.14.1, win32 x64). Nao edite a mao: a execucao seguinte sobrescreve este arquivo. Analise e interpretacao: [load-testing.md](load-testing.md).

- Servidor: processo isolado na porta 3401, um unico processo Node, `ALLOW_DEV_LOGIN=1`, `DATA_DIR` temporario, logs de auditoria do pino desligados da tela (stdout descartado).
- Cada degrau: rampa de 50 conexoes/s, 3 s de estabilizacao, janela de medicao de 20 s.
- Bots: andam a cada 4-8 s, falam a cada 20-40 s, emote a cada 30-60 s, ping a cada 2 s. Distribuidos em office/lounge/auditorium na proporcao das capacidades (40/30/40).
- Limites aceitaveis: p95 < 150 ms (ping e move->path), 0 quedas inesperadas, 0 falhas de handshake, perda de respostas <= 0,5%.

| Bots | Em sala / sem sala (lotada) | msg/s recebidas | KB/s recebidos | Ping ms p50/p95/p99 | move->path ms p50/p95/p99 | Perda % ping/move/entrega | Quedas | CPU srv % | RSS MB | tick p95 ms | handler p95 ms | lag loop srv p99 ms | lag gerador p99 ms | Veredito |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 10 | 10/0 | 10 | 1 | 1.0 / 2.0 / 2.0 | 1.3 / 1.7 / 2.6 | 0.00 / 0.00 / 0.00 | 0 | 2 | 98 | 0.25 | 1.00 | 20.6 | 19.1 | OK |
| 25 | 25/0 | 45 | 6 | 1.0 / 1.0 / 2.0 | 0.8 / 1.5 / 2.2 | 0.00 / 0.00 / 0.00 | 0 | 1 | 99 | 0.25 | 1.00 | 21.0 | 20.9 | OK |
| 50 | 50/0 | 160 | 22 | 1.0 / 1.0 / 2.0 | 1.4 / 2.4 / 2.9 | 0.00 / 0.00 / 0.00 | 0 | 3 | 98 | 0.25 | 2.50 | 20.6 | 18.2 | OK |
| 100 | 100/0 | 617 | 92 | 1.0 / 3.0 / 4.0 | 1.8 / 3.9 / 5.9 | 0.00 / 0.00 / 0.00 | 0 | 7 | 103 | 0.50 | 2.50 | 21.2 | 21.9 | OK |
| 200 | 110/90 | 774 | 104 | 1.0 / 3.0 / 5.0 | 1.9 / 5.2 / 8.2 | 0.00 / 0.00 / 0.01 | 0 | 7 | 107 | 0.25 | 5.00 | 21.4 | 18.8 | OK |
| 400 | 110/290 | 781 | 109 | 1.0 / 3.0 / 5.0 | 1.8 / 4.3 / 6.7 | 0.00 / 0.00 / 0.19 | 0 | 7 | 115 | 0.25 | 2.50 | 21.7 | 19.7 | OK |
| 800 | 110/690 | 801 | 113 | 1.0 / 2.0 / 3.0 | 1.3 / 3.0 / 4.4 | 0.00 / 0.00 / 0.00 | 0 | 5 | 132 | 0.50 | 2.50 | 22.1 | 19.2 | OK |

Legenda: "Perda entrega" compara mensagens enviadas pelo servidor (`/metrics`) com as recebidas pelos bots na janela (indicativo; erro de borda de poucos %). tick/handler p95 sao o limite superior do bucket do histograma. CPU e % de um nucleo.

**Nenhum degrau reprovou nos limites definidos.**
**Maior degrau aprovado: 800 bots.**


