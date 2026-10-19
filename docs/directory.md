# Cargos, setores, crachá e atendente da recepção

## Modelo
- **Setor** = a equipe (`teams`) da organização: nome (2 a 24 caracteres) + cor de uma **paleta fixa** de 10 cores (`DEPT_PALETTE`, `packages/shared/src/directory.ts`). A equipe padrão "Geral" conta como "sem setor" (sem pílula, sem botão no diretório).
- **Cargo** = texto curto por pessoa e por organização (`org_members.title`, até 32 caracteres; migração `0006_member_title.sql`; no arquivo JSON vai no próprio vínculo). Sem controle, zero-width, bidi, emoji nem HTML (`cleanTitle`, mesma `isForbiddenChar` do chat). Contas antigas continuam sem cargo/setor, sem etiqueta.
- Quem define: **staff** (moderador ou acima) pelo painel (abas *Contas* → "Cargo e setor" e *Setores*, rotas `PATCH /api/staff/accounts/:id/profile` e `/api/staff/orgs/:orgId/depts[/:teamId]`, auditadas como `account.profile`, `dept.create`, `dept.update`) e **admin/dono da organização** pela API (`PATCH /api/orgs/:id/members/:accountId` com `title`/`teamId`, `POST/PATCH /api/orgs/:id/teams`, permissão `team.manage`). A pessoa comum **não** muda o próprio cargo. Setor/cargo de outra organização nunca é aceito.
- Ao vivo: o servidor manda `{ t: 'profile', id, title?, dept?, deptColor? }` para a sala da pessoa; `PlayerView` também carrega os campos opcionais `title`, `dept`, `deptColor`.

## O que se vê
- Sobre o avatar: só uma **pílula minúscula com o setor** (abreviado, cor do setor), ao lado do nome; o cargo não aparece no mundo.
- Ao clicar no avatar, na lista de Pessoas (clique no nome) e nos resultados da atendente: a **ficha/crachá compacto** (`BadgeCard`): foto = cabeça do avatar (vista frontal) sobre a cor do setor, nome, cargo, setor, selo STAFF (só de staff em serviço).
- O item de avatar *Crachá corporativo* (`sp.badge*`) desenha um mini retrato (pele e cabelo da própria pessoa) e a faixa na cor do setor.

## Atendente NPC (recepção)
Desenhada só no cliente, sentada na cadeira atrás do balcão (tile 10,2 da recepção): **não é jogador** (fora de população, presença e listas). Clique abre o painel *Atendimento*: setor → nome (busca parcial sem acento/caixa) → fichas com "Ir até a sala" (`join`), "Chamar" (`meeting_invite`) e "Mensagem" (DM). Um "?" aparece de tempos em tempos sobre ela.

Servidor: `dir_search { dept?, q? }` → `dir_result { depts, dept, q, results, truncated }`. Permissão `dir.search` (membros e acima; visitantes não), limite de pedidos por jogador (6 de rajada, 1/s), no máximo 20 resultados, isolado por organização (setor de outra org = sem resultados), sem e-mail nem id de conta, sem contas desativadas/banidas/suspensas; staff invisível aparece como offline; sala só é dita quando quem pergunta pode entrar nela (senão `roomHidden`, "em uma sala privada").
