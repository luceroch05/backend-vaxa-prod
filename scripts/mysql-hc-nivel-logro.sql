-- =========================================================
--  Maestro: NIVEL DE LOGRO de un objetivo terapéutico
--  ---------------------------------------------------------
--  Normaliza la escala de progreso de los objetivos (antes estaba
--  hardcodeada en el frontend). El `id` = número de nivel (1..5), así
--  coincide con lo que ya se guarda en hc_objetivo_avance.valor y
--  hc_objetivos.meta (no hace falta migrar datos). `orden` fija la
--  secuencia visual. Editable por si un centro quiere otras etiquetas.
--
--  El backend la crea/siembra sola (ensureNivelLogro); este script
--  queda para correrla a mano si se prefiere.
--  ✅ ADITIVO. Correr DESPUÉS de mysql-historias-clinicas.sql.
-- =========================================================
USE vaxa;
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS hc_nivel_logro (
  id     TINYINT     NOT NULL PRIMARY KEY,          -- 1..5 (coincide con valor/meta)
  codigo VARCHAR(20) NOT NULL UNIQUE,
  nombre VARCHAR(60) NOT NULL,
  orden  TINYINT     NOT NULL,
  activo TINYINT(1)  NOT NULL DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Escala de logro de objetivos (No lo hace → … → Lo aplica en su vida diaria)';

INSERT INTO hc_nivel_logro (id, codigo, nombre, orden) VALUES
  (1, 'NO_LO_HACE',  'No lo hace',                  1),
  (2, 'CON_AYUDA',   'Con ayuda',                   2),
  (3, 'A_VECES',     'Lo hace solo a veces',        3),
  (4, 'SOLO',        'Lo hace solo',                4),
  (5, 'VIDA_DIARIA', 'Lo aplica en su vida diaria', 5)
ON DUPLICATE KEY UPDATE nombre = VALUES(nombre), orden = VALUES(orden);
