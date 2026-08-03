-- ────────────────────────────────────────────────────────────────
-- Modo "Diseño Personalizado (Lienzo)" para certificados.
--
-- Cuando una empresa contrata un diseño a medida (ej. el arte de FAP),
-- el fondo entregado por el cliente se dibuja a sangre completa y el
-- sistema solo estampa ENCIMA los campos dinámicos (nombre, calidad,
-- fecha, QR, texto de evento) en las coordenadas que el admin defina.
--
-- Esta columna guarda ese layout como JSON. Si es NULL, el certificado
-- se dibuja con el diseño por defecto de Vaxa (comportamiento actual).
-- ────────────────────────────────────────────────────────────────

ALTER TABLE configuraciones_certificado
  ADD COLUMN layout_personalizado TEXT NULL
  COMMENT 'JSON con el layout del modo lienzo (fondo del cliente + campos por coordenadas). NULL = diseño por defecto de Vaxa.'
  AFTER texto_personalizado;
