-- =========================================================
--  FEATURE: Planes de Servicio (suscripción mensual)
--  ---------------------------------------------------------
--  Reemplaza el modelo de "créditos prepago" por:
--    1) Catálogo de planes (Básico / Profesional / Avanzado / Corporativo)
--    2) Suscripción por empresa (plan + ciclo + vigencia)
--    3) Cupo mensual de certificados + cobro de excedentes
--    4) Registro de pagos (Niubiz; SIN factura electrónica por ahora)
--    5) Dominios propios por empresa (subdominio Vaxa / dominio propio)
--
--  Diseño: en vez de ENUM se usan TABLAS MAESTRAS (catálogos con FK),
--  igual que estado_inscripcion / estado_certificado / tipos_documento.
--  Ventaja: se listan/editan, no hay que ALTERar la tabla para agregar
--  un valor, y el descuento de ciclo queda como DATO (meses_pago/vigencia).
--
--  ✅ ADITIVO y reversible: este script NO borra nada.
--     La limpieza del modelo viejo (créditos) va aparte, en
--     scripts/mysql-cleanup-creditos.sql, y se corre DESPUÉS de
--     migrar el código (si no, la emisión se rompe).
--
--  Uso: mysql -u usuario -p vaxa < scripts/mysql-planes.sql
-- =========================================================
USE vaxa;
SET NAMES utf8mb4;

-- =========================================================
--  A) TABLAS MAESTRAS (catálogos)
-- =========================================================

