-- =========================================================
--  Permite guardar el logo de la empresa como data URL base64
--  (igual que la tabla `logos`). varchar(255) no alcanza.
-- =========================================================
USE vaxa;

ALTER TABLE `empresas` MODIFY `logo_url` MEDIUMTEXT NULL;
