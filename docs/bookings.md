# Reservas de sala com fila

Regras puras em `packages/shared/src/bookings.ts` (conflito, fila, limites, janelas, placa) e `bookingTime.ts` (fusos); servidor em `apps/server/src/bookings.ts` (mensagens `booking_*`, relogio por `World.tick`, acesso via `World.canEnter` -> `restriction()`); stores em `bookingStore.ts` (memoria/JSON) e `db/bookingMapping.ts` (PostgreSQL, migracao `0008_room_bookings.sql`).

- Sala Privada reservavel por padrao; as demais a organizacao liga na aba Acesso do editor ou em Reservas > Salas e limites (recepcao/escritorio nunca).
- Conflito -> fila por ordem de chegada (posicao + proxima janela livre); cancelar/encerrar/no-show/editar promove a fila.
- Aprovacao opcional por sala (admins/donos aprovam ou recusam com motivo; os pedidos deles saem confirmados).
- Limites por organizacao (padrao: 8 h por reserva, 2 ativas, 30 dias, 8 h/dia, no-show 15 min).
- Durante a janela so entram dono, convidados, owners/admins e staff admin; aviso 5 min antes, tolerancia de 1 min, aviso de fim, estender +30 min sem fila/conflito. Config permanente da sala nao muda.
- Privacidade: quem nao tem acesso ve so "Ocupada"; sem e-mails/ids. Tempos em ms UTC; avisos do servidor usam horario de Brasilia, a UI usa o fuso do navegador.
- Limpeza: reservas terminadas ha mais de 90 dias sao apagadas.
