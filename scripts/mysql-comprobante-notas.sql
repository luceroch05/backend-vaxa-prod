-- =========================================================
--  FEATURE: Notas / observaciones en comprobantes
--  ---------------------------------------------------------
--  Campo de texto libre para condiciones, forma de pago, etc.
--  Es SOLO para la representación impresa (PDF): NO se declara a
--  SUNAT (no va en el XML/UBL), igual que las notas de una cotización.
--  Se permiten párrafos: se guardan los saltos de línea tal cual.
--
--  ✅ ADITIVO. Correr UNA vez.
--  Uso: mysql -u usuario -p vaxa < scripts/mysql-comprobante-notas.sql
-- =========================================================
USE vaxa;
SET NAMES utf8mb4;

ALTER TABLE comprobantes
  ADD COLUMN notas VARCHAR(1000) NULL AFTER cliente_direccion;
