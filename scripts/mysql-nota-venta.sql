-- =========================================================
--  NOTA DE VENTA (documento interno, NO se declara a SUNAT)
--  Reutiliza las tablas existentes (tipo_comprobante / estado_comprobante /
--  comprobante_series / comprobantes) con un código centinela 'NV'.
--  'NV' NO es un código real de SUNAT: solo permite usar las FKs actuales.
--  ✅ ADITIVO. Correr una vez:  mysql -u root -p vaxa < scripts/mysql-nota-venta.sql
-- =========================================================

-- 1) Tipo de comprobante interno. codigo_sunat='NV' (centinela) para la FK.
INSERT INTO tipo_comprobante (codigo, codigo_sunat, nombre) VALUES
  ('nota_venta', 'NV', 'Nota de venta')
ON DUPLICATE KEY UPDATE nombre = VALUES(nombre), codigo_sunat = VALUES(codigo_sunat);

-- 2) Estado "Emitida": la nota de venta no pasa por SUNAT, nace ya emitida.
INSERT INTO estado_comprobante (id, codigo, nombre) VALUES
  (8, 'EMITIDA', 'Emitida (no declarada a SUNAT)')
ON DUPLICATE KEY UPDATE nombre = VALUES(nombre);

-- 3) Serie interna NV01 (correlativo arranca en 0; el primer documento será NV01-1).
INSERT INTO comprobante_series (tipo_comprobante, serie) VALUES
  ('NV', 'NV01')
ON DUPLICATE KEY UPDATE serie = VALUES(serie);
