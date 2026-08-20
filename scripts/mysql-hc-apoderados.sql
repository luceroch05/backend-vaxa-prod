-- ============================================================
-- Apoderados / tutores del paciente — tabla intermedia (escalable)
-- ------------------------------------------------------------
-- Un paciente (sobre todo menor de edad) puede tener varios apoderados. En vez de
-- columnas fijas (apoderado, apoderado2…) que NO escalan, se guardan como FILAS en
-- esta tabla. La regla de negocio hoy limita a 2 por paciente (MAX_APODERADOS en el
-- repo), pero la estructura soporta N sin cambiar el esquema.
--
-- ADITIVO: crea una tabla nueva. Correr una vez. (El backend también la auto-crea.)
-- ============================================================
USE vaxa;

CREATE TABLE IF NOT EXISTS hc_apoderados (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id   INT NOT NULL,
  paciente_id  INT NOT NULL,
  nombre       VARCHAR(160) NOT NULL,
  tipo_doc     CHAR(1)      DEFAULT NULL COMMENT 'cat.06: 1 DNI · 4 CE · 7 pasaporte',
  num_doc      VARCHAR(20)  DEFAULT NULL,
  telefono     VARCHAR(30)  DEFAULT NULL,
  relacion     VARCHAR(60)  DEFAULT NULL COMMENT 'Madre, Padre, Tutor(a)…',
  orden        TINYINT      NOT NULL DEFAULT 1,
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_hcapod_empresa  FOREIGN KEY (empresa_id)  REFERENCES empresas(id)     ON DELETE CASCADE,
  CONSTRAINT fk_hcapod_paciente FOREIGN KEY (paciente_id) REFERENCES hc_pacientes(id) ON DELETE CASCADE,
  INDEX idx_hcapod_paciente (paciente_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Apoderados/tutores de un paciente (hasta 2 por regla de negocio; tabla escalable)';

SELECT 'hc_apoderados creada' AS ok;
