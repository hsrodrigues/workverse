-- Reserva de sala com fila (docs/bookings.md). Tudo pertence a UMA organizacao (org_id).

-- Uma linha por pedido de reserva. `status`: pending (aguarda aprovacao), confirmed, queued (fila), cancelled, declined, ended,
-- no_show (dono nao entrou) ou expired (a fila nao chegou a tempo). So pending/confirmed ocupam o horario; a ordem da fila e created_at.
CREATE TABLE room_bookings (
  id             text        PRIMARY KEY,
  org_id         text        NOT NULL REFERENCES orgs (id) ON DELETE CASCADE,
  room_id        text        NOT NULL,
  owner_id       uuid        NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  title          text        NOT NULL CHECK (char_length(title) <= 120),
  start_at       timestamptz NOT NULL,
  end_at         timestamptz NOT NULL,
  status         text        NOT NULL CHECK (status IN ('pending', 'confirmed', 'queued', 'cancelled', 'declined', 'ended', 'no_show', 'expired')),
  guest_ids      jsonb       NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(guest_ids) = 'array'),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  decided_by     uuid        REFERENCES accounts (id) ON DELETE SET NULL,
  reason         text        CHECK (reason IS NULL OR char_length(reason) <= 240),
  checked_in_at  timestamptz,
  -- avisos ja enviados (bits), para nao repetir depois de um reinicio do servidor
  notified       integer     NOT NULL DEFAULT 0 CHECK (notified >= 0),
  CHECK (end_at > start_at)
);

-- agenda da sala por janela, e reservas de uma pessoa
CREATE INDEX room_bookings_window_idx ON room_bookings (org_id, room_id, start_at, end_at);
CREATE INDEX room_bookings_owner_idx ON room_bookings (org_id, owner_id, start_at);
-- o relogio do servidor so olha o que ainda esta vivo
CREATE INDEX room_bookings_live_idx ON room_bookings (org_id, room_id, start_at) WHERE status IN ('pending', 'confirmed', 'queued');
-- limpeza das reservas antigas
CREATE INDEX room_bookings_end_idx ON room_bookings (end_at);

-- Quais salas a organizacao deixa reservar e se exigem aprovacao. Sem linha = padrao (so a Sala Privada e reservavel, sem aprovacao).
CREATE TABLE booking_room_settings (
  org_id            text        NOT NULL REFERENCES orgs (id) ON DELETE CASCADE,
  room_id           text        NOT NULL,
  bookable          boolean     NOT NULL,
  requires_approval boolean     NOT NULL DEFAULT false,
  updated_by        uuid        REFERENCES accounts (id) ON DELETE SET NULL,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, room_id)
);

-- Limites por organizacao. Sem linha = padrao.
CREATE TABLE booking_limits (
  org_id               text        PRIMARY KEY REFERENCES orgs (id) ON DELETE CASCADE,
  max_duration_min     integer     NOT NULL CHECK (max_duration_min BETWEEN 15 AND 1440),
  max_active_per_person integer    NOT NULL CHECK (max_active_per_person BETWEEN 1 AND 20),
  max_advance_days     integer     NOT NULL CHECK (max_advance_days BETWEEN 1 AND 365),
  max_daily_min        integer     NOT NULL CHECK (max_daily_min BETWEEN 15 AND 1440),
  no_show_min          integer     NOT NULL CHECK (no_show_min BETWEEN 0 AND 120),
  updated_by           uuid        REFERENCES accounts (id) ON DELETE SET NULL,
  updated_at           timestamptz NOT NULL DEFAULT now()
);
