# Staff da plataforma (Administrador do WorkVerse)

Staff é o papel de **plataforma** (suporte, moderação e administração de contas), distinto dos papéis de organização
(owner/admin/member/guest). Quem é staff usa o **crachá dourado** e o selo `STAFF` sobre o nome.
Código: `apps/server/src/staff.ts` (poderes ao vivo), `staffAdmin.ts` + `staffRoutes.ts` (contas, equipe, auditoria),
`passwordRoutes.ts` (troca de senha), `packages/shared/src/staff.ts` (níveis e tipos) e o painel em `apps/client/src/ui/staff/`.

## Contas só por staff

Ninguém se cadastra sozinho: `REGISTRATION_MODE` é **`closed` por padrão** (também em desenvolvimento). A tela de login só tem
"Entrar" e a mensagem "Peça a quem administra para criar sua conta". `open` e `invite` continuam existindo, mas só por escolha
explícita. `ALLOW_DEV_LOGIN=1` (login só pelo nome, para testes) segue funcionando em desenvolvimento.

Quem cria a conta:

- **Painel** (aba **Contas** → "+ Nova conta"), nível **moderador** ou **administrador**: e-mail, nome de exibição, organização,
  equipe, papel e senha (gerada forte ou definida). A senha provisória é mostrada **uma única vez** com botão "Copiar" (o servidor
  guarda só o hash; ela nunca vai para o log nem para a auditoria). Moderador atribui até "Membro"; administrador até "Dono".
- **CLI**: `npm run account:create -w @workverse/server -- email nome [senha] [--trocar-senha]`. Sem senha, gera uma provisória
  (mostrada uma vez) e marca a troca obrigatória. Com JSON, pare o servidor antes; com PostgreSQL basta reiniciar para a conta
  entrar na organização padrão.
- **Primeiro dono**: `BOOTSTRAP_OWNER_EMAIL` pode se cadastrar sem convite enquanto não houver conta com senha (ver `registration.ts`).

### Senha provisória e troca obrigatória

Conta criada por staff (ou com senha redefinida) fica com `mustChangePassword`. Enquanto isso:

- o login funciona, mas `/api/me` traz `mustChangePassword: true` e **todo o resto de `/api/*` responde 403
  `password_change_required`**; o WebSocket recusa o `hello`;
- o cliente mostra a tela "Crie sua senha" (senha provisória + nova + confirmação) antes de entrar; depois da troca vai para a
  escolha de visual e para o escritório.

Qualquer pessoa também troca a própria senha em **"Alterar senha"** (ícone de chave na barra): `POST /api/account/password
{ current, next }`. Mesma política do cadastro (10 a 128 caracteres, sem senhas comuns), nova diferente da atual, 5 tentativas
erradas de senha atual e depois 1 por minuto. **Revoga todas as outras sessões** (cookies e WebSocket); a atual continua.

## API de administração (`/api/staff/*`)

Cada rota exige: sessão válida, conta staff, **estar em serviço**, nível mínimo e limite de taxa (leituras 40 de rajada/4 por s;
escritas 15/1 por s). Escritas passam pela checagem de Origin/CSRF do hook global (e o cookie é `SameSite=Strict`). Corpo
estrito: campo desconhecido é `400`. Conta comum ou nível insuficiente recebe um `403 forbidden` genérico (registrado como
`staff.denied`). Toda mudança é auditada.

