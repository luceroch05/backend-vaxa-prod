-- ────────────────────────────────────────────────────────────────
-- Override de evaluación POR AULA
-- ────────────────────────────────────────────────────────────────
-- Permite que un aula lleve notas y otra no, dentro del MISMO programa.
--   NULL = hereda del programa (programas.requiere_notas)  ← default
--   1    = esta aula SÍ lleva evaluación (notas + acta)
--   0    = esta aula NO lleva evaluación (temario / solo certificado)
-- El valor efectivo es COALESCE(grupos_programas.requiere_notas, programas.requiere_notas).
-- ────────────────────────────────────────────────────────────────

ALTER TABLE grupos_programas
  ADD COLUMN requiere_notas TINYINT(1) NULL DEFAULT NULL AFTER modalidad_id;
