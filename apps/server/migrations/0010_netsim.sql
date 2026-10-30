-- Simulador de rede da Sala da TI (docs/netsim.md). Tudo pertence a UMA organizacao (org_id). Nada aqui toca a rede real.

-- Uma topologia por organizacao. `version` sobe a cada edicao (controle de conflito, como o editor de salas).
-- O JSON e validado pelo servidor (limites de dispositivos/cabos) antes de gravar; o banco so garante o formato basico.
CREATE TABLE netsim_topologies (
  org_id     text        PRIMARY KEY REFERENCES orgs (id) ON DELETE CASCADE,
  version    integer     NOT NULL CHECK (version >= 1),
  topology   jsonb       NOT NULL CHECK (jsonb_typeof(topology) = 'object' AND jsonb_typeof(topology -> 'devices') = 'array' AND jsonb_typeof(topology -> 'cables') = 'array'),
  updated_by uuid        REFERENCES accounts (id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Progresso dos desafios "Conserte a rede" por conta (e placar da equipe de TI da organizacao).
CREATE TABLE netsim_progress (
  org_id       text        NOT NULL REFERENCES orgs (id) ON DELETE CASCADE,
  account_id   uuid        NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  challenge_id text        NOT NULL CHECK (char_length(challenge_id) BETWEEN 1 AND 40),
  best         integer     NOT NULL DEFAULT 0 CHECK (best BETWEEN 0 AND 100),
  attempts     integer     NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  solved_at    timestamptz,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, account_id, challenge_id)
);
CREATE INDEX netsim_progress_org_idx ON netsim_progress (org_id, best DESC);
