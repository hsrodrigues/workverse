-- Redefinicao de senha por e-mail ("Esqueci minha senha", docs/password-reset.md).
-- Guarda SOMENTE o SHA-256 do token (o token em claro existe apenas no e-mail enviado). Uso unico: a linha e apagada ao usar.
-- Validade curta (30 min) e no maximo 3 pendentes por conta sao impostos pela aplicacao; linhas expiradas sao descartadas no boot.

CREATE TABLE password_reset_tokens (
  token_hash text        PRIMARY KEY,
  account_id uuid        NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL
);

CREATE INDEX password_reset_tokens_account_idx ON password_reset_tokens (account_id);
CREATE INDEX password_reset_tokens_expires_idx ON password_reset_tokens (expires_at);
