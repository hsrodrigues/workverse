-- Contas e sessoes (equivalente ao AccountStore atual).
-- Unicidade case-insensitive: email_key / name_key sao calculadas pela aplicacao
-- (NFKC + minusculas, igual ao cache em memoria) e protegidas por indice unico.

CREATE TABLE accounts (
  id            uuid        PRIMARY KEY,
  email         text        NOT NULL,
  email_key     text        NOT NULL,
  display_name  text        NOT NULL,
  name_key      text        NOT NULL,
  password_hash text        NOT NULL DEFAULT '',
  avatar        jsonb       NOT NULL DEFAULT '{}'::jsonb,
  last_room     text        NOT NULL,
  status        text,
  team          text,
  -- Campos de Account que ainda nao tem coluna propria (ex.: conjuntos de roupas).
  -- A aplicacao grava aqui qualquer propriedade desconhecida e a devolve ao carregar.
  extra         jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX accounts_email_key_uq ON accounts (email_key);
CREATE UNIQUE INDEX accounts_name_key_uq  ON accounts (name_key);

CREATE TABLE sessions (
  token_hash text        PRIMARY KEY,
  account_id uuid        NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  ip         text,
  user_agent text,
  last_seen  timestamptz
);

CREATE INDEX sessions_account_idx ON sessions (account_id);
CREATE INDEX sessions_expires_idx ON sessions (expires_at);
