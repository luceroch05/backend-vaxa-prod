-- ============================================================================
--  VAXA · Historias Clínicas para Centros Terapéuticos
--  --------------------------------------------------------------------------
--  Nuevo PRODUCTO dentro del SaaS multi-tenant existente. NO reemplaza nada:
--  se apoya en las tablas que ya tienes (empresas, usuarios, roles, productos)
--  y agrega su propio dominio, TODO aislado con el prefijo `hc_`.
--
--  Cada centro terapéutico = 1 fila en `empresas` (tenant). Su login con logo
--  ya funciona vía empresas.logo_url + producto. Aquí solo:
--    1) registramos el producto 'historias-clinicas'
--    2) agregamos el rol TERAPEUTA (ADMINISTRADOR y ADMISION ya existen)
--    3) catálogos (tablas maestras) del dominio — sin ENUM, todo por FK
--    4) tablas del dominio clínico, cada una con empresa_id (aislamiento tenant)
--
--  Ejecutar UNA vez. Idempotente (IF NOT EXISTS / INSERT ... ON DUPLICATE).
--    mysql -u root -p vaxa < scripts/mysql-historias-clinicas.sql
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Producto nuevo en el catálogo -------------------------------------------
--    interno=0 -> es software que la empresa contrata (se factura).
-- ----------------------------------------------------------------------------
INSERT INTO productos (slug, nombre, interno) VALUES
  ('historias-clinicas', 'Historias Clínicas', 0)
ON DUPLICATE KEY UPDATE nombre = VALUES(nombre), interno = VALUES(interno);

-- ----------------------------------------------------------------------------
-- 2) Rol TERAPEUTA (ADMINISTRADOR y ADMISION ya existen) ----------------------
--    ADMINISTRADOR -> dueño/coordinador del centro: todo.
--    ADMISION      -> recepción: registra pacientes, agenda citas.
--    TERAPEUTA     -> psicólogo/terapeuta: abre historia y escribe evoluciones
--                     de SUS pacientes asignados.
-- ----------------------------------------------------------------------------
INSERT INTO roles (nombre, descripcion) VALUES
  ('TERAPEUTA', 'Terapeuta: atiende pacientes y registra evoluciones clínicas')
ON DUPLICATE KEY UPDATE descripcion = VALUES(descripcion);

-- ============================================================================
--  3) CATÁLOGOS / TABLAS MAESTRAS  (globales, no por tenant)
--     Reemplazan los ENUM. Mismo patrón que reclamo_estado / reclamo_tipo:
--     id TINYINT PK · codigo UNIQUE · nombre · activo. Se referencian con *_id.
-- ============================================================================

