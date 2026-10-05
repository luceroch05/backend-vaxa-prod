-- ============================================================================
--  VAXA · Historias Clínicas — FASE 2: Paquetes y Combos
--  --------------------------------------------------------------------------
--  Un PAQUETE/COMBO es una tarifa vendible a precio especial, compuesta de
--  1..N líneas. El descuento sale solo (suma de líneas a precio normal vs.
--  precio_total del paquete). No es un concepto nuevo raro: es exactamente lo
--  que ya hace el saldo de sesiones, solo que ahora se compra "de golpe".
--
--    · Paquete de 8 sesiones  = 1 línea  -> Sesión individual × 8  a S/ 380
--    · Combo Evaluación Integral = varias líneas -> Sesión × 4 + Informe × 1 a S/ 300
--
--  Al VENDER un paquete, el backend explota sus líneas en hc_venta_items
--  (cada una con su motivo_id + cantidad) y así carga el saldo de cada motivo;
--  cada cita de ese motivo lo consume. `paquete_id` queda de rastro en la venta.
--
--  Requiere FASE 1 (mysql-hc-motivos.sql).
--    mysql -u root -p vaxa < scripts/mysql-hc-paquetes.sql
-- ============================================================================

-- Fija utf8mb4 en la sesión para que las tildes/ñ de los literales no se corrompan.
SET NAMES utf8mb4;

-- 1) Paquete / Combo (cabecera) ----------------------------------------------
--    servicio_id es OPCIONAL: un combo puede anclarse a un área, o quedar NULL
--    si mezcla motivos de distintas áreas.
CREATE TABLE IF NOT EXISTS hc_paquetes (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id    INT           NOT NULL,
  servicio_id   INT           DEFAULT NULL,             -- área a la que pertenece (opcional)
  nombre        VARCHAR(160)  NOT NULL,                 -- 'Paquete 8 sesiones', 'Evaluación Integral'…
  descripcion   VARCHAR(255)  DEFAULT NULL,
  precio_total  DECIMAL(10,2) NOT NULL DEFAULT 0,       -- precio ya con el descuento del paquete
  activo        TINYINT(1)    NOT NULL DEFAULT 1,
  user_crea_id  INT           DEFAULT NULL,
  created_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_hcpaq_empresa  FOREIGN KEY (empresa_id)   REFERENCES empresas(id)     ON DELETE CASCADE,
  CONSTRAINT fk_hcpaq_servicio FOREIGN KEY (servicio_id)  REFERENCES hc_servicios(id) ON DELETE SET NULL,
  CONSTRAINT fk_hcpaq_crea     FOREIGN KEY (user_crea_id)  REFERENCES usuarios(id),
  INDEX idx_hcpaq_empresa (empresa_id),
  UNIQUE KEY uq_hcpaq (empresa_id, nombre)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Paquetes/combos vendibles (tarifa especial por N líneas)';

-- 2) Líneas del paquete: qué motivo y cuántas sesiones incluye ----------------
CREATE TABLE IF NOT EXISTS hc_paquete_lineas (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id  INT      NOT NULL,
  paquete_id  INT      NOT NULL,
  motivo_id   INT      NOT NULL,
  cantidad    INT      NOT NULL DEFAULT 1,
  orden       INT      NOT NULL DEFAULT 0,
  CONSTRAINT fk_hcpl_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id)    ON DELETE CASCADE,
  CONSTRAINT fk_hcpl_paquete FOREIGN KEY (paquete_id) REFERENCES hc_paquetes(id) ON DELETE CASCADE,
  CONSTRAINT fk_hcpl_motivo  FOREIGN KEY (motivo_id)  REFERENCES hc_motivos(id),
  INDEX idx_hcpl_paquete (paquete_id),
  INDEX idx_hcpl_motivo (motivo_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Líneas que componen un paquete/combo (motivo × cantidad)';

-- 3) Rastro del paquete en la venta ------------------------------------------
--    La venta se explota en líneas por motivo (ver FASE 1), pero guardamos de
--    qué paquete vinieron para reportes/anulación y para mostrarlo en el recibo.
SET @has_vip := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'hc_venta_items' AND COLUMN_NAME = 'paquete_id');
SET @sql := IF(@has_vip = 0,
  'ALTER TABLE hc_venta_items ADD COLUMN paquete_id INT NULL AFTER motivo_id',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_vip_fk := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'hc_venta_items' AND CONSTRAINT_NAME = 'fk_hcvi_paquete');
SET @sql := IF(@has_vip_fk = 0,
  'ALTER TABLE hc_venta_items ADD CONSTRAINT fk_hcvi_paquete FOREIGN KEY (paquete_id) REFERENCES hc_paquetes(id)',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Verificación
SELECT 'hc_paquetes OK' AS estado;
