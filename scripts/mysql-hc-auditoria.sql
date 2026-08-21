-- =========================================================
--  AUDITORÍA de Historias Clínicas (centros terapéuticos)
--  ---------------------------------------------------------
--  Bitácora de acciones sobre datos clínicos: quién, cuándo, qué
--  entidad y qué acción (crear/editar/eliminar/ver/asignar…).
--
--  A diferencia de la auditoría de certificados, esta NO se gatea
--  por plan: la historia clínica es DATO SENSIBLE (Ley 29733), así
--  que el registro va SIEMPRE. Aislada en su propia tabla `hc_*`.
--
--  El backend la crea sola (hcAuditoriaRepo.ensureTabla), pero este
--  script queda para correrla a mano si se prefiere:
--     mysql -u root -p vaxa < scripts/mysql-hc-auditoria.sql
--  ✅ ADITIVO. Correr DESPUÉS de mysql-historias-clinicas.sql.
-- =========================================================
USE vaxa;
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS hc_auditoria (
  id             BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
  empresa_id     INT          NOT NULL,
  usuario_id     INT          NULL,                 -- quién (nullable: el usuario puede borrarse)
  usuario_nombre VARCHAR(160) NULL,                 -- snapshot "Nombres Apellidos" (sobrevive borrados)
  usuario_rol    VARCHAR(60)  NULL,                 -- snapshot del rol en Historias Clínicas
  accion         VARCHAR(20)  NOT NULL,             -- crear|editar|eliminar|ver|asignar|revocar|adjuntar
  entidad        VARCHAR(30)  NOT NULL,             -- paciente|historia|diagnostico|objetivo|avance|sesion|tarea|tratamiento|servicio|cita|adjunto|acceso|asignacion
  entidad_id     INT          NULL,
  descripcion    VARCHAR(400) NOT NULL,             -- frase legible ya armada
  ip             VARCHAR(45)  NULL,
  created_at     DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  INDEX idx_hcaud_empresa_fecha   (empresa_id, created_at),
  INDEX idx_hcaud_empresa_entidad (empresa_id, entidad),
  INDEX idx_hcaud_empresa_accion  (empresa_id, accion),
  CONSTRAINT fk_hcaud_empresa FOREIGN KEY (empresa_id) REFERENCES empresas (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Bitácora de acciones sobre datos clínicos (siempre activa, Ley 29733)';
