-- =========================================================
--  FEATURE: Diseño personalizado (Lienzo) a partir del Plan Profesional
--  ---------------------------------------------------------
--  El editor de "Diseño personalizado (Lienzo)" se muestra según el flag
--  planes.permite_diseno (lo lee el frontend: estado.plan.permite_diseno).
--  El modelo vigente (scripts/mysql-modelo-creditos.sql) ya deja este flag
--  en 1 para Profesional / Empresarial / Corporativo. Este script es solo
--  por si tu BD de producción quedó con el seed viejo (mysql-planes.sql),
--  donde el Profesional tenía permite_diseno=0.
--
--  ✅ ADITIVO e idempotente: se puede correr las veces que haga falta.
--     mysql -u root -p vaxa < scripts/mysql-diseno-profesional.sql
-- =========================================================
USE vaxa;

-- Prende el diseño personalizado de Profesional para arriba (por orden de plan).
-- 'basico' (orden 1) queda intacto en 0.
UPDATE planes
   SET permite_diseno = 1
 WHERE slug IN ('profesional', 'avanzado', 'empresarial', 'corporativo');

-- Verificación rápida.
SELECT slug, nombre, orden, permite_diseno FROM planes ORDER BY orden;
