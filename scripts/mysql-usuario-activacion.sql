-- ============================================================================
--  Cobro de usuarios adicionales — marca de "activación ya cobrada" (jul 2026)
--  --------------------------------------------------------------------------
--  ÚNICO cambio de esquema del feature "seguimiento de cobros".
--  NO crea tablas: reusa usuarios.created_at (prorrateo del 1er mes),
--  parametros_facturacion (S/50 y S/5), planes.usuarios_incluidos y
--  empresa_suscripcion (aniversario de la implementación).
--
--  usuarios.activacion_cobrada:
--    0 = usuario adicional al que aún NO se le cobró el pago único de S/50.
--    1 = ya se cobró (o es un usuario incluido en el plan / preexistente).
--
--  Correr UNA vez en producción.
--  (Nota: el backend también crea esta columna solo si falta; este script es
--   por si prefieres aplicarla a mano antes de desplegar.)
-- ============================================================================

-- 1) Agregar la columna.
ALTER TABLE usuarios
  ADD COLUMN activacion_cobrada TINYINT(1) NOT NULL DEFAULT 0 AFTER activo;

-- 2) Grandfather: a los usuarios que YA existían NO se les cobra activación.
UPDATE usuarios SET activacion_cobrada = 1;
