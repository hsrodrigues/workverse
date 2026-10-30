-- Desafios do simulador de rede: dicas usadas na execucao da melhor pontuacao (0 a 3).
ALTER TABLE netsim_progress ADD COLUMN hints integer NOT NULL DEFAULT 0 CHECK (hints BETWEEN 0 AND 3);
