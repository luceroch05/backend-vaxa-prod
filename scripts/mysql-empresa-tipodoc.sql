-- =========================================================
--  Tipo de documento de la empresa/cliente (para registrar
--  personas naturales con DNI/CE, no solo RUC).
--  codigo_sunat cat.06: '6' RUC · '1' DNI · '4' CE · '7' pasaporte · '0' sin doc
--  El número se sigue guardando en la columna `ruc` (genérica).
--  ✅ ADITIVO. Default '6' (RUC) para no romper las empresas existentes.
--     mysql -u root -p vaxa < scripts/mysql-empresa-tipodoc.sql
-- =========================================================
ALTER TABLE empresas
  ADD COLUMN tipo_doc CHAR(1) NOT NULL DEFAULT '6' AFTER ruc;
