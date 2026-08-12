-- =========================================================
--  PLAN "Pago por certificado" (pago único por certificado emitido)
--  ---------------------------------------------------------
--  Modo sin mantenimiento ni ciclo: la empresa se crea normal (con su usuario,
--  que administra Vaxa), NO se le cobra mensualidad, y se cobra por cada
--  certificado emitido a un precio CONFIGURABLE POR CLIENTE. El certificado
--  queda validable de por vida. Emite sin bloqueo (creditos_incluidos = 0 =
--  ilimitado, igual que el Corporativo).
--
--  Son solo 2 cambios y NINGUNO duplica columnas existentes:
--    1) empresas.precio_certificado  -> NUEVA (no existe hoy). Precio por cliente.
--    2) fila nueva en `planes`        -> es un registro, no una columna.
--
--  ✅ ADITIVO. Correr UNA vez:
--     mysql -u USUARIO -p BASE < scripts/mysql-plan-pago-certificado.sql
-- =========================================================

-- 1) Precio por certificado, POR EMPRESA (default lo pones al crear la empresa).
--    NULL = la empresa no está en este modo (usa su plan normal).
ALTER TABLE empresas
  ADD COLUMN precio_certificado DECIMAL(10,2) NULL AFTER plan_actual_id;

-- 2) El plan aparece como una opción más al crear la empresa.
--    creditos_incluidos e implementacion/mantenimiento quedan en 0 por DEFAULT
--    (columnas del modelo de créditos) → emite sin tope y sin mensualidad.
INSERT INTO planes
  (slug, nombre, precio_mensual, limite_certificados_mes, precio_certificado_adicional, setup_inicial,
   permite_diseno, permite_subdominio, permite_api, permite_carga_masiva, permite_metricas, permite_auditoria, muestra_pdf_publico, orden)
VALUES
  ('pago_certificado', 'Pago por certificado', 0.00, 0, 0.00, 0.00,
   1, 0, 0, 1, 0, 0, 1, 5)
ON DUPLICATE KEY UPDATE
  nombre = VALUES(nombre),
  precio_mensual = VALUES(precio_mensual),
  permite_diseno = VALUES(permite_diseno),
  permite_carga_masiva = VALUES(permite_carga_masiva),
  muestra_pdf_publico = VALUES(muestra_pdf_publico);
