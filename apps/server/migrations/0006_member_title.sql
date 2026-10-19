-- Cargo (texto curto) de cada pessoa em cada organizacao. O SETOR e a equipe ja existente (org_members.team_id + teams.color).
-- Quem administra define; NULL = sem cargo (contas antigas continuam funcionando).
ALTER TABLE org_members ADD COLUMN title text CHECK (title IS NULL OR (char_length(title) BETWEEN 1 AND 32));
