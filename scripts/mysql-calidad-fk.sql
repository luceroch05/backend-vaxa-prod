-- ============================================================================
--  Vínculo REAL inscripción ↔ catálogo de calidades (FK por id)
--  --------------------------------------------------------------------------
--  Agrega inscripciones.calidad_id → calidad_participacion(id). Se CONSERVA
--  inscripciones.calidad (texto) como espejo, así el PDF y los reportes que lo
--  leen siguen igual (riesgo cero). El id da el vínculo relacional de verdad,
--  igual que participante_id → participantes.
--
--  Correr UNA vez (el runner de node evita duplicar el ALTER si ya existe).
--    node -e "... mysql-calidad-fk.sql"  (ver sesión)
-- ============================================================================

-- 1) Columna + FK (el runner solo corre esto si la columna NO existe).
ALTER TABLE inscripciones
  ADD COLUMN calidad_id INT NULL AFTER calidad,
  ADD CONSTRAINT fk_insc_calidad FOREIGN KEY (calidad_id) REFERENCES calidad_participacion(id);

-- 2) Rellenar el id de las inscripciones existentes según su nombre de calidad
--    (dentro de la misma empresa). Idempotente: solo las que aún no lo tienen.
--    (COLLATE explícito: las 2 columnas pueden tener collation distinta.)
UPDATE inscripciones i
  JOIN calidad_participacion c
    ON c.empresa_id = i.empresa_id
   AND c.nombre COLLATE utf8mb4_unicode_ci = TRIM(i.calidad) COLLATE utf8mb4_unicode_ci
  SET i.calidad_id = c.id
 WHERE i.calidad_id IS NULL;
