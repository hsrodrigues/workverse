# Seguranca do WorkVerse

Revisao feita antes de expor o servico na internet. "Confirmado" = reproduzido por teste ou leitura do codigo.
Testes: `apps/server/test/security.test.ts` (e os existentes de auth, stage, staff, metrics).

## Modelo de ameacas (resumo)

| Ator | Pode tentar | Defesa principal |
| --- | --- | --- |
| Anonimo na internet | forca bruta, enumeracao, flood de conexoes/uploads, cadastro em massa | limites por IP e por conta, lockout, Origin, limites de WebSocket, cadastro fechado/convite |
| Site malicioso | CSRF, WebSocket de outra origem | cookie `SameSite=Strict`, checagem de Origin em toda rota que muda estado e no `/ws` |
| Membro de uma org | ler/escrever em outra org (IDOR), DM/chat/midia cruzados, escalar papel | `can()` com regra zero de orgId, org vinda da sessao (nunca do corpo), 404 uniforme |
| Staff de nivel baixo | virar admin, agir sobre staff de nivel igual/maior | `staffCan`, hierarquia no alvo, auditoria; concessao so por env/CLI/rota de staff com checagem |
| Quem rouba um cookie | usar a sessao por 30 dias | HttpOnly, Secure, token so como hash no servidor, logout revoga, limite de 10 sessoes |

## Achados e correcoes

| # | Sev. | Estado | Achado | Onde | Correcao | Teste |
| - | - | - | - | - | - | - |
| 1 | Alto | confirmado | Upload `/api/stage/image` bufferizava ate 1,5 MB de corpo ANTES de autenticar (DoS anonimo) | `stageRoutes.ts` | `onRequest` autentica antes de ler o corpo | "anonymous upload refused before body parsed" |
| 2 | Alto | confirmado | `/ws` sem limite de conexoes por IP/conta, sem timeout de `hello`, sem rate limit de mensagens por conexao (ping e pre-hello ilimitados) | `app.ts` | `socketLimits`: 50/IP em producao, 5/conta, hello em 10 s, 60 de rajada + 30/s, 20 strikes derrubam | "WebSocket abuse limits" (3 testes) |
| 3 | Medio | confirmado | Checagem de Origin so existia com `ALLOWED_ORIGINS` e era repetida por rota (rota nova esqueceria) | `authRoutes.ts` | `originAllowed` + hook global `onRequest` para POST/PUT/PATCH/DELETE em `/api/*` e no `/ws`; sem lista em producao exige mesma origem | "CSRF / Origin" (3 testes) |
| 4 | Medio | confirmado | Sem limite de sessoes por conta; login nao revogava o cookie apresentado | `authRoutes.ts`, `store.ts` | token novo a cada login (sem fixacao), cookie anterior revogado e socket fechado, maximo 10 sessoes (`trimSessionsOf`) | "sessions and cookie" |
| 5 | Medio | confirmado | scrypt N=2^14 (abaixo do recomendado) | `auth.ts` | N=2^16 r=8 p=1; hashes antigos sao refeitos no proximo login (`needsRehash`) | "upgrades a weaker scrypt hash" |
| 6 | Medio | confirmado | Politica de senha so por tamanho (aceitava `xxxxxxxxxx`, `1234567890`, senha igual ao e-mail) | `auth.ts` | lista de senhas comuns, repeticao, sequencia, igual a e-mail/nome | "rejects common passwords" |
| 7 | Medio | confirmado | Imitacao de nomes: mistura latim+cirilico/grego ("Аdmin") e nomes como `admin`, `staff` | `world.ts` | recusa mistura de scripts e nomes reservados no cadastro | "blocks homoglyph and reserved names" |
| 8 | Medio | confirmado | Organizacoes sem limite por conta (cada uma ocupa memoria: mundo e imagens) | `org.ts` | maximo 5 como dono (`org_limit`) | "limits how many organizations" |
| 9 | Medio | confirmado | `ALLOW_DEV_LOGIN` (entra so com nome) ficava ativo se o dev server fosse exposto por tunel | `app.ts` | em modo dev, requisicoes com `X-Forwarded-*`/`CF-*` recebem 403 | "ALLOW_DEV_LOGIN refuses proxied requests" |
| 10 | Medio | confirmado | Token de convite aparecia na URL dos logs de acesso | `app.ts` | serializer de log com `redactUrl`, sem query nem headers | "invite tokens never reach the access log" |
| 11 | Baixo | confirmado | `/health` expunha numero de organizacoes | `app.ts` | so `ok` e `online` | "/health exposes no organization data" |
| 12 | Baixo | confirmado | `.gitignore` sem `.env.*`, chaves, `*.bak-v2` | `.gitignore` | adicionado | - |

Verificado e SEM falha (confirmado por teste/leitura): isolamento entre orgs em rotas `/api/orgs/:id/*` (404 uniforme, nenhum dado da outra org), chat/DM/equipe/midia entre orgs, token LiveKit (sala vem da sessao, `canPublishData=false`, TTL 600 s, segredo nunca sai), upload (assinatura, SVG/HTML recusados, `nosniff`, CSP `sandbox`), conector do PowerPoint (127.0.0.1, Host fixo anti DNS-rebinding, Origin exato, token, rate limit, nenhum caminho vindo da web), cliente sem `innerHTML`/`dangerouslySetInnerHTML`, IP real (`TRUST_PROXY` por saltos, nao "confiar em tudo"), `npm audit`: 0 vulnerabilidades.

## Riscos aceitos / que sobraram

