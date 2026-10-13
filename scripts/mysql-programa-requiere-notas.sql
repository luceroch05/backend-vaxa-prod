-- ────────────────────────────────────────────────────────────────
-- Programa SIN evaluación (sin notas ni acta)
-- ────────────────────────────────────────────────────────────────
-- Interruptor por programa: cuando requiere_notas = 0, el programa NO
-- lleva evaluación. No se registran notas y al emitir NO se genera la
-- 2ª hoja de acta de notas (solo el certificado). La aprobación se
-- marca por asistencia desde Inscripciones (igual que el modo Crédito).
--
-- Default 1: todos los programas existentes conservan su comportamiento
-- actual (acta si tienen unidades).
-- ────────────────────────────────────────────────────────────────

ALTER TABLE programas
  ADD COLUMN requiere_notas TINYINT(1) NOT NULL DEFAULT 1 AFTER nota_minima;
