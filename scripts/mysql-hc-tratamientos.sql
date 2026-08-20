-- ============================================================
-- Tratamientos — Historias Clínicas (centros terapéuticos)
-- ------------------------------------------------------------
-- La HISTORIA es la carpeta permanente del paciente (1 por paciente, nunca se
-- cierra). Dentro, el paciente pasa por TRATAMIENTOS: cada tratamiento es una
-- etapa en que viene al centro y recibe sus terapias, con su ciclo
-- (En curso → En pausa → Alta), y puede abarcar VARIOS servicios a la vez
-- (ej. Terapia de lenguaje + Psicología infantil). Si más adelante recae o vuelve
-- por algo nuevo, se abre un tratamiento NUEVO (el anterior queda guardado).
--
-- Los diagnósticos van APARTE (a nivel de historia). Aquí solo el tratamiento.
-- ADITIVO: crea tablas nuevas, no toca las existentes. Correr una vez.
-- ============================================================
USE vaxa;

-- Estado del tratamiento (catálogo, sin ENUM, mismo patrón que los demás hc_*_estado).
CREATE TABLE IF NOT EXISTS hc_tratamiento_estado (
  id     TINYINT AUTO_INCREMENT PRIMARY KEY,
  codigo VARCHAR(20) NOT NULL UNIQUE,
  nombre VARCHAR(40) NOT NULL,
  activo TINYINT(1)  NOT NULL DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Catálogo: estado de un tratamiento';
INSERT INTO hc_tratamiento_estado (id, codigo, nombre) VALUES
  (1, 'EN_CURSO', 'En curso'),
  (2, 'PAUSADO',  'En pausa'),
  (3, 'ALTA',     'Alta')
ON DUPLICATE KEY UPDATE nombre = VALUES(nombre);

-- Tratamiento (etapa de atención) dentro de la historia.
CREATE TABLE IF NOT EXISTS hc_tratamientos (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id     INT      NOT NULL,
  historia_id    INT      NOT NULL,
  motivo         TEXT     DEFAULT NULL COMMENT 'Motivo del tratamiento / por qué se abre',
  fecha_inicio   DATE     NOT NULL DEFAULT (CURRENT_DATE),
  fecha_fin      DATE     DEFAULT NULL COMMENT 'Se setea al dar de alta / cerrar',
  estado_id      TINYINT  NOT NULL DEFAULT 1 COMMENT '-> hc_tratamiento_estado',
  nota_cierre    TEXT     DEFAULT NULL COMMENT 'Resultado / motivo del alta o pausa',
  user_crea_id   INT      DEFAULT NULL,
  user_actua_id  INT      DEFAULT NULL,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_hctra_empresa  FOREIGN KEY (empresa_id)    REFERENCES empresas(id)                ON DELETE CASCADE,
  CONSTRAINT fk_hctra_historia FOREIGN KEY (historia_id)   REFERENCES hc_historias(id)            ON DELETE CASCADE,
  CONSTRAINT fk_hctra_estado   FOREIGN KEY (estado_id)     REFERENCES hc_tratamiento_estado(id),
  CONSTRAINT fk_hctra_crea     FOREIGN KEY (user_crea_id)  REFERENCES usuarios(id),
  CONSTRAINT fk_hctra_actua    FOREIGN KEY (user_actua_id) REFERENCES usuarios(id),
  INDEX idx_hctra_historia (historia_id),
  INDEX idx_hctra_empresa  (empresa_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Tratamiento (etapa de atención) dentro de una historia clínica';

-- Servicios que abarca un tratamiento (N:N), cada uno con su terapeuta responsable.
CREATE TABLE IF NOT EXISTS hc_tratamiento_servicio (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id    INT NOT NULL,
  tratamiento_id INT NOT NULL,
  servicio_id   INT NOT NULL,
  terapeuta_id  INT DEFAULT NULL COMMENT 'Terapeuta a cargo de ese servicio en este tratamiento',
  activo        TINYINT(1) NOT NULL DEFAULT 1,
  CONSTRAINT fk_hctras_empresa FOREIGN KEY (empresa_id)     REFERENCES empresas(id)        ON DELETE CASCADE,
  CONSTRAINT fk_hctras_tra     FOREIGN KEY (tratamiento_id) REFERENCES hc_tratamientos(id) ON DELETE CASCADE,
  CONSTRAINT fk_hctras_serv    FOREIGN KEY (servicio_id)    REFERENCES hc_servicios(id),
  CONSTRAINT fk_hctras_ter     FOREIGN KEY (terapeuta_id)   REFERENCES usuarios(id),
  UNIQUE KEY uq_hctras (tratamiento_id, servicio_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Servicios que abarca un tratamiento (varios a la vez), con su terapeuta';

SELECT 'hc_tratamientos + hc_tratamiento_servicio + hc_tratamiento_estado creados' AS ok;
