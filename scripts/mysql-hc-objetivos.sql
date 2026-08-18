-- ============================================================================
--  VAXA · Historias Clínicas — Objetivos terapéuticos + progreso medible
--  --------------------------------------------------------------------------
--  Diferenciador estrella: cada historia tiene objetivos MEDIBLES (ej. "producir
--  /r/ en palabras: meta 80%") y en cada avance se registra el % logrado → el
--  sistema dibuja la CURVA de progreso. Todo aislado (hc_*), scoped por empresa.
--
--  Correr DESPUÉS de mysql-historias-clinicas.sql.
--    mysql -u root -p vaxa < scripts/mysql-hc-objetivos.sql
-- ============================================================================

-- 1) Catálogo: estado del objetivo (sin ENUM, igual que el resto) --------------
CREATE TABLE IF NOT EXISTS hc_objetivo_estado (
  id     TINYINT AUTO_INCREMENT PRIMARY KEY,
  codigo VARCHAR(20) NOT NULL UNIQUE,
  nombre VARCHAR(40) NOT NULL,
  activo TINYINT(1)  NOT NULL DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Catálogo: estado del objetivo terapéutico';

INSERT INTO hc_objetivo_estado (id, codigo, nombre) VALUES
  (1, 'EN_CURSO', 'En curso'),
  (2, 'LOGRADO',  'Logrado'),
  (3, 'PAUSADO',  'Pausado')
ON DUPLICATE KEY UPDATE nombre = VALUES(nombre);

-- 2) Objetivos de la historia --------------------------------------------------
CREATE TABLE IF NOT EXISTS hc_objetivos (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id    INT           NOT NULL,
  historia_id   INT           NOT NULL,
  descripcion   VARCHAR(255)  NOT NULL,
  unidad        VARCHAR(20)   NOT NULL DEFAULT '%' COMMENT 'Unidad de medida: %, min, palabras…',
  meta          DECIMAL(7,2)  NOT NULL DEFAULT 100 COMMENT 'Valor objetivo a alcanzar',
  estado_id     TINYINT       NOT NULL DEFAULT 1 COMMENT '-> hc_objetivo_estado',
  fecha_inicio  DATE          NOT NULL DEFAULT (CURRENT_DATE),
  fecha_logro   DATE          DEFAULT NULL COMMENT 'Se setea cuando se alcanza la meta',
  user_crea_id  INT           DEFAULT NULL,
  created_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_hcobj_empresa  FOREIGN KEY (empresa_id)   REFERENCES empresas(id)             ON DELETE CASCADE,
  CONSTRAINT fk_hcobj_historia FOREIGN KEY (historia_id)  REFERENCES hc_historias(id)         ON DELETE CASCADE,
  CONSTRAINT fk_hcobj_estado   FOREIGN KEY (estado_id)    REFERENCES hc_objetivo_estado(id),
  CONSTRAINT fk_hcobj_crea     FOREIGN KEY (user_crea_id) REFERENCES usuarios(id),
  INDEX idx_hcobj_historia (historia_id),
  INDEX idx_hcobj_empresa (empresa_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Objetivos terapéuticos medibles por historia';

-- 3) Avance del objetivo (un punto por medición → alimenta la gráfica) ---------
CREATE TABLE IF NOT EXISTS hc_objetivo_avance (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id    INT           NOT NULL,
  objetivo_id   INT           NOT NULL,
  sesion_id     INT           DEFAULT NULL COMMENT 'Sesión en que se midió (opcional)',
  valor         DECIMAL(7,2)  NOT NULL COMMENT 'Valor logrado en esta medición',
  fecha         DATE          NOT NULL DEFAULT (CURRENT_DATE),
  nota          VARCHAR(255)  DEFAULT NULL,
  user_crea_id  INT           DEFAULT NULL,
  created_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_hcav_empresa  FOREIGN KEY (empresa_id)   REFERENCES empresas(id)       ON DELETE CASCADE,
  CONSTRAINT fk_hcav_objetivo FOREIGN KEY (objetivo_id)  REFERENCES hc_objetivos(id)   ON DELETE CASCADE,
  CONSTRAINT fk_hcav_sesion   FOREIGN KEY (sesion_id)    REFERENCES hc_sesiones(id)    ON DELETE SET NULL,
  CONSTRAINT fk_hcav_crea     FOREIGN KEY (user_crea_id) REFERENCES usuarios(id),
  INDEX idx_hcav_objetivo (objetivo_id, fecha)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Mediciones de avance de cada objetivo (curva de progreso)';

-- Verificación
SELECT 'hc_objetivo_estado' AS t, codigo, nombre FROM hc_objetivo_estado;
