-- ─────────────────────────────────────────────────────────────────────────────
-- FIX: empresas de Historias Clínicas que no aparecen en su panel (salen en
-- Certificados como "legacy"). Causa: faltaba la fila 'historias-clinicas' en la
-- tabla `productos`, así que al registrarlas no se creó el vínculo empresa↔producto.
--
-- Idempotente y seguro de re-ejecutar. Correr en la BD de producción.
-- (Para que el PANEL de HC funcione de verdad, además hay que correr
--  mysql-historias-clinicas.sql y los demás mysql-hc-*.sql que crean las tablas.)
-- ─────────────────────────────────────────────────────────────────────────────

-- 1) Registrar el producto Historias Clínicas (si no existe).
INSERT INTO productos (slug, nombre, interno) VALUES ('historias-clinicas', 'Historias Clínicas', 0)
ON DUPLICATE KEY UPDATE nombre = VALUES(nombre);

-- 2) Ver qué empresas están "sueltas" (sin ningún producto vinculado). Son las que
--    quedaron mal registradas. Revisa esta lista y decide cuáles son de HC.
SELECT e.id, e.tenant_slug, e.razon_social
  FROM empresas e
  LEFT JOIN empresa_producto ep ON ep.empresa_id = e.id
 WHERE ep.empresa_id IS NULL;

-- 3) Vincular UNA empresa concreta a Historias Clínicas.
--    Cambia 'TU_SLUG' por el tenant_slug de la empresa (de la lista de arriba).
INSERT IGNORE INTO empresa_producto (empresa_id, producto_id)
SELECT e.id, p.id
  FROM empresas e
  JOIN productos p ON p.slug = 'historias-clinicas'
 WHERE e.tenant_slug = 'TU_SLUG';

-- 4) (Opcional) Verificar cómo quedó:
-- SELECT e.tenant_slug,
--        (SELECT GROUP_CONCAT(p.slug) FROM empresa_producto ep
--           JOIN productos p ON p.id = ep.producto_id
--          WHERE ep.empresa_id = e.id AND ep.activo = 1) AS productos
--   FROM empresas e WHERE e.tenant_slug = 'TU_SLUG';
