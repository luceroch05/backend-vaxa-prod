-- ────────────────────────────────────────────────────────────────
-- Catálogo de GRADOS ACADÉMICOS extra por empresa
-- ────────────────────────────────────────────────────────────────
-- La lista base (Lic./Mag./Dr./Mg.…) vive en el frontend. Esta tabla guarda SOLO
-- los grados que el centro agrega al vuelo (ej. "MBA", "Esp.") para que los vean
-- TODOS los usuarios (no solo el navegador donde se agregaron).
-- El backend la auto-crea igual (ensureGradosCatalogo) si esta migración no corrió.
-- ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS grado_academico (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  nombre     VARCHAR(40) NOT NULL,
  activo     TINYINT(1) NOT NULL DEFAULT 1,
  orden      INT NOT NULL DEFAULT 0,
  UNIQUE KEY uq_grado_emp_nombre (empresa_id, nombre)
);
