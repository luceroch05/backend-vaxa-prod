-- =========================================================
--  LIMPIEZA: retiro del modelo de "créditos prepago"
--  ---------------------------------------------------------
--  ⚠️  SCRIPT DESTRUCTIVO. NO LO CORRAS hasta haber migrado el
--      CÓDIGO que todavía usa créditos. Si lo corres antes, la
--      emisión de certificados se ROMPE (busca columnas que ya no
--      existirán).
--
--  El nuevo modelo ya cubre lo que daba el viejo:
--    - Cada emisión queda registrada en la tabla `certificados`.
--    - El consumo/cupo del mes vive en `consumo_mensual`.
--    => `creditos_movimientos` y el saldo en `empresas` quedan obsoletos.
--
--  ───────────────────────────────────────────────────────────
--  CÓDIGO A MIGRAR ANTES DE CORRER ESTO
--  Backend (C:\...\backend-vaxa-prod\src):
--    [ ] modules/certificados/shared/creditos.repository.ts
--          -> Eliminar, o reescribir consumir()/devolver() para que
--             actualicen `consumo_mensual` en vez del saldo de créditos.
--    [ ] modules/certificados/shared/certificados.repository.ts
--          -> emisionRepo.generar(): quitar creditosRepo.consumir(); en su
--             lugar, validar cupo del plan y sumar en consumo_mensual.
--          -> emisionRepo.eliminar(): quitar creditosRepo.devolver().
--    [ ] modules/certificados/creditos/credito.controller.ts   (endpoints de saldo)
--    [ ] modules/admin/creditos.admin.routes.ts                (recargar saldo)
--    [ ] modules/admin/admin.repository.ts
--          -> listEmpresas()/updateEmpresa()/crearEmpresa(): quitar
--             creditos_disponibles / creditos_asignados_total del SELECT/INSERT.
--  Frontend (C:\...\frontend_vaxa_prod):
--    [ ] modules/extensions/certificaciones/shared/hooks/useCreditos.ts
--    [ ] modules/extensions/certificaciones/shared/api/creditos.api.ts
--    [ ] Componentes que muestran "saldo de créditos" (AdminCertificados, panel Vaxa).
--  ───────────────────────────────────────────────────────────
--
--  Uso (SOLO tras migrar el código):
--    mysql -u usuario -p vaxa < scripts/mysql-cleanup-creditos.sql
-- =========================================================
USE vaxa;
SET NAMES utf8mb4;

-- (Recomendado) Respaldar el historial antes de borrar:
-- CREATE TABLE creditos_movimientos_backup AS SELECT * FROM creditos_movimientos;

-- 1) Quitar el ledger de créditos.
DROP TABLE IF EXISTS creditos_movimientos;

-- 2) Quitar el saldo de créditos de la empresa.
ALTER TABLE empresas
  DROP COLUMN creditos_disponibles,
  DROP COLUMN creditos_asignados_total;

-- =========================================================
--  REVISAR (NO se borran aquí: requieren confirmación humana)
--  ---------------------------------------------------------
--  a) empresas_vaxa  (scripts/mysql-empresas.sql)
--     Tabla paralela de tenants (id VARCHAR) que usa el módulo
--     backoffice. Parece legado frente a `empresas` (id INT) +
--     tenants.config. Antes de borrarla, confirmar que backoffice
--     ya no se usa:
--       grep -r "getEmpresasFromDb\|empresas_vaxa" src
--     Si está muerto -> DROP TABLE empresas_vaxa;  (y borrar empresas.store.ts)
--
--  b) empresas.dominio  (columna única actual)
--     Reemplazada por la tabla `empresa_dominios` (multi-dominio).
--     Si migras admin.repository.ts para usar la tabla nueva, podrías:
--       ALTER TABLE empresas DROP COLUMN dominio;
--     Mientras tanto, déjala como "dominio principal".
-- =========================================================
