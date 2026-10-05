-- ============================================================================
--  VAXA · Historias Clínicas — FASE 1: Motivos de cita (tipos con precio)
--  --------------------------------------------------------------------------
--  Hasta hoy el `motivo` de la cita era TEXTO LIBRE y el precio vivía en el
--  propio servicio (un servicio = un precio). Esta fase agrega el nivel
--  intermedio que faltaba:
--
--      Servicio (ÁREA: Terapia de Lenguaje, Psicología…)
--        └─ Motivo de cita (Evaluación, Sesión individual, Informe…) · con precio y duración
--
--  · hc_motivos                 -> catálogo de motivos POR servicio (y por centro)
--  · hc_citas.motivo_id         -> la cita apunta a un motivo (se conserva el texto
--                                  libre `motivo` como respaldo / nota)
--  · hc_venta_items.motivo_id   -> una línea de venta puede ser de un MOTIVO, para que
--                                  el saldo de sesiones pase a contarse POR motivo
--                                  (antes era por servicio). Compatible hacia atrás:
--                                  las ventas viejas siguen con servicio_id y null motivo.
--
--  Correr DESPUÉS de mysql-hc-finanzas.sql.
--    mysql -u root -p vaxa < scripts/mysql-hc-motivos.sql
-- ============================================================================

-- IMPORTANTE: fija la codificación de la sesión a utf8mb4 para que las tildes/ñ
-- de los textos literales (ej. 'Sesión individual') se guarden bien aunque el
-- cliente mysql por defecto use latin1. Sin esto, "Sesión" se guarda como "SesiÃ³n".
SET NAMES utf8mb4;

-- 1) Catálogo de motivos de cita por servicio --------------------------------
CREATE TABLE IF NOT EXISTS hc_motivos (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id    INT           NOT NULL,
  servicio_id   INT           NOT NULL,                 -- el área clínica a la que pertenece
  nombre        VARCHAR(120)  NOT NULL,                 -- 'Evaluación', 'Sesión individual', 'Informe'…
  descripcion   VARCHAR(255)  DEFAULT NULL,
  tipo          VARCHAR(20)   NOT NULL DEFAULT 'sesion',-- sesion|evaluacion|informe|grupal|otro
  precio        DECIMAL(10,2) NOT NULL DEFAULT 0,
  duracion_min  INT           NOT NULL DEFAULT 45,
  consume_saldo TINYINT(1)    NOT NULL DEFAULT 1,       -- ¿una cita de este motivo descuenta saldo?
  orden         INT           NOT NULL DEFAULT 0,       -- para ordenarlos en la UI
  activo        TINYINT(1)    NOT NULL DEFAULT 1,
  user_crea_id  INT           DEFAULT NULL,
  created_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_hcmot_empresa  FOREIGN KEY (empresa_id)   REFERENCES empresas(id)     ON DELETE CASCADE,
  CONSTRAINT fk_hcmot_servicio FOREIGN KEY (servicio_id)  REFERENCES hc_servicios(id) ON DELETE CASCADE,
  CONSTRAINT fk_hcmot_crea     FOREIGN KEY (user_crea_id)  REFERENCES usuarios(id),
  INDEX idx_hcmot_empresa (empresa_id),
  INDEX idx_hcmot_servicio (servicio_id),
  UNIQUE KEY uq_hcmot (empresa_id, servicio_id, nombre)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Motivos de cita por servicio (tipo + precio + duración)';

-- 2) La cita apunta a un motivo (texto libre `motivo` queda como respaldo) ----
SET @has_cm := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'hc_citas' AND COLUMN_NAME = 'motivo_id');
SET @sql := IF(@has_cm = 0,
  'ALTER TABLE hc_citas ADD COLUMN motivo_id INT NULL AFTER servicio_id',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_cm_fk := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'hc_citas' AND CONSTRAINT_NAME = 'fk_hccita_motivo');
SET @sql := IF(@has_cm_fk = 0,
  'ALTER TABLE hc_citas ADD CONSTRAINT fk_hccita_motivo FOREIGN KEY (motivo_id) REFERENCES hc_motivos(id)',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 3) La línea de venta puede ser de un MOTIVO (saldo de sesiones por motivo) ---
SET @has_vim := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'hc_venta_items' AND COLUMN_NAME = 'motivo_id');
SET @sql := IF(@has_vim = 0,
  'ALTER TABLE hc_venta_items ADD COLUMN motivo_id INT NULL AFTER servicio_id',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_vim_fk := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'hc_venta_items' AND CONSTRAINT_NAME = 'fk_hcvi_motivo');
SET @sql := IF(@has_vim_fk = 0,
  'ALTER TABLE hc_venta_items ADD CONSTRAINT fk_hcvi_motivo FOREIGN KEY (motivo_id) REFERENCES hc_motivos(id)',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 4) (Opcional) Semilla: por cada servicio existente crea un motivo "Sesión" ---
--    con el precio y la duración que hoy tiene el servicio, para no empezar en
--    cero y que las citas viejas tengan a dónde colgarse. Idempotente por el
--    UNIQUE (empresa_id, servicio_id, nombre) + INSERT IGNORE.
INSERT IGNORE INTO hc_motivos (empresa_id, servicio_id, nombre, tipo, precio, duracion_min, consume_saldo, orden)
SELECT s.empresa_id, s.id, 'Sesión individual', 'sesion', s.precio, COALESCE(s.duracion_min, 45), 1, 0
FROM hc_servicios s;

-- Verificación
SELECT 'hc_motivos OK' AS estado, (SELECT COUNT(*) FROM hc_motivos) AS motivos_sembrados;
