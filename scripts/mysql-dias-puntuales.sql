-- ─────────────────────────────────────────────────────────────
-- Días puntuales del aula (hasta 3 fechas exactas)
-- ─────────────────────────────────────────────────────────────
-- Un curso puede dictarse en hasta 3 días puntuales, que pueden NO ser
-- consecutivos (ej. 21, 25 y 1 de agosto). Día 1 = fecha_inicio (ya existe);
-- se agregan Día 2 y Día 3 opcionales. El certificado los lista:
--   1 día  → "realizado el 21 de agosto de 2026"
--   2 días → "realizado los días 21 y 25 de agosto de 2026"
--   3 días → "realizado los días 21, 25 y 1 de agosto de 2026"
-- fecha_fin queda para aulas antiguas (rango); las nuevas usan los días.
-- Ejecutar una sola vez sobre la BD del tenant.

ALTER TABLE grupos_programas
  ADD COLUMN fecha_dia2 DATE NULL AFTER fecha_fin,
  ADD COLUMN fecha_dia3 DATE NULL AFTER fecha_dia2;