-- 3.1) Sexo del paciente -----------------------------------------------------
CREATE TABLE IF NOT EXISTS hc_sexo (
  id     TINYINT AUTO_INCREMENT PRIMARY KEY,
  codigo VARCHAR(10) NOT NULL UNIQUE,
  nombre VARCHAR(40) NOT NULL,
  activo TINYINT(1)  NOT NULL DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Catálogo: sexo del paciente';

INSERT INTO hc_sexo (id, codigo, nombre) VALUES
  (1, 'M', 'Masculino'),
  (2, 'F', 'Femenino'),
  (3, 'X', 'No especifica')
ON DUPLICATE KEY UPDATE nombre = VALUES(nombre);

-- 3.2) Estado de la historia clínica -----------------------------------------
CREATE TABLE IF NOT EXISTS hc_historia_estado (
  id     TINYINT AUTO_INCREMENT PRIMARY KEY,
  codigo VARCHAR(20) NOT NULL UNIQUE,
  nombre VARCHAR(40) NOT NULL,
  activo TINYINT(1)  NOT NULL DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Catálogo: estado de la historia clínica';

INSERT INTO hc_historia_estado (id, codigo, nombre) VALUES
  (1, 'ABIERTA',   'Abierta'),
  (2, 'ALTA',      'De alta'),
  (3, 'ARCHIVADA', 'Archivada')
ON DUPLICATE KEY UPDATE nombre = VALUES(nombre);

-- 3.3) Tipo de diagnóstico ---------------------------------------------------
CREATE TABLE IF NOT EXISTS hc_diagnostico_tipo (
  id     TINYINT AUTO_INCREMENT PRIMARY KEY,
  codigo VARCHAR(20) NOT NULL UNIQUE,
  nombre VARCHAR(40) NOT NULL,
  activo TINYINT(1)  NOT NULL DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Catálogo: tipo de diagnóstico';

INSERT INTO hc_diagnostico_tipo (id, codigo, nombre) VALUES
  (1, 'PRESUNTIVO', 'Presuntivo'),
  (2, 'DEFINITIVO', 'Definitivo')
ON DUPLICATE KEY UPDATE nombre = VALUES(nombre);

-- 3.4) Estado de la cita -----------------------------------------------------
CREATE TABLE IF NOT EXISTS hc_cita_estado (
  id     TINYINT AUTO_INCREMENT PRIMARY KEY,
  codigo VARCHAR(20) NOT NULL UNIQUE,
  nombre VARCHAR(40) NOT NULL,
  activo TINYINT(1)  NOT NULL DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Catálogo: estado de la cita';

INSERT INTO hc_cita_estado (id, codigo, nombre) VALUES
  (1, 'PENDIENTE',  'Pendiente'),
  (2, 'ATENDIDA',   'Atendida'),
  (3, 'CANCELADA',  'Cancelada'),
  (4, 'NO_ASISTIO', 'No asistió')
ON DUPLICATE KEY UPDATE nombre = VALUES(nombre);

-- ============================================================================
--  4) DOMINIO CLÍNICO  (todo scoped por empresa_id = tenant)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 4.1) Pacientes  (reemplaza el store en memoria de src/modules/pacientes)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hc_pacientes (
  id                 INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id         INT          NOT NULL,
  -- Filiación
  tipo_doc           CHAR(1)      NOT NULL DEFAULT '1' COMMENT 'cat.06: 1 DNI · 4 CE · 7 pasaporte · 0 sin doc',
  num_doc            VARCHAR(20)  DEFAULT NULL,
  nombres            VARCHAR(120) NOT NULL,
  apellidos          VARCHAR(120) NOT NULL,
  fecha_nacimiento   DATE         DEFAULT NULL,
  sexo_id            TINYINT      DEFAULT NULL COMMENT '-> hc_sexo',
  -- Contacto
  telefono           VARCHAR(30)  DEFAULT NULL,
  email              VARCHAR(160) DEFAULT NULL,
  direccion          VARCHAR(255) DEFAULT NULL,
  -- Apoderado / contacto de emergencia (menores o dependientes)
  apoderado_nombre   VARCHAR(160) DEFAULT NULL,
  apoderado_telefono VARCHAR(30)  DEFAULT NULL,
  apoderado_relacion VARCHAR(60)  DEFAULT NULL COMMENT 'Madre, Padre, Tutor, etc.',
  observaciones      TEXT         DEFAULT NULL,
  activo             TINYINT(1)   NOT NULL DEFAULT 1,
  user_crea_id       INT          DEFAULT NULL COMMENT 'Quién lo registró',
  user_actua_id      INT          DEFAULT NULL COMMENT 'Último usuario que lo editó',
  created_at         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_hcpac_empresa FOREIGN KEY (empresa_id)    REFERENCES empresas(id) ON DELETE CASCADE,
  CONSTRAINT fk_hcpac_sexo    FOREIGN KEY (sexo_id)       REFERENCES hc_sexo(id),
  CONSTRAINT fk_hcpac_crea    FOREIGN KEY (user_crea_id)  REFERENCES usuarios(id),
  CONSTRAINT fk_hcpac_actua   FOREIGN KEY (user_actua_id) REFERENCES usuarios(id),
  INDEX idx_hcpac_empresa (empresa_id),
  INDEX idx_hcpac_nombre (empresa_id, apellidos, nombres),
  -- Un documento no se repite dentro del mismo centro (pero sí entre centros).
  UNIQUE KEY uq_hcpac_doc (empresa_id, tipo_doc, num_doc)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Pacientes por centro terapéutico (tenant)';

-- ----------------------------------------------------------------------------
-- 4.2) Historia clínica  (cabecera; 1 por paciente)
--      Aquí va la anamnesis / antecedentes que se llenan al abrirla.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hc_historias (
  id                 INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id         INT          NOT NULL,
  paciente_id        INT          NOT NULL,
  numero             VARCHAR(30)  DEFAULT NULL COMMENT 'N° de historia correlativo por centro (ej: HC-2026-0001)',
  fecha_apertura     DATE         NOT NULL DEFAULT (CURRENT_DATE),
  motivo_consulta    TEXT         DEFAULT NULL,
  antecedentes       TEXT         DEFAULT NULL COMMENT 'Antecedentes personales/familiares, anamnesis',
  estado_id          TINYINT      NOT NULL DEFAULT 1 COMMENT '-> hc_historia_estado',
  user_crea_id       INT          DEFAULT NULL COMMENT 'Quién la abrió',
  user_actua_id      INT          DEFAULT NULL COMMENT 'Último usuario que la editó',
  created_at         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_hchist_empresa  FOREIGN KEY (empresa_id)    REFERENCES empresas(id)          ON DELETE CASCADE,
  CONSTRAINT fk_hchist_paciente FOREIGN KEY (paciente_id)   REFERENCES hc_pacientes(id)      ON DELETE CASCADE,
  CONSTRAINT fk_hchist_estado   FOREIGN KEY (estado_id)     REFERENCES hc_historia_estado(id),
  CONSTRAINT fk_hchist_crea     FOREIGN KEY (user_crea_id)  REFERENCES usuarios(id),
  CONSTRAINT fk_hchist_actua    FOREIGN KEY (user_actua_id) REFERENCES usuarios(id),
  INDEX idx_hchist_empresa (empresa_id),
  -- 1 sola historia por paciente (decisión de negocio).
  UNIQUE KEY uq_hchist_paciente (paciente_id),
  UNIQUE KEY uq_hchist_numero (empresa_id, numero)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Historia clínica (cabecera + anamnesis) por paciente';

-- ----------------------------------------------------------------------------
-- 4.3) Diagnósticos de la historia  (CIE-10 u observación libre; N por historia)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hc_diagnosticos (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id    INT          NOT NULL,
  historia_id   INT          NOT NULL,
  codigo_cie10  VARCHAR(10)  DEFAULT NULL,
  descripcion   VARCHAR(255) NOT NULL,
  tipo_id       TINYINT      NOT NULL DEFAULT 1 COMMENT '-> hc_diagnostico_tipo',
  fecha         DATE         NOT NULL DEFAULT (CURRENT_DATE),
  user_crea_id  INT          DEFAULT NULL,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_hcdx_empresa  FOREIGN KEY (empresa_id)   REFERENCES empresas(id)            ON DELETE CASCADE,
  CONSTRAINT fk_hcdx_historia FOREIGN KEY (historia_id)  REFERENCES hc_historias(id)        ON DELETE CASCADE,
  CONSTRAINT fk_hcdx_tipo     FOREIGN KEY (tipo_id)      REFERENCES hc_diagnostico_tipo(id),
  CONSTRAINT fk_hcdx_crea     FOREIGN KEY (user_crea_id) REFERENCES usuarios(id),
  INDEX idx_hcdx_historia (historia_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Diagnósticos asociados a una historia';

-- ----------------------------------------------------------------------------
-- 4.4) Asignación paciente <-> terapeuta  (quién atiende a quién)
--      terapeuta_id apunta a usuarios(id) con rol TERAPEUTA.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hc_asignaciones (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id    INT        NOT NULL,
  paciente_id   INT        NOT NULL,
  terapeuta_id  INT        NOT NULL,
  activo        TINYINT(1) NOT NULL DEFAULT 1,
  user_crea_id  INT        DEFAULT NULL COMMENT 'Quién hizo la asignación',
  created_at    DATETIME   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_hcasig_empresa   FOREIGN KEY (empresa_id)   REFERENCES empresas(id)     ON DELETE CASCADE,
  CONSTRAINT fk_hcasig_paciente  FOREIGN KEY (paciente_id)  REFERENCES hc_pacientes(id) ON DELETE CASCADE,
  CONSTRAINT fk_hcasig_terapeuta FOREIGN KEY (terapeuta_id) REFERENCES usuarios(id)     ON DELETE CASCADE,
  CONSTRAINT fk_hcasig_crea      FOREIGN KEY (user_crea_id) REFERENCES usuarios(id),
  UNIQUE KEY uq_hcasig (paciente_id, terapeuta_id),
  INDEX idx_hcasig_terapeuta (empresa_id, terapeuta_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Qué terapeuta atiende a qué paciente';

-- ----------------------------------------------------------------------------
-- 4.5) Sesiones / evoluciones  (el día a día del terapeuta — formato SOAP)
--      Este es el corazón del sistema: cada atención queda registrada.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hc_sesiones (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id    INT          NOT NULL,
  historia_id   INT          NOT NULL,
  terapeuta_id  INT          NOT NULL COMMENT 'usuarios(id) que realizó la sesión',
  fecha         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  numero_sesion INT          DEFAULT NULL COMMENT 'Correlativo dentro de la historia',
  -- Nota de evolución (SOAP: Subjetivo/Objetivo/Análisis/Plan). Se puede usar
  -- solo `evolucion` si el centro no trabaja SOAP formal.
  subjetivo     TEXT         DEFAULT NULL,
  objetivo      TEXT         DEFAULT NULL,
  analisis      TEXT         DEFAULT NULL,
  plan          TEXT         DEFAULT NULL,
  evolucion     TEXT         DEFAULT NULL COMMENT 'Nota libre si no se usa SOAP',
  -- Firma / cierre: una evolución firmada no debería editarse (integridad clínica)
  firmada       TINYINT(1)   NOT NULL DEFAULT 0,
  -- terapeuta_id = autor (crea). user_actua_id = último que la editó.
  user_actua_id INT          DEFAULT NULL COMMENT 'Último usuario que la editó',
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_hcses_empresa   FOREIGN KEY (empresa_id)    REFERENCES empresas(id)     ON DELETE CASCADE,
  CONSTRAINT fk_hcses_historia  FOREIGN KEY (historia_id)   REFERENCES hc_historias(id) ON DELETE CASCADE,
  CONSTRAINT fk_hcses_terapeuta FOREIGN KEY (terapeuta_id)  REFERENCES usuarios(id),
  CONSTRAINT fk_hcses_actua     FOREIGN KEY (user_actua_id) REFERENCES usuarios(id),
  INDEX idx_hcses_historia (historia_id, fecha),
  INDEX idx_hcses_empresa (empresa_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Sesiones / notas de evolución (SOAP) del terapeuta';

-- ----------------------------------------------------------------------------
-- 4.6) Citas / agenda  (opcional pero típico en un centro terapéutico)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hc_citas (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id    INT       NOT NULL,
  paciente_id   INT       NOT NULL,
  terapeuta_id  INT       NOT NULL,
  inicio        DATETIME  NOT NULL,
  fin           DATETIME  DEFAULT NULL,
  estado_id     TINYINT   NOT NULL DEFAULT 1 COMMENT '-> hc_cita_estado',
  motivo        VARCHAR(255) DEFAULT NULL,
  sesion_id     INT       DEFAULT NULL COMMENT 'Se enlaza a la evolución cuando se atiende',
  user_crea_id  INT       DEFAULT NULL COMMENT 'Quién agendó la cita',
  user_actua_id INT       DEFAULT NULL COMMENT 'Último usuario que la editó',
  created_at    DATETIME  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME  NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_hccita_empresa   FOREIGN KEY (empresa_id)    REFERENCES empresas(id)     ON DELETE CASCADE,
  CONSTRAINT fk_hccita_paciente  FOREIGN KEY (paciente_id)   REFERENCES hc_pacientes(id) ON DELETE CASCADE,
  CONSTRAINT fk_hccita_terapeuta FOREIGN KEY (terapeuta_id)  REFERENCES usuarios(id),
  CONSTRAINT fk_hccita_estado    FOREIGN KEY (estado_id)     REFERENCES hc_cita_estado(id),
  CONSTRAINT fk_hccita_sesion    FOREIGN KEY (sesion_id)     REFERENCES hc_sesiones(id)  ON DELETE SET NULL,
  CONSTRAINT fk_hccita_crea      FOREIGN KEY (user_crea_id)  REFERENCES usuarios(id),
  CONSTRAINT fk_hccita_actua     FOREIGN KEY (user_actua_id) REFERENCES usuarios(id),
  INDEX idx_hccita_agenda (empresa_id, terapeuta_id, inicio),
  INDEX idx_hccita_paciente (paciente_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Agenda de citas del centro';

-- ----------------------------------------------------------------------------
-- 4.7) Adjuntos  (informes, PDFs, exámenes que sube el terapeuta)
--      Se guarda la RUTA del archivo en /uploads (no base64), como el resto
--      del sistema (ver feedback imagenes-archivo-no-base64).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hc_adjuntos (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id    INT          NOT NULL,
  historia_id   INT          NOT NULL,
  sesion_id     INT          DEFAULT NULL,
  nombre        VARCHAR(200) NOT NULL,
  ruta          VARCHAR(500) NOT NULL COMMENT 'Ruta en /uploads',
  mime          VARCHAR(120) DEFAULT NULL,
  user_crea_id  INT          DEFAULT NULL,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_hcadj_empresa  FOREIGN KEY (empresa_id)  REFERENCES empresas(id)     ON DELETE CASCADE,
  CONSTRAINT fk_hcadj_historia FOREIGN KEY (historia_id) REFERENCES hc_historias(id) ON DELETE CASCADE,
  CONSTRAINT fk_hcadj_sesion   FOREIGN KEY (sesion_id)   REFERENCES hc_sesiones(id)  ON DELETE SET NULL,
  CONSTRAINT fk_hcadj_crea     FOREIGN KEY (user_crea_id) REFERENCES usuarios(id),
  INDEX idx_hcadj_historia (historia_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Documentos/adjuntos de la historia clínica';

-- ============================================================================
--  5) Altas de acceso (ejemplo — descomentar y ajustar IDs por centro)
--  --------------------------------------------------------------------------
--  Para que un centro EXISTENTE (fila en empresas) tenga este producto:
--
--    INSERT IGNORE INTO empresa_producto (empresa_id, producto_id)
--    SELECT :empresa_id, id FROM productos WHERE slug = 'historias-clinicas';
--
--  Y para dar acceso a un usuario a este producto con su rol:
--    INSERT IGNORE INTO usuario_producto (usuario_id, producto_id, rol_id)
--    SELECT :usuario_id, p.id, :rol_id
--    FROM productos p WHERE p.slug = 'historias-clinicas';
-- ============================================================================

-- Verificación rápida
SELECT slug, nombre FROM productos WHERE slug = 'historias-clinicas';
SELECT id, nombre FROM roles WHERE nombre IN ('ADMINISTRADOR','ADMISION','TERAPEUTA');
SELECT 'hc_sexo' t, codigo, nombre FROM hc_sexo
UNION ALL SELECT 'hc_historia_estado', codigo, nombre FROM hc_historia_estado
UNION ALL SELECT 'hc_diagnostico_tipo', codigo, nombre FROM hc_diagnostico_tipo
UNION ALL SELECT 'hc_cita_estado', codigo, nombre FROM hc_cita_estado;
