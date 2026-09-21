-- ============================================================================
--  VAXA · Historias Clínicas — Finanzas del centro (Caja + Ventas + Inventario)
--  --------------------------------------------------------------------------
--  Agrega el módulo económico POR CENTRO (multi-tenant, aislado de lo clínico):
--    · hc_servicios.precio       -> precio del servicio (para la venta automática)
--    · hc_productos              -> inventario del centro (stock + precios)
--    · hc_inventario_mov         -> kardex: entradas/salidas de stock
--    · hc_ventas + hc_venta_items-> ventas (servicios y/o productos), por paciente opcional
--    · hc_caja_mov               -> ingresos/egresos (la venta genera su ingreso)
--
--  Correr DESPUÉS de mysql-hc-servicios.sql.
--    mysql -u root -p vaxa < scripts/mysql-hc-finanzas.sql
-- ============================================================================

-- 1) Precio del servicio (para la venta automática por servicio) --------------
--    Idempotente: solo agrega la columna si aún no existe.
SET @has_precio := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'hc_servicios' AND COLUMN_NAME = 'precio');
SET @sql := IF(@has_precio = 0,
  'ALTER TABLE hc_servicios ADD COLUMN precio DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER descripcion',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 2) Inventario: productos del centro -----------------------------------------
CREATE TABLE IF NOT EXISTS hc_productos (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id    INT           NOT NULL,
  nombre        VARCHAR(160)  NOT NULL,
  sku           VARCHAR(60)   DEFAULT NULL,
  descripcion   VARCHAR(255)  DEFAULT NULL,
  unidad        VARCHAR(30)   NOT NULL DEFAULT 'unidad',
  precio_venta  DECIMAL(10,2) NOT NULL DEFAULT 0,
  costo         DECIMAL(10,2) NOT NULL DEFAULT 0,
  stock         DECIMAL(12,2) NOT NULL DEFAULT 0,
  stock_min     DECIMAL(12,2) NOT NULL DEFAULT 0,
  activo        TINYINT(1)    NOT NULL DEFAULT 1,
  user_crea_id  INT           DEFAULT NULL,
  created_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_hcprod_empresa FOREIGN KEY (empresa_id)  REFERENCES empresas(id) ON DELETE CASCADE,
  CONSTRAINT fk_hcprod_crea    FOREIGN KEY (user_crea_id) REFERENCES usuarios(id),
  INDEX idx_hcprod_empresa (empresa_id),
  UNIQUE KEY uq_hcprod (empresa_id, nombre)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Productos/insumos del centro (inventario, por tenant)';

-- 3) Kardex: movimientos de inventario (entrada / salida) ---------------------
CREATE TABLE IF NOT EXISTS hc_inventario_mov (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id    INT           NOT NULL,
  producto_id   INT           NOT NULL,
  tipo          VARCHAR(10)   NOT NULL,               -- 'entrada' | 'salida'
  cantidad      DECIMAL(12,2) NOT NULL,
  motivo        VARCHAR(160)  DEFAULT NULL,
  venta_id      INT           DEFAULT NULL,           -- si la salida vino de una venta
  user_crea_id  INT           DEFAULT NULL,
  created_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_hcinv_empresa  FOREIGN KEY (empresa_id)  REFERENCES empresas(id)     ON DELETE CASCADE,
  CONSTRAINT fk_hcinv_producto FOREIGN KEY (producto_id) REFERENCES hc_productos(id) ON DELETE CASCADE,
  CONSTRAINT fk_hcinv_crea     FOREIGN KEY (user_crea_id) REFERENCES usuarios(id),
  INDEX idx_hcinv_empresa (empresa_id),
  INDEX idx_hcinv_producto (producto_id),
  INDEX idx_hcinv_venta (venta_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Kardex de inventario (entradas y salidas de stock)';

-- 4) Ventas (cabecera) --------------------------------------------------------
CREATE TABLE IF NOT EXISTS hc_ventas (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id    INT           NOT NULL,
  paciente_id   INT           DEFAULT NULL,           -- opcional: venta de mostrador
  fecha         DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  total         DECIMAL(10,2) NOT NULL DEFAULT 0,
  metodo_pago   VARCHAR(30)   NOT NULL DEFAULT 'efectivo',
  nota          VARCHAR(255)  DEFAULT NULL,
  estado        VARCHAR(12)   NOT NULL DEFAULT 'emitida',  -- 'emitida' | 'anulada'
  user_crea_id  INT           DEFAULT NULL,
  created_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_hcvta_empresa  FOREIGN KEY (empresa_id)  REFERENCES empresas(id)      ON DELETE CASCADE,
  CONSTRAINT fk_hcvta_paciente FOREIGN KEY (paciente_id) REFERENCES hc_pacientes(id)  ON DELETE SET NULL,
  CONSTRAINT fk_hcvta_crea     FOREIGN KEY (user_crea_id) REFERENCES usuarios(id),
  INDEX idx_hcvta_empresa (empresa_id),
  INDEX idx_hcvta_fecha (empresa_id, fecha),
  INDEX idx_hcvta_paciente (paciente_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Ventas del centro (servicios y/o productos)';

-- 5) Ventas (detalle) ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS hc_venta_items (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id    INT           NOT NULL,
  venta_id      INT           NOT NULL,
  tipo          VARCHAR(10)   NOT NULL,               -- 'servicio' | 'producto'
  servicio_id   INT           DEFAULT NULL,
  producto_id   INT           DEFAULT NULL,
  descripcion   VARCHAR(200)  NOT NULL,               -- snapshot del nombre al vender
  cantidad      DECIMAL(12,2) NOT NULL DEFAULT 1,
  precio_unit   DECIMAL(10,2) NOT NULL DEFAULT 0,
  subtotal      DECIMAL(10,2) NOT NULL DEFAULT 0,
  CONSTRAINT fk_hcvi_empresa  FOREIGN KEY (empresa_id) REFERENCES empresas(id)     ON DELETE CASCADE,
  CONSTRAINT fk_hcvi_venta    FOREIGN KEY (venta_id)   REFERENCES hc_ventas(id)    ON DELETE CASCADE,
  CONSTRAINT fk_hcvi_servicio FOREIGN KEY (servicio_id) REFERENCES hc_servicios(id),
  CONSTRAINT fk_hcvi_producto FOREIGN KEY (producto_id) REFERENCES hc_productos(id),
  INDEX idx_hcvi_venta (venta_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Detalle de la venta (líneas de servicio/producto)';

-- 6) Caja: ingresos y egresos -------------------------------------------------
CREATE TABLE IF NOT EXISTS hc_caja_mov (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id    INT           NOT NULL,
  fecha         DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  tipo          VARCHAR(10)   NOT NULL,               -- 'ingreso' | 'egreso'
  monto         DECIMAL(10,2) NOT NULL,
  concepto      VARCHAR(200)  NOT NULL,
  categoria     VARCHAR(60)   DEFAULT NULL,
  metodo_pago   VARCHAR(30)   DEFAULT NULL,
  venta_id      INT           DEFAULT NULL,           -- ingreso generado por una venta
  user_crea_id  INT           DEFAULT NULL,
  created_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_hccaja_empresa FOREIGN KEY (empresa_id)  REFERENCES empresas(id)   ON DELETE CASCADE,
  CONSTRAINT fk_hccaja_venta   FOREIGN KEY (venta_id)    REFERENCES hc_ventas(id)  ON DELETE CASCADE,
  CONSTRAINT fk_hccaja_crea    FOREIGN KEY (user_crea_id) REFERENCES usuarios(id),
  INDEX idx_hccaja_empresa (empresa_id),
  INDEX idx_hccaja_fecha (empresa_id, fecha)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Movimientos de caja: ingresos y egresos del centro';

-- Verificación
SELECT 'hc_finanzas OK' AS estado;
