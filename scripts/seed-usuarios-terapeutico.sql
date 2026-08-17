-- ============================================================================
--  SEED · Usuarios de prueba para Historias Clínicas (centro terapéutico)
--  --------------------------------------------------------------------------
--  Crea un centro demo, le habilita el producto y 3 usuarios (uno por rol),
--  todos con la MISMA contraseña de prueba: terapia123
--
--  Requisito: haber corrido antes scripts/mysql-historias-clinicas.sql
--  (crea el producto 'historias-clinicas' y el rol TERAPEUTA).
--
--  Ejecutar:  mysql -u root -p vaxa < scripts/seed-usuarios-terapeutico.sql
--
--  Login (front):  /centro-demo/terapeutico
--    admin@centro-demo.com      · terapia123   (ADMINISTRADOR)
--    admision@centro-demo.com   · terapia123   (ADMISION)
--    terapeuta@centro-demo.com  · terapia123   (TERAPEUTA)
-- ============================================================================

-- Hash bcrypt de 'terapia123' (bcryptjs, 10 rounds).
SET @hash := '$2b$10$fzNwGGX84QD9Z.Aj9qa8Q.vYBiSRHIVpNWa9h2q.s0MJQBAbVKume';

-- 1) Centro demo (empresa/tenant). Solo si no existe. -------------------------
INSERT INTO empresas (razon_social, tenant_slug, ruc, tipo_doc, activo, permite_diseno)
SELECT 'Centro Terapéutico Demo', 'centro-demo', NULL, '6', 1, 0
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM empresas WHERE tenant_slug = 'centro-demo');

SET @emp := (SELECT id FROM empresas WHERE tenant_slug = 'centro-demo' LIMIT 1);

-- 2) Habilitar el producto para el centro -------------------------------------
INSERT IGNORE INTO empresa_producto (empresa_id, producto_id)
SELECT @emp, id FROM productos WHERE slug = 'historias-clinicas';

-- 3) Roles (deben existir) ----------------------------------------------------
SET @rol_admin     := (SELECT id FROM roles WHERE nombre = 'ADMINISTRADOR' LIMIT 1);
SET @rol_admision  := (SELECT id FROM roles WHERE nombre = 'ADMISION'      LIMIT 1);
SET @rol_terapeuta := (SELECT id FROM roles WHERE nombre = 'TERAPEUTA'     LIMIT 1);

-- 4) Usuarios (uno por rol). Solo si no existe el correo en este centro. -------
INSERT INTO usuarios (empresa_id, nombres, apellidos, correo, contrasena, rol_id)
SELECT @emp, 'Admin', 'Demo', 'admin@centro-demo.com', @hash, @rol_admin
FROM DUAL
WHERE @emp IS NOT NULL AND @rol_admin IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM usuarios WHERE correo = 'admin@centro-demo.com' AND empresa_id = @emp);

INSERT INTO usuarios (empresa_id, nombres, apellidos, correo, contrasena, rol_id)
SELECT @emp, 'Admisión', 'Demo', 'admision@centro-demo.com', @hash, @rol_admision
FROM DUAL
WHERE @emp IS NOT NULL AND @rol_admision IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM usuarios WHERE correo = 'admision@centro-demo.com' AND empresa_id = @emp);

INSERT INTO usuarios (empresa_id, nombres, apellidos, correo, contrasena, rol_id)
SELECT @emp, 'Terapeuta', 'Demo', 'terapeuta@centro-demo.com', @hash, @rol_terapeuta
FROM DUAL
WHERE @emp IS NOT NULL AND @rol_terapeuta IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM usuarios WHERE correo = 'terapeuta@centro-demo.com' AND empresa_id = @emp);

-- 5) Dar acceso de cada usuario al producto con su rol ------------------------
INSERT IGNORE INTO usuario_producto (usuario_id, producto_id, rol_id)
SELECT u.id, p.id, u.rol_id
FROM usuarios u
CROSS JOIN productos p
WHERE u.empresa_id = @emp
  AND p.slug = 'historias-clinicas'
  AND u.correo IN ('admin@centro-demo.com', 'admision@centro-demo.com', 'terapeuta@centro-demo.com');

-- 6) Verificación -------------------------------------------------------------
SELECT u.correo, r.nombre AS rol, e.tenant_slug
FROM usuarios u
JOIN roles r    ON r.id = u.rol_id
JOIN empresas e ON e.id = u.empresa_id
WHERE e.tenant_slug = 'centro-demo'
ORDER BY u.id;
