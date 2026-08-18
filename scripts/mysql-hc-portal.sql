-- ============================================================================
--  VAXA · Historias Clínicas — Portal para padres / apoderados
--  --------------------------------------------------------------------------
--  El centro genera un ENLACE mágico por paciente (token) y se lo pasa a la
--  familia (WhatsApp). El apoderado abre el link y ve, SOLO LECTURA, el
--  progreso de su hijo (objetivos + gráfica) y sus próximas citas. Sin
--  contraseñas: el token es la credencial (revocable).
--
--  Correr DESPUÉS de mysql-historias-clinicas.sql (y objetivos).
--    mysql -u root -p vaxa < scripts/mysql-hc-portal.sql
-- ============================================================================

CREATE TABLE IF NOT EXISTS hc_apoderado_acceso (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id    INT          NOT NULL,
  paciente_id   INT          NOT NULL,
  token         VARCHAR(64)  NOT NULL UNIQUE COMMENT 'Credencial del enlace (aleatorio)',
  activo        TINYINT(1)   NOT NULL DEFAULT 1,
  user_crea_id  INT          DEFAULT NULL COMMENT 'Quién generó el acceso',
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revocado_at   DATETIME     DEFAULT NULL,
  CONSTRAINT fk_hcapo_empresa  FOREIGN KEY (empresa_id)   REFERENCES empresas(id)     ON DELETE CASCADE,
  CONSTRAINT fk_hcapo_paciente FOREIGN KEY (paciente_id)  REFERENCES hc_pacientes(id) ON DELETE CASCADE,
  CONSTRAINT fk_hcapo_crea     FOREIGN KEY (user_crea_id) REFERENCES usuarios(id),
  INDEX idx_hcapo_paciente (paciente_id, activo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Acceso del apoderado al portal (enlace por token, por paciente)';

SELECT 'hc_apoderado_acceso creada' AS ok;
