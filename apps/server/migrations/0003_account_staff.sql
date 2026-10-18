-- Nivel de staff da PLATAFORMA (suporte/moderacao). NULL = conta comum.
-- Definido somente pelo servidor (BOOTSTRAP_STAFF_EMAILS ou "npm run staff:grant"), nunca por mensagem do cliente.

ALTER TABLE accounts
  ADD COLUMN staff text CHECK (staff IN ('helper', 'moderator', 'admin'));

CREATE INDEX accounts_staff_idx ON accounts (staff) WHERE staff IS NOT NULL;
