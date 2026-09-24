-- ============================================================================
-- Testimonios de clientes para la landing pública de Vaxa
-- ----------------------------------------------------------------------------
-- Comentarios REALES de personas de empresas cliente. NO guarda foto de la
-- persona: se enlaza a una alianza (alianza_id) y reutiliza su logo.
-- La app también la crea sola (ensureVaxaTestimonios); este archivo es para
-- correrlo manualmente en producción si se prefiere.
-- ============================================================================

CREATE TABLE IF NOT EXISTS vaxa_testimonios (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  comentario   TEXT         NOT NULL,                 -- lo que dijo el cliente
  autor        VARCHAR(200) NOT NULL,                 -- nombre de la persona
  cargo        VARCHAR(200) NULL,                     -- puesto / rol (ej. "CEO")
  empresa      VARCHAR(200) NULL,                     -- nombre manual (fallback si no hay alianza)
  alianza_id   INT          NULL,                     -- reutiliza el logo de esta alianza
  calificacion TINYINT      NOT NULL DEFAULT 5,       -- estrellas 1..5
  orden        INT          NOT NULL DEFAULT 0,       -- orden de aparición
  activo       TINYINT(1)   NOT NULL DEFAULT 1,       -- 1 = se muestra en la landing
  creado       TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_testimonio_alianza
    FOREIGN KEY (alianza_id) REFERENCES vaxa_alianzas(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- (Opcional) Ejemplos de arranque -------------------------------------------
-- Reemplaza el alianza_id por el id real de la alianza (SELECT id, nombre FROM vaxa_alianzas;)
-- Si no enlazas alianza, usa la columna `empresa`.
--
-- INSERT INTO vaxa_testimonios (comentario, autor, cargo, empresa, alianza_id, calificacion, orden) VALUES
--   ('Vaxa nos permite emitir y validar nuestros certificados en segundos, con el respaldo del QR público.',
--    'Jesús Yactayo', 'CEO', 'Centro de Terapias Crecemos', NULL, 5, 1),
--   ('La plataforma es intuitiva, segura y se adapta a nuestras necesidades. El soporte siempre ha sido excelente.',
--    'Comité Organizador', NULL, 'SIEFO Perú', NULL, 5, 2);
