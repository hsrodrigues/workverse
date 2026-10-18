# Banco de dados (PostgreSQL) e barramento (Redis opcional)

Contas e sessões vivem em PostgreSQL em produção. Sem `DATABASE_URL`, o servidor continua usando o arquivo
`accounts.json` (`JsonFileAccountStore`), útil em desenvolvimento.

## Como funciona

`PgAccountStore` (`apps/server/src/db/pgAccountStore.ts`) mantém a interface **síncrona** de `AccountStore`:

- No boot carrega todas as contas e as sessões não expiradas para memória (`await PgAccountStore.open(pool)`).
  Leituras e a checagem de duplicidade (e-mail e nome, sem diferenciar maiúsculas) acontecem no cache.
- Toda escrita entra numa fila FIFO e é gravada em segundo plano (write-behind). Escritas repetidas da mesma
  conta ainda não iniciadas são fundidas. Falhas transitórias (conexão) têm retry com backoff exponencial
  (250 ms até 30 s); erros permanentes (violação de unicidade/FK, dado inválido) descartam a escrita e são logados.
- O banco também impõe a unicidade (índices únicos `email_key` e `name_key`). Se outra instância gravou antes, a
  escrita local é descartada e a conta sai do cache.
- `await store.flush()` espera a fila esvaziar (o `main.ts` chama no SIGINT/SIGTERM antes de fechar o pool).
  Métricas: `store.queueSize` e `store.stats` (`queued`, `maxQueued`, `written`, `retries`, `dropped`, `lastError`).
- Campos de `Account` sem coluna própria (ex.: conjuntos de roupas) são gravados em `accounts.extra` (jsonb) e
  devolvidos ao carregar, então acrescentar campos ao `Account` não exige migração.

Limites: o que ainda estava na fila numa queda brusca do processo (`kill -9`, falta de energia) é perdido
(normalmente milissegundos). Premissa: **uma instância** escreve as contas.

## Variáveis de ambiente

| Variável | Padrão | Descrição |
| --- | --- | --- |
| `DATABASE_URL` | (vazio = JSON) | `postgres://usuario:senha@host:5432/banco` |
| `PGSSLMODE` | `disable` | `disable`, `require` (cifra sem validar certificado), `verify-ca`, `verify-full`, `no-verify`. Também lido de `?sslmode=` na URL |
| `PGSSLROOTCERT` | | CA (caminho ou PEM) para `verify-*` |
| `MIGRATE_ON_BOOT` | | `1` roda as migrações pendentes ao iniciar |
| `DB_POOL_MAX` | 10 | conexões no pool |
| `DB_POOL_IDLE_MS` | 30000 | fecha conexões ociosas |
| `DB_CONNECT_TIMEOUT_MS` | 10000 | |
| `DB_STATEMENT_TIMEOUT_MS` | 30000 | |
| `REDIS_URL` | (vazio = memória) | só usado pelo `RedisBus` (ainda não ligado ao `World`) |
| `REDIS_PREFIX` | `wv:` | prefixo de chaves e canais |

## Migrações

Arquivos `apps/server/migrations/NNNN_nome.sql`, somente `up`. A tabela `schema_migrations(version, checksum, applied_at)`
registra o que foi aplicado; o runner usa `pg_advisory_lock` (duas instâncias não migram juntas), roda cada
arquivo em transação e **falha** se uma migração aplicada foi alterada (checksum), se o arquivo sumiu ou se há
pendente com versão menor que a última aplicada. Para mudar o schema, crie um novo arquivo.

```bash
npm run db:migrate -w @workverse/server      # ou: npm run db:migrate
```

## Desenvolvimento local sem Docker

```bash
npm run pg:dev        # PostgreSQL real e portátil (embedded-postgres), porta 54329, dados em tools/pg-data
# em outro terminal:
set DATABASE_URL=postgres://workverse:workverse@127.0.0.1:54329/workverse   (PowerShell: $env:DATABASE_URL=...)
set MIGRATE_ON_BOOT=1
npm run dev:server
```

