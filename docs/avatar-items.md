# Avatares, itens e guarda-roupa

## 1. Diagnóstico (estado antes desta expansão)

- `AvatarConfig` era um conjunto de 10 índices numéricos (`skin`, `hairStyle`, `top`, ...) em catálogos append-only
  (`packages/shared/src/avatar.ts`). Nada de ids estáveis, compatibilidade entre peças, desbloqueio ou raridade.
- O renderer (`apps/client/src/game/avatarRenderer.ts`, ~1900 linhas) era um arquivo único: um esqueleto 3D mínimo
  (quadril, joelhos, ombros...) projetado em 4 visões, cada parte rasterizada numa máscara de 1 bit e pintada com
  3 tons chapados + contorno seletivo. Cada peça era um `if (style === n)` espalhado em várias funções.
- Aparência salva em `Account.avatar` (JSON), enviada por `hello`/`avatar` e transmitida a toda a sala.
- O editor (`AvatarEditor.tsx`) só tinha chips de texto e amostras de cor, sem miniaturas, sem confirmação de erro
  do servidor e sem guarda-roupa.
- Não existem poses "trabalhando" nem "conversando": só parado, andar, sentar e acenar. Isto continua valendo.

Detalhes da solução, arquivos e pendências nas seções seguintes (preenchidas ao final da implementação).

## 2. Solução

- **Catálogo** (`packages/shared/src/items/`): itens com id estável, slot, paleta, `unlock` (free|achievement|event|staff),
  `availability` e `poses`/`views` (suporte por pose: `full`, `adapted`, `hidden`). Itens sem arte numa pose ficam ocultos
  nela (nunca um sprite quebrado): notebook e tablet não aparecem andando/acenando; a caneca não aparece acenando.
  Não existem poses "trabalhando" nem "conversando": só parado, andar, sentar e acenar.
- **Desenho** (`apps/client/src/game/avatar/drawers/`): um drawer por chave `drawer` do catálogo; `faceExtra.ts`
  (olhos, sobrancelhas, bocas, barba), `outers.ts` (bomber, cardigã, colete, avental), `accessories2.ts` (chapéu, bucket,
  óculos AR, mochila, relógio), `specials.ts` (notebook, tablet, caneca, crachá, chapéus de festa). O teste
  `apps/client/test/avatar-drawers.test.ts` garante que todo item do catálogo tem drawer e renderiza em todas as vistas.
- **Servidor** (`apps/server/src/wardrobe.ts`): `canUse(account, item)`, validação estrita (item inexistente, slot errado,
  cor fora da paleta, incompatível, bloqueado/indisponível, com mensagem em português), persistência em `Account.avatar`,
  `Account.outfits` (máx. 12, nome 1-24 caracteres sanitizado, só referências) e `Account.unlocks`. Mensagens autenticadas
  pelo WebSocket: `wardrobe_get`, `avatar_save`, `outfit_save`, `outfit_delete`, `outfit_apply` (respostas `wardrobe` e
  `avatar_result`, com `rid`). A mensagem antiga `avatar` continua válida (migra o formato legado, valida e transmite).
  Tudo é gratuito por padrão; não há compras.
- **Editor** (`apps/client/src/ui/AvatarEditor.tsx` + `ui/avatar/`): prévia ampliada em tempo real, abas por categoria,
  grades de miniaturas desenhadas pelo próprio item (pixel nítido), cor por item, filtros, Confirmar/Cancelar/Restaurar
  padrão, comparação com o visual salvo, "Meu Guarda-Roupa" (equipar/remover, salvar, vestir, atualizar e excluir conjuntos).

## 3. Pendências conhecidas

- Barba cheia em vista 3/4 cobre a bochecha inteira (visual pesado).
- O Gorro de Natal segue `upcoming` (não equipável).
- Não há endpoint REST para o guarda-roupa: tudo passa pelo WebSocket autenticado por cookie.

## 4. Itens bloqueados: como desbloquear

- **No editor:** clicar num item bloqueado mostra "Como desbloquear: ..." (texto de `describeUnlock`); itens de equipe ou de
  evento dizem "Peça a um administrador".
- **Chaves de desbloqueio** (`Account.unlocks`): `staff` (itens da equipe), `achievement:<nome>`, `event:<nome>` e
  `item:<id>` (um item específico, também libera itens `hidden`).
- **Administrador:** `POST /api/admin/unlocks` com `{ "accountId": "..." | "email": "...", "key": "staff", "revoke": false }`.
  Exige sessão de owner/admin (`can(actor, 'member.invite', ...)`) numa organização em que a conta alvo também é membro
  ativo. Responde `{ ok, changed, unlocks }`; chave inválida, 400; conta inexistente, 404; sem permissão, 403.
- **Desenvolvimento** (apenas com `ALLOW_DEV_LOGIN=1`): no chat, `/desbloquear <chave>` ou `/desbloquear todos` concede a si
  mesmo; depois reabra o editor de visual. Fora do modo de desenvolvimento o comando não existe.

## 5. Cabelos femininos e filtro de gênero

12 novos penteados (`hair.long_bangs`, `hair.wavy`, `hair.volume`, `hair.braids`, `hair.pigtails`, `hair.high_pony`,
`hair.messy_bun`, `hair.low_bun`, `hair.bob_asym`, `hair.pixie`, `hair.half_up`, `hair.sidelocks`), desenhados em
`drawers/hairFem.ts` com a paleta de cabelo (inclui fantasia). Os ids antigos não mudaram; os cabelos receberam as tags
`feminino`, `masculino` ou `unissex`, usadas pelos filtros da aba Cabelo. Todos os itens servem a qualquer pessoa.

## 6. Pernas

Em pé as pernas são retas e paralelas (pés logo abaixo dos quadris, pontas para a frente do corpo, joelho quase sem dobra).
