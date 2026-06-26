-- ============================================================
-- Logo DEFAULT obligatorio por plan (Básico / Profesional)
-- ------------------------------------------------------------
-- El logo que Vaxa sube al registrar la empresa (empresas.logo_url, base64) se
-- materializa como una fila en `logos` con es_default=1. Para los planes
-- Básico/Profesional ese logo es OBLIGATORIO en los certificados: el cliente no
-- lo puede eliminar ni deseleccionar (sí reordenar y agregar otros).
--
-- ADITIVO: solo agrega una columna. Correr una vez.
-- ============================================================

ALTER TABLE logos
  ADD COLUMN es_default TINYINT(1) NOT NULL DEFAULT 0 AFTER imagen_logo;
