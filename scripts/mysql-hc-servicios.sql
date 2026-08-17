-- ============================================================================
--  VAXA · Historias Clínicas — Servicios del centro
--  --------------------------------------------------------------------------
--  Agrega el concepto de SERVICIO (terapia de lenguaje, ocupacional, psicología…):
--    · hc_servicios            -> catálogo POR CENTRO (cada tenant define los suyos)
--    · hc_terapeuta_servicio   -> qué servicios brinda cada terapeuta (N:N)
--    · hc_asignaciones.servicio_id -> la asignación paciente↔terapeuta es POR servicio
--    · hc_citas.servicio_id        -> la cita indica el servicio
--
--  Correr DESPUÉS de mysql-historias-clinicas.sql.
--    mysql -u root -p vaxa < scripts/mysql-hc-servicios.sql
-- ============================================================================

-- 1) Catálogo de servicios por centro ----------------------------------------
CREATE TABLE IF NOT EXISTS hc_servicios (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id   INT          NOT NULL,
  nombre       VARCHAR(120) NOT NULL,
  descripcion  VARCHAR(255) DEFAULT NULL,
  activo       TINYINT(1)   NOT NULL DEFAULT 1,
  user_crea_id INT          DEFAULT NULL,
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_hcserv_empresa FOREIGN KEY (empresa_id)   REFERENCES empresas(id) ON DELETE CASCADE,
  CONSTRAINT fk_hcserv_crea    FOREIGN KEY (user_crea_id)  REFERENCES usuarios(id),
  INDEX idx_hcserv_empresa (empresa_id),
  UNIQUE KEY uq_hcserv (empresa_id, nombre)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Servicios que ofrece el centro (por tenant)';

-- 2) Servicios que brinda cada terapeuta (N:N) --------------------------------
CREATE TABLE IF NOT EXISTS hc_terapeuta_servicio (
  empresa_id   INT      NOT NULL,
  terapeuta_id INT      NOT NULL,
  servicio_id  INT      NOT NULL,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (terapeuta_id, servicio_id),
  CONSTRAINT fk_hcts_empresa   FOREIGN KEY (empresa_id)   REFERENCES empresas(id)     ON DELETE CASCADE,
  CONSTRAINT fk_hcts_terapeuta FOREIGN KEY (terapeuta_id) REFERENCES usuarios(id)     ON DELETE CASCADE,
  CONSTRAINT fk_hcts_servicio  FOREIGN KEY (servicio_id)  REFERENCES hc_servicios(id) ON DELETE CASCADE,
  INDEX idx_hcts_servicio (servicio_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Qué servicios brinda cada terapeuta';

-- 3) La asignación paciente↔terapeuta pasa a ser POR servicio -----------------
ALTER TABLE hc_asignaciones
  ADD COLUMN servicio_id INT NULL AFTER terapeuta_id,
  ADD CONSTRAINT fk_hcasig_servicio FOREIGN KEY (servicio_id) REFERENCES hc_servicios(id);

-- Reemplaza el UNIQUE (paciente,terapeuta) por (paciente,terapeuta,servicio).
-- Se AGREGA el nuevo antes de soltar el viejo: el paciente_id FK necesita un
-- índice y el nuevo (con paciente_id a la izquierda) lo cubre.
ALTER TABLE hc_asignaciones ADD UNIQUE KEY uq_hcasig2 (paciente_id, terapeuta_id, servicio_id);
ALTER TABLE hc_asignaciones DROP INDEX uq_hcasig;

-- 4) La cita indica el servicio -----------------------------------------------
ALTER TABLE hc_citas
  ADD COLUMN servicio_id INT NULL AFTER terapeuta_id,
  ADD CONSTRAINT fk_hccita_servicio FOREIGN KEY (servicio_id) REFERENCES hc_servicios(id);

-- Verificación
SELECT 'hc_servicios' AS tabla;
