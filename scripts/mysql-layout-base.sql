-- =========================================================
--  FEATURE: Plantilla base del diseño personalizado (por empresa)
--  ---------------------------------------------------------
--  Agrega empresas.layout_base (JSON TEXT): la posición por defecto de los
--  elementos del "Diseño personalizado (Lienzo)" que cada empresa guarda UNA
--  vez. Al activar el diseño en un programa nuevo se carga esta base (ya no un
--  preset hardcodeado por el programador). El usuario solo mueve lo que quiera.
--
--  El backend también la auto-crea en runtime (ensureLayoutBase), así que este
--  script es opcional. Idempotente: se puede correr varias veces.
--    mysql -u root -p vaxa < scripts/mysql-layout-base.sql
-- =========================================================
USE vaxa;

SET @existe := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'empresas'
     AND COLUMN_NAME = 'layout_base'
);
SET @sql := IF(@existe = 0,
  'ALTER TABLE empresas ADD COLUMN layout_base TEXT NULL',
  'SELECT "empresas.layout_base ya existe" AS info');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
