-- ============================================================
-- Tareas para casa: enlace de VIDEO de YouTube (hc_tareas.video_url)
-- ------------------------------------------------------------
-- La tarea puede llevar un video de apoyo. Hay dos formas:
--   1) Video propio corto  → se sube como ADJUNTO (adjunto_ruta/mime), tope 40 MB.
--   2) Video de YouTube     → se guarda solo el ENLACE aquí (no pesa nada en el VPS;
--                             lo sirve YouTube, el apoderado lo ve embebido).
--
-- ADITIVO: solo agrega una columna. Correr una vez. (El backend también la
-- auto-crea de forma lazy, así que esto es opcional pero recomendado.)
-- ============================================================
USE vaxa;

ALTER TABLE hc_tareas
  ADD COLUMN video_url VARCHAR(500) NULL AFTER adjunto_mime;

SELECT 'hc_tareas.video_url agregada' AS ok;
