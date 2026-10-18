# Mídia (áudio, vídeo e tela) com LiveKit

Base de mídia da etapa 1. O chat e o jogo **não dependem** dela: sem LiveKit, sem microfone ou sem câmera, tudo segue
funcionando e a barra mostra "Mídia indisponível" ou um aviso de permissão.

## Como funciona

- Uma sala do mundo = uma sala LiveKit chamada `wv:<roomId>`. O cliente pede `POST /api/media/token` com
  `{ roomId, kind?: 'room' | 'stage', canPublish?: boolean }` (cookie de sessão; em dev com `ALLOW_DEV_LOGIN=1`, também
  `devName`).
- O servidor só emite o token se a conta **está agora** naquela sala (consulta o `World`). `identity` = id do jogador
  (o mesmo `id` que a cena e o protocolo já usam: `RoomSnapshot.youId`, `PlayerView.id`), `name` = nome de exibição.
- Permissão de publicar vem do servidor: `canPublishIn(roomId, player, kind)` em `apps/server/src/media.ts`. Hoje
  devolve `true`; **o auditório restringe aqui** (apresentadores). O cliente só pode pedir menos (`canPublish: false`).
- Token com TTL de 10 min. Enquanto conectado, o próprio LiveKit renova o token da sessão; se a conexão cair, o
  `MediaClient` busca um token novo e reentra (backoff). Limite de 12 pedidos em rajada por conta (+1 a cada 5 s).
- `GET /api/media/config` devolve `{ enabled, url }`. Em produção, sem `LIVEKIT_*` a mídia fica `enabled: false`.

## Variáveis

| Variável             | Onde     | Descrição                                                                                         |
| -------------------- | -------- | ------------------------------------------------------------------------------------------------- |
| `LIVEKIT_URL`        | servidor | URL do LiveKit (`ws://livekit:7880` na rede do compose).                                         |
| `PUBLIC_LIVEKIT_URL` | servidor | URL que o **navegador** usa (`wss://livekit.seu.dominio`). Se ausente, vale `LIVEKIT_URL`.       |
| `LIVEKIT_API_KEY`    | servidor | Chave da API (a mesma do livekit-server).                                                         |
| `LIVEKIT_API_SECRET` | servidor | Segredo da API. Nunca vai ao navegador.                                                           |

Fora de produção, os padrões são `devkey` / `secret` / `ws://localhost:7880` (os do `livekit-server --dev`).

## Desenvolvimento

```bash
npm run livekit:setup   # baixa o binário livekit-server (windows_amd64) para tools/livekit/ (ignorado pelo git)
npm run dev             # servidor + cliente (+ livekit-server se o binário existir)
npm run livekit:dev     # só o livekit-server --dev (porta 7880, RTC em UDP/TCP)
```

Página de teste isolada (precisa de `ALLOW_DEV_LOGIN=1`): `http://localhost:5173/media-test.html?name=Ana&room=office`.
Abra uma segunda aba/navegador com outro `name` para ver as duas pessoas na mesma chamada.

## Ponto de montagem no app (etapa 2)

```tsx
import { MediaProvider, MediaBar, VideoTiles } from './media'; // importa também media.css

// roomId = sala atual do mundo (null/undefined desconecta). getTilePosition(identity) vem da cena.
<MediaProvider roomId={roomId} getTilePosition={(id) => scene.getTilePosition(id)}>
  <MediaBar />     {/* mic, câmera, tela, configurações, avisos */}
  <VideoTiles />   {/* grade de vídeos + tela compartilhada grande */}
</MediaProvider>
```

- `getTilePosition(identity: string): { x: number; y: number } | undefined`, em tiles lógicos. Deve conhecer também o
  próprio jogador (identity = `youId`). Posição desconhecida = silêncio no modo proximidade.
- `useMedia()` devolve `{ client, state }`: `state` é reativo (`participants` com `micOn/camOn/screenOn/speaking`,
  `micPermission/camPermission` = `'prompt' | 'granted' | 'denied' | 'unavailable'`, `status`, `notice`, `audioBlocked`,
  `mode`...), e `client` tem as ações (`toggleMic`, `toggleCam`, `toggleScreenShare`, `setInputDevices`, `setMode`,
  `setProximityParams`, `enableAudio`).
- Nada pede permissão ao entrar: o navegador só pergunta quando a pessoa clica em mic ou câmera. Se negar, o estado vira
  `denied`, aparece o aviso em português e o resto (chat, ouvir e ver os outros) segue normal.
- Áudio dos outros: modos `room` (sala inteira), `proximity` e `off`, salvos em `localStorage` (`wv.media.mode`,
  `wv.media.proximity`). Proximidade: volume 1 até 2 tiles, linear até 0 em 8 tiles (configuráveis), recalculado 5x/s.
- O áudio toca em `<audio>` gerenciados num contêiner oculto; se o navegador bloquear o autoplay aparece o botão
  "Ativar áudio" na `MediaBar`.

## Produção

`docker-compose.yml` inclui o serviço `livekit` (imagem `livekit/livekit-server`, config em `deploy/livekit.yaml`, chaves
por `LIVEKIT_KEYS` montado a partir de `LIVEKIT_API_KEY`/`LIVEKIT_API_SECRET`). Portas: 7880 (HTTP/WS), 7881 (TCP RTC),
50000-50100/udp. Defina `PUBLIC_LIVEKIT_URL` com `wss://` e TLS (proxy reverso) e, atrás de NAT, `use_external_ip: true`
em `deploy/livekit.yaml`. Câmera e microfone só funcionam em HTTPS (ou `localhost`).
