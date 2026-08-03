-- ─────────────────────────────────────────────────────────────
-- Calidad de participación por inscripción.
-- Permite dar constancias a Participante / Organizador / Ponente / etc.
-- El default es 'Participante' → la web pública (que no la setea) queda
-- siempre como participante; el admin y el Excel pueden ponerle otra calidad.
-- (Se llama "calidad" y no "rol" para no confundir con el rol de usuario.)
-- ADITIVO y seguro de correr varias veces.
-- ─────────────────────────────────────────────────────────────

ALTER TABLE inscripciones
  ADD COLUMN calidad VARCHAR(60) NOT NULL DEFAULT 'Participante' AFTER estado_id;

-- Las inscripciones existentes quedan como 'Participante' (por el DEFAULT).
