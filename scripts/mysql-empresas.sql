-- ============================================================
-- Script MySQL: tabla empresas_vaxa (tenants) - datos básicos
-- Proyecto Vaxa - Backend multi-tenant
-- ============================================================
-- Uso: mysql -u usuario -p nombre_bd < scripts/mysql-empresas.sql
-- ============================================================

-- Opcional: crear la base de datos si no existe
-- CREATE DATABASE IF NOT EXISTS vaxa_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
-- USE vaxa_db;

-- ------------------------------------------------------------
-- Tabla: empresas_vaxa (solo datos básicos por ahora)
-- ------------------------------------------------------------
DROP TABLE IF EXISTS empresas_vaxa;

CREATE TABLE empresas_vaxa (
  id            VARCHAR(64)   NOT NULL PRIMARY KEY COMMENT 'Identificador único del tenant',
  name          VARCHAR(255)  NOT NULL             COMMENT 'Nombre de la empresa',
  primary_color VARCHAR(32)   DEFAULT NULL         COMMENT 'Color principal (ej: purple, #1976d2)',
  activo        TINYINT(1)    NOT NULL DEFAULT 1   COMMENT '1=activo, 0=inactivo',
  tiene_login   TINYINT(1)    NOT NULL DEFAULT 1   COMMENT '1=tiene login propio, 0=no',
  created_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_empresas_vaxa_activo (activo),
  INDEX idx_empresas_vaxa_name (name(100))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Tenants (empresas) - datos básicos';

-- ------------------------------------------------------------
-- Inserts de prueba
-- ------------------------------------------------------------
INSERT INTO empresas_vaxa (id, name, primary_color, activo, tiene_login) VALUES
('backoffice',        'Sistemas Vaxa',     NULL,      1, 0),
('empresa-techpro',   'Certificaciones',   'purple',  1, 1),
('empresa-demo',      'Empresa Demo',      '#1976d2', 1, 1),
('clinica-sur',       'Clínica del Sur',   '#2e7d32', 1, 1),
('laboratorio-norte', 'Laboratorio Norte', '#ed6c02', 1, 0);

-- ------------------------------------------------------------
-- Verificación
-- ------------------------------------------------------------
SELECT id, name, primary_color, activo, tiene_login, created_at
FROM empresas_vaxa
ORDER BY id;
