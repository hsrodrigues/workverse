-- Equipes que entram numa sala mesmo quando ela esta trancada (acesso restrito ou trancada pela staff). Lista de ids de equipe da
-- PROPRIA organizacao (jsonb). NULL = padrao da sala (ex.: a Sala da TI deixa passar a equipe chamada "TI"); lista vazia = ninguem.
ALTER TABLE room_settings ADD COLUMN pass_team_ids jsonb CHECK (pass_team_ids IS NULL OR jsonb_typeof(pass_team_ids) = 'array');
