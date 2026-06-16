-- Sesión única por usuario (single-session enforcement).
--
-- Guarda el identificador de la sesión ACTIVA de cada usuario. En cada login se
-- genera un UUID nuevo y se pisa esta columna; el JWT lleva ese mismo UUID en el
-- claim `sid`. El middleware compara el `sid` del token contra esta columna: si
-- no coinciden, el token pertenece a una sesión vieja (otro dispositivo) y se
-- rechaza con 401 SESSION_REVOKED.
--
-- Ejecutar una sola vez en la base de datos de producción.

ALTER TABLE usuarios
  ADD COLUMN session_token VARCHAR(64) NULL DEFAULT NULL
  COMMENT 'UUID de la sesión activa; sesión única por usuario';
