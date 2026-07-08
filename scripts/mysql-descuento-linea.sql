-- =========================================================
--  FEATURE: Descuento por producto (línea) en cotizaciones
--  ---------------------------------------------------------
--  Cada línea de una cotización puede llevar su propio descuento
--  (independiente del descuento global sobre el total): en % o en soles.
--  El neto de la línea se guarda en `total`.
--
--  En comprobantes (facturas/boletas/NV) el descuento por línea NO necesita
--  columnas nuevas: se "hornea" en valor_unitario / precio_unitario al emitir
--  (el motor ya lo hace), así el XML de SUNAT y el IGV siguen cuadrando.
--
--  ✅ ADITIVO e IDEMPOTENTE. Correr UNA vez:
--     mysql -u root -p vaxa < scripts/mysql-descuento-linea.sql
-- =========================================================
USE vaxa;
SET NAMES utf8mb4;
SET @db := DATABASE();

-- descuento_tipo -----------------------------------------------------------
SET @sql := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE cotizacion_detalle ADD COLUMN descuento_tipo VARCHAR(5) NULL AFTER precio_unitario',
  'SELECT 1')
  FROM information_schema.columns
  WHERE table_schema = @db AND table_name = 'cotizacion_detalle' AND column_name = 'descuento_tipo');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- descuento_valor ----------------------------------------------------------
SET @sql := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE cotizacion_detalle ADD COLUMN descuento_valor DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER descuento_tipo',
  'SELECT 1')
  FROM information_schema.columns
  WHERE table_schema = @db AND table_name = 'cotizacion_detalle' AND column_name = 'descuento_valor');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- descuento_monto ----------------------------------------------------------
SET @sql := (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE cotizacion_detalle ADD COLUMN descuento_monto DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER descuento_valor',
  'SELECT 1')
  FROM information_schema.columns
  WHERE table_schema = @db AND table_name = 'cotizacion_detalle' AND column_name = 'descuento_monto');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
