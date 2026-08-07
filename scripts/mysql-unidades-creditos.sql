-- ─────────────────────────────────────────────────────────────
-- Créditos por unidad (modo "Crédito" de la evaluación del programa)
-- Agrega la columna `creditos` a la tabla `unidades`.
-- Cada unidad del temario puede valer una cantidad distinta de créditos.
-- Solo se usa cuando el programa evalúa por "Crédito" (programas.unidad_label = 'Crédito'):
-- en ese modo NO se ponen notas, los créditos se otorgan por asistencia y el
-- acta muestra los créditos de cada unidad + el total.
-- Es multi-tenant (un solo ALTER cubre todas las empresas).
-- ─────────────────────────────────────────────────────────────

ALTER TABLE unidades
  ADD COLUMN creditos DECIMAL(5,2) NOT NULL DEFAULT 0 AFTER orden;
