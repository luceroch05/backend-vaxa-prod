-- ============================================================================
--  VAXA · Historias Clínicas — Adjunto (audio/imagen) en las tareas para casa
--  --------------------------------------------------------------------------
--  El terapeuta puede adjuntar un AUDIO modelo (mp3) — o imagen — a la tarea,
--  y el apoderado lo escucha/ve desde el portal. Reusa /uploads (ruta, no base64).
--
--  Correr DESPUÉS de mysql-hc-tareas.sql.
--    mysql -u root -p vaxa < scripts/mysql-hc-tareas-adjunto.sql
-- ============================================================================

ALTER TABLE hc_tareas
  ADD COLUMN adjunto_ruta   VARCHAR(500) DEFAULT NULL COMMENT 'Ruta en /uploads (audio/imagen de apoyo)' AFTER detalle,
  ADD COLUMN adjunto_nombre VARCHAR(200) DEFAULT NULL AFTER adjunto_ruta,
  ADD COLUMN adjunto_mime   VARCHAR(120) DEFAULT NULL AFTER adjunto_nombre;

SELECT 'hc_tareas: columnas de adjunto agregadas' AS ok;
