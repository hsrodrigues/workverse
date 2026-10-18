-- Organizacoes, equipes, vinculos (org_members) e convites.
-- Ids de orgs/equipes/convites sao text: a org padrao migrada das contas antigas usa o id fixo 'default'.
-- accounts.team (legado) continua existindo, mas so a migracao v3 a le; a equipe vigente e org_members.team_id.

CREATE TABLE orgs (
  id         text        PRIMARY KEY,
  slug       text        NOT NULL,
  name       text        NOT NULL,
  settings   jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX orgs_slug_uq ON orgs (slug);

CREATE TABLE teams (
  id     text PRIMARY KEY,
  org_id text NOT NULL REFERENCES orgs (id) ON DELETE CASCADE,
  name   text NOT NULL,
  color  text NOT NULL DEFAULT '#6c8cff'
);

CREATE INDEX teams_org_idx ON teams (org_id);

CREATE TABLE org_members (
  org_id     text        NOT NULL REFERENCES orgs (id) ON DELETE CASCADE,
  account_id uuid        NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  role       text        NOT NULL CHECK (role IN ('owner', 'admin', 'member', 'guest')),
  team_id    text        REFERENCES teams (id) ON DELETE SET NULL,
  status     text        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, account_id)
);

CREATE INDEX org_members_account_idx ON org_members (account_id);

CREATE TABLE invites (
  id         text        PRIMARY KEY,
  org_id     text        NOT NULL REFERENCES orgs (id) ON DELETE CASCADE,
  email      text,
  role       text        NOT NULL CHECK (role IN ('owner', 'admin', 'member', 'guest')),
  team_id    text        REFERENCES teams (id) ON DELETE SET NULL,
  -- sha256 do token; o token em si nunca e gravado.
  token_hash text        NOT NULL,
  created_by uuid        REFERENCES accounts (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  max_uses   integer     NOT NULL DEFAULT 1 CHECK (max_uses >= 1),
  uses       integer     NOT NULL DEFAULT 0 CHECK (uses >= 0),
  revoked_at timestamptz
);

CREATE UNIQUE INDEX invites_token_hash_uq ON invites (token_hash);
CREATE INDEX invites_org_idx ON invites (org_id);
