-- ============================================================================
--  Catálogo de CALIDADES de participación (deja de ser texto libre)
--  --------------------------------------------------------------------------
--  Antes la calidad (Participante / Organizador / Ponente…) se escribía a mano
--  y las opciones estaban hardcodeadas en el frontend. Ahora salen de esta
--  tabla, POR EMPRESA (cada centro administra su propia lista).
--
--  IMPORTANTE: NO se toca `inscripciones.calidad` (sigue guardando el NOMBRE de
--  la calidad como texto). El PDF y todos los reportes lo leen igual. Esta tabla
--  solo alimenta el desplegable y valida/gestiona las opciones. Riesgo cero.
--
--  Ejecutar UNA vez. Idempotente (IF NOT EXISTS / INSERT ... ON DUPLICATE).
--    mysql -u root -p vaxa < scripts/mysql-calidad-catalogo.sql
-- ============================================================================

CREATE TABLE IF NOT EXISTS calidad_participacion (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id  INT          NOT NULL,
  nombre      VARCHAR(60)  NOT NULL,
  activo      TINYINT(1)   NOT NULL DEFAULT 1,
  orden       INT          NOT NULL DEFAULT 0,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_calpart_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE,
  UNIQUE KEY uq_calpart_empresa_nombre (empresa_id, nombre)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Calidades de participación por empresa (Participante, Ponente, Organizador…)';

-- 1) Semilla con las calidades estándar para CADA empresa existente. -----------
--    (Participante primero; el orden define cómo salen en el desplegable.)
INSERT INTO calidad_participacion (empresa_id, nombre, orden)
SELECT src.id, src.nombre, src.orden FROM (
  SELECT e.id AS id, x.nombre AS nombre, x.orden AS orden
    FROM empresas e
    CROSS JOIN (
      SELECT 'Participante' AS nombre, 1 AS orden
      UNION ALL SELECT 'Organizador', 2
      UNION ALL SELECT 'Colaborador', 3
      UNION ALL SELECT 'Ponente',     4
    ) x
) src
ON DUPLICATE KEY UPDATE activo = activo;

-- 2) Rescatar cualquier calidad YA USADA en inscripciones que no esté arriba, ---
--    para no perder valores personalizados que se escribieron antes a mano.
INSERT INTO calidad_participacion (empresa_id, nombre, orden)
SELECT i.empresa_id, TRIM(i.calidad), 50
  FROM inscripciones i
 WHERE TRIM(COALESCE(i.calidad, '')) <> ''
 GROUP BY i.empresa_id, TRIM(i.calidad)
ON DUPLICATE KEY UPDATE activo = activo;
