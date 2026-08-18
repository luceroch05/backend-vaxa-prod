-- ============================================================================
--  VAXA · Historias Clínicas — Tareas para casa (plan casero)
--  --------------------------------------------------------------------------
--  El terapeuta asigna ejercicios para casa tras la sesión; el apoderado los
--  marca como cumplidos desde el PORTAL (enlace mágico). Refuerza el tratamiento
--  y lo hace medible.
--
--  Correr DESPUÉS de mysql-historias-clinicas.sql (+ portal).
--    mysql -u root -p vaxa < scripts/mysql-hc-tareas.sql
-- ============================================================================

CREATE TABLE IF NOT EXISTS hc_tareas (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id    INT           NOT NULL,
  historia_id   INT           NOT NULL,
  sesion_id     INT           DEFAULT NULL COMMENT 'Sesión en que se asignó (opcional)',
  descripcion   VARCHAR(255)  NOT NULL,
  detalle       VARCHAR(500)  DEFAULT NULL COMMENT 'Instrucciones / cómo hacerla',
  fecha_limite  DATE          DEFAULT NULL,
  cumplida      TINYINT(1)    NOT NULL DEFAULT 0,
  cumplida_at   DATETIME      DEFAULT NULL COMMENT 'Cuándo la marcó cumplida el apoderado',
  activo        TINYINT(1)    NOT NULL DEFAULT 1,
  user_crea_id  INT           DEFAULT NULL,
  created_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_hctar_empresa  FOREIGN KEY (empresa_id)   REFERENCES empresas(id)     ON DELETE CASCADE,
  CONSTRAINT fk_hctar_historia FOREIGN KEY (historia_id)  REFERENCES hc_historias(id) ON DELETE CASCADE,
  CONSTRAINT fk_hctar_sesion   FOREIGN KEY (sesion_id)    REFERENCES hc_sesiones(id)  ON DELETE SET NULL,
  CONSTRAINT fk_hctar_crea     FOREIGN KEY (user_crea_id) REFERENCES usuarios(id),
  INDEX idx_hctar_historia (historia_id, activo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Tareas para casa asignadas por el terapeuta';

SELECT 'hc_tareas creada' AS ok;
