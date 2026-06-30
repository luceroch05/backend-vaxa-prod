-- =========================================================
--  AUDITORÍA del sistema de certificados
--  ---------------------------------------------------------
--  Registra TODA acción del panel (crear/editar/eliminar/emitir/
--  anular/importar) + inicio de sesión, con: quién, cuándo, qué
--  entidad y el cambio específico (diffs en `detalle`).
--
--  Solo se registra para planes con permite_auditoria=1
--  (Profesional / Empresarial / Corporativo). El gating lo hace
--  el backend (auditoria.repository.registrar).
--
--  ✅ ADITIVO. Correr una vez:  mysql -u root -p vaxa < scripts/mysql-auditoria.sql
-- =========================================================
USE vaxa;
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS auditoria (
  id             BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
  empresa_id     INT          NOT NULL,
  usuario_id     INT          NULL,                 -- quién (nullable: el usuario puede borrarse)
  usuario_nombre VARCHAR(160) NULL,                 -- snapshot "Nombres Apellidos" (sobrevive borrados)
  usuario_rol    VARCHAR(60)  NULL,                 -- snapshot del rol
  accion         VARCHAR(20)  NOT NULL,             -- crear|editar|eliminar|emitir|anular|importar|login
  entidad        VARCHAR(30)  NOT NULL,             -- programa|aula|inscripcion|participante|nota|certificado|config|logo|firma|unidad|sesion
  entidad_id     INT          NULL,
  entidad_nombre VARCHAR(200) NULL,                 -- snapshot legible (ej. nombre del programa)
  descripcion    VARCHAR(400) NOT NULL,             -- frase específica ya armada
  detalle        JSON         NULL,                 -- diffs por campo: {campo:{antes,despues}}
  ip             VARCHAR(45)  NULL,
  created_at     DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  INDEX idx_aud_empresa_fecha  (empresa_id, created_at),
  INDEX idx_aud_empresa_entidad (empresa_id, entidad),
  INDEX idx_aud_empresa_accion  (empresa_id, accion),
  CONSTRAINT fk_aud_empresa FOREIGN KEY (empresa_id) REFERENCES empresas (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Bitácora de acciones del sistema de certificados (planes Profesional+)';

-- Auditoría disponible en Profesional, Empresarial y Corporativo; NO en Básico.
UPDATE planes SET permite_auditoria = 1 WHERE slug IN ('profesional', 'empresarial', 'corporativo');
UPDATE planes SET permite_auditoria = 0 WHERE slug = 'basico';
