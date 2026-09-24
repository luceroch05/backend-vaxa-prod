-- ============================================================================
-- Infraestructura (uso interno de Vaxa, solo ADMIN)
--   infra_recursos   = tus VPS/dominios/hosting: lo que pagas al proveedor.
--   infra_alquileres = lo que le cobras/alquilas a un cliente.
-- Se auto-crean al arrancar el backend; este archivo es para correrlo a mano.
-- ============================================================================

CREATE TABLE IF NOT EXISTS infra_recursos (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  tipo             VARCHAR(40)   NOT NULL DEFAULT 'Hosting',
  nombre           VARCHAR(200)  NOT NULL,
  proveedor        VARCHAR(150)  NULL,
  costo            DECIMAL(10,2) NOT NULL DEFAULT 0,
  moneda           VARCHAR(8)    NOT NULL DEFAULT 'PEN',
  ciclo            VARCHAR(20)   NOT NULL DEFAULT 'mensual',
  fecha_renovacion DATE          NULL,
  proyectos        TEXT          NULL,
  credenciales     TEXT          NULL,
  notas            TEXT          NULL,
  activo           TINYINT(1)    NOT NULL DEFAULT 1,
  user_crea_id     INT           DEFAULT NULL,
  user_actua_id    INT           DEFAULT NULL,
  created_at       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS infra_alquileres (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  cliente       VARCHAR(200)  NULL,
  empresa_id    INT           NULL,
  recurso_id    INT           NULL,
  descripcion   VARCHAR(250)  NULL,
  precio        DECIMAL(10,2) NOT NULL DEFAULT 0,
  moneda        VARCHAR(8)    NOT NULL DEFAULT 'PEN',
  ciclo         VARCHAR(20)   NOT NULL DEFAULT 'mensual',
  fecha_inicio  DATE          NULL,
  proximo_cobro DATE          NULL,
  estado_pago   VARCHAR(20)   NOT NULL DEFAULT 'pendiente',
  notas         TEXT          NULL,
  activo        TINYINT(1)    NOT NULL DEFAULT 1,
  user_crea_id  INT           DEFAULT NULL,
  user_actua_id INT           DEFAULT NULL,
  created_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
