-- =========================================================
--  FEATURE: Facturación Electrónica (SUNAT — SEE Del Contribuyente)
--  ---------------------------------------------------------
--  Vaxa (emisor, RUC 20615047954) emite a sus clientes del SaaS:
--    01 Factura · 03 Boleta · 07 Nota de crédito · 08 Nota de débito
--  Flujo directo a SUNAT: UBL 2.1 → firma XML-DSig → ZIP → SOAP.
--
--  DISEÑO (revisión senior):
--   • NO se duplican catálogos: se REUTILIZAN los existentes
--     `tipo_comprobante` y `tipos_documento`, agregándoles `codigo_sunat`.
--   • Nombres consistentes con el resto del esquema (estado_*, comprobante_*).
--   • El comprobante guarda los datos fiscales como SNAPSHOT (inmutables, como
--     exige la ley); solo el estado interno es FK a un catálogo.
--
--  ✅ ADITIVO sobre catálogos; crea tablas nuevas. Correr UNA vez.
--  Uso: mysql -u usuario -p vaxa < scripts/mysql-facturacion.sql
-- =========================================================
USE vaxa;
SET NAMES utf8mb4;

-- =========================================================
--  A) EXTENDER CATÁLOGOS EXISTENTES (no crear duplicados)
-- =========================================================

-- A.1 tipo_comprobante: mapeo al código oficial SUNAT (cat.01) + tipos de nota.
ALTER TABLE tipo_comprobante
  ADD COLUMN codigo_sunat CHAR(2) NULL AFTER codigo,
  ADD UNIQUE KEY uq_tc_sunat (codigo_sunat);

UPDATE tipo_comprobante SET codigo_sunat = '01' WHERE codigo = 'factura';
UPDATE tipo_comprobante SET codigo_sunat = '03' WHERE codigo = 'boleta';

INSERT INTO tipo_comprobante (codigo, codigo_sunat, nombre) VALUES
  ('nota_credito', '07', 'Nota de crédito'),
  ('nota_debito',  '08', 'Nota de débito')
ON DUPLICATE KEY UPDATE nombre = VALUES(nombre), codigo_sunat = VALUES(codigo_sunat);

-- A.2 tipos_documento: mapeo al código oficial SUNAT (cat.06).
ALTER TABLE tipos_documento
  ADD COLUMN codigo_sunat CHAR(1) NULL AFTER codigo;

UPDATE tipos_documento SET codigo_sunat = '1' WHERE codigo = 'DNI';
UPDATE tipos_documento SET codigo_sunat = '4' WHERE codigo = 'CE';
UPDATE tipos_documento SET codigo_sunat = '7' WHERE codigo = 'PASAPORTE';
UPDATE tipos_documento SET codigo_sunat = '6' WHERE codigo = 'RUC';

-- =========================================================
--  B) CATÁLOGOS NUEVOS (no existen aún)
-- =========================================================