| Rota | Faz | Nível |
|---|---|---|
| `GET /api/staff/accounts?q=&filter=all\|online\|staff\|blocked` | lista/busca (até 100) | helper |
| `GET /api/staff/accounts/:id` | ficha (organizações, banimento, silêncio, desbloqueios; sem hash nem DMs) | helper |
| `POST /api/staff/accounts` | cria conta com senha provisória | moderator |
| `POST /api/staff/accounts/:id/reset-password` | nova senha provisória + revoga sessões | moderator |
| `PATCH /api/staff/accounts/:id` `{disabled, reason?}` | desativa/reativa (derruba sessões) | moderator |
| `POST /api/staff/accounts/:id/ban` `{minutes\|null, reason}` / `.../unban` | banir (reversível) / liberar | moderator |
| `GET /api/staff/team` | lista da equipe staff | helper |
| `POST /api/staff/team` `{identifier, level}` | adiciona staff (e-mail, nome ou id) | admin |
| `PATCH /api/staff/team/:id` `{level}` / `DELETE` | altera nível / remove | admin |
| `GET /api/staff/orgs` | organizações e equipes (formulário de conta) | helper |
| `GET /api/staff/audit` e `/audit.csv` | auditoria com filtros / exportação | moderator |
| `GET /api/staff/announcements` | histórico de avisos | helper |

Regras: não se age sobre si mesmo nem sobre staff de nível igual ou maior (reset, desativar, banir). Moderador bane até 30 dias;
**banimento permanente é só administrador**; motivo obrigatório.

### Ban, desativação e silêncio (persistentes)

Ficam na própria conta (`Account.ban`, `disabled`, `mute`; no PostgreSQL vão em `accounts.extra`, sem migração) e sobrevivem a
reinício. Banir ou desativar **derruba as sessões** (cookie e WebSocket, que recebe `kicked`) e bloqueia o login
(`403 account_banned` / `account_disabled` depois de a senha estar correta). Ban temporário vencido deixa entrar sozinho.
O silenciamento (chat, DM e equipe) também persiste e vale em qualquer sessão.

## Equipe de staff (gerenciada pelo painel)

Aba **Equipe staff**: só **administrador** adiciona, promove, rebaixa ou remove. O efeito é **imediato, sem reiniciar o servidor**:
grava `Account.staff` (JSON ou PostgreSQL, coluna `accounts.staff` da migração `0003`) e reconcilia a sessão online: selo, painel e
poderes mudam na hora; quem é removido recebe `staff_revoked` e perde o painel. Salvaguardas:

- **não rebaixa nem remove o último administrador ativo** (`409 last_admin`; admin desativado/banido não conta);
- contas definidas em `BOOTSTRAP_STAFF_EMAILS` são **só pela variável de ambiente** (`409 env_managed`), senão voltariam no login;
- conta de teste (sem senha), desativada ou banida não vira staff.

Outras formas de conceder (`BOOTSTRAP_STAFF_EMAILS=email[:nivel],...` e `npm run staff:grant|revoke|list`) continuam valendo; o CLI
grava direto no armazenamento (reinicie o servidor depois).

Níveis: `helper` (Ajudante), `moderator`, `admin`. Campo `Account.staff`.

## Painel (botão **Staff** na barra, janela arrastável)

Tudo é botão (os comandos de chat continuam funcionando). Ações destrutivas pedem confirmação; sucesso e erro aparecem como aviso
(`aria-live`); abas com `role=tablist` e setas do teclado; botões desativados quando o nível/serviço não permite.

- **Online**: contagem, busca, lista com sala/org/status; por pessoa: ir até, trazer, silenciar (duração) e liberar, tirar da sala,
  expulsar da sessão, banir conta (tempo ou permanente + motivo), ver ficha, conceder/revogar item (admin), mensagem privada de staff.
- **Salas**: população por organização/sala, "ver quem está", avisar a sala, **trancar** (ninguém novo entra) / destrancar,
  **fechar** (tranca e manda todos para a sala inicial) / reabrir, **esvaziar**. A sala inicial nunca é trancada nem esvaziada. Staff
  em serviço continua podendo entrar. O estado das salas é em memória (volta "aberta" ao reiniciar).
- **Avisos**: sala (qualquer uma), organização ou global, com **destaque** (faixa maior e mais tempo) e histórico.
- **Contas**: busca/filtros, ficha, nova conta, redefinir senha, desativar/reativar, banir/remover banimento; mostra último login e
  organização.
