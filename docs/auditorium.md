# Auditório

Sala `auditorium` ("Auditório", 18x12): palco ao norte, púlpito, telão na parede norte, 36 poltronas em três fileiras com corredor central e tapete. Fica atrás da porta da parede oeste do Escritório (e volta para ele pela porta da parede oeste do auditório). Qualquer sala com um `podium` na lista de móveis se comporta como auditório (`isStageRoom` em `packages/shared/src/rooms.ts`).

O escopo é o de uma **reunião com palco**: o palestrante compartilha a tela (como em uma chamada), pode mostrar **slides de imagem**, pode **abrir o palco** para a sala toda falar, a plateia **levanta a mão** e o PowerPoint pode ser controlado pelo conector local. Não há slides de texto, Markdown, temas nem importação de PDF.

Código: `packages/shared/src/stage.ts` (modelo, limites, validação do deck, assinatura de imagem), `apps/server/src/stage.ts` (palco, mãos, permissões), `apps/server/src/stageRoutes.ts` (imagens), `apps/server/src/media.ts` (token e LiveKit), `apps/client/src/ui/StagePanel.tsx` (painel), `apps/client/src/stage/*` (desenho dos slides, imagens, PowerPoint), `apps/client/src/game/stageScreen.ts` (telão no jogo) e `mediaBadges.ts` (ícones sobre os avatares).

## Como apresentar

1. Entre no Escritório e atravesse a porta da parede oeste (ou use **Salas > Auditório**).
2. Assuma o palco: clique no **púlpito** (o personagem anda até ele) ou use **Assumir palco** na barra inferior. Se o palco já tem dono, aparece "Fulano já está no palco". Ao assumir, o servidor leva o palestrante atrás do púlpito, de frente para a plateia (`stageSpots`, mensagem `face`).
3. O painel **Apresentação** abre sozinho. Para **compartilhar a tela** (PowerPoint, Google Slides, qualquer janela) use o botão de tela da barra de baixo; câmera e microfone também ficam lá. A plateia vê a tela na área principal do painel (com tela cheia), as câmeras numa faixa pequena e uma miniatura ao vivo no telão do jogo. Quando há tela compartilhada e slides, a plateia alterna entre **Slides** e **Tela**.
4. **Slides de imagem** (opcional): **+ Imagem** aceita PNG, JPEG e WebP (várias de uma vez); imagens grandes são reduzidas (até 1920 px) e reencodadas no navegador antes do envio. Reordene, remova e use **Iniciar slides** / **Encerrar slides**. As setas, PageUp/PageDown, Home e End mudam de slide fora de campos de texto; os botões Anterior/Próximo e as miniaturas também.
5. **PowerPoint**: o bloco **PowerPoint** do painel controla o programa pelo conector local (próximo/anterior, notas, miniaturas, enviar os slides como imagens). Veja [powerpoint.md](powerpoint.md).
6. **Palco aberto** (`stage_open`/`stage_close`): o palestrante libera microfone, câmera e tela para a sala toda. Ao fechar, ao sair do palco ou ao perdê-lo, volta ao normal.
7. **Mão levantada**: a plateia levanta a mão; o palestrante vê a fila e clica **Dar a palavra** (a pessoa passa a poder ligar só o microfone; no máximo 3 ao mesmo tempo) ou **Dispensar**.
8. **Sair do palco** libera o palco. O deck e o slide atual ficam guardados no servidor por conta (fechar o painel ou F5 não os perde, e o palestrante os recupera ao voltar); quem assume o palco depois começa limpo e um deck abandonado expira em 12 h.

A plateia: o painel abre sozinho quando uma apresentação começa e acompanha o palestrante ao vivo (slide, tela, vídeo). Pode ser ampliado, reduzido ou fechado; o chat continua funcionando, com ou sem microfone e câmera.

## Papéis (servidor autoritativo)

| Papel | Quem | Pode |
|---|---|---|
| Palestrante | uma pessoa por vez, `speakerId` | publicar áudio, vídeo e tela; montar e navegar os slides; abrir/fechar o palco; dar e retirar a palavra |
| Com a palavra | até 3 pessoas escolhidas pelo palestrante | publicar só o **microfone** |
| Plateia | todos os outros | assistir, conversar no chat, levantar a mão (com o **palco aberto**, também microfone, câmera e tela) |

O palestrante **perde o palco** (e o estado da apresentação, mãos e palavras concedidas são apagados) quando: libera o palco, sai da sala (portal ou entrar em outra sala), desconecta, muda o status para *Ausente* ou fica ausente automaticamente (5 min sem ação). O cliente do palestrante manda `stage_alive` a cada 60 s enquanto há mouse/teclado recente, para uma palestra longa sem cliques não ser tratada como ausência. Quem está *Ausente* por escolha própria não consegue assumir o palco.

