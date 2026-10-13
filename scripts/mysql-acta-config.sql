-- ────────────────────────────────────────────────────────────────
-- Config del ACTA (2ª hoja) por programa/grupo
-- ────────────────────────────────────────────────────────────────
-- JSON con qué datos muestra el acta, su título y un texto extra:
--   { "titulo": "...", "mostrarDocumento": true, "mostrarGrupo": true,
--     "mostrarPeriodo": true, "mostrarQr": true, "textoExtra": "..." }
-- NULL = acta por defecto (muestra todo, título automático según el modo).
-- El backend la auto-crea igual (ensureActaConfig) si esta migración no corrió.
-- ────────────────────────────────────────────────────────────────

ALTER TABLE configuraciones_certificado
  ADD COLUMN acta_config TEXT NULL AFTER layout_personalizado;
