-- =========================================================
--  Carga masiva por Excel SOLO en Profesional, Empresarial y Corporativo
--  ---------------------------------------------------------
--  El plan Básico NO incluye importación por Excel.
--  ✅ ADITIVO / idempotente. Correr una vez sobre la BD ya migrada:
--     mysql -u root -p vaxa < scripts/mysql-carga-masiva-por-plan.sql
-- =========================================================
USE vaxa;

-- Básico: sin carga masiva
UPDATE planes SET permite_carga_masiva = 0 WHERE slug = 'basico';

-- Profesional / Empresarial / Corporativo: con carga masiva
UPDATE planes SET permite_carga_masiva = 1
 WHERE slug IN ('profesional', 'empresarial', 'corporativo');
