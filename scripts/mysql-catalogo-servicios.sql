-- ============================================================
--  Catálogo de servicios sueltos (Desarrollo Web / Dominios / Hosting)
--  Antes vivían hardcodeados en el frontend (WEB_PLANES/DOMINIOS/HOSTING).
--  Ahora salen de la BD para poder editar precios sin re-deploy.
--  Los usan Cotizaciones y Facturación (mismo catálogo).
--  Idempotente: se puede correr varias veces sin duplicar.
-- ============================================================

CREATE TABLE IF NOT EXISTS catalogo_servicios (
  id     INT AUTO_INCREMENT PRIMARY KEY,
  slug   VARCHAR(40)   NOT NULL UNIQUE,        -- WEB-EMP, DOM-COM, HOST-NEG...
  grupo  VARCHAR(40)   NOT NULL,               -- 'Desarrollo Web' | 'Dominios' | 'Hosting'
  nombre VARCHAR(120)  NOT NULL,               -- etiqueta visible en el catálogo
  precio DECIMAL(10,2) NOT NULL,               -- incluye IGV
  activo TINYINT(1)    NOT NULL DEFAULT 1,
  orden  INT           NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Servicios de pago único/anual (web, dominios, hosting)';

-- Semilla con los valores actuales. ON DUPLICATE conserva el precio ya editado
-- (solo re-sincroniza nombre/grupo/orden si el slug ya existía).
INSERT INTO catalogo_servicios (slug, grupo, nombre, precio, orden) VALUES
  ('WEB-EMP',   'Desarrollo Web', 'Plan Emprendedor (desarrollo web)',                 300.00, 1),
  ('WEB-NEG',   'Desarrollo Web', 'Plan Negocios (desarrollo web)',                    500.00, 2),
  ('DOM-COM',   'Dominios',       'Dominio .com (anual)',                              120.00, 3),
  ('DOM-COMPE', 'Dominios',       'Dominio .com.pe (anual)',                           150.00, 4),
  ('DOM-PE',    'Dominios',       'Dominio .pe (anual)',                               150.00, 5),
  ('HOST-EMP',  'Hosting',        'Hosting Individual (Plan Emprendedor, anual)',      100.00, 6),
  ('HOST-NEG',  'Hosting',        'Hosting Business (Plan Negocios, anual)',           150.00, 7)
ON DUPLICATE KEY UPDATE nombre = VALUES(nombre), grupo = VALUES(grupo), orden = VALUES(orden);
