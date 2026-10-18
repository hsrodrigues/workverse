# Camada social

Implementada em `packages/shared/src/protocol.ts`, `apps/server/src/world.ts` e `apps/client/src/ui/Social.tsx`.

## Status de presença

- Lista fechada: `available`, `busy`, `focus`, `meeting`, `away` (rótulos em `STATUS_LABELS`: Disponível, Ocupado, Concentrado, Em reunião, Ausente).
- C2S `{t:'status', status}`: valor fora da lista conta como mensagem inválida (`bad_message`, com strike) e nada muda.
- S2C `{t:'status', id, status}` vai a todos da sala; `PlayerView.status` leva o valor a quem entra; `session` traz o status e a equipe do próprio jogador.
- A última escolha manual é salva em `Account.status` e restaurada no próximo login.
- Ausente automático: depois de `AUTO_AWAY_MS` (5 min, opção `idleAwayMs` do `World`) sem nenhuma mensagem do jogador (`ping` não conta). Qualquer ação volta ao status anterior. O ausente automático nunca é persistido; escolher "Ausente" manualmente permanece até nova escolha.
- No cliente, `worldStore.roster[].status` expõe o dado (usado depois pelo indicador sobre o avatar no Phaser).

## Mensagens privadas

- C2S `{t:'dm', to, text}`, com `to` = id da conta ou nome de exibição (até 64 caracteres).
- S2C `{t:'dm', peerId, peer, self, text, at}`: o destinatário recebe `self:false`; o remetente recebe o eco com `self:true`. Ninguém mais recebe.
- Nunca vira balão nem linha do chat público; funciona entre salas.
- Mesma sanitização (`cleanChat`, 120 caracteres) e mesmo rate limit (`chatBucket`) do chat público.
- Erros: `dm_offline` (destinatário offline ou inexistente, mesma resposta para não revelar contas), `dm_self`, `rate_limited`, `bad_message` (campos com tipo errado).
- Mensagens não são guardadas no servidor: quem estiver offline não recebe nada depois. O histórico no cliente vive só na sessão do navegador.

## Chat de equipe

- C2S `{t:'team', text}`; S2C `{t:'team', team, from, self, text, at}`.
- Entregue a todos online com a mesma `Account.team` (padrão `geral`), em qualquer sala, incluindo o eco ao remetente. Nunca chega a outra equipe.
- Mesma sanitização e rate limit do chat.
- Ainda não há UI de administração: por enquanto `team` só é alterado editando a conta no armazenamento. Futuramente só o administrador poderá defini-lo; o cliente não consegue mudar a própria equipe.

## Notificações (cliente)

Contador de não lidas no botão "Conversas" e nas abas, e `document.title` piscando enquanto houver não lidas. Sem som. Conversa aberta e visível não gera não lida.

## Testes

`apps/server/test/social.test.ts` (rodar com `npm test`).
