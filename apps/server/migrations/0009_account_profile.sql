-- Perfil editavel pela propria pessoa ("Meu perfil", docs/profile.md).
-- Os campos (sobre mim, pronomes, aniversario, preferencias, trocas de nome) vivem em accounts.extra -> 'profile' (jsonb),
-- como os demais campos opcionais da conta; contas antigas continuam funcionando com tudo vazio. Nao ha coluna nova.
-- Este indice acelera o historico de trocas de nome mostrado a staff na ficha da conta (auditoria 'profile.rename').
CREATE INDEX IF NOT EXISTS staff_audit_rename_idx ON staff_audit (target_id, at DESC) WHERE action = 'profile.rename';
