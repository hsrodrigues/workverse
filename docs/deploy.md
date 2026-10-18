# Colocar o WorkVerse online (sem Docker)

O servidor Node serve **o site, a API e o WebSocket na mesma porta e no mesmo domínio** (necessário para o cookie
`SameSite=Strict`). Não há cadastro público: **só a staff cria contas**.

Comum aos quatro caminhos:

- Node.js 22+ (testado com 24).
- Variáveis de ambiente (ou o arquivo `.env.production` no PC; veja `.env.production.example`, tudo comentado).
- Em `NODE_ENV=production` o servidor **recusa iniciar** com configuração insegura e explica o que corrigir.

## Variáveis de produção

| Variável | Para quê |
| --- | --- |
| `PUBLIC_URL` | Endereço público, `https://...` sem barra final. Vira a origem permitida (`ALLOWED_ORIGINS` é derivado dele). |
| `ALLOWED_ORIGINS` | Opcional, extras separados por vírgula. Aceita `https://*.trycloudflare.com` (um rótulo). |
| `DATABASE_URL` | PostgreSQL (Neon/Supabase), com `sslmode=require`. Sem ele: erro, a menos que `ALLOW_JSON_STORE=1`. |
| `MIGRATE_ON_BOOT=1` | Cria/atualiza as tabelas ao iniciar. |
| `REGISTRATION_MODE` | `closed` (padrão, só staff cria contas), `invite` (link de convite) ou `open` (só para testes). |
| `BOOTSTRAP_STAFF_EMAILS` | `email:admin,...` promove contas já criadas a staff. |
| `LIVEKIT_URL`, `PUBLIC_LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | Áudio/vídeo/tela. Sem eles a mídia fica desligada (aviso), o resto funciona. URL sempre `wss://`. |
| `METRICS_TOKEN` | Libera `GET /metrics` (`Authorization: Bearer ...`). Sem ele `/metrics` fica desligado. `Iniciar-Producao.bat` e `Publicar-*.bat` geram um token forte e o gravam em `.env.production` (procure a linha `METRICS_TOKEN=`). |
| `TRUST_PROXY` | Nº de proxies à frente (padrão **1** em produção: Cloudflare, Caddy, Railway, Render). `0` desliga. |
| `PORT` / `HOST` | Padrão 8080 / `0.0.0.0`. Atrás de túnel ou Caddy no mesmo PC use `HOST=127.0.0.1`. |
| `WEB_ROOT` | Pasta do site (padrão `apps/client/dist`). |

Verificações automáticas na partida: `ALLOW_DEV_LOGIN` ligado, falta de origem pública, falta de `DATABASE_URL`,
`PUBLIC_URL` sem https, `ws://` remoto no LiveKit e `REGISTRATION_MODE`/`TRUST_PROXY` inválidos **abortam**; LiveKit
ausente, `METRICS_TOKEN` ausente e JSON como armazenamento viram **aviso**. `GET /health` é o healthcheck e
`SIGTERM`/`SIGINT` desligam com graça (gravam o banco, fecham conexões; limite de 10 s).

## Antes de tudo: banco, LiveKit e a primeira conta

**Banco (Neon, grátis).** Crie um projeto em <https://neon.tech>, copie a *connection string* (já vem com
`?sslmode=require`) e use como `DATABASE_URL`. Defina `MIGRATE_ON_BOOT=1` no primeiro start. Supabase funciona igual
(use a string do *pooler* em modo sessão ou a direta). Sem banco, num PC com disco próprio, `ALLOW_JSON_STORE=1` basta
(arquivo `apps/server/data/accounts.json`).

**LiveKit Cloud (grátis).** Crie um projeto em <https://cloud.livekit.io>, abra *Settings > Keys*, crie uma chave e
copie as três informações:

```
LIVEKIT_URL=wss://seu-projeto.livekit.cloud
PUBLIC_LIVEKIT_URL=wss://seu-projeto.livekit.cloud
LIVEKIT_API_KEY=API...
LIVEKIT_API_SECRET=...
```

Versão do servidor LiveKit local/Docker: fixa em **v1.13.10** (`scripts/setup-livekit.ps1` e `docker-compose.yml`). Para atualizar, troque a versão nesses dois lugares, apague `tools/livekit/livekit-server.exe` e rode `npm run livekit:setup`. No LiveKit Cloud a versão é gerenciada por eles.

O token entregue ao navegador usa `PUBLIC_LIVEKIT_URL` (ou `LIVEKIT_URL`) e o navegador conecta por `wss://`. O
`tools/livekit` (servidor local) é **só para desenvolvimento**.

**Primeira conta (dona).** Com o servidor **parado**:

```bash
npm run account:create -w @workverse/server -- voce@email.com SeuNome          # gera e mostra uma senha
npm run account:create -w @workverse/server -- voce@email.com SeuNome "senha longa aqui"
```

