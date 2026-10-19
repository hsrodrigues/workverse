-- Editor de salas e controle de acesso por sala. Tudo pertence a UMA organizacao (org_id): editar a sala de uma org
-- nunca toca outra. O layout base das salas continua no codigo (ROOM_DEFS); aqui fica so o que a org personalizou.

-- Layout personalizado de uma sala. `furniture` = lista completa de pecas; NULL = layout original (depois de "restaurar").
-- A linha nao e apagada ao restaurar: `version` so cresce, para o controle otimista de concorrencia nunca repetir um numero.
CREATE TABLE room_furniture (
  org_id     text        NOT NULL REFERENCES orgs (id) ON DELETE CASCADE,
  room_id    text        NOT NULL,
  version    integer     NOT NULL DEFAULT 0 CHECK (version >= 0),
  furniture  jsonb,
  updated_by uuid        REFERENCES accounts (id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, room_id)
);

-- Quem pode entrar: aberta a org, so uma equipe, por convite ou privada. Sem linha = padrao da sala (ROOM_DEFS).
CREATE TABLE room_settings (
  org_id     text        NOT NULL REFERENCES orgs (id) ON DELETE CASCADE,
  room_id    text        NOT NULL,
  access     text        NOT NULL CHECK (access IN ('org', 'team', 'invited', 'private')),
  team_id    text        REFERENCES teams (id) ON DELETE SET NULL,
  updated_by uuid        REFERENCES accounts (id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, room_id)
);

-- Convites para salas por convite / privadas: uma linha por conta e sala, com validade opcional.
CREATE TABLE room_invites (
  org_id     text        NOT NULL REFERENCES orgs (id) ON DELETE CASCADE,
  room_id    text        NOT NULL,
  account_id uuid        NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  invited_by uuid        REFERENCES accounts (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  PRIMARY KEY (org_id, room_id, account_id)
);

CREATE INDEX room_invites_account_idx ON room_invites (account_id);
