-- ─────────────────────────────────────────────────────────────
-- Créditos académicos por programa
-- Agrega la columna `creditos` a la tabla `programas`.
-- Es OPCIONAL (default 0, igual criterio que horas_academicas).
-- Se puede insertar en el texto del certificado con la variable {creditos}.
-- ─────────────────────────────────────────────────────────────

ALTER TABLE programas
  ADD COLUMN creditos INT NOT NULL DEFAULT 0 AFTER horas_academicas;
