-- =========================================================
--  FEATURE: Unidades / Ciclos / Módulos + Notas
--  Escala 0-20, aprobación por promedio simple >= nota_minima
--  Etiqueta de la unidad configurable por programa
-- =========================================================
USE vaxa;
SET NAMES utf8mb4;

-- 1) El programa define: cómo se llaman sus unidades y la nota mínima de aprobación.
--    (Opt-in: un programa "tiene unidades" si existen filas en `unidades` para él.)
ALTER TABLE `programas`
  ADD COLUMN `unidad_label` VARCHAR(30)   NOT NULL DEFAULT 'Unidad'  AFTER `horas_academicas`,
  ADD COLUMN `nota_minima`  DECIMAL(4,2)  NOT NULL DEFAULT 11.00     AFTER `unidad_label`;

-- 2) Unidades (el "plan" del programa). El orden es solo para mostrar.
CREATE TABLE `unidades` (
  `id`            INT          NOT NULL AUTO_INCREMENT,
  `empresa_id`    INT          NOT NULL,
  `programa_id`   INT          NOT NULL,
  `nombre`        VARCHAR(120) NOT NULL,
  `orden`         INT          NOT NULL DEFAULT 1,
  `activo`        TINYINT      NOT NULL DEFAULT 1,
  `created_at`    DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at`    DATETIME(6)  DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  `user_crea_id`  INT          DEFAULT NULL,
  `user_actua_id` INT          DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_programa_unidad` (`programa_id`, `nombre`),
  FOREIGN KEY (`empresa_id`)    REFERENCES `empresas`  (`id`),
  FOREIGN KEY (`programa_id`)   REFERENCES `programas` (`id`) ON DELETE CASCADE,
  FOREIGN KEY (`user_crea_id`)  REFERENCES `usuarios`  (`id`),
  FOREIGN KEY (`user_actua_id`) REFERENCES `usuarios`  (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3) Notas: una nota por alumno (inscripción) por unidad.
CREATE TABLE `notas` (
  `id`             INT          NOT NULL AUTO_INCREMENT,
  `empresa_id`     INT          NOT NULL,
  `inscripcion_id` INT          NOT NULL,
  `unidad_id`      INT          NOT NULL,
  `nota`           DECIMAL(4,2) NOT NULL,
  `created_at`     DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at`     DATETIME(6)  DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  `user_crea_id`   INT          DEFAULT NULL,
  `user_actua_id`  INT          DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_inscripcion_unidad` (`inscripcion_id`, `unidad_id`),
  FOREIGN KEY (`empresa_id`)     REFERENCES `empresas`      (`id`),
  FOREIGN KEY (`inscripcion_id`) REFERENCES `inscripciones` (`id`) ON DELETE CASCADE,
  FOREIGN KEY (`unidad_id`)      REFERENCES `unidades`      (`id`) ON DELETE CASCADE,
  FOREIGN KEY (`user_crea_id`)   REFERENCES `usuarios`      (`id`),
  FOREIGN KEY (`user_actua_id`)  REFERENCES `usuarios`      (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
