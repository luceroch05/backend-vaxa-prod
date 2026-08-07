-- =========================================================
--  FEATURE: Libro de Reclamaciones Virtual (formato INDECOPI)
--  ---------------------------------------------------------
--  Libro de Reclamaciones ÚNICO de VAXA (el proveedor somos nosotros).
--  NO es multi-tenant: cualquier consumidor/cliente de Vaxa registra
--  aquí su Reclamo o Queja. Sigue el formato oficial de la Hoja de
--  Reclamación de INDECOPI (D.S. 011-2011-PCM y modificatorias):
--    1) Identificación del consumidor reclamante
--    2) Identificación del bien contratado (producto/servicio)
--    3) Detalle de la reclamación + acciones adoptadas por el proveedor
--
--  Numeración correlativa por año: LR-2026-0001 (Hoja de Reclamación N°).
--  Plazo legal de respuesta: 15 días hábiles (calculado en el backend).
--
--  ✅ ADITIVO. Correr UNA vez:
--     mysql -u root -p vaxa < scripts/mysql-libro-reclamaciones.sql
-- =========================================================
USE vaxa;
SET NAMES utf8mb4;

-- =========================================================
--  A) CATÁLOGO: tipo de reclamación (Reclamo vs Queja)
--     INDECOPI los distingue y es obligatorio marcarlo.
-- =========================================================
CREATE TABLE IF NOT EXISTS reclamo_tipo (
  id          TINYINT AUTO_INCREMENT PRIMARY KEY,
  codigo      VARCHAR(20)  NOT NULL UNIQUE,
  nombre      VARCHAR(40)  NOT NULL,
  descripcion VARCHAR(255) NULL,
  activo      TINYINT(1)   NOT NULL DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Tipo de reclamación: Reclamo o Queja (INDECOPI)';

INSERT INTO reclamo_tipo (id, codigo, nombre, descripcion) VALUES
  (1, 'RECLAMO', 'Reclamo', 'Disconformidad relacionada a los productos o servicios.'),
  (2, 'QUEJA',   'Queja',   'Malestar o disconformidad respecto a la atención al público.')
ON DUPLICATE KEY UPDATE nombre = VALUES(nombre);

-- =========================================================
--  B) CATÁLOGO: tipo de bien contratado (Producto vs Servicio)
-- =========================================================
CREATE TABLE IF NOT EXISTS reclamo_bien_tipo (
  id     TINYINT AUTO_INCREMENT PRIMARY KEY,
  codigo VARCHAR(20) NOT NULL UNIQUE,
  nombre VARCHAR(40) NOT NULL,
  activo TINYINT(1)  NOT NULL DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Tipo de bien contratado: Producto o Servicio';

INSERT INTO reclamo_bien_tipo (id, codigo, nombre) VALUES
  (1, 'PRODUCTO', 'Producto'),
  (2, 'SERVICIO', 'Servicio')
ON DUPLICATE KEY UPDATE nombre = VALUES(nombre);

-- =========================================================
--  C) CATÁLOGO: estado de atención del reclamo
-- =========================================================
CREATE TABLE IF NOT EXISTS reclamo_estado (
  id     TINYINT AUTO_INCREMENT PRIMARY KEY,
  codigo VARCHAR(20) NOT NULL UNIQUE,
  nombre VARCHAR(40) NOT NULL,
  activo TINYINT(1)  NOT NULL DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Estado de atención de la hoja de reclamación';

INSERT INTO reclamo_estado (id, codigo, nombre) VALUES
  (1, 'PENDIENTE',  'Pendiente'),
  (2, 'EN_PROCESO', 'En proceso'),
  (3, 'ATENDIDO',   'Atendido'),
  (4, 'CERRADO',    'Cerrado')
ON DUPLICATE KEY UPDATE nombre = VALUES(nombre);

-- =========================================================
--  D) NUMERACIÓN ANUAL (correlativo atómico por año)
--     El número final es LR-2026-0001.
-- =========================================================
CREATE TABLE IF NOT EXISTS reclamo_series (
  anio        INT NOT NULL PRIMARY KEY,
  correlativo INT NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Correlativo anual del libro de reclamaciones';

-- =========================================================
--  E) LIBRO DE RECLAMACIONES (una fila = una Hoja de Reclamación)
-- =========================================================
CREATE TABLE IF NOT EXISTS reclamos (
  id                   INT AUTO_INCREMENT PRIMARY KEY,
  numero               VARCHAR(20) NOT NULL UNIQUE,       -- LR-2026-0001 (código público)

  -- ---- Bloque 1: identificación del consumidor reclamante ----
  consumidor_nombre    VARCHAR(150) NOT NULL,
  consumidor_tipo_doc  CHAR(1)      NOT NULL DEFAULT '1', -- cat.06: 1 DNI · 4 CE · 7 Pasaporte
  consumidor_num_doc   VARCHAR(20)  NOT NULL,
  consumidor_domicilio VARCHAR(255) NULL,
  consumidor_telefono  VARCHAR(30)  NULL,
  consumidor_email     VARCHAR(120) NULL,
  es_menor             TINYINT(1)   NOT NULL DEFAULT 0,   -- reclama en representación de un menor
  apoderado_nombre     VARCHAR(150) NULL,                 -- padre / madre / tutor
  apoderado_num_doc    VARCHAR(20)  NULL,

  -- ---- Bloque 2: identificación del bien contratado ----
  bien_tipo_id         TINYINT       NOT NULL,            -- -> reclamo_bien_tipo
  bien_monto           DECIMAL(10,2) NULL,                -- monto reclamado (S/)
  bien_descripcion     VARCHAR(500)  NULL,

  -- ---- Bloque 3: detalle de la reclamación ----
  tipo_id              TINYINT NOT NULL,                  -- -> reclamo_tipo (Reclamo/Queja)
  detalle              TEXT NOT NULL,                     -- detalle del reclamo/queja
  pedido               TEXT NOT NULL,                     -- pedido concreto del consumidor
  -- Firma del consumidor: presentación virtual (sin firma manuscrita). En el PDF
  -- se estampa la leyenda "Presentado virtualmente el {created_at}" + el nombre.

  -- ---- Acciones adoptadas por el proveedor (Vaxa) ----
  estado_id            TINYINT  NOT NULL DEFAULT 1,       -- -> reclamo_estado
  respuesta            TEXT     NULL,                     -- observaciones / acciones adoptadas
  respondido_at        DATETIME NULL,
  -- Firma del proveedor: solo texto ("VAXA SYSTEMS S.A.C." + fecha de respuesta),
  -- se estampa en el PDF; no se guarda imagen.
  fecha_limite         DATE     NULL,                     -- fecha reclamo + 15 días hábiles

  ip_registro          VARCHAR(45) NULL,                  -- IP desde donde se registró (traza)
  user_crea_id         INT      NULL,                     -- quién lo creó (NULL = consumidor público)
  user_actua_id        INT      NULL,                     -- último usuario Vaxa que respondió/actualizó
  created_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  KEY idx_reclamo_estado (estado_id),
  KEY idx_reclamo_doc    (consumidor_num_doc),
  KEY idx_reclamo_fecha  (created_at),
  FOREIGN KEY (bien_tipo_id)  REFERENCES reclamo_bien_tipo(id),
  FOREIGN KEY (tipo_id)       REFERENCES reclamo_tipo(id),
  FOREIGN KEY (estado_id)     REFERENCES reclamo_estado(id),
  FOREIGN KEY (user_crea_id)  REFERENCES usuarios(id),
  FOREIGN KEY (user_actua_id) REFERENCES usuarios(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Libro de Reclamaciones Virtual de Vaxa (formato INDECOPI)';

-- =========================================================
--  F) HISTORIAL / LÍNEA DE TIEMPO (para el seguimiento del consumidor)
--     Una fila por cada cambio de estado: registro, en proceso, respuesta…
-- =========================================================
CREATE TABLE IF NOT EXISTS reclamo_historial (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  reclamo_id INT NOT NULL,
  estado_id  TINYINT NOT NULL,          -- -> reclamo_estado
  nota       VARCHAR(500) NULL,         -- descripción del hito (visible al consumidor)
  user_crea_id INT NULL,                -- usuario Vaxa que generó el hito (NULL = automático / consumidor)
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_hist_reclamo (reclamo_id),
  FOREIGN KEY (reclamo_id)   REFERENCES reclamos(id) ON DELETE CASCADE,
  FOREIGN KEY (estado_id)    REFERENCES reclamo_estado(id),
  FOREIGN KEY (user_crea_id) REFERENCES usuarios(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Línea de tiempo de cada reclamo (seguimiento público)';

-- =========================================================
--  G) ADJUNTOS (evidencia que sube el consumidor: boletas, fotos, PDFs)
--     El archivo se guarda en /uploads/reclamos/; la BD solo la ruta.
-- =========================================================
CREATE TABLE IF NOT EXISTS reclamo_adjunto (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  reclamo_id INT NOT NULL,
  nombre     VARCHAR(255) NOT NULL,     -- nombre original del archivo
  ruta       VARCHAR(255) NOT NULL,     -- /uploads/reclamos/<hash>.<ext>
  mime       VARCHAR(100) NOT NULL,
  tamano     INT NOT NULL DEFAULT 0,    -- bytes
  user_crea_id INT NULL,                -- quién lo subió (NULL = consumidor público)
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_adj_reclamo (reclamo_id),
  FOREIGN KEY (reclamo_id)   REFERENCES reclamos(id) ON DELETE CASCADE,
  FOREIGN KEY (user_crea_id) REFERENCES usuarios(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Archivos adjuntos (evidencia) de cada reclamo';
