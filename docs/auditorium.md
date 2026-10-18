# Auditório

Sala `auditorium` ("Auditório", 18x12): palco ao norte, púlpito, telão na parede norte, 36 poltronas em três fileiras com corredor central e tapete. Fica atrás da porta da parede oeste do Escritório (e volta para ele pela porta da parede oeste do auditório). É a primeira sala com palco; qualquer sala que tenha um `podium` na lista de móveis passa a se comportar como auditório (`isStageRoom` em `packages/shared/src/rooms.ts`).

Código: `packages/shared/src/stage.ts` (modelo, limites, validação, Markdown, assinatura de imagem), `apps/server/src/stage.ts` (palco, mãos, permissões), `apps/server/src/stageRoutes.ts` (imagens), `apps/server/src/media.ts` (token e LiveKit), `apps/client/src/ui/StagePanel.tsx` (painel), `apps/client/src/stage/*` (desenho dos slides, imagens, PDF), `apps/client/src/game/stageScreen.ts` (telão no jogo) e `mediaBadges.ts` (ícones sobre os avatares).

> **Atualização (escopo simples).** Só existem slides de **imagem** (PNG/JPEG/WebP) e **compartilhamento de tela**; as partes de texto/Markdown/tema/PDF abaixo estão obsoletas. O deck, a imagem e o slide atual ficam no servidor por conta: fechar o painel, F5 ou sair e voltar não os perdem (outra pessoa que assume o palco começa limpa; deck abandonado expira em 12 h). Ao assumir o palco o servidor leva o palestrante atrás do púlpito, de frente para a plateia (`stageSpots`, mensagem `face`). **Palco aberto** (`stage_open`/`stage_close`): o palestrante libera microfone, câmera e tela para a sala toda; ao fechar ou sair do palco volta ao normal. A tela compartilhada ocupa a área principal do painel (com tela cheia) e as câmeras ficam numa faixa pequena.

## Como apresentar

1. Entre no Escritório e atravesse a porta da parede oeste (ou use **Salas > Auditório**).
2. Assuma o palco: clique no **púlpito** (o personagem anda até ele) ou use o botão **Assumir palco** da barra inferior. Se o palco já tem dono, aparece "Fulano já está no palco".
3. O painel **Apresentação** abre sozinho. Monte os slides:
   - **+ Texto** cria um slide de texto (Markdown simples, abaixo). **Importar texto** aceita vários slides de uma vez separados por uma linha `---`.
   - **+ Imagem** aceita PNG, JPEG e WebP (várias de uma vez). Imagens grandes são reduzidas (até 1920 px) e reencodadas no navegador antes do envio.
   - **PDF** converte cada página em imagem no seu navegador (pdf.js), até 40 páginas.
   - Reordene, remova, escolha o **tema** (Noite, Papel, Aurora) e o título.
4. **Iniciar apresentação** envia os slides e abre para a plateia. **← →** (ou PageUp/PageDown, Home, End) mudam de slide enquanto você não está digitando; os botões Anterior/Próximo fazem o mesmo. Clicar numa miniatura vai direto àquele slide. Editou algo durante a apresentação? **Atualizar slides** envia as mudanças.
5. Para controlar o **PowerPoint** de dentro do WorkVerse (próximo/anterior, notas, miniaturas, enviar os slides como imagens), use o conector local: [docs/powerpoint.md](powerpoint.md). Para apresentar Google Slides ou qualquer janela, use o botão de **compartilhar tela** da barra (e câmera/microfone se quiser). A plateia vê a tela no painel (aba **Tela**) e uma miniatura ao vivo no telão do jogo; sua câmera aparece num quadrinho no canto.
6. **Pedidos de palavra**: a plateia levanta a mão; você vê a fila e clica **Dar a palavra** (a pessoa passa a poder ligar só o microfone; no máximo 3 ao mesmo tempo) ou **Retirar**.
7. **Encerrar** termina a apresentação (o palco continua seu). **Sair do palco** libera o palco e apaga os slides.

A plateia: o painel abre sozinho quando uma apresentação começa e acompanha o palestrante ao vivo (slide, tela compartilhada, vídeo). Ele pode ser ampliado, reduzido ou fechado; o chat continua funcionando normalmente, com ou sem microfone e câmera.

