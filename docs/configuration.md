# Configuração e autenticação

## Variáveis de ambiente (servidor)

| Variável | Padrão | Descrição |
| --- | --- | --- |
| `PORT` | `3001` (dev), `8080` (produção) | Porta HTTP/WebSocket |
| `HOST` | `0.0.0.0` | Interface de escuta |
| `DATA_DIR` | `./data` | Onde ficam `accounts.json` (contas, hashes de senha, sessões e avatares) e os dados locais |
| `DATABASE_URL` | *(vazio)* | Se definida, usa PostgreSQL em vez do arquivo JSON (veja [database.md](database.md)) |
| `ALLOWED_ORIGINS` | *(vazio)* | Origens permitidas na API e no WebSocket, separadas por vírgula. **Defina em produção.** |
| `NODE_ENV` | *(vazio)* | Com `production`, o cookie de sessão recebe `Secure` (exige HTTPS) e as verificações de segurança de inicialização ficam ativas |
| `ALLOW_DEV_LOGIN` | *(vazio)* | `1` aceita `hello` só com nome, sem senha (desenvolvimento, bots, testes). **O servidor recusa iniciar com `NODE_ENV=production`.** |
| `TRUST_PROXY` | `0` (dev), `1` (produção) | Número de proxies confiáveis à frente (Cloudflare, Caddy...). Sem isso, todos os limites de taxa veem o IP do proxy |
| `PUBLIC_URL` | *(vazio)* | Endereço público; vira origem permitida |
| `KEEPALIVE` | automático | Autoping (veja [deploy.md](deploy.md#autoping-render-gratuito)): liga sozinho só com `NODE_ENV=production` e `PUBLIC_URL` https que não seja localhost; `on` força, `off` desliga |
| `KEEPALIVE_MINUTES` | `10` | Intervalo do autoping, de 1 a 14 (o plano gratuito do Render dorme após ~15 min) |
| `PET` | *(ligado)* | `off` desliga o Byte, o pet do escritório, em todo o servidor ([pet.md](pet.md)) |
| `REGISTRATION_MODE` | `closed` | `closed`, `invite` ou `open`. O padrão é cadastro fechado: só a equipe cria contas |
| `WEB_ROOT` | `apps/client/dist` | Pasta do site servido pelo próprio servidor |
| `BOOTSTRAP_STAFF_EMAILS` | *(vazio)* | `email:nivel,email2:nivel` — concede staff (`helper`, `moderator`, `admin`) a contas já existentes |
| `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `PUBLIC_LIVEKIT_URL` | dev: `devkey` / `secret` / `ws://localhost:7880` | Mídia (veja [media.md](media.md)) |
| `METRICS_TOKEN` | *(vazio)* | Token do endpoint `/metrics`; em produção sem token ele fica desabilitado |

Cliente: `VITE_WS_URL` (opcional) sobrescreve a URL do WebSocket; por padrão usa `/ws` na mesma origem
(proxy do Vite em desenvolvimento).

Modelo comentado para produção: `.env.production.example`. Para o ambiente local, um arquivo `.env.local`
(ignorado pelo git) é lido pelo `iniciar.bat`.

## Autenticação

- **Contas:** e-mail (normalizado, único) + nome de exibição (único, sem diferenciar maiúsculas) + senha
  (10 a 128 caracteres; senhas comuns, repetidas ou iguais ao e-mail/nome são recusadas). A senha é guardada só como
  hash **scrypt** com sal próprio; a comparação é em tempo constante.
- **Cadastro:** público **fechado** por padrão. Contas são criadas pela equipe (painel de staff) ou pelo comando
  `npm run account:create -w @workverse/server -- email nome [senha]` (com o servidor parado).
- **Sessão:** cookie `wv_session` `HttpOnly`, `SameSite=Strict` (e `Secure` em produção), com 30 dias de validade. O
  servidor guarda apenas o SHA-256 do token; sair revoga a sessão e derruba o WebSocket. O WebSocket só abre com cookie
  válido (senão `401` antes do upgrade). Uma sessão ativa por conta e, no máximo, 10 sessões guardadas.
- **API:** `GET /api/config`, `GET /api/me`, `POST /api/login`, `POST /api/logout` (mais as rotas da equipe em
  `/api/staff/*`). Erros vêm como `{ "error": { "code", "message", "retryAfterSeconds"? } }`; login com e-mail
  inexistente e com senha errada devolve a mesma mensagem.
- **Abuso:** limites de taxa por IP e por e-mail (`429` + `Retry-After`), bloqueio progressivo após falhas, verificação
  de `Origin` em toda rota que altera dados e no WebSocket, limites de conexões por IP e por conta.
- O arquivo `accounts.json` (modo `0600`) contém hashes de senha: trate-o como segredo (ele está no `.gitignore`).

Mais detalhes em [security.md](security.md).
