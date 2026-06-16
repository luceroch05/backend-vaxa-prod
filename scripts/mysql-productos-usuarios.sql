-- ============================================================================
--  Modelo multi-producto de Vaxa
--  --------------------------------------------------------------------------
--  Objetivo: diferenciar usuarios por PRODUCTO (software) sin duplicar data.
--
--    productos          -> catálogo de software de Vaxa (Certificaciones, …)
--    empresa_producto   -> qué productos tiene contratada cada empresa
--    usuario_producto   -> a qué productos entra cada usuario y con qué rol
--
--  Una sola fila de `usuarios` puede acceder a varios productos vía
--  `usuario_producto` (N:N), evitando repetir la persona por cada sistema.
--
--  Ejecutar UNA vez. Es idempotente (CREATE IF NOT EXISTS / INSERT IGNORE).
-- ============================================================================

-- 1) Catálogo de productos --------------------------------------------------
--   `interno` = 1  -> herramienta interna de Vaxa (NO se factura: sistemas-vaxa)
--   `interno` = 0  -> software que la empresa contrata y SÍ se cobra
CREATE TABLE IF NOT EXISTS productos (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  slug       VARCHAR(50)  NOT NULL UNIQUE,
  nombre     VARCHAR(120) NOT NULL,
  interno    TINYINT(1)   NOT NULL DEFAULT 0,
  activo     TINYINT(1)   NOT NULL DEFAULT 1,
  creado_en  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO productos (slug, nombre, interno) VALUES
  ('certificaciones', 'Certificaciones', 0),
  ('sistemas-vaxa',   'Sistemas Vaxa',   1)
ON DUPLICATE KEY UPDATE nombre = VALUES(nombre), interno = VALUES(interno);

-- 2) Productos contratados por cada empresa ---------------------------------
CREATE TABLE IF NOT EXISTS empresa_producto (
  empresa_id   INT NOT NULL,
  producto_id  INT NOT NULL,
  activo       TINYINT(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (empresa_id, producto_id),
  FOREIGN KEY (empresa_id)  REFERENCES empresas(id)  ON DELETE CASCADE,
  FOREIGN KEY (producto_id) REFERENCES productos(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 3) Acceso de cada usuario a cada producto (con su rol en ese producto) -----
CREATE TABLE IF NOT EXISTS usuario_producto (
  usuario_id    INT NOT NULL,
  producto_id   INT NOT NULL,
  rol_id        INT NOT NULL,
  activo        TINYINT(1) NOT NULL DEFAULT 1,
  session_token VARCHAR(64) NULL DEFAULT NULL,   -- sesión única POR producto
  PRIMARY KEY (usuario_id, producto_id),
  FOREIGN KEY (usuario_id)  REFERENCES usuarios(id)  ON DELETE CASCADE,
  FOREIGN KEY (producto_id) REFERENCES productos(id) ON DELETE CASCADE,
  FOREIGN KEY (rol_id)      REFERENCES roles(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Si la tabla ya existía sin la columna (entornos donde se corrió una versión
-- previa de este script), agrégala manualmente con:
--   ALTER TABLE usuario_producto ADD COLUMN session_token VARCHAR(64) NULL DEFAULT NULL;

-- ============================================================================
--  Migración de datos existentes (sin romper nada)
--  Regla actual: empresa raíz 'vaxa' = panel admin; el resto = certificados.
-- ============================================================================

-- Empresas (no raíz) -> contratan Certificaciones
INSERT IGNORE INTO empresa_producto (empresa_id, producto_id)
SELECT e.id, p.id
FROM empresas e CROSS JOIN productos p
WHERE p.slug = 'certificaciones' AND e.tenant_slug <> 'vaxa';

-- Empresa raíz 'vaxa' -> contrata Sistemas Vaxa
INSERT IGNORE INTO empresa_producto (empresa_id, producto_id)
SELECT e.id, p.id
FROM empresas e CROSS JOIN productos p
WHERE p.slug = 'sistemas-vaxa' AND e.tenant_slug = 'vaxa';

-- Usuarios de empresas (no raíz) -> acceso a Certificaciones con su rol actual
INSERT IGNORE INTO usuario_producto (usuario_id, producto_id, rol_id)
SELECT u.id, p.id, u.rol_id
FROM usuarios u
JOIN empresas e ON e.id = u.empresa_id
CROSS JOIN productos p
WHERE p.slug = 'certificaciones' AND e.tenant_slug <> 'vaxa';

-- Usuarios de la raíz 'vaxa' -> acceso a Sistemas Vaxa con su rol actual
INSERT IGNORE INTO usuario_producto (usuario_id, producto_id, rol_id)
SELECT u.id, p.id, u.rol_id
FROM usuarios u
JOIN empresas e ON e.id = u.empresa_id
CROSS JOIN productos p
WHERE p.slug = 'sistemas-vaxa' AND e.tenant_slug = 'vaxa';