Use as mesmas variáveis do servidor (`DATABASE_URL` ou `DATA_DIR`). Depois ponha o e-mail em
`BOOTSTRAP_STAFF_EMAILS=voce@email.com:admin` e inicie. A primeira conta com senha vira dona da organização padrão.
As demais contas são criadas pela staff no painel (ou pelo mesmo comando).

---

## A) Online AGORA, do seu PC (Cloudflare quick tunnel)

Sem conta, sem domínio, sem abrir portas no roteador. O link `https://xxxx.trycloudflare.com` é aleatório e muda a cada vez.

1. Dê dois cliques em **`Publicar-Online.bat`** (na primeira vez cria `.env.production` a partir do modelo, instala
   dependências, gera o site e baixa o `cloudflared` oficial para `tools/cloudflared`, conferindo o SHA-256 publicado).
2. Aguarde o destaque **`SEU LINK: https://...trycloudflare.com`** e mande o link às pessoas.
3. Se a janela mostrar "ALLOW_DEV_LOGIN esta ligado", você abriu a partir de um terminal do `iniciar.bat`: o script se recusa a publicar assim. Feche e abra de novo.
4. Deixe a janela aberta. Fechar (ou Ctrl+C) tira o site do ar.

Detalhes: o script sobe o túnel, captura a URL, inicia o servidor com `PUBLIC_URL` igual a ela (origem exata, sem
curinga) e `HOST=127.0.0.1`. Sem `DATABASE_URL` usa o JSON local. Contas e dados persistem entre execuções; só o link muda.
O PC precisa ficar ligado. Vale para demonstração e times pequenos.

## B) Domínio próprio no Cloudflare (túnel nomeado, link fixo)

Requer um domínio com DNS na Cloudflare (conta grátis). Uma vez (o `cloudflared.exe` fica em `tools\cloudflared`
depois de rodar `Publicar-Online.bat` uma vez):

```bat
tools\cloudflared\cloudflared.exe login
tools\cloudflared\cloudflared.exe tunnel create workverse
tools\cloudflared\cloudflared.exe tunnel route dns workverse escritorio.seudominio.com
```

No `.env.production`:

```
TUNNEL_NAME=workverse
PUBLIC_URL=https://escritorio.seudominio.com
```

Depois, sempre que quiser publicar: **`Publicar-Dominio.bat`**. Alternativa manual com `config.yml`
(`%USERPROFILE%\.cloudflared\config.yml`):

```yaml
tunnel: workverse
credentials-file: C:\Users\SEU_USUARIO\.cloudflared\<ID-DO-TUNEL>.json
ingress:
  - hostname: escritorio.seudominio.com
    service: http://127.0.0.1:8080
  - service: http_status:404
```

e `cloudflared tunnel run workverse` junto com `Iniciar-Producao.bat`. Para virar serviço do Windows:
`cloudflared service install`. O WebSocket funciona pelo túnel sem configuração extra.

## C) VPS Linux (sem Docker)

Debian/Ubuntu, domínio apontando (registro A) para o IP da VPS.

```bash
# Node 24
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash - && sudo apt install -y nodejs git
git clone <seu-repositorio> /opt/workverse && cd /opt/workverse
npm ci --include=dev && npm run build:prod
sudo useradd -r -s /usr/sbin/nologin workverse && sudo chown -R workverse /opt/workverse
```

Crie `/opt/workverse/.env.production` (modo 600) com `PUBLIC_URL=https://escritorio.seudominio.com`, `DATABASE_URL`
(Neon), `MIGRATE_ON_BOOT=1`, LiveKit, `BOOTSTRAP_STAFF_EMAILS`, `METRICS_TOKEN`, `HOST=127.0.0.1`, `PORT=8080`.
Crie a conta dona (servidor parado) com `npm run account:create ...`.

**systemd** (`/etc/systemd/system/workverse.service`):

```ini
[Service]
User=workverse
WorkingDirectory=/opt/workverse
ExecStart=/usr/bin/node scripts/prod.mjs start
Restart=always
KillSignal=SIGINT
TimeoutStopSec=15
[Install]
WantedBy=multi-user.target
```

`sudo systemctl enable --now workverse`. (Com **pm2**: `pm2 start "node scripts/prod.mjs start" --name workverse && pm2 save && pm2 startup`.)

**Caddy** (HTTPS automático) em `/etc/caddy/Caddyfile`:

```
escritorio.seudominio.com {
  reverse_proxy 127.0.0.1:8080
}
```

(Caddy já encaminha WebSocket e `X-Forwarded-For`; `TRUST_PROXY=1` é o padrão.)

**Firewall:** `sudo ufw allow OpenSSH && sudo ufw allow 80,443/tcp && sudo ufw enable`. Não libere a 8080.

## D) Railway / Render

