# Byte, o pet do escritório

Um gatinho-robô (corpo cinza-azulado, orelhas com LED ciano, olhos verdes, cauda com antena, coleirinha com plaquinha "B") que vive
no servidor. Arte original, desenhada por código (`apps/client/src/game/petArt.ts`).

## Como funciona

- **Não é jogador.** Fica fora de `room.players`: não conta em população, presença, listas, diretório nem inventário de PCs.
- **Um por organização**, estado só em memória (reiniciar o servidor volta ao padrão). Código: `apps/server/src/pet.ts`.
- **Autoritativo:** o servidor decide passeio (A\* existente, sem atravessar móveis), sentar em sofá/pufe ou perto de uma estação,
  dormir e trocar de sala por portas. O cliente só anima `pet`, `pet_path` e `pet_act` (mesmo formato de caminho dos jogadores),
  então todos veem a mesma coisa.
- **Zonas** (`petRoomAllowed`, `packages/shared/src/pet.ts`): só salas com acesso `org`, abertas (não trancadas/fechadas), sem reserva,
  sem palco ativo; nunca sala privada nem de concentração. Se a sala deixa de valer, ele sai dela.
- **Custo:** nada roda para organizações sem ninguém online; sala vazia = dorme; mensagens só para quem está na sala.

## Interação

Clique no Byte: **Fazer carinho** (corações, ronronar), **Dar petisco** (se você está ao lado de uma máquina de lanches, "compra" e
entrega; cooldown de 20 s por pessoa), **Chamar** (segue você por ~8 s) e **Brincar** (persegue o ponteiro por ~5 s). Frases nerds
em balões ocasionais. Validação estrita, limite de taxa por pessoa e por pet, alcance máximo de 6 tiles para carinho/petisco.

## Batida de coração

Cada autoping bem-sucedido (veja [deploy.md](deploy.md)) faz o Byte pulsar (LEDs acesos, anel e coraçãozinho ciano). É só visual.
**O pet não impede o plano gratuito de dormir; quem mantém acordado é o autoping.**

## Staff e variáveis

Aba **Byte** no painel (moderador ou mais; listar: helper): ligar/desligar por organização, renomear, "levar até mim", com auditoria
(`pet.on`, `pet.off`, `pet.rename`, `pet.bring`). `PET=off` desliga globalmente. Autoping: `KEEPALIVE`, `KEEPALIVE_MINUTES`.

## Limitações

Estado não persiste; reservas de sala ainda não são consultadas (o gancho `reserved` existe, e salas privadas já são proibidas);
o sprite tem 4 vistas por espelho e dormir/comer/feliz usam só a vista de frente.
