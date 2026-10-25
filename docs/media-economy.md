# Economia de áudio e vídeo (LiveKit)

O plano gratuito do LiveKit Cloud tem cota de **5.000 minutos de participante por mês** e **50 GB de saída**. Minuto de participante conta enquanto a pessoa está conectada à sala do LiveKit, mesmo calada. Estas regras (padrão ligado; `MEDIA_ECONOMY=off` volta ao comportamento antigo) reduzem isso sem trocar de provedor. Código: `apps/server/src/mediaEconomy.ts`, `packages/shared/src/mediaEconomy.ts`, `apps/client/src/media/connectGate.ts`.

## Conexão sob demanda
O cliente só entra na sala do LiveKit quando: (a) a pessoa liga mic/câmera/tela; (b) alguém da mesma sala está publicando (mensagem `media_active` do servidor, que não depende de a pessoa estar na chamada); (c) há palco/TV em uso. Sem motivo: zero minutos. Sai `MEDIA_IDLE_DISCONNECT_SECONDS` (20 s) depois do último motivo. Aba em segundo plano há `MEDIA_HIDDEN_TAB_SECONDS` (120 s) ou status ausente, sem publicar: desconecta e reconecta ao voltar. Os clientes avisam o servidor com `media_report` (conectado/mic/câmera/tela), a cada mudança e a cada 30 s (batimento que não conta como atividade da pessoa). Pedidos de token têm debounce de 300 ms, jitter de até 400 ms quando conectam "porque alguém falou", e respeitam 429/Retry-After.

## Vídeo econômico
Câmera desligada por padrão. Ao ligar: 360p, 20 fps, ~450 kbps, `simulcast` só com 8+ pessoas. Tela: até 1080p/15 fps, `contentHint: text`. Áudio: fala 24 kbps com DTX e RED. "Economia de dados" (Configurações de áudio e vídeo, guardada em `localStorage`; também vale a opção do perfil): câmera 180p/12 fps, tela 720p/8 fps e sem receber o vídeo dos outros (só áudio), exceto palco/TV.

## Limites no servidor (na emissão do token)
`MEDIA_MAX_PEOPLE_PER_ROOM` (20) pessoas conectadas por sala (409 `media_room_full`; o apresentador e staff em serviço passam); `MEDIA_MAX_VIDEO_PUBLISHERS` (6) câmeras/telas simultâneas por sala: os demais recebem só áudio (token e `updateParticipant`), com aviso claro; `MEDIA_TOKEN_TTL_SECONDS` (1800). O cliente revalida o token em 80% do prazo (a renovação da faixa de conexão em si é feita pelo próprio LiveKit).

## Modo economia e contador (staff)
Aba **Modo** do painel de staff: interruptor "Modo economia" (permissão `media.control`, nível admin; auditado como `media.economy.on/off`): vídeo só no palco/TV, salas comuns só áudio. O contador (`media.view`, moderador+) mostra "X de 5.000 min (Y%)". O servidor soma os minutos de participante da emissão do token até a saída (relato `connected:false`, troca de sala, queda do jogo, ou 100 s sem batimento), por mês (fuso `MEDIA_QUOTA_TZ_OFFSET_MINUTES`, padrão -180), em `DATA_DIR/media-usage.json`. Alertas na staff em serviço (chat, log e auditoria do sistema) a 70% e 90%. A 100% (`MEDIA_MONTHLY_MINUTES`, 0 = sem cota) não há novos tokens ("cota mensal de áudio e vídeo atingida; volta no dia 1"), as sessões abertas são encerradas e todos recebem a política. Métricas: `workverse_media_minutes_month`, `_limit`, `_quota_ratio`, `_sessions_active`, `_publishers_active`, `_economy_strict`, `workverse_media_tokens_total{result}`.

**É uma estimativa local**; a cota oficial está no painel do LiveKit. Um cliente adulterado pode mentir no relato (ex.: dizer que publica), o que só faz os colegas conectarem por até 20 s; os limites do token e da cota são do servidor.