## Mensagens

Cliente para servidor (`ClientMessage` em `packages/shared/src/protocol.ts`; todas validadas e com rate limit):

| Mensagem | Quem | Efeito |
|---|---|---|
| `stage_take` | qualquer um na sala | assume o palco se estiver livre (`stage_busy` se não) |
| `stage_release` | palestrante | libera o palco |
| `stage_alive` | palestrante | conta como atividade |
| `stage_open` / `stage_close` | palestrante | abre/fecha o palco para a sala toda |
| `hand_raise` / `hand_lower` | plateia | entra/sai da fila (máx. 30; precisa haver palestrante) |
| `voice_grant {id}` / `voice_revoke {id}` | palestrante | dá/retira a palavra (também dispensa uma mão levantada) |
| `deck_set {deck}` / `deck_clear` | palestrante | substitui / apaga os slides |
| `present_start {index?}` / `present_end` | palestrante | abre/fecha os slides para a plateia |
| `slide_goto {index}` | palestrante | muda o slide (só com os slides ao vivo) |

Servidor para cliente: `stage {speakerId, speakerName, hands[], voices[], open}` (todos da sala), `deck {deck|null}` e `slide {live, index}`. Quem entra no meio recebe, logo depois de `room`, `stage`, `deck` e `slide` com o estado atual. O deck é **privado do palestrante até os slides irem ao vivo**: a plateia só recebe `deck` e só baixa imagens enquanto `live` for verdadeiro. Erros: `not_stage_room`, `stage_busy`, `stage_away`, `not_speaker`, `no_speaker`, `stage_speaker`, `has_voice`, `hands_full`, `no_target`, `voices_full`, `deck_invalid`, `no_deck`, `not_live`, `bad_slide`, `rate_limited`.

## Slides (somente imagem)

`Deck = { title, slides: Slide[] }`, `Slide = { kind: 'image', imageId, alt? }`. Todo slide é desenhado em `<canvas>` (`apps/client/src/stage/slideRender.ts`, o mesmo código no painel, nas miniaturas e no telão do jogo). Textos (título, descrição) passam por limpeza: o servidor remove caracteres de controle, de largura zero e de inversão bidirecional.

### Limites

| Item | Limite |
|---|---|
| slides por deck | 40 |
| título / descrição da imagem | 80 / 120 caracteres |
| imagem | 1,5 MB, 4096 px por lado |
| imagens somadas por palco | 24 MB |
| mensagem de WebSocket | 4 KB, exceto `deck_set` (200 KB) |
| mãos levantadas / com a palavra | 30 / 3 |
| `deck_set` | 3 de rajada, 1 a cada 4 s |
| ações do palco (mão, slide...) | 20 de rajada, 8/s |
| upload de imagem | 10 de rajada, 1 a cada 2 s por conta |

### Imagens: envio e entrega

Imagens não passam pelo WebSocket. O palestrante envia cada uma por `POST /api/stage/image` (corpo = bytes, `Content-Type` = `image/png`, `image/jpeg` ou `image/webp`) e recebe um `id` aleatório de 24 hex. O servidor:

- exige sessão (cookie; no login de desenvolvimento, o cabeçalho `X-Dev-Name`), que a pessoa esteja num auditório **e seja a palestrante**;
- recusa qualquer outro tipo (SVG, HTML, GIF... = 415 antes de ler o corpo), confere a **assinatura mágica**, que ela **bata com o tipo declarado**, o tamanho em bytes e as dimensões lidas do cabeçalho;
- guarda em memória, por sala (nada vai para disco), e libera tudo quando o palco é liberado; imagens que o deck novo não usa mais são descartadas.

`GET /api/stage/image/:id` entrega a imagem só a quem está **na mesma sala** (a plateia apenas com os slides ao vivo), com `Content-Type` verificado, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'; sandbox`, `Cross-Origin-Resource-Policy: same-origin` e `Cache-Control: private`. Um endpoint autenticado em vez de data URL não infla o WebSocket e permite o controle de acesso acima.

## Câmera, microfone e tela