-- A.1 Ciclos de facturación. El descuento vive como DATO:
--     meses_pago = cuántas mensualidades cobra · meses_vigencia = cuántos meses dura.
CREATE TABLE IF NOT EXISTS ciclo_facturacion (
  id             TINYINT AUTO_INCREMENT PRIMARY KEY,
  codigo         VARCHAR(20) NOT NULL UNIQUE,
  nombre         VARCHAR(60) NOT NULL,
  meses_pago     TINYINT NOT NULL,             -- mensualidades que se cobran
  meses_vigencia TINYINT NOT NULL,             -- meses de servicio que recibe
  activo         TINYINT(1) NOT NULL DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Ciclos de contrato y su descuento';

INSERT INTO ciclo_facturacion (id, codigo, nombre, meses_pago, meses_vigencia) VALUES
  (1, 'mensual',   'Mensual',                      1,  1),
  (2, 'semestral', 'Semestral (paga 5, recibe 6)', 5,  6),
  (3, 'anual',     'Anual (paga 10, recibe 12)',  10, 12)
ON DUPLICATE KEY UPDATE nombre = VALUES(nombre), meses_pago = VALUES(meses_pago), meses_vigencia = VALUES(meses_vigencia);

-- A.2 Estados de suscripción.
CREATE TABLE IF NOT EXISTS estado_suscripcion (
  id     TINYINT AUTO_INCREMENT PRIMARY KEY,
  codigo VARCHAR(20) NOT NULL UNIQUE,
  nombre VARCHAR(40) NOT NULL,
  activo TINYINT(1) NOT NULL DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Estados de una suscripción';

INSERT INTO estado_suscripcion (id, codigo, nombre) VALUES
  (1, 'activa',     'Activa'),
  (2, 'vencida',    'Vencida'),
  (3, 'suspendida', 'Suspendida'),
  (4, 'cancelada',  'Cancelada')
ON DUPLICATE KEY UPDATE nombre = VALUES(nombre);

-- A.3 Conceptos de pago.
CREATE TABLE IF NOT EXISTS concepto_pago (
  id     TINYINT AUTO_INCREMENT PRIMARY KEY,
  codigo VARCHAR(20) NOT NULL UNIQUE,
  nombre VARCHAR(40) NOT NULL,
  activo TINYINT(1) NOT NULL DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Por qué concepto entra un pago';

INSERT INTO concepto_pago (id, codigo, nombre) VALUES
  (1, 'suscripcion', 'Suscripción'),
  (2, 'setup',       'Setup inicial'),
  (3, 'excedente',   'Certificados excedentes'),
  (4, 'dominio',     'Dominio')
ON DUPLICATE KEY UPDATE nombre = VALUES(nombre);

-- A.4 Estados de pago.
CREATE TABLE IF NOT EXISTS estado_pago (
  id     TINYINT AUTO_INCREMENT PRIMARY KEY,
  codigo VARCHAR(20) NOT NULL UNIQUE,
  nombre VARCHAR(40) NOT NULL,
  activo TINYINT(1) NOT NULL DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Estados de un pago';

INSERT INTO estado_pago (id, codigo, nombre) VALUES
  (1, 'pendiente', 'Pendiente'),
  (2, 'pagado',    'Pagado'),
  (3, 'fallido',   'Fallido')
ON DUPLICATE KEY UPDATE nombre = VALUES(nombre);

-- A.5 Tipos de comprobante (manual; sin factura electrónica por ahora).
CREATE TABLE IF NOT EXISTS tipo_comprobante (
  id     TINYINT AUTO_INCREMENT PRIMARY KEY,
  codigo VARCHAR(20) NOT NULL UNIQUE,
  nombre VARCHAR(40) NOT NULL,
  activo TINYINT(1) NOT NULL DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Tipo de comprobante emitido (manual)';

INSERT INTO tipo_comprobante (id, codigo, nombre) VALUES
  (1, 'ninguno', 'Ninguno'),
  (2, 'boleta',  'Boleta'),
  (3, 'factura', 'Factura')
ON DUPLICATE KEY UPDATE nombre = VALUES(nombre);

-- A.6 Tipos de dominio.
CREATE TABLE IF NOT EXISTS tipo_dominio (
  id     TINYINT AUTO_INCREMENT PRIMARY KEY,
  codigo VARCHAR(20) NOT NULL UNIQUE,
  nombre VARCHAR(40) NOT NULL,
  activo TINYINT(1) NOT NULL DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Origen del dominio de una empresa';

INSERT INTO tipo_dominio (id, codigo, nombre) VALUES
  (1, 'subdominio_vaxa', 'Subdominio de Vaxa'),
  (2, 'dominio_propio',  'Dominio propio')
ON DUPLICATE KEY UPDATE nombre = VALUES(nombre);

-- =========================================================
--  B) TABLAS PRINCIPALES
-- =========================================================

-- B.1 Catálogo de planes.
--     Los "permite_*" son interruptores 1/0 que desbloquean funciones.
--     El PDF NO va aquí: se genera y guarda en el VPS para TODOS los
--     planes (es core). Solo se controla si se OFRECE su descarga
--     pública con `muestra_pdf_publico`.
CREATE TABLE IF NOT EXISTS planes (
  id                           INT AUTO_INCREMENT PRIMARY KEY,
  slug                         VARCHAR(40)   NOT NULL UNIQUE,
  nombre                       VARCHAR(80)   NOT NULL,
  precio_mensual               DECIMAL(10,2) NOT NULL DEFAULT 0,   -- S/ (incluye IGV)
  limite_certificados_mes      INT           NOT NULL DEFAULT 0,   -- cupo mensual (0 = a medida)
  precio_certificado_adicional DECIMAL(10,2) NOT NULL DEFAULT 0,   -- excedente c/u
  setup_inicial                DECIMAL(10,2) NOT NULL DEFAULT 0,
  permite_diseno               TINYINT(1) NOT NULL DEFAULT 0,      -- diseño personalizado del certificado
  permite_subdominio           TINYINT(1) NOT NULL DEFAULT 0,      -- dominio/subdominio propio
  permite_api                  TINYINT(1) NOT NULL DEFAULT 0,      -- acceso por API
  permite_carga_masiva         TINYINT(1) NOT NULL DEFAULT 0,      -- importar por Excel/API
  permite_metricas             TINYINT(1) NOT NULL DEFAULT 0,      -- panel de métricas
  permite_auditoria            TINYINT(1) NOT NULL DEFAULT 0,      -- auditoría completa
  muestra_pdf_publico          TINYINT(1) NOT NULL DEFAULT 0,      -- descarga del PDF en la validación pública
  activo                       TINYINT(1) NOT NULL DEFAULT 1,
  orden                        INT NOT NULL DEFAULT 0,
  created_at                   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Catálogo de planes de servicio';

INSERT INTO planes
  (slug, nombre, precio_mensual, limite_certificados_mes, precio_certificado_adicional, setup_inicial,
   permite_diseno, permite_subdominio, permite_api, permite_carga_masiva, permite_metricas, permite_auditoria, muestra_pdf_publico, orden)
VALUES
  ('basico',      'Plan Básico',            300.00, 100, 2.00,   0.00, 0,0,0,0,0,0, 0, 1),
  ('profesional', 'Plan Profesional',       480.00, 300, 1.50,   0.00, 0,0,0,0,0,0, 1, 2),
  ('avanzado',    'Plan Avanzado',          750.00, 600, 1.00, 350.00, 1,1,1,1,1,1, 1, 3),
  ('corporativo', 'Plan Corporativo / API', 1000.00,  0, 0.00, 600.00, 1,1,1,1,1,1, 1, 4)
ON DUPLICATE KEY UPDATE
  nombre = VALUES(nombre),
  precio_mensual = VALUES(precio_mensual),
  limite_certificados_mes = VALUES(limite_certificados_mes),
  precio_certificado_adicional = VALUES(precio_certificado_adicional),
  setup_inicial = VALUES(setup_inicial);

-- B.2 Suscripción de cada empresa (qué plan tiene y su vigencia).
-- Es un HISTORIAL: cada cambio de plan NO pisa la fila, sino que cierra la
-- suscripción actual (estado=cancelada/vencida + fecha_fin=hoy) y crea una nueva.
-- Así el cambio de plan se SACA del propio historial, sin campos extra.
CREATE TABLE IF NOT EXISTS empresa_suscripcion (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id     INT NOT NULL,
  plan_id        INT NOT NULL,
  ciclo_id       TINYINT NOT NULL DEFAULT 1,   -- -> ciclo_facturacion
  estado_id      TINYINT NOT NULL DEFAULT 1,   -- -> estado_suscripcion (1=activa)
  fecha_inicio   DATE NOT NULL,
  fecha_fin      DATE NOT NULL,                 -- vigencia con el descuento de ciclo ya aplicado
  precio_pactado DECIMAL(10,2) NULL,            -- por si se negocia distinto al de lista
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_sus_empresa (empresa_id, estado_id),
  FOREIGN KEY (empresa_id) REFERENCES empresas(id),
  FOREIGN KEY (plan_id)    REFERENCES planes(id),
  FOREIGN KEY (ciclo_id)   REFERENCES ciclo_facturacion(id),
  FOREIGN KEY (estado_id)  REFERENCES estado_suscripcion(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Suscripción activa/histórica de cada empresa';

-- B.3 Consumo mensual (el "contador" del cupo).
--     Una fila por empresa y por mes. El cupo "se reinicia" solo
--     porque cada mes nuevo es una fila nueva.
CREATE TABLE IF NOT EXISTS consumo_mensual (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id      INT      NOT NULL,
  anio            SMALLINT NOT NULL,
  mes             TINYINT  NOT NULL,            -- 1..12
  incluidos       INT      NOT NULL DEFAULT 0,  -- cupo del plan ese mes
  emitidos        INT      NOT NULL DEFAULT 0,  -- total emitidos en el mes
  adicionales     INT      NOT NULL DEFAULT 0,  -- excedente (por encima del cupo)
  monto_adicional DECIMAL(10,2) NOT NULL DEFAULT 0,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_consumo (empresa_id, anio, mes),
  FOREIGN KEY (empresa_id) REFERENCES empresas(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Consumo de certificados por empresa y mes (cupo + excedentes)';

-- B.4 Pagos (Niubiz). SIN factura electrónica por ahora:
--     el número de boleta/factura se registra manual si se emitió fuera.
CREATE TABLE IF NOT EXISTS pagos (
  id                  INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id          INT NOT NULL,
  suscripcion_id      INT NULL,
  concepto_id         TINYINT NOT NULL,           -- -> concepto_pago
  monto               DECIMAL(10,2) NOT NULL,
  moneda              CHAR(3) NOT NULL DEFAULT 'PEN',
  metodo              VARCHAR(20) NOT NULL DEFAULT 'niubiz',
  referencia_niubiz   VARCHAR(100) NULL,          -- id de transacción que devuelve Niubiz
  estado_id           TINYINT NOT NULL DEFAULT 1, -- -> estado_pago (1=pendiente)
  fecha_pago          DATETIME NULL,
  comprobante_tipo_id TINYINT NOT NULL DEFAULT 1, -- -> tipo_comprobante (1=ninguno)
  comprobante_numero  VARCHAR(40) NULL,           -- manual, opcional
  created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_pagos_empresa (empresa_id, estado_id),
  FOREIGN KEY (empresa_id)          REFERENCES empresas(id),
  FOREIGN KEY (suscripcion_id)      REFERENCES empresa_suscripcion(id),
  FOREIGN KEY (concepto_id)         REFERENCES concepto_pago(id),
  FOREIGN KEY (estado_id)           REFERENCES estado_pago(id),
  FOREIGN KEY (comprobante_tipo_id) REFERENCES tipo_comprobante(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Pagos por Niubiz (suscripción, setup, excedente, dominio)';

-- B.5 Dominios propios por empresa.
--     `empresas.dominio` (columna actual) queda como dominio "principal";
--     esta tabla permite VARIOS dominios y resolver el tenant por Host.
CREATE TABLE IF NOT EXISTS empresa_dominios (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id  INT NOT NULL,
  dominio     VARCHAR(190) NOT NULL UNIQUE,     -- ej: validar.suempresa.com
  tipo_id     TINYINT NOT NULL DEFAULT 1,       -- -> tipo_dominio
  verificado  TINYINT(1) NOT NULL DEFAULT 0,    -- DNS apunta al VPS
  ssl_ok      TINYINT(1) NOT NULL DEFAULT 0,    -- AutoSSL emitido
  activo      TINYINT(1) NOT NULL DEFAULT 1,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_dom_empresa (empresa_id),
  FOREIGN KEY (empresa_id) REFERENCES empresas(id),
  FOREIGN KEY (tipo_id)    REFERENCES tipo_dominio(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Dominios/subdominios por empresa (resolución de tenant por Host)';

-- =========================================================
--  C) CAMPOS NUEVOS EN TABLAS EXISTENTES
-- =========================================================

-- C.1 Plan vigente de la empresa (acceso rápido) + llave de API.
ALTER TABLE empresas
  ADD COLUMN plan_actual_id INT         NULL AFTER tenant_slug,
  ADD COLUMN api_key        VARCHAR(64) NULL AFTER plan_actual_id,
  ADD CONSTRAINT fk_empresa_plan FOREIGN KEY (plan_actual_id) REFERENCES planes(id);

-- C.2 Estado "Sustituido" del certificado (hoy: 1=Válido, 2=Anulado).
--     NOTA: si la tabla estado_certificado tiene más columnas NOT NULL,
--     añádelas a este INSERT.
INSERT INTO estado_certificado (id, nombre)
VALUES (3, 'Sustituido')
ON DUPLICATE KEY UPDATE nombre = VALUES(nombre);

-- Un certificado puede apuntar al que lo reemplaza.
ALTER TABLE certificados
  ADD COLUMN sustituido_por_id INT NULL AFTER estado_id,
  ADD CONSTRAINT fk_cert_sustituto FOREIGN KEY (sustituido_por_id) REFERENCES certificados(id);

-- =========================================================
--  D) (OPCIONAL) Sembrar el Plan Básico en las empresas actuales,
--     para que arranquen con una suscripción vigente de 1 mes.
--     Descomenta si quieres datos de prueba.
-- =========================================================
-- INSERT INTO empresa_suscripcion (empresa_id, plan_id, ciclo_id, estado_id, fecha_inicio, fecha_fin)
-- SELECT e.id, (SELECT id FROM planes WHERE slug='basico'), 1, 1,
--        CURDATE(), DATE_ADD(CURDATE(), INTERVAL 1 MONTH)
-- FROM empresas e WHERE e.activo = 1 AND e.tenant_slug <> 'vaxa';
-- UPDATE empresas e
--   JOIN planes p ON p.slug = 'basico'
--   SET e.plan_actual_id = p.id
--   WHERE e.activo = 1 AND e.tenant_slug <> 'vaxa';
