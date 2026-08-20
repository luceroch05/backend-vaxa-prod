-- ============================================================
-- Logo OBLIGATORIO dedicado al certificado (empresas.logo_cert_url)
-- ------------------------------------------------------------
-- Hasta ahora el logo obligatorio del certificado se materializaba desde
-- `empresas.logo_url` (el mismo que Vaxa sube al registrar la empresa).
-- El usuario pidió que Vaxa pueda asignar a cada cliente OTRA imagen dedicada
-- al certificado, SEPARADA del logo de registro.
--
-- `logo_cert_url` guarda esa imagen (ruta en /uploads o data URL base64, igual
-- que logo_url). Si está NULL/vacía, el obligatorio cae al `logo_url` (fallback).
--
-- ADITIVO: solo agrega una columna. Correr una vez. (El backend también la
-- auto-crea de forma lazy, así que esto es opcional pero recomendado.)
-- ============================================================
USE vaxa;

ALTER TABLE `empresas`
  ADD COLUMN `logo_cert_url` MEDIUMTEXT NULL AFTER `logo_url`;
