# Controlar o PowerPoint pelo WorkVerse

O navegador não consegue comandar programas do seu computador. Por isso existe o **WorkVerse PowerPoint Connector**: um programa local (Node + um processo PowerShell persistente com COM) que roda no PC de quem apresenta e é comandado pela interface do WorkVerse (painel do palco, bloco **PowerPoint**).

Requisitos: Windows, Microsoft PowerPoint desktop (COM `PowerPoint.Application`), Node.js. Mac, Keynote e Google Slides ficam para o futuro (veja "Outros programas").

## Como usar

1. No PC de quem vai apresentar, dê dois cliques em `Conector-PowerPoint.bat` (ou `npm run powerpoint:connector`). A janela mostra um **código de 6 dígitos** e fica aberta enquanto você apresenta.
2. No WorkVerse, assuma o palco, abra **Palco > PowerPoint**, digite o código e clique em **Conectar ao PowerPoint** (uma vez por aba; o segredo fica só em `sessionStorage`).
3. **Abrir apresentação…** abre a janela nativa do Windows no seu PC (pode levar alguns segundos); escolha o `.pptx`. Depois **Iniciar** (em janela ou tela cheia) e use **Anterior/Próximo**, a caixa "Ir ao slide", as miniaturas, **Preta/Branca**, o ponteiro (normal, laser, caneta, ocultar, apagar traços) e **Encerrar**. As **notas do orador** do slide atual aparecem só para você.

Se o WorkVerse estiver publicado em outro endereço: `Conector-PowerPoint.bat --origin https://seu-endereco` (ou `CONNECTOR_ORIGINS=https://a,https://b`). A porta padrão é 47831 (`--port` ou `CONNECTOR_PORT`; em "Opções avançadas" do painel você informa o endereço se mudar a porta).

### Dois modos

- **Compartilhar tela**: inicie **em janela**, compartilhe essa janela pelo botão de tela da barra de baixo e controle tudo pelo WorkVerse. As animações do PowerPoint funcionam (Próximo avança também as animações). A plateia vê o seu vídeo; o WorkVerse não repassa o número do slide (limitação atual: o servidor só sincroniza índices de decks de imagem).
- **Enviar slides ao WorkVerse**: o conector exporta cada slide como PNG (1600 px), o navegador recomprime (WebP, ou JPEG) conforme a **qualidade** escolhida (Alta 1920 px, Equilibrada 1600 px, Leve 1280 px) e envia pelo mesmo fluxo de imagens do palco (`POST /api/stage/image` + `deck_set`, com os limites do servidor: 40 slides, 1,5 MB por imagem, 24 MB no total). Há barra de progresso, cancelamento e mensagens claras para excesso de slides ou de tamanho. A navegação passa a ser sincronizada pelo palco (a plateia vê os slides, sem compartilhar tela); se o show estiver rodando no PowerPoint, ele acompanha o slide, e quem muda de slide no próprio PowerPoint (ou com o clicker na janela dele) arrasta o palco junto. Reenviar substitui os slides atuais. Animações não aparecem para a plateia (cada slide vira uma imagem). O servidor limita uploads por conta (rajada de 10, depois 1 a cada 2 s), então 40 slides levam cerca de um minuto.

### Atalhos (painel do palco aberto, foco fora de campos de texto)

Setas, PageUp/PageDown (apresentadores/clickers USB), espaço e Enter (próximo), `N`/`P`, Home/End, `B` (tela preta), `W` (tela branca), `Esc` (encerra a apresentação). Enquanto o painel do PowerPoint está ativo, o atalho antigo "setas movem os slides de imagem" fica em silêncio para a tecla nunca ser tratada duas vezes.

## API local do conector (`/v1`)

Tipos em `packages/shared/src/powerpoint.ts`. Todas as rotas, menos `POST /v1/pair`, exigem `Authorization: Bearer <segredo>`; `POST` exige `Content-Type: application/json`.

| Rota | Efeito |
| --- | --- |
| `POST /v1/pair {code}` | troca o código de 6 dígitos pelo segredo |
| `GET /v1/status` | PowerPoint aberto?, apresentação (nome e total), show (estado, modo, ponteiro), slide atual, título, notas, progresso das miniaturas, capacidades |
| `POST /v1/open` | janela nativa "Abrir" no PC do palestrante e abre o arquivo escolhido (somente leitura) |
| `POST /v1/start {mode: fullscreen\|window, from?}` | inicia o show |
| `POST /v1/next`, `/prev`, `/first`, `/last`, `/end` | navegação (next inclui animações; passar do último encerra o show) |
| `POST /v1/goto {index}` | vai ao slide N (1 a total) |
| `POST /v1/blank {kind: black\|white}` | alterna tela preta/branca |
| `POST /v1/pointer {mode: arrow\|laser\|pen\|hidden\|erase}` | ponteiro |
| `POST /v1/export {width, format}` e `GET /v1/export` | exporta todos os slides / progresso |
| `GET /v1/slides/N/full` e `/thumb` | imagem exportada (PNG/JPEG) ou miniatura (cerca de 320 px) |
| `POST /v1/thumbs` | refaz as miniaturas |

