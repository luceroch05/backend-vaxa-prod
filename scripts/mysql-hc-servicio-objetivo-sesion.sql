-- =========================================================
--  Amarra OBJETIVOS y SESIONES a un SERVICIO
--  ---------------------------------------------------------
--  Un paciente puede llevar varios servicios (a la vez o en el tiempo).
--  Con `servicio_id` cada objetivo y cada sesión sabe de qué servicio es,
--  así se pueden filtrar por servicio. NULL = general / sin servicio.
--
--  El backend lo agrega solo (ensureServicioObjSes); este script queda
--  para correrlo a mano si se prefiere.
--  ✅ ADITIVO. Correr DESPUÉS de mysql-historias-clinicas.sql.
-- =========================================================
USE vaxa;
SET NAMES utf8mb4;

ALTER TABLE hc_objetivos ADD COLUMN servicio_id INT NULL AFTER historia_id;
ALTER TABLE hc_objetivos ADD CONSTRAINT fk_hc_objetivos_servicio
  FOREIGN KEY (servicio_id) REFERENCES hc_servicios(id) ON DELETE SET NULL;

ALTER TABLE hc_sesiones ADD COLUMN servicio_id INT NULL AFTER historia_id;
ALTER TABLE hc_sesiones ADD CONSTRAINT fk_hc_sesiones_servicio
  FOREIGN KEY (servicio_id) REFERENCES hc_servicios(id) ON DELETE SET NULL;