- Build: `npm ci --include=dev && npm run build:prod` (ou `npm install --include=dev`). Start: `npm run start:prod`.
- Variáveis: `NODE_ENV=production`, `PUBLIC_URL=https://seu-app.up.railway.app` (ou o domínio próprio), `DATABASE_URL`
  (Neon), `MIGRATE_ON_BOOT=1`, LiveKit, `BOOTSTRAP_STAFF_EMAILS`, `METRICS_TOKEN`. Deixe `HOST` padrão e `TRUST_PROXY=1`.
  A plataforma define `PORT` sozinha. Healthcheck: `/health`.
- **Disco efêmero:** nunca use `ALLOW_JSON_STORE` aqui, os dados somem a cada deploy. Use o Postgres.
- A primeira conta dona: rode o `account:create` num shell da plataforma (`railway run npm run account:create -w @workverse/server -- email nome`
  usa o `DATABASE_URL` do projeto) **antes** de abrir ao público.

---

## Primeiros passos depois de publicar

1. Entre com a conta dona (criada pelo CLI). Ela aparece com o crachá de staff se estiver em `BOOTSTRAP_STAFF_EMAILS`.
2. Crie as contas do time pelo painel de staff (ou pelo CLI). Quem recebe uma senha provisória deve trocá-la.
3. Para convites por link em vez de contas criadas pela staff, use `REGISTRATION_MODE=invite` (o link é
   `https://seu-site/invite/CODIGO`). Padrão e recomendado: `closed`.

## Backup, atualização e reinício

- **Backup:** `npm run db:backup` (precisa do `pg_dump`; no Windows `npm run pg:tools` baixa). Para o JSON local,
  copie `apps/server/data/accounts.json`. Restaurar: `npm run db:restore`.
- **Atualizar:** `git pull`, `npm ci --include=dev`, `npm run build:prod`, reinicie o serviço. Os arquivos do site mudam
  de nome a cada build; recarregar a página basta.
- No PC: `Iniciar-Producao.bat` / `Publicar-*.bat` refazem o build sozinhos quando o código muda.

## Solução de problemas

| Sintoma | Causa e saída |
| --- | --- |
| "Configuracao insegura ou incompleta" ao iniciar | Leia a lista: cada linha diz a variável a corrigir. |
| Login dá "Origem não permitida" | `PUBLIC_URL`/`ALLOWED_ORIGINS` diferem do endereço que você digitou (http x https, www, porta). |
| Entra e cai logo / "Sessão expirada" | Site e API em domínios diferentes, ou HTTP puro (o cookie é `Secure`). Use HTTPS no mesmo domínio. |
| Todos bloqueados juntos (429) | `TRUST_PROXY=0` atrás de proxy: todos parecem o mesmo IP. Use `1`. |
| Sem áudio/vídeo | LiveKit sem chaves (veja o aviso na partida), URL sem `wss://`, ou navegador sem HTTPS (microfone exige). |
| Página em branco após atualizar | Faça `npm run build:prod` e recarregue com Ctrl+F5. |
| Link do quick tunnel não abre | Pode levar alguns segundos; rode o `.bat` de novo (gera outro link). |
| Contas sumiram no Railway/Render | Estava no JSON em disco efêmero. Use `DATABASE_URL`. |

## Checklist de segurança antes de abrir ao público

- [ ] `NODE_ENV=production` e a partida sem erros.
- [ ] `ALLOW_DEV_LOGIN` **não** existe no ambiente.
- [ ] HTTPS ativo (túnel, Caddy ou plataforma) e `PUBLIC_URL` com `https://`.
- [ ] `REGISTRATION_MODE=closed` (ou `invite` conscientemente). Nunca `open`.
- [ ] PostgreSQL gerenciado com backup (`npm run db:backup` agendado); senha do banco forte.
- [ ] `METRICS_TOKEN` longo e aleatório, ou deixe `/metrics` desligado.
- [ ] Porta do Node fechada ao mundo (`HOST=127.0.0.1` ou firewall); só o proxy/túnel a alcança.
- [ ] `.env.production` fora do git (já está no `.gitignore`) e com permissão restrita.
- [ ] Conta dona com senha longa; staff só para quem precisa.
- [ ] Revisão de segurança concluída (ver pendências no README: sem recuperação de senha, sem 2FA).

## O que NÃO fazer

- Nunca `ALLOW_DEV_LOGIN=1` em produção (entra sem senha; o servidor recusa iniciar).
- Não exponha a porta do Node direto com `TRUST_PROXY` ligado (o IP pode ser forjado); use proxy/túnel.
- Não use `ALLOW_JSON_STORE` em plataformas de disco efêmero.
- Não use `REGISTRATION_MODE=open` na internet.
- Não rode `account:create` com o JSON local enquanto o servidor está ligado (ele sobrescreve o arquivo).
- Não use o `livekit-server` de `tools/livekit` em produção.
- Não commite `.env.production`, chaves do LiveKit nem a `DATABASE_URL`.