Cada ação devolve o status novo, então a interface atualiza sem outra ida e volta. Erros têm `{error:{code,message}}` em português (`no_powerpoint`, `no_presentation`, `no_show`, `protected_view`, `busy`...).

## Modelo de ameaça e segurança

Quem teria interesse: qualquer página aberta no seu navegador (inclusive de outro site) tentando controlar seu PowerPoint ou ler arquivos; outro processo da mesma máquina; alguém na rede.

- **Só loopback.** O servidor escuta apenas em `127.0.0.1`; nada fica exposto à rede. O cabeçalho `Host` precisa ser `127.0.0.1:porta`, `localhost:porta` ou `[::1]:porta` (defesa contra DNS rebinding).
- **Token de pareamento.** Ao iniciar, o conector gera um código de 6 dígitos e um segredo de 256 bits. O código aparece só no console; trocá-lo pelo segredo (`/v1/pair`) exige `Origin` permitida, é limitado a 5 erros por minuto e o código é trocado após 15 erros. O segredo é comparado em tempo constante, não é gravado em disco pelo conector e, no navegador, fica só em `sessionStorage` (some ao fechar a aba). Toda outra chamada exige o segredo.
- **CORS restrito.** Só as origens da lista (padrão `http://localhost:5173` e `http://127.0.0.1:5173`, mais `--origin`/`CONNECTOR_ORIGINS`). Origem fora da lista recebe 403, inclusive no preflight. O preflight responde `Access-Control-Allow-Private-Network: true`. `POST` só aceita `application/json`, o que obriga preflight de qualquer página externa.
- **Sem execução arbitrária.** Não há rota que rode comando, script ou abra caminho informado pela web. O arquivo é escolhido pela pessoa na janela nativa do Windows; os caminhos de exportação são criados pelo próprio conector (pasta temporária privada, apagada ao sair) e só esses arquivos podem ser lidos. Os argumentos recebidos (modo, índice, ponteiro...) são validados contra listas fixas e faixas numéricas; o worker PowerShell tem comandos fixos e não executa texto recebido.
- **Limites.** Corpo de até 2 KB, rate limit global (30 req/s, rajada de 60) e limite de tentativas de autenticação inválida.
- **Arquivos do usuário.** Apresentações abertas somente leitura; o conector nunca salva, fecha ou altera arquivos e nunca lê outros arquivos. Se o PowerPoint abrir o arquivo em Modo Protegido, o conector avisa para você clicar em "Habilitar edição" no próprio PowerPoint (ele não contorna a proteção).
- **Log** sem dados sensíveis: só método, rota (números trocados por `#`), status e duração; nunca token, código, nomes ou conteúdo.

Riscos que restam: um processo malicioso **rodando como você** no mesmo PC pode ler o console ou testar o código (limitado a 5 tentativas por minuto), e o conector, por definição, deixa quem tiver o segredo avançar seus slides. Feche o conector ao terminar.

## Limitações

- Só Windows com PowerPoint desktop (COM). Se o PowerPoint estiver aberto mas o conector disser que está fechado (ele não aparece como "objeto ativo" do Windows), use "Abrir apresentação…".
- Um show por vez; se o PowerPoint abrir uma janela de diálogo, as chamadas respondem "PowerPoint ocupado".
- Modo "Enviar slides": máximo de 40 slides, sem animações. Não exige mudança no servidor do WorkVerse.
- Modo "Compartilhar tela": a plateia não recebe o número do slide.
- A janela "Abrir" demora alguns segundos para aparecer (PowerShell + Windows Forms).

## Outros programas (futuro)

A interface `PresentationAdapter` (`tools/powerpoint-connector/src/adapter.ts`) é tudo o que o conector pede do programa de slides, mais `capabilities` (abrir arquivo, notas, ir ao slide, exportar, ponteiro, tela preta, janela). Um adaptador genérico de **teclas** (Keynote, Google Slides, LibreOffice) só precisa implementar `next`/`previous`/`start`/`end` enviando teclas e declarar as demais capacidades como `false`.

## Testes

- `npm test` roda `tools/powerpoint-connector/test`: protocolo e handlers com adaptador falso (`server.test.ts`: token, origem, host, rate limit, pareamento, validação, exportação, log) e o teste **real** `powerpoint.integration.test.ts` (cria um .pptx de 5 slides por COM, abre, inicia, navega, confere o índice real pelo COM, tela preta, ponteiro, exporta PNG, encerra e fecha o PowerPoint que abriu). O teste real só roda no Windows com PowerPoint instalado **e fechado** (para não mexer na sessão de quem está trabalhando); `WV_SKIP_COM=1` o desliga.
- `npx tsc -p tools/powerpoint-connector --noEmit` verifica os tipos do conector (também incluído em `npm run typecheck`).