`npm run pg:tools` (Windows) baixa os binários oficiais da EnterpriseDB e extrai só `pgsql/bin` em `tools/pg/bin`
(necessário para `pg_dump`/`pg_restore`; o `embedded-postgres` não os traz).
`docker compose --profile db up postgres` e `--profile redis up redis` existem como alternativa opcional.

## Importar o JSON existente

```bash
set DATABASE_URL=postgres://...
npm run db:import-json -- apps/server/data/accounts.json
```

Migra o schema, lê o `accounts.json` v2 e insere contas e sessões válidas numa transação. É idempotente: o que já
existe (mesmo id, e-mail ou nome) é pulado, nada é sobrescrito. Rode com o servidor parado.

## Backup e restauração

```bash
npm run db:backup                              # DATABASE_URL definido: pg_dump -Fc; senão copia DATA_DIR (padrão apps/server/data)
npm run db:restore -- backups/daily/workverse-pg-<data>.dump
```

- Saída em `BACKUP_DIR` (padrão `./backups`, ignorado pelo git): `daily/` mantém os 7 últimos, `weekly/` os 4
  últimos (uma cópia semanal nasce quando a última tem 7 dias ou mais). Ajuste com `BACKUP_KEEP_DAILY/WEEKLY`.
  Agende 1 vez por dia (cron ou Agendador de Tarefas) e copie `backups/` para fora da máquina.
- `pg_dump`/`pg_restore` são procurados em `PG_BIN`, `tools/pg/bin` e no `PATH`.
- A restauração exige **base vazia** (recusa se houver tabelas). Crie outra base, restaure nela e aponte o
  `DATABASE_URL` para ela, ou apague/recrie a base. As migrações já constam em `schema_migrations`.
- Recuperação típica: parar o servidor, restaurar em base vazia, subir (`MIGRATE_ON_BOOT=1` aplica migrações
  mais novas que o dump). Em provedor gerenciado, use também os backups/PITR do provedor.
- Modo JSON: `db:restore -- <pasta-de-backup>` copia de volta para `DATA_DIR` (recusa sobrescrever sem `--force`).

## Postgres gerenciado (Neon, Supabase, Railway)

Só precisa de PostgreSQL padrão (sem extensões). Use a string de conexão **direta** (porta 5432) ou o pooler em
modo *session*; evite pooler em modo *transaction* para o runner de migrações (usa `pg_advisory_lock` em sessão).
Defina `PGSSLMODE=require` (ou `verify-full` com `PGSSLROOTCERT`). O pool padrão (10) cabe nos planos gratuitos;
reduza `DB_POOL_MAX` se o limite de conexões for baixo. Neon pode suspender o banco ocioso: a primeira conexão demora
e o `DB_CONNECT_TIMEOUT_MS` cobre isso. Não testado contra esses provedores (apenas PostgreSQL 18.4 real local).

## Barramento de presença (Redis opcional)

`apps/server/src/bus.ts` define `PresenceBus` (publish/subscribe por canal e presença por conta/sala com TTL) com
`MemoryBus` (padrão) e `RedisBus` (`ioredis`, `REDIS_URL`, prefixo `REDIS_PREFIX`). `createBus()` escolhe pelo ambiente.
**Ainda não está ligado ao `World`** (virá com o núcleo de organizações).

Importante: a **simulação de uma sala continua em UMA instância** (afinidade de sala: todos os jogadores de uma sala
conectam ao mesmo processo). O barramento é para o que atravessa instâncias — quem está online e em que sala, avisos
entre salas/organizações — e nunca para replicar movimento ou estado de uma mesma sala entre processos.

Testes: o contrato roda em memória sempre; o do `RedisBus` roda só com `REDIS_URL` definido (ex.:
`REDIS_URL=redis://127.0.0.1:6380 npm test`).

## Testes

`apps/server/test/pg.test.ts` sobe um PostgreSQL real descartável (`embedded-postgres`, porta aleatória, ~20 s) e
é pulado se não for possível (ou com `WV_SKIP_PG=1`). Os testes de backup/restauração exigem `tools/pg/bin`
(`npm run pg:tools`); sem ele são pulados.
