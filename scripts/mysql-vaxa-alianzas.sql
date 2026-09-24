-- ─────────────────────────────────────────────────────────────────────────────
-- Alianzas / convenios de la landing pública de Vaxa
-- ─────────────────────────────────────────────────────────────────────────────
-- Logos de aliados que se muestran en la página principal de Vaxa, editables
-- desde sistemas-vaxa (pestaña "Landing de Vaxa" → "Alianzas").
--
-- NOTA: el backend crea esta tabla solo (ensureVaxaAlianzas en admin.repository.ts),
-- así que este script es OPCIONAL / de referencia. Correrlo a mano no hace daño
-- (es idempotente con CREATE TABLE IF NOT EXISTS).
--
-- El logo se guarda como ARCHIVO en /uploads/vaxa (la columna logo_url solo
-- almacena la ruta, ej. "/uploads/vaxa/ab12...png"; nunca base64).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS vaxa_alianzas (
  id       INT AUTO_INCREMENT PRIMARY KEY,
  nombre   VARCHAR(200) NOT NULL,                 -- nombre del aliado
  logo_url VARCHAR(400) NULL,                      -- ruta al archivo del logo (/uploads/vaxa/...)
  link     VARCHAR(400) NULL,                      -- sitio web del aliado (opcional)
  orden    INT          NOT NULL DEFAULT 0,        -- orden de aparición
  activo   TINYINT(1)   NOT NULL DEFAULT 1,        -- 1 = visible en la landing
  creado   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
