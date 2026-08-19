-- ============================================================================
--  VAXA · Web Pública editable por el cliente (módulo "Mi Web")
--  --------------------------------------------------------------------------
--  El DISEÑO/layout de la landing es a medida por cliente (código), pero el
--  CONTENIDO lo administra el propio cliente desde el panel. Aquí viven esas
--  6 cosas editables, todo aislado con el prefijo `web_` y scoped por
--  empresa_id (tenant), igual que el módulo `hc_` de historias clínicas.
--
--    · web_config    -> fila ÚNICA por empresa: hero + marca + redes + contacto
--    · web_servicios -> lista de servicios
--    · web_staff     -> lista de personal/equipo
--    · web_alianzas  -> lista de alianzas y convenios
--
--  Imágenes = RUTA en /uploads (no base64), como el resto del sistema.
--  Ejecutar UNA vez. Idempotente (IF NOT EXISTS).
--    mysql -u root -p vaxa < scripts/mysql-web-publica.sql
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) web_config  (1 fila por empresa: hero + marca + redes sociales + contacto)
--    Lo que es "único" del sitio va aquí. Las listas van en sus propias tablas.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS web_config (
  id                 INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id         INT          NOT NULL,
  -- Marca (el logo puede caer a empresas.logo_url si se deja NULL)
  logo_url           VARCHAR(500) DEFAULT NULL COMMENT 'Ruta en /uploads; si NULL usa empresas.logo_url',
  color_primario     VARCHAR(9)   DEFAULT NULL COMMENT 'Hex, ej: #0EA5A4',
  color_secundario   VARCHAR(9)   DEFAULT NULL COMMENT 'Hex, ej: #FF7A59',
  -- Hero (portada)
  hero_titulo        VARCHAR(200) DEFAULT NULL,
  hero_subtitulo     VARCHAR(400) DEFAULT NULL,
  hero_imagen        VARCHAR(500) DEFAULT NULL COMMENT 'Ruta en /uploads',
  hero_boton_texto   VARCHAR(60)  DEFAULT NULL,
  hero_boton_link    VARCHAR(300) DEFAULT NULL,
  -- Redes sociales (URLs completas; NULL = no se muestra)
  red_facebook       VARCHAR(300) DEFAULT NULL,
  red_instagram      VARCHAR(300) DEFAULT NULL,
  red_tiktok         VARCHAR(300) DEFAULT NULL,
  red_youtube        VARCHAR(300) DEFAULT NULL,
  red_linkedin       VARCHAR(300) DEFAULT NULL,
  red_whatsapp       VARCHAR(300) DEFAULT NULL COMMENT 'Número o link de WhatsApp',
  -- Datos de contacto
  contacto_direccion VARCHAR(255) DEFAULT NULL,
  contacto_telefono  VARCHAR(60)  DEFAULT NULL,
  contacto_telefono2 VARCHAR(60)  DEFAULT NULL,
  contacto_email     VARCHAR(160) DEFAULT NULL,
  contacto_horario   VARCHAR(200) DEFAULT NULL,
  contacto_mapa_url  VARCHAR(500) DEFAULT NULL COMMENT 'Embed/URL de Google Maps',
  -- Estado
  publicada          TINYINT(1)   NOT NULL DEFAULT 0 COMMENT '1 = web visible al público',
  user_actua_id      INT          DEFAULT NULL COMMENT 'Último usuario que la editó',
  created_at         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_webcfg_empresa FOREIGN KEY (empresa_id)    REFERENCES empresas(id) ON DELETE CASCADE,
  CONSTRAINT fk_webcfg_actua   FOREIGN KEY (user_actua_id) REFERENCES usuarios(id),
  -- 1 sola configuración por empresa (tenant).
  UNIQUE KEY uq_webcfg_empresa (empresa_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Config de la web pública por empresa: hero, marca, redes, contacto';

-- ----------------------------------------------------------------------------
-- 2) web_servicios  (lista de servicios que muestra la web; N por empresa)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS web_servicios (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id    INT          NOT NULL,
  titulo        VARCHAR(160) NOT NULL,
  descripcion   VARCHAR(600) DEFAULT NULL,
  icono         VARCHAR(60)  DEFAULT NULL COMMENT 'Emoji o nombre de ícono',
  imagen_url    VARCHAR(500) DEFAULT NULL COMMENT 'Ruta en /uploads (opcional)',
  orden         INT          NOT NULL DEFAULT 0 COMMENT 'Orden de aparición',
  activo        TINYINT(1)   NOT NULL DEFAULT 1,
  user_crea_id  INT          DEFAULT NULL,
  user_actua_id INT          DEFAULT NULL,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_webserv_empresa FOREIGN KEY (empresa_id)    REFERENCES empresas(id) ON DELETE CASCADE,
  CONSTRAINT fk_webserv_crea    FOREIGN KEY (user_crea_id)  REFERENCES usuarios(id),
  CONSTRAINT fk_webserv_actua   FOREIGN KEY (user_actua_id) REFERENCES usuarios(id),
  INDEX idx_webserv_empresa (empresa_id, orden)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Servicios mostrados en la web pública';

-- ----------------------------------------------------------------------------
-- 3) web_staff  (equipo/personal que muestra la web; N por empresa)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS web_staff (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id    INT          NOT NULL,
  nombre        VARCHAR(160) NOT NULL,
  cargo         VARCHAR(160) DEFAULT NULL COMMENT 'Cargo o especialidad',
  descripcion   VARCHAR(400) DEFAULT NULL,
  foto_url      VARCHAR(500) DEFAULT NULL COMMENT 'Ruta en /uploads',
  orden         INT          NOT NULL DEFAULT 0,
  activo        TINYINT(1)   NOT NULL DEFAULT 1,
  user_crea_id  INT          DEFAULT NULL,
  user_actua_id INT          DEFAULT NULL,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_webstaff_empresa FOREIGN KEY (empresa_id)    REFERENCES empresas(id) ON DELETE CASCADE,
  CONSTRAINT fk_webstaff_crea    FOREIGN KEY (user_crea_id)  REFERENCES usuarios(id),
  CONSTRAINT fk_webstaff_actua   FOREIGN KEY (user_actua_id) REFERENCES usuarios(id),
  INDEX idx_webstaff_empresa (empresa_id, orden)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Equipo/personal mostrado en la web pública';

-- ----------------------------------------------------------------------------
-- 4) web_alianzas  (alianzas y convenios; N por empresa)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS web_alianzas (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id    INT          NOT NULL,
  nombre        VARCHAR(160) NOT NULL,
  logo_url      VARCHAR(500) DEFAULT NULL COMMENT 'Ruta en /uploads',
  link          VARCHAR(300) DEFAULT NULL COMMENT 'Sitio del aliado (opcional)',
  orden         INT          NOT NULL DEFAULT 0,
  activo        TINYINT(1)   NOT NULL DEFAULT 1,
  user_crea_id  INT          DEFAULT NULL,
  user_actua_id INT          DEFAULT NULL,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_webali_empresa FOREIGN KEY (empresa_id)    REFERENCES empresas(id) ON DELETE CASCADE,
  CONSTRAINT fk_webali_crea    FOREIGN KEY (user_crea_id)  REFERENCES usuarios(id),
  CONSTRAINT fk_webali_actua   FOREIGN KEY (user_actua_id) REFERENCES usuarios(id),
  INDEX idx_webali_empresa (empresa_id, orden)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Alianzas y convenios mostrados en la web pública';

-- Verificación rápida
SELECT TABLE_NAME, TABLE_COMMENT FROM information_schema.TABLES
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME LIKE 'web\_%';
