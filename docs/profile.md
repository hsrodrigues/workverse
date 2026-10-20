# Meu perfil

Painel "Meu perfil" (botão com ícone de crachá na barra, menu do próprio avatar e botão "Editar meu perfil" na ficha de si mesmo).

## O que a pessoa edita

| Campo | Regra |
| --- | --- |
| Nome de exibição | Mesma sanitização/unicidade do cadastro (`cleanDisplayName`, nome reservado recusado). Cooldown de 24 h entre trocas e no máximo 5 trocas em 30 dias. Vale na hora para todos online (mensagem `profile` com `name`) e em todas as listas. Auditoria `profile.rename` (`detail` = `{from,to}`); a staff vê o histórico na ficha da conta (`nameHistory`). |
| Sobre mim | Até 80 caracteres, sem controle/invisíveis/quebra de linha. Aparece na ficha e na lista de Pessoas / recepção. |
| Pronomes | ela/dela, ele/dele, elu/delu, outro, ou não informar. Só na ficha. |
| Aniversário | Dia e mês, sem ano. Opt-in separado para (a) ícone de bolo na ficha no dia e (b) mensagem de parabéns no chat do sistema (uma vez por dia, no fuso da pessoa). |
| Preferências | Fuso (padrão America/Sao_Paulo), idioma (pt-BR, estrutura pronta), sons, avisos de menção, decoração de eventos, economia de dados, mostrar "trabalhando". |

Somente leitura (staff/administração altera): e-mail, cargo, setor, nível de staff. O PATCH recusa qualquer chave fora da lista.

## API

- `GET /api/profile` e `PATCH /api/profile` (somente a própria conta; sem parâmetro de id). Mesma política de origem/CSRF das demais rotas, `bodyLimit` 2 KB, validação estrita (`parseProfilePatch`, a mesma função usada no formulário), rate limit (12 gravações em rajada, depois 1 a cada 5 s; leituras 30 + 1/s).
- Erros: `bad_name`, `name_taken` (409), `name_cooldown` (429 + `Retry-After`), `bad_about`, `bad_birthday`, `bad_pronouns`, `bad_prefs`, `muted` (silenciado não troca nome/sobre mim), `rate_limited`. A resposta inclui `field` quando se aplica.
- Config: `PROFILE_NAME_COOLDOWN_HOURS` (24), `PROFILE_NAME_MAX_CHANGES` (5), `PROFILE_NAME_WINDOW_DAYS` (30).

## Privacidade

- Quem decide o que aparece é o servidor: campos opcionais (`about`, `pronouns`, `bday`) saem só para membros da mesma organização; visitantes (`guest`) recebem só o nome (filtro único no envio, `stripOptionalProfile`).
- Logs e auditoria nunca carregam texto do perfil, só o id da conta (a auditoria de troca de nome guarda os dois nomes, por finalidade de moderação).
- "Mostrar que estou trabalhando" desligado: o servidor envia a atividade `working` como `idle` aos demais.

## Persistência

`Account.profile` (JSON, memória e PostgreSQL). No PG vive em `accounts.extra`; a migração `0009_account_profile.sql` só cria o índice do histórico de nomes. Contas antigas têm tudo vazio. `AccountStore.rename()` mantém o índice de unicidade.

## Cliente

`apps/client/src/ui/profile/` (`ProfilePanel.tsx`, `profileForm.ts` com a lógica pura, `profileStore.ts`) e `clientPrefs.ts`. Prévia ao vivo da ficha, Esc fecha, Desfazer restaura, layout em coluna no celular. A decoração de eventos migra do `localStorage` para a conta na primeira carga (se estava desligada e nunca foi salva).

## Limitações

- Sons e avisos de menção são salvos na conta, mas ainda não há sons/menções no cliente para consumi-los.
- Fuso: usado no aniversário e no relógio do painel; os demais horários do app não foram convertidos.
- Com "trabalhando" oculto, a própria pessoa também vê a atividade parada.
- Conversas privadas abertas por nome não acompanham um colega que trocou de nome.
