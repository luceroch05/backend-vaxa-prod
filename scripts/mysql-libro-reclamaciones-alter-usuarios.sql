-- =========================================================
--  FIX: Libro de Reclamaciones — nombres de columna desalineados
--  ---------------------------------------------------------
--  En PRODUCCIÓN las columnas de "qué usuario actuó" existen con el nombre
--  VIEJO; el código las usa con el nombre NUEVO. Son la misma columna:
--    reclamos.respondido_by       ->  user_actua_id
--    reclamo_historial.created_by ->  user_crea_id
--  Por eso al responder / cambiar estado salía:
--    Unknown column 'user_actua_id' in 'SET'
--    Unknown column 'user_crea_id' in 'INSERT INTO'
--
--  Solución: RENOMBRAR (no agregar), así se conservan los datos y no quedan
--  columnas duplicadas. CHANGE funciona en MySQL y MariaDB.
--
--  reclamo_adjunto NO necesita cambios (el código no escribe user_crea_id ahí).
--
--  ✅ Correr UNA vez en producción. Si tu base no se llama 'vaxa', cambia el USE.
-- =========================================================
USE vaxa;

ALTER TABLE reclamos          CHANGE respondido_by user_actua_id INT NULL;
ALTER TABLE reclamo_historial CHANGE created_by    user_crea_id   INT NULL;