## Papéis (servidor autoritativo)

| Papel | Quem | Pode |
|---|---|---|
| Palestrante | uma pessoa por vez, `speakerId` | publicar áudio, vídeo e tela; criar o deck, iniciar, navegar e encerrar; dar e retirar a palavra |
| Com a palavra | até 3 pessoas da plateia escolhidas pelo palestrante | publicar só o **microfone** |
| Plateia | todos os outros | assistir, conversar no chat, levantar a mão |

O palestrante **perde o palco** (e a apresentação, o deck, as imagens, as mãos e as palavras concedidas são apagados) quando: libera o palco, sai da sala (portal ou entrar em outra sala), desconecta, muda o status para *Ausente* ou fica ausente automaticamente (5 min sem ação). O cliente do palestrante manda `stage_alive` a cada 60 s enquanto há mouse/teclado recente, para uma palestra longa sem cliques não ser tratada como ausência. Quem está *Ausente* por escolha própria não consegue assumir o palco.

## Mensagens

Cliente para servidor (`ClientMessage` em `protocol.ts`; todas são validadas e passam por rate limit):

| Mensagem | Quem | Efeito |
|---|---|---|
| `stage_take` | qualquer um na sala | assume o palco se estiver livre (`stage_busy` se não) |
| `stage_release` | palestrante | libera o palco |
| `stage_alive` | palestrante | conta como atividade |
| `hand_raise` / `hand_lower` | plateia | entra/sai da fila (máx. 30; precisa haver palestrante) |
| `voice_grant {id}` / `voice_revoke {id}` | palestrante | dá/retira a palavra (também dispensa uma mão levantada) |
| `deck_set {deck}` | palestrante | substitui o deck |
| `present_start` / `present_end` | palestrante | abre/fecha a apresentação para a plateia |
| `slide_goto {index}` | palestrante | muda o slide (só com a apresentação ao vivo) |

Servidor para cliente: `stage {speakerId, speakerName, hands[], voices[]}` (todos da sala), `deck {deck|null}` e `slide {live, index}`. Quem entra no meio recebe, logo depois de `room`, `stage`, `deck` e `slide` com o estado atual. O deck é **privado do palestrante até a apresentação começar**: a plateia só recebe `deck` e só consegue baixar imagens enquanto `live` for verdadeiro. Erros: `not_stage_room`, `stage_busy`, `stage_away`, `not_speaker`, `no_speaker`, `stage_speaker`, `has_voice`, `hands_full`, `no_target`, `voices_full`, `deck_invalid`, `no_deck`, `not_live`, `bad_slide`, `rate_limited`.

## Deck e slides

`Deck = { title, theme: 'night'|'paper'|'sunrise', slides: Slide[] }`, `Slide = {kind:'text', md} | {kind:'image', imageId, alt?}`.

Markdown dos slides de texto: `# título`, `## subtítulo`, `- item` (ou `* item`), `**negrito**`, qualquer outra linha é texto; `---` separa slides (no importador). Um `**` sem par fica literal. Não há HTML, links nem imagens em Markdown.

**Texto nunca vira HTML.** Todo slide é desenhado em `<canvas>` com `fillText` (painel, miniaturas e telão do jogo usam o mesmo código: `apps/client/src/stage/slideRender.ts`). O servidor ainda remove caracteres de controle, de largura zero e de inversão bidirecional.

### Limites

| Item | Limite |
|---|---|
| slides por deck | 40 |
| texto por slide | 1200 caracteres |
| título / descrição da imagem | 80 / 120 caracteres |
| imagem | 1,5 MB, 4096 px por lado |
| imagens somadas por palco | 24 MB |
| páginas de PDF | 40 (PDF até 40 MB) |
| mensagem de WebSocket | 4 KB, exceto `deck_set` (200 KB) |
| mãos levantadas / com a palavra | 30 / 3 |
| `deck_set` | 3 de rajada, 1 a cada 4 s |
| ações do palco (mão, slide...) | 20 de rajada, 8/s |
| upload de imagem | 10 de rajada, 1 a cada 2 s por conta |

