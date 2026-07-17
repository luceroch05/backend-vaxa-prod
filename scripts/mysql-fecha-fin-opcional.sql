-- ─────────────────────────────────────────────────────────────
-- fecha_fin opcional en las aulas (grupos_programas)
-- ─────────────────────────────────────────────────────────────
-- Un aula puede durar un solo día: en ese caso se guarda solo
-- fecha_inicio y fecha_fin queda NULL. El certificado muestra
-- "realizado el X" (un día) o "realizado del X al Y" (rango).
--
-- Antes: fecha_fin era NOT NULL. Esta migración la vuelve nullable.
-- Ejecutar una sola vez sobre la BD del tenant.

ALTER TABLE grupos_programas
  MODIFY COLUMN fecha_fin DATE NULL;
