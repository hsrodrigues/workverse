-- Auditoria permanente das acoes de staff da plataforma (painel, API e comandos).
-- Sem chave estrangeira para accounts: o registro deve sobreviver mesmo que a conta um dia seja apagada.
-- Nunca guarda texto de mensagens privadas (DMs de usuarios nao passam por aqui).

CREATE TABLE staff_audit (
  id        text PRIMARY KEY,
  at        timestamptz NOT NULL,
  actor_id  text NOT NULL,
  actor     text NOT NULL,
  level     text CHECK (level IN ('helper', 'moderator', 'admin')),
  action    text NOT NULL,
  target_id text,
  target    text,
  detail    text
);

CREATE INDEX staff_audit_at_idx ON staff_audit (at DESC);
CREATE INDEX staff_audit_actor_idx ON staff_audit (actor_id, at DESC);
CREATE INDEX staff_audit_target_idx ON staff_audit (target_id, at DESC) WHERE target_id IS NOT NULL;
CREATE INDEX staff_audit_action_idx ON staff_audit (action, at DESC);