- **Equipe staff**: ver (todos) e gerenciar (admin).
- **Modo**: em serviço, invisível, crachá dourado (segue o serviço) e o que o seu nível permite.
- **Log**: auditoria permanente com filtros (staff, alvo, ação, data) e **exportar CSV** (UTF-8 com BOM; células iniciadas por
  `= + - @` são neutralizadas contra injeção de fórmula). Ajudante vê só as últimas ações ao vivo.

## Poderes por nível

| Ação | Mínimo |
|---|---|
| Entrar/sair de serviço, invisível, lista de online, ir/trazer, silenciar até 30 min, tirar da sala, avisar a sala, mensagem de staff, ver salas, listar/ver contas | helper |
| Silenciar até 24 h, expulsar da sessão, aviso global e por organização, trancar/fechar/esvaziar salas, criar conta, redefinir senha, desativar, banir (até 30 dias), log e CSV | moderator |
| Silenciar até 7 dias, conceder/revogar item, **gerenciar a equipe**, banir permanente | admin |

Comandos de chat (só para staff; para os demais o chat segue como antes): `/staff on|off`, `/invis`, `/online`, `/goto`, `/bring`,
`/mute nome min [motivo]`, `/unmute`, `/kickroom`, `/kick`, `/avisosala`, `/aviso`, `/dar nome chave`, `/tirar nome chave`.

## Crachá dourado

Item `sp.badge_staff`, verificado pelo servidor: em serviço é imposto no visual exibido; fora de serviço (ou conta comum) é removido.
`staff` e `item:sp.badge_staff` não valem em `Account.unlocks`. O selo `STAFF` vem de `PlayerView.staff`/`staff_flag`, definidos pelo servidor.

## Limites e segurança

- Staff **não lê DMs nem mídia privada**; a lista traz só presença. A auditoria nunca guarda texto de DMs de usuários (só mensagens
  que a própria staff escreve pelo botão "Mensagem de staff").
- E-mail **mascarado** (`a***@e***.com`) para helper e moderador, completo só para administrador (lista, ficha e busca: o helper não
  descobre e-mail por tentativa).
- Isolamento por organização: `goto`/`bring` só dentro da org da staff; silenciar, expulsar, avisar e controlar salas valem para
  qualquer org, e tudo é registrado.
- Cliente forjando `staff_*`, `/comandos` ou rotas `/api/staff/*` recebe `forbidden` genérico (`staff.denied`).
- Invisível: some dos outros na sala; continua contando na população.

## Auditoria

Toda ação (WebSocket, painel/API e comandos) passa por `StaffService.record()`: log estruturado `staff.action`
(`at, actor, actorName, level, action, target, targetName, detail`), anel em memória para o painel e **tabela permanente**:
arquivo JSON (campo `audit` de `accounts.json`) ou PostgreSQL (`staff_audit`, migração `0004_staff_audit.sql`, sem FK para
`accounts`). Em memória ficam os 10 000 registros mais recentes (consulta e CSV); a tabela guarda tudo. Ações registradas incluem
`account.create|reset_password|disable|enable|ban|unban|view`, `staff.add|set_level|remove`, `room.lock|unlock|close|open|empty`,
`announce.room|org|all`, `dm`, `mute`, `kick.*`, `goto`, `bring`, `item.*`, `duty.*`, `invis.*` e `audit.export`.

## Testes

- `apps/server/test/staffAdmin.test.ts`: criação por staff (e negada para não-staff/helper/fora de serviço/origem estranha),
  validação estrita, troca obrigatória, reset, desativar, ban (níveis, expiração, persistência em JSON), equipe (promover/rebaixar,
  hierarquia, último admin, env), ficha e e-mail mascarado, botões por nível no WebSocket (DM de staff, aviso por org, salas),
  silêncio persistente, auditoria (filtros, CSV, DMs fora do log).
- `apps/server/test/staffPg.test.ts`: PostgreSQL real (migração 0004, criar/banir/promover, reiniciar o store e conferir contas e
  auditoria).
- `apps/server/test/staff.test.ts` (poderes ao vivo) e o contrato de store em `apps/server/test/helpers/storeContract.ts`.