-- B.1 Estado del comprobante en su ciclo de vida (patrón estado_*).
CREATE TABLE IF NOT EXISTS estado_comprobante (
  id     TINYINT AUTO_INCREMENT PRIMARY KEY,
  codigo VARCHAR(20) NOT NULL UNIQUE,
  nombre VARCHAR(40) NOT NULL,
  activo TINYINT(1) NOT NULL DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Estado interno del comprobante electrónico';

INSERT INTO estado_comprobante (id, codigo, nombre) VALUES
  (1, 'PENDIENTE', 'Pendiente de envío'),
  (2, 'ENVIADO',   'Enviado (en proceso)'),
  (3, 'ACEPTADO',  'Aceptado por SUNAT'),
  (4, 'OBSERVADO', 'Aceptado con observaciones'),
  (5, 'RECHAZADO', 'Rechazado por SUNAT'),
  (6, 'BAJA',      'Dado de baja / anulado'),
  (7, 'ERROR',     'Error de comunicación')
ON DUPLICATE KEY UPDATE nombre = VALUES(nombre);

-- B.2 Motivos de nota de crédito (cat.09) / débito (cat.10).
CREATE TABLE IF NOT EXISTS comprobante_nota_motivo (
  tipo_nota CHAR(2)     NOT NULL,          -- '07' crédito · '08' débito (codigo_sunat)
  codigo    VARCHAR(2)  NOT NULL,
  nombre    VARCHAR(80) NOT NULL,
  PRIMARY KEY (tipo_nota, codigo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Motivos de nota de crédito (cat.09) y débito (cat.10)';

INSERT INTO comprobante_nota_motivo (tipo_nota, codigo, nombre) VALUES
  ('07', '01', 'Anulación de la operación'),
  ('07', '02', 'Anulación por error en el RUC'),
  ('07', '03', 'Corrección por error en la descripción'),
  ('07', '06', 'Devolución total'),
  ('07', '07', 'Devolución por ítem'),
  ('07', '10', 'Descuento global'),
  ('08', '01', 'Intereses por mora'),
  ('08', '02', 'Aumento en el valor'),
  ('08', '03', 'Penalidad u otros conceptos')
ON DUPLICATE KEY UPDATE nombre = VALUES(nombre);

-- =========================================================
--  C) SERIES Y CORRELATIVOS
-- =========================================================
-- tipo_comprobante = código SUNAT (FK al codigo_sunat del catálogo).
CREATE TABLE IF NOT EXISTS comprobante_series (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  tipo_comprobante CHAR(2) NOT NULL,        -- -> tipo_comprobante.codigo_sunat
  serie       VARCHAR(4)  NOT NULL,
  correlativo INT         NOT NULL DEFAULT 0,
  activo      TINYINT(1)  NOT NULL DEFAULT 1,
  UNIQUE KEY uq_serie (tipo_comprobante, serie),
  FOREIGN KEY (tipo_comprobante) REFERENCES tipo_comprobante(codigo_sunat)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Series y correlativos por tipo de comprobante';

INSERT INTO comprobante_series (tipo_comprobante, serie) VALUES
  ('01', 'F001'),   -- facturas
  ('03', 'B001'),   -- boletas
  ('07', 'FC01'),   -- nota de crédito de factura
  ('08', 'FD01'),   -- nota de débito de factura
  ('07', 'BC01'),   -- nota de crédito de boleta
  ('08', 'BD01')    -- nota de débito de boleta
ON DUPLICATE KEY UPDATE serie = VALUES(serie);

-- =========================================================
--  D) COMPROBANTES + DETALLE
-- =========================================================
CREATE TABLE IF NOT EXISTS comprobantes (
  id                 INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id         INT NULL,              -- cliente del SaaS facturado (FK empresas)
  pago_id            INT NULL,              -- pago que originó el comprobante (FK pagos)

  -- Identificación del comprobante (snapshot fiscal)
  tipo_comprobante   CHAR(2)  NOT NULL,     -- -> tipo_comprobante.codigo_sunat (01/03/07/08)
  serie              VARCHAR(4)  NOT NULL,
  correlativo        INT         NOT NULL,
  fecha_emision      DATE     NOT NULL,
  hora_emision       TIME     NULL,
  moneda             CHAR(3)  NOT NULL DEFAULT 'PEN',

  -- Adquirente (snapshot fiscal: no se referencia, se congela)
  cliente_tipo_doc   CHAR(1)  NOT NULL DEFAULT '6',  -- código SUNAT cat.06 (de tipos_documento.codigo_sunat)
  cliente_num_doc    VARCHAR(15) NOT NULL,
  cliente_razon_social VARCHAR(190) NOT NULL,
  cliente_direccion  VARCHAR(190) NULL,

  -- Totales (snapshot)
  total_gravado      DECIMAL(12,2) NOT NULL DEFAULT 0,
  total_exonerado    DECIMAL(12,2) NOT NULL DEFAULT 0,
  total_inafecto     DECIMAL(12,2) NOT NULL DEFAULT 0,
  total_igv          DECIMAL(12,2) NOT NULL DEFAULT 0,
  total_descuentos   DECIMAL(12,2) NOT NULL DEFAULT 0,
  importe_total      DECIMAL(12,2) NOT NULL DEFAULT 0,

  -- Notas (07/08): documento que corrigen + motivo
  ref_tipo_comprobante CHAR(2)  NULL,       -- tipo del comprobante referenciado
  ref_serie_correlativo VARCHAR(20) NULL,   -- ej. F001-123
  nota_motivo_codigo VARCHAR(2)  NULL,      -- -> comprobante_nota_motivo
  nota_motivo_desc   VARCHAR(190) NULL,

  -- Estado interno (FK a catálogo) + respuesta de SUNAT
  estado_id          TINYINT NOT NULL DEFAULT 1,  -- -> estado_comprobante
  sunat_ticket       VARCHAR(40) NULL,
  sunat_resp_codigo  VARCHAR(10) NULL,
  sunat_resp_desc    VARCHAR(255) NULL,
  hash_cpe           VARCHAR(100) NULL,      -- DigestValue de la firma
  xml_firmado        MEDIUMTEXT NULL,
  cdr_xml            MEDIUMTEXT NULL,

  resumen_id         INT NULL,               -- agrupación del resumen diario (boletas)
  created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY uq_cpe (tipo_comprobante, serie, correlativo),
  KEY idx_cpe_empresa (empresa_id),
  KEY idx_cpe_estado (estado_id),
  FOREIGN KEY (tipo_comprobante) REFERENCES tipo_comprobante(codigo_sunat),
  FOREIGN KEY (estado_id)        REFERENCES estado_comprobante(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Comprobantes electrónicos emitidos (facturas, boletas, notas)';

CREATE TABLE IF NOT EXISTS comprobante_detalle (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  comprobante_id  INT NOT NULL,
  orden           INT NOT NULL DEFAULT 1,
  descripcion     VARCHAR(250) NOT NULL,
  unidad          VARCHAR(10) NOT NULL DEFAULT 'NIU',   -- cat.03 SUNAT
  cantidad        DECIMAL(12,4) NOT NULL DEFAULT 1,
  valor_unitario  DECIMAL(12,4) NOT NULL DEFAULT 0,     -- sin IGV
  precio_unitario DECIMAL(12,4) NOT NULL DEFAULT 0,     -- con IGV
  tipo_afectacion CHAR(2) NOT NULL DEFAULT '10',        -- cat.07 (10=gravado)
  valor_total     DECIMAL(12,2) NOT NULL DEFAULT 0,     -- cantidad * valor_unitario
  igv             DECIMAL(12,2) NOT NULL DEFAULT 0,
  FOREIGN KEY (comprobante_id) REFERENCES comprobantes(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Líneas de detalle de cada comprobante';

-- D.3 Vínculo opcional desde un pago al comprobante emitido (acceso rápido).
--     Reemplaza a futuro al manual pagos.comprobante_tipo_id + comprobante_numero.
ALTER TABLE pagos
  ADD COLUMN comprobante_id INT NULL AFTER comprobante_numero,
  ADD CONSTRAINT fk_pago_cpe FOREIGN KEY (comprobante_id) REFERENCES comprobantes(id);