### Imagens: envio e entrega

Imagens não passam pelo WebSocket. O palestrante envia cada uma por `POST /api/stage/image` (corpo = bytes, `Content-Type` = `image/png`, `image/jpeg` ou `image/webp`) e recebe um `id` aleatório de 24 hex. O servidor:

- exige sessão (cookie; no login de desenvolvimento, o cabeçalho `X-Dev-Name`), que a pessoa esteja num auditório **e seja a palestrante**;
- recusa qualquer outro tipo (SVG, HTML, GIF... = 415 antes de ler o corpo), confere a **assinatura mágica** (PNG, JPEG, WebP), que ela **bata com o tipo declarado**, o tamanho em bytes e as dimensões lidas do cabeçalho;
- guarda em memória, por sala (nada vai para disco), e libera tudo quando o palco é liberado; imagens que o deck novo não usa mais são descartadas.

`GET /api/stage/image/:id` entrega a imagem só a quem está **na mesma sala** (a plateia apenas com a apresentação ao vivo), com o `Content-Type` verificado, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'; sandbox`, `Cross-Origin-Resource-Policy: same-origin` e `Cache-Control: private`. Escolhi endpoint autenticado em vez de data URL: não infla o WebSocket, não replica megabytes para todos a cada mudança e permite o controle de acesso acima.

### PDF

pdf.js (`pdfjs-dist` 6.4.299, licença Apache-2.0) roda **só no navegador do palestrante**, carregado sob demanda (import dinâmico; o worker vem de `pdfjs-dist/build/pdf.worker.min.mjs?url`, o jeito suportado pelo Vite). Cada página vira um JPEG de até 1600 px de largura e segue o mesmo caminho das imagens (limites, validação, servidor). O servidor nunca lê PDF. PDFs com senha são recusados com mensagem clara.

## Câmera, microfone e tela

- Auditório: o token do LiveKit sai com `canPublish=false` e nenhuma fonte para a plateia; `canPublishSources` = [microfone] para quem está com a palavra; tudo para o palestrante. O cliente pode pedir menos, nunca mais.
- **Mudança de palestrante com gente já conectada**: o servidor chama `RoomServiceClient.updateParticipant` (permissões) a cada mudança (assumir, liberar, dar/retirar a palavra, sair); o LiveKit derruba as faixas que deixaram de ser permitidas e o cliente recebe `ParticipantPermissionsChanged`, desliga o que estiver ligado e atualiza os botões. A atualização é repetida em 1,5 s e 5 s (vale sempre o último estado) para cobrir quem ainda estava entrando na chamada. Quem reconectar recebe um token novo já com os direitos certos.
- Fora do auditório o comportamento é o de antes (todos publicam). `canPublishIn`/`publishRights` em `apps/server/src/media.ts` concentram a regra.
- O áudio do palestrante e de quem está com a palavra ignora o modo de proximidade (só o modo *Desligado* o silencia).
- Indicadores sobre o avatar (microfone ligado/mudo, câmera, anel pulsante enquanto fala, 🎤 no palestrante, ✋ nas mãos levantadas) e na lista **Pessoas**: só aparecem para quem tem mídia conectada. O navegador nunca pede permissão ao entrar; só ao clicar nos botões.
- Modo de áudio padrão nas salas: **sala inteira**, configurável (sala inteira, proximidade, desligado) e lembrado no `localStorage`.

## Salas de reunião por convite

**Pendente.** Não foi implementado: uma sala privada com porta, convite por mensagem direta a partir do menu do avatar e autorização de entrada no servidor, com testes de isolamento. O ponto de partida seria uma sala com lista de convidados por instância e uma checagem em `World.enterRoom`.

## Testes

`packages/shared/test/stage.test.ts` (layout do auditório, Markdown, validação do deck, assinatura de imagem) e `apps/server/test/stage.test.ts` (papéis do palco, perda do palco, permissões de publicação e tokens, mão levantada e palavra, deck, controle só pelo palestrante, entrada no meio, rate limits, upload e entrega de imagens, tamanho de mensagem no WebSocket). Rodam com `npm test`.