- Auditório: o token do LiveKit sai com `canPublish=false` e nenhuma fonte para a plateia; `canPublishSources` = [microfone] para quem está com a palavra; tudo para o palestrante, e tudo para todos enquanto o palco está aberto. O cliente pode pedir menos, nunca mais.
- **Mudança de palestrante ou de palco aberto com gente já conectada**: o servidor chama `RoomServiceClient.updateParticipant` (permissões) a cada mudança (assumir, liberar, abrir/fechar, dar/retirar a palavra, sair); o LiveKit derruba as faixas que deixaram de ser permitidas e o cliente recebe `ParticipantPermissionsChanged`, desliga o que estiver ligado e atualiza os botões. A atualização é repetida em 1,5 s e 5 s (vale sempre o último estado) para cobrir quem ainda estava entrando na chamada. Quem reconectar recebe um token novo já com os direitos certos.
- Fora do auditório todos publicam. `canPublishIn`/`publishRights` em `apps/server/src/media.ts` concentram a regra.
- O áudio do palestrante e de quem está com a palavra ignora o modo de proximidade (só o modo *Desligado* o silencia).
- Indicadores sobre o avatar (microfone, câmera, anel pulsante enquanto fala, mão levantada) e na lista **Pessoas**: só aparecem para quem tem mídia conectada. O navegador nunca pede permissão ao entrar; só ao clicar nos botões. Detalhes de mídia em [media.md](media.md).
- Modo de áudio padrão nas salas: **sala inteira**, configurável (sala inteira, proximidade, desligado) e lembrado no `localStorage`.

## Testes

`packages/shared/test/stage.test.ts` (layout do auditório, validação do deck, assinatura de imagem) e `apps/server/test/stage.test.ts` (papéis do palco, perda do palco, palco aberto, permissões de publicação e tokens, mão levantada e palavra, deck, controle só pelo palestrante, entrada no meio, rate limits, upload e entrega de imagens, tamanho de mensagem no WebSocket). Rodam com `npm test`.
## TV nas salas de reunião

Reunião 1, Reunião 2 e Sala de Equipe têm uma **TV com suporte** (`tv_stand`) para passar slides. É o mesmo sistema do palco (`StageManager`, deck de imagens, tela compartilhada, controle do PowerPoint, painel `StagePanel`), com um **alvo de apresentação** por sala: `stage` (púlpito) ou `tv` (`presentationOf` em `packages/shared/src/stage.ts`). O auditório não muda.

- **Assumir**: qualquer pessoa na sala clica na TV (o personagem anda até ela) ou usa **Apresentar na TV** na barra. Um apresentador por vez; ocupada devolve `stage_busy` ("Fulano já está apresentando na TV"). Quem não está na sala (ou está em outra, ou em outra organização) não afeta a TV.
- **Liberar**: o apresentador para de apresentar, sai da sala, desconecta ou fica ausente (manual ou automático). O deck e o slide ficam guardados para a mesma conta; outra pessoa começa limpa (mesma regra do palco).
- **À força**: `stage_take {force: true}` só funciona na TV e só para owner/admin da organização ou staff admin em serviço; as demais pessoas recebem `stage_busy`. O servidor registra `stage.force` (e `stage.force_denied`) na auditoria. No auditório `force` é ignorado.
- **Sem palco aberto, mão levantada nem palavra**: `hand_raise`, `voice_grant/revoke`, `stage_open/close` respondem `tv_room`.
- **Publicação** (`rightsOf` / `canPublishIn` em `media.ts`): o apresentador publica tudo (microfone, câmera e tela); **quem assiste mantém microfone e câmera mas não compartilha tela** (direito `av`, `TV_VIEWER_RIGHTS` em `apps/server/src/stage.ts`; troque para `'none'` se quiser uma sala estritamente só de leitura). A reunião continua podendo conversar. Mudanças de direito vão ao LiveKit por `updateParticipant`, como no palco.
- **TV acesa**: enquanto alguém apresenta, o servidor liga a peça (`furni` on), o sprite acende e a iluminação (`dayLighting.ts`) soma o brilho; livre, a TV fica apagada e mostra "TV livre / Clique para apresentar".
- **Conteúdo na TV**: `stageScreen.ts` (a mesma classe do telão) pinta slide, tela compartilhada, selo AO VIVO, nome de quem apresenta e n/total sobre a tela da TV, num canvas denso e inclinado para o plano isométrico.
- **Painel**: a janela de apresentação aparece como "Apresentação da sala" (tela grande, câmeras em miniatura, tela cheia, deck, PowerPoint); sem os controles de palco aberto e fila de palavra.
- **Mensagens**: nenhuma nova; `stage_take` ganhou o campo opcional `force` (booleano estrito) e `StageView` o campo `mode` (`'stage' | 'tv'`).

Testes: `apps/server/test/tv.test.ts` (assumir, ocupado, liberar, perder ao sair/desconectar/ausência, sala errada, recusas do palco, `force`, direitos de publicação, deck persistente, isolamento entre duas organizações, TV adicionada pelo editor, auditório inalterado) e `packages/shared/test/tv.test.ts` (catálogo, modo por sala, TV de frente para a mesa e alcançável, validação do editor).
