-- =========================================================
--  FEATURE: Créditos de certificados (bolsa prepaga por empresa)
--  - Saldo recargable por empresa: emitir -1, eliminar +1, recargar +N.
--  - Anular NO toca el saldo (solo desactiva el certificado).
--  - Ledger de movimientos para auditoría/seguimiento desde Vaxa.
-- =========================================================
USE vaxa;
SET NAMES utf8mb4;

-- 1) Saldo de créditos en la empresa.
ALTER TABLE `empresas`
  ADD COLUMN `creditos_disponibles`     INT NOT NULL DEFAULT 0 AFTER `tenant_slug`,
  ADD COLUMN `creditos_asignados_total` INT NOT NULL DEFAULT 0 AFTER `creditos_disponibles`;

-- 2) Movimientos de crédito (ledger). Cada fila explica un cambio de saldo.
--    `cantidad` es con signo (+ entra, - sale). `saldo_resultante` = saldo tras el movimiento.
CREATE TABLE `creditos_movimientos` (
  `id`               INT          NOT NULL AUTO_INCREMENT,
  `empresa_id`       INT          NOT NULL,
  `tipo`             ENUM('asignacion','recarga','consumo','devolucion','ajuste') NOT NULL,
  `cantidad`         INT          NOT NULL,
  `saldo_resultante` INT          NOT NULL,
  `certificado_id`   INT          DEFAULT NULL,
  `descripcion`      VARCHAR(200) DEFAULT NULL,
  `user_crea_id`     INT          DEFAULT NULL,
  `created_at`       DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `idx_mov_empresa` (`empresa_id`, `created_at`),
  FOREIGN KEY (`empresa_id`)   REFERENCES `empresas` (`id`),
  FOREIGN KEY (`user_crea_id`) REFERENCES `usuarios` (`id`)
  -- Nota: NO hay FK a certificados porque al ELIMINAR el cert el movimiento debe sobrevivir.
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3) Seed de arranque: dar 100 créditos a la empresa de pruebas (vaxa = empresa_id 1).
UPDATE `empresas`
   SET `creditos_disponibles` = 100, `creditos_asignados_total` = 100
 WHERE `id` = 1;

INSERT INTO `creditos_movimientos` (`empresa_id`, `tipo`, `cantidad`, `saldo_resultante`, `descripcion`)
SELECT 1, 'asignacion', 100, 100, 'Asignación inicial de prueba'
 WHERE EXISTS (SELECT 1 FROM `empresas` WHERE `id` = 1);