- **Estado de staff da plataforma e transversal as orgs por desenho**: staff ve a lista de online de todas as orgs e pode silenciar/expulsar/avisar em qualquer uma. Conceda so a pessoas de confianca (helper ve tudo igual).
- **Sem verificacao de e-mail e sem recuperacao de senha**: quem cadastra primeiro um e-mail o possui. Por isso `BOOTSTRAP_OWNER_EMAIL` e `BOOTSTRAP_STAFF_EMAILS` so sao seguros se essas contas forem criadas ANTES de abrir ao publico (ou com cadastro fechado). `email_taken` revela e-mails cadastrados (aceito; some com cadastro fechado/convite).
- **Sem troca de senha nem "sair de todos os dispositivos"**: cookie roubado vale ate 30 dias ou ate o logout; limite de 10 sessoes. Fortemente recomendado entregar a troca de senha (revogando as outras sessoes) junto com a criacao de contas por staff.
- **Bloqueio por conta e DoS**: o limite por e-mail (5/min) permite que alguem impeca o login de uma vitima enquanto atacar. Cloudflare/regras de WAF mitigam.
- **Origens com curinga** (`https://*.trycloudflare.com`): qualquer pessoa pode abrir um subdominio. Hoje so e seguro porque o cookie e `SameSite=Strict` (trycloudflare.com e site distinto). NUNCA afrouxe o cookie para Lax/None e prefira dominio proprio em producao.
- Sem CAPTCHA/Turnstile; o limite de cadastro por IP e o modo `invite`/`closed` fazem esse papel.
- Imagens do auditorio ficam em memoria ate outra pessoa assumir o palco (ate 24 MB por sala de palco por org).
- Pequena diferenca de tempo no login enquanto existirem hashes antigos (N=2^14) versus o hash falso (N=2^16); desaparece apos o primeiro login de cada conta.
- Voce nao precisa de `__Host-` no nome do cookie, mas e um endurecimento extra possivel.

## Cadastro so por staff: o que revisar/exigir (superficie `/api/staff/*`)

Na data desta revisao a superficie `/api/staff/*` ainda NAO existia no codigo, entao ela nao foi auditada: abaixo estao os requisitos que a implementacao deve cumprir e que merecem teste (marcado como **suspeita ate haver codigo**).

1. Toda rota `POST/PATCH/DELETE /api/staff/*` ja passa pelo hook global de Origin; exigir sessao + staff verificado no SERVIDOR (conta `staff` lida da conta, nunca de corpo/cookie), em servico, nivel minimo, rate limit e auditoria.
2. Escalonamento: helper nao cria conta com nivel de staff; ninguem concede nivel >= ao proprio (so `admin` promove, e nunca acima de `admin`); ninguem promove/rebaixa/bane a si mesmo nem staff de nivel igual/maior; o ultimo admin nao pode ser rebaixado/banido.
3. Criar conta com e-mail ja usado: responder igual para staff (409 so para staff e auditado), nunca por rota publica; nome unico e as mesmas regras de nome/homoglifos/reservados.
4. Senha provisoria: gerada pelo servidor (CSPRNG, >= 16 caracteres, nunca escolhida pelo staff nem reaproveitada), mostrada UMA vez, nunca registrada em log/auditoria, hash scrypt, `mustChangePassword=true`; enquanto pendente a sessao so acessa "trocar senha" e logout (nem WebSocket nem midia); expirar a provisoria (ex.: 72 h); a troca valida a politica de `checkPassword`, recusa repetir a provisoria e revoga as outras sessoes.
5. Ban/desativacao: checado em `authenticate` (nao so no login), revoga todas as sessoes e fecha o socket na hora, impede novo login com a mesma resposta generica de credencial invalida (sem enumeracao); auditar quem baniu e por que.
6. Enumeracao: busca de contas por staff com limite de taxa e sem listar e-mails de orgs onde o staff nao tem escopo, se isso for requisito.
7. Registro publico: `REGISTRATION_MODE=closed` em producao; `/api/register` deve continuar recusando (o teste de gate ja existe).

## Checklist de producao

- [ ] `NODE_ENV=production`, HTTPS, `PUBLIC_URL`/`ALLOWED_ORIGINS` exatos (sem curinga se possivel).
- [ ] `REGISTRATION_MODE=closed` (ou `invite`); crie primeiro as contas de dono/staff; `BOOTSTRAP_OWNER_EMAIL` e `BOOTSTRAP_STAFF_EMAILS` apenas com e-mails ja cadastrados.
- [ ] Nunca `ALLOW_DEV_LOGIN`; nao use `iniciar.bat` em producao (liga dev login e escuta em 0.0.0.0).
- [ ] `TRUST_PROXY` = numero exato de proxies (1 Cloudflare Tunnel/Caddy; 2 Cloudflare -> nginx -> node). Porta do Node so acessivel pelo proxy (`HOST=127.0.0.1` ou rede privada).
- [ ] PostgreSQL com senha forte e backup; `data/` fora do git; permissoes 0600 em `accounts.json` se usar arquivo.
- [ ] `METRICS_TOKEN` forte (ou `/metrics` fica desligado); nao publique `/metrics`.
- [ ] LiveKit: chave/segredo novos so por variavel de ambiente, URL `wss://`, imagem com versao fixa (nao `latest`), portas UDP necessarias apenas.
- [ ] No proxy/nginx: `client_max_body_size 2m`, limite de requisicoes por IP, cabecalho HSTS, CSP (o servidor Node ja envia CSP e demais cabecalhos pelo `webServer.ts`).
- [ ] Conector do PowerPoint: iniciar com `--origin https://seu-endereco`; nunca com origem `*`.
- [ ] Rode `npm audit --omit=dev`, `npm run typecheck`, `npm test`, `npm run build` antes de cada publicacao.
