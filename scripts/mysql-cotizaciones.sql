-- =========================================================
--  FEATURE: Cotizaciones (propuestas económicas previas a la venta)
--  ---------------------------------------------------------
--  Vaxa arma una cotización para un cliente (empresa registrada O prospecto
--  nuevo), la guarda con un N° (COT-YYYY-NNNN), le da estado y, si la aceptan,
--  la "convierte en venta" reutilizando el motor de comprobantes.
--
--  Cotizar NO consume créditos ni emite nada a SUNAT: es solo una propuesta.
--
--  ✅ ADITIVO. Correr UNA vez:
--     mysql -u root -p vaxa < scripts/mysql-cotizaciones.sql
-- =========================================================
USE vaxa;
SET NAMES utf8mb4;

-- =========================================================
--  A) CATÁLOGO DE ESTADOS DE LA COTIZACIÓN
-- =========================================================
CREATE TABLE IF NOT EXISTS cotizacion_estado (
  id     TINYINT AUTO_INCREMENT PRIMARY KEY,
  codigo VARCHAR(20) NOT NULL UNIQUE,
  nombre VARCHAR(40) NOT NULL,
  activo TINYINT(1) NOT NULL DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Estado del ciclo de vida de una cotización';

INSERT INTO cotizacion_estado (id, codigo, nombre) VALUES
  (1, 'BORRADOR',  'Borrador'),
  (2, 'ENVIADA',   'Enviada al cliente'),
  (3, 'ACEPTADA',  'Aceptada'),
  (4, 'RECHAZADA', 'Rechazada'),
  (5, 'VENCIDA',   'Vencida')
ON DUPLICATE KEY UPDATE nombre = VALUES(nombre);

-- =========================================================
--  B) NUMERACIÓN ANUAL (correlativo atómico por año)
--     El número final es COT-2026-0001.
-- =========================================================
CREATE TABLE IF NOT EXISTS cotizacion_series (
  anio        INT NOT NULL PRIMARY KEY,
  correlativo INT NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Correlativo anual de cotizaciones';

-- =========================================================
--  C) COTIZACIONES + DETALLE
-- =========================================================
CREATE TABLE IF NOT EXISTS cotizaciones (
  id                   INT AUTO_INCREMENT PRIMARY KEY,
  numero               VARCHAR(20)  NOT NULL UNIQUE,   -- COT-2026-0001

  -- Cliente: empresa registrada (FK) O prospecto (empresa_id NULL). En ambos
  -- casos se congela el snapshot del cliente para el PDF.
  empresa_id           INT NULL,
  cliente_tipo_doc     CHAR(1)  NOT NULL DEFAULT '6',  -- cat.06: 6 RUC · 1 DNI · 4 CE · 0 sin doc
  cliente_num_doc      VARCHAR(15)  NOT NULL DEFAULT '0',
  cliente_razon_social VARCHAR(190) NOT NULL,
  cliente_email        VARCHAR(120) NULL,

  moneda               CHAR(3)  NOT NULL DEFAULT 'PEN',
  igv_incluido         TINYINT(1) NOT NULL DEFAULT 1,  -- 1 = los precios ya incluyen IGV

  -- Totales (calculados y congelados por el backend)
  subtotal             DECIMAL(12,2) NOT NULL DEFAULT 0,
  descuento_tipo       VARCHAR(5)   NULL,              -- 'monto' | 'pct'
  descuento_valor      DECIMAL(12,2) NOT NULL DEFAULT 0,
  descuento_monto      DECIMAL(12,2) NOT NULL DEFAULT 0,
  total                DECIMAL(12,2) NOT NULL DEFAULT 0,

  notas                TEXT NULL,
  valida_hasta         DATE NULL,

  estado_id            TINYINT NOT NULL DEFAULT 1,     -- -> cotizacion_estado
  comprobante_id       INT NULL,                       -- se llena al convertir en venta

  created_by           INT NULL,                       -- usuario Vaxa que la creó
  created_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  KEY idx_cot_empresa (empresa_id),
  KEY idx_cot_estado (estado_id),
  FOREIGN KEY (empresa_id)     REFERENCES empresas(id),
  FOREIGN KEY (estado_id)      REFERENCES cotizacion_estado(id),
  FOREIGN KEY (comprobante_id) REFERENCES comprobantes(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Cotizaciones emitidas a clientes y prospectos';

CREATE TABLE IF NOT EXISTS cotizacion_detalle (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  cotizacion_id   INT NOT NULL,
  orden           INT NOT NULL DEFAULT 1,
  descripcion     VARCHAR(250)  NOT NULL,
  cantidad        DECIMAL(12,2) NOT NULL DEFAULT 1,
  precio_unitario DECIMAL(12,2) NOT NULL DEFAULT 0,    -- con IGV (lo que se ve)
  total           DECIMAL(12,2) NOT NULL DEFAULT 0,    -- cantidad * precio_unitario
  creditos        INT NULL,                            -- créditos que otorgaría esta línea (paquete)
  renueva         TINYINT(1) NOT NULL DEFAULT 0,       -- si renovaría la suscripción (mantenimiento)
  FOREIGN KEY (cotizacion_id) REFERENCES cotizaciones(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Líneas de detalle de cada cotización';
