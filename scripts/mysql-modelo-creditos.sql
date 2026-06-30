-- =========================================================
--  CAMBIO DE MODELO: Créditos + Mantenimiento + Implementación
--  ---------------------------------------------------------
--  Reemplaza el modelo de "cupo mensual" por:
--    • Implementación (pago único de activación)
--    • Mantenimiento mensual (recurrente, define funciones)
--    • Créditos incluidos al activar (acumulables, no vencen)
--    • Cada certificado consume 1 crédito; sin saldo → no emite
--    • Paquetes de créditos para recargar
--    • Límite de usuarios por plan
--
--  Reutiliza lo que YA existe: empresas.creditos_disponibles /
--  creditos_asignados_total y la tabla creditos_movimientos.
--
--  ✅ ADITIVO. Correr una vez.  mysql -u root -p vaxa < scripts/mysql-modelo-creditos.sql
-- =========================================================
USE vaxa;
SET NAMES utf8mb4;

-- ── A) Nuevas columnas en planes ──────────────────────────
ALTER TABLE planes
  ADD COLUMN implementacion        DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER nombre,
  ADD COLUMN mantenimiento_mensual DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER implementacion,
  ADD COLUMN creditos_incluidos    INT NOT NULL DEFAULT 0 AFTER mantenimiento_mensual,
  ADD COLUMN usuarios_incluidos    INT NOT NULL DEFAULT 1 AFTER creditos_incluidos;

-- ── B) Reconfigurar los 4 planes con el modelo nuevo ──────
--  precio_mensual se iguala al mantenimiento (lo recurrente que cobra cobranza)
--  setup_inicial se iguala a la implementación (el pago único)
--  limite_certificados_mes deja de usarse (la emisión ahora consume créditos)
UPDATE planes SET
  nombre='Plan Básico', implementacion=300, mantenimiento_mensual=30, creditos_incluidos=100, usuarios_incluidos=1,
  precio_mensual=30, setup_inicial=300, limite_certificados_mes=0,
  permite_carga_masiva=0, permite_diseno=0, permite_subdominio=0, permite_api=0, permite_metricas=0, permite_auditoria=0, muestra_pdf_publico=0
 WHERE slug='basico';

UPDATE planes SET
  nombre='Plan Profesional', implementacion=650, mantenimiento_mensual=50, creditos_incluidos=300, usuarios_incluidos=3,
  precio_mensual=50, setup_inicial=650, limite_certificados_mes=0,
  permite_carga_masiva=1, permite_diseno=1, permite_subdominio=0, permite_api=0, permite_metricas=1, permite_auditoria=1, muestra_pdf_publico=1
 WHERE slug='profesional';

UPDATE planes SET
  slug='empresarial', nombre='Plan Empresarial', implementacion=950, mantenimiento_mensual=80, creditos_incluidos=700, usuarios_incluidos=10,
  precio_mensual=80, setup_inicial=950, limite_certificados_mes=0,
  permite_carga_masiva=1, permite_diseno=1, permite_subdominio=1, permite_api=0, permite_metricas=1, permite_auditoria=1, muestra_pdf_publico=1
 WHERE slug='avanzado';

UPDATE planes SET
  nombre='Plan Corporativo', implementacion=1500, mantenimiento_mensual=150, creditos_incluidos=0, usuarios_incluidos=0,
  precio_mensual=150, setup_inicial=1500, limite_certificados_mes=0,
  permite_carga_masiva=1, permite_diseno=1, permite_subdominio=1, permite_api=1, permite_metricas=1, permite_auditoria=1, muestra_pdf_publico=1
 WHERE slug='corporativo';

-- ── C) Catálogo de paquetes de créditos (recarga) ─────────
CREATE TABLE IF NOT EXISTS creditos_paquetes (
  id        INT AUTO_INCREMENT PRIMARY KEY,
  nombre    VARCHAR(60)   NOT NULL,
  creditos  INT           NOT NULL,
  precio    DECIMAL(10,2) NOT NULL,          -- incluye IGV
  activo    TINYINT(1)    NOT NULL DEFAULT 1,
  orden     INT           NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Paquetes de créditos para recargar saldo';

INSERT INTO creditos_paquetes (nombre, creditos, precio, orden) VALUES
  ('Paquete Básico',      100,  270.00, 1),
  ('Paquete Profesional', 300,  750.00, 2),
  ('Paquete Empresarial', 700, 1500.00, 3)
ON DUPLICATE KEY UPDATE nombre = VALUES(nombre);

-- ── D) Parámetros de usuarios adicionales (config simple) ──
--  Activación única S/50 + mantenimiento S/5/mes por usuario extra.
CREATE TABLE IF NOT EXISTS parametros_facturacion (
  clave VARCHAR(40) PRIMARY KEY,
  valor DECIMAL(10,2) NOT NULL,
  nota  VARCHAR(120) NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Parámetros sueltos de cobro';

INSERT INTO parametros_facturacion (clave, valor, nota) VALUES
  ('usuario_extra_activacion', 50.00, 'Pago único por usuario adicional'),
  ('usuario_extra_mensual',     5.00, 'Mantenimiento mensual por usuario adicional')
ON DUPLICATE KEY UPDATE valor = VALUES(valor);

-- ── E) Asegurar columnas de saldo en empresas (ya existen, por si acaso) ──
--  (creditos_disponibles, creditos_asignados_total ya están en la tabla)
