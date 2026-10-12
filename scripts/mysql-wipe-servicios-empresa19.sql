-- ============================================================================
--  VAXA · HC — BORRADO EN CASCADA de los servicios del tenant 19 (y lo que depende)
--  --------------------------------------------------------------------------
--  Elimina TODO lo que cuelga de los servicios para poder borrarlos:
--  citas, ventas (+items/pagos/caja/kardex), asignaciones, objetivos (+avances),
--  sesiones, paquetes (+líneas), terapeuta_servicio, motivos y servicios.
--  DEJA intactos: pacientes, historias, productos.
--  Acotado a empresa_id = 19. Transaccional: si algo falla, ROLLBACK.
--
--    mysql -u root -p vaxa < scripts/mysql-wipe-servicios-empresa19.sql
-- ============================================================================
SET @EMP := 19;

START TRANSACTION;
SET FOREIGN_KEY_CHECKS = 0;

-- Progreso clínico ligado a objetivos
DELETE FROM hc_objetivo_avance WHERE objetivo_id IN (SELECT id FROM hc_objetivos WHERE empresa_id = @EMP);
DELETE FROM hc_objetivos  WHERE empresa_id = @EMP;

-- Evoluciones/sesiones (adjuntos de sesión se desenganchan para no bloquear)
UPDATE hc_adjuntos SET sesion_id = NULL WHERE empresa_id = @EMP AND sesion_id IS NOT NULL;
DELETE FROM hc_sesiones WHERE empresa_id = @EMP;

-- Agenda
DELETE FROM hc_citas        WHERE empresa_id = @EMP;
DELETE FROM hc_asignaciones WHERE empresa_id = @EMP;

-- Finanzas (orden: hijos de la venta -> venta)
DELETE FROM hc_caja_mov      WHERE empresa_id = @EMP;
DELETE FROM hc_inventario_mov WHERE empresa_id = @EMP;
DELETE FROM hc_venta_pagos   WHERE empresa_id = @EMP;
DELETE FROM hc_venta_items   WHERE empresa_id = @EMP;
DELETE FROM hc_ventas        WHERE empresa_id = @EMP;

-- Catálogo que cuelga de los servicios
DELETE FROM hc_paquete_lineas     WHERE empresa_id = @EMP;
DELETE FROM hc_paquetes           WHERE empresa_id = @EMP;
DELETE FROM hc_terapeuta_servicio WHERE empresa_id = @EMP;
DELETE FROM hc_motivos            WHERE empresa_id = @EMP;

-- << Los servicios
DELETE FROM hc_servicios WHERE empresa_id = @EMP;

SET FOREIGN_KEY_CHECKS = 1;
COMMIT;

-- Verificación
SELECT 'servicios' t, COUNT(*) n FROM hc_servicios WHERE empresa_id = @EMP
UNION ALL SELECT 'motivos',   COUNT(*) FROM hc_motivos   WHERE empresa_id = @EMP
UNION ALL SELECT 'paquetes',  COUNT(*) FROM hc_paquetes  WHERE empresa_id = @EMP
UNION ALL SELECT 'citas',     COUNT(*) FROM hc_citas     WHERE empresa_id = @EMP
UNION ALL SELECT 'ventas',    COUNT(*) FROM hc_ventas    WHERE empresa_id = @EMP;
