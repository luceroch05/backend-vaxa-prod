-- ─────────────────────────────────────────────────────────────
-- Agrega "Congreso" y "Constancia" al catálogo global de tipos de programa.
-- Catálogo global (sin empresa_id). Idempotente: no duplica si ya existen.
-- ─────────────────────────────────────────────────────────────

INSERT INTO tipos_programa (nombre, descripcion, activo)
SELECT 'Congreso', 'Programa de capacitación tipo congreso', 1
WHERE NOT EXISTS (SELECT 1 FROM tipos_programa WHERE nombre = 'Congreso');

INSERT INTO tipos_programa (nombre, descripcion, activo)
SELECT 'Constancia', 'Programa de capacitación tipo constancia', 1
WHERE NOT EXISTS (SELECT 1 FROM tipos_programa WHERE nombre = 'Constancia');
