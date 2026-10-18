# Interações do avatar com o ambiente

Tudo aqui é decidido pelo servidor e visível para todos na sala.

## Estado (`Activity`, `packages/shared/src/activity.ts`)

`idle` | `working` | `holding:coffee` | `holding:water`. Fica em `Player.activity` (servidor) e vai no `PlayerView.activity`
(quem entra depois já vê). Mudanças são transmitidas por `{ t: 'activity', id, activity }`.

| Situação | Estado |
| --- | --- |
| Sentar em um assento cujo tile da frente tem um `computer` (`RoomInstance.computerFacing`) | `working`; monitor liga (`furni`), status `focus` sugerido |
| Levantar / andar, sair da sala, desconectar | volta a `idle`; monitor desliga; `focus` sugerido é desfeito |
| Usar cafeteira (`coffee`) | `holding:coffee` + chat de sistema "X pegou um café." |
| Usar bebedouro (`cooler`) ou geladeira (`fridge`) | `holding:water` + "X pegou um copo d’água." |
| 25 s (`HOLD_MS`) sem soltar | volta a `idle` (verificado no tick) |

Regras: o item fica na mão ao andar; usar a máquina de novo entrega um copo novo e reinicia o tempo; sentar num PC troca o
copo por trabalho (as duas mãos digitam) e pegar um copo estando no PC encerra o trabalho. Os móveis que dão item estão em
`FURNI_HOLDS` (precisam de `usable: true` em `FURNI_KINDS`). Um monitor em uso não é desligado por clique de outra pessoa.

Status: `focus` só é sugerido quando o status atual é `available`; uma escolha manual (ocupado, reunião...) nunca é
sobrescrita, e escolher um status enquanto trabalha cancela o desfazer automático. O ausente automático descarta o `focus`
sugerido.

## Protocolo e limites

- Cliente -> servidor: `{ t: 'activity', activity }`. **Só `idle` é aceito** (soltar o copo; clicar no próprio avatar). `working` e
  `holding:*` respondem `error activity_not_allowed` sem strike; valores desconhecidos/tipos errados contam como mensagem
  inválida (strike). Rate limit: o `miscBucket` (10 de rajada, 5/s). Permissão: `room.enter` (`authz.ts`).
- Servidor -> cliente: `activity` (mudanças) e `PlayerView.activity` (snapshot da sala).

## Cliente

- `game/avatar/engine.ts`: novos quadros `FRAME_TYPE` (13-14, sentado digitando, mãos alternando, cabeça mais baixa) e
  `FRAME_DRINK` (15-16, em pé, copo no meio do caminho / na boca). `FRAME_COUNT = 17`.
- `game/avatar/held.ts`: itens sintéticos `held.coffee` (usa o drawer `sp.mug`, a mesma caneca do guarda-roupa) e `held.water`
  (drawer novo `sp.cup`). Não fazem parte do catálogo e substituem o item da mão. O copo é desenhado na folha do avatar:
  `buildAvatarSheet(cfg, held)` gera uma folha por item segurado (textura `av:<chave>~coffee`), gerada na primeira vez.
- `WorldScene.ts` (`Actor`): escolhe os quadros (digitar quando sentado e `working`; beber a cada ~6,5-9 s, parado e em pé;
  andar já mostra o copo), balão "trabalhando" em pixel art (`game/activityArt.ts`, três pontos animados, sem emoji) acima do
  nome. Clicar no próprio avatar segurando algo solta o item.

## Fallbacks (sem sprite para a combinação)

- Segurando e sentado (sofá etc.): pose sentada normal com o copo, sem animação de beber (só há quadros de beber em pé).
- Segurando e acenando: o copo fica oculto durante o aceno (o braço está ocupado), como a caneca do catálogo.
- Digitando: nunca há copo na mão.
- Pose de digitar vale para qualquer vista; nas costas as mãos ficam atrás do corpo, então o balão e o monitor aceso são o sinal.
