import { pool, getEmpresaId } from '../shared/db.helper';
import { ConfigCertificadoEntity } from './config.entity';
import type { UpsertConfigDto } from './config.dto';

export async function findByPrograma(tenantSlug: string, programaId: number): Promise<ConfigCertificadoEntity | null> {
  const empresaId = await getEmpresaId(tenantSlug);
  const [rows] = await pool().query<any[]>(
    `SELECT cc.*,
            l.imagen_logo, l.nombre AS logo_nombre,
            f1.nombre_autoridad AS firma1_autoridad, f1.cargo AS firma1_cargo, f1.imagen_firma AS firma1_imagen,
            f2.nombre_autoridad AS firma2_autoridad, f2.cargo AS firma2_cargo, f2.imagen_firma AS firma2_imagen
     FROM configuraciones_certificado cc
     LEFT JOIN logos l   ON l.id  = cc.logo_id
     LEFT JOIN firmas f1 ON f1.id = cc.firma_1_id
     LEFT JOIN firmas f2 ON f2.id = cc.firma_2_id
     WHERE cc.empresa_id = ? AND cc.programa_id = ? AND cc.activo = 1`,
    [empresaId, programaId],
  );
  return rows[0] ? ConfigCertificadoEntity.fromRow(rows[0]) : null;
}

export async function upsert(tenantSlug: string, programaId: number, dto: UpsertConfigDto, userId?: number): Promise<ConfigCertificadoEntity> {
  const empresaId = await getEmpresaId(tenantSlug);
  await pool().query(
    `INSERT INTO configuraciones_certificado (empresa_id, programa_id, plantilla_url, firma_1_id, firma_2_id, logo_id, user_crea_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       plantilla_url = VALUES(plantilla_url),
       firma_1_id    = VALUES(firma_1_id),
       firma_2_id    = VALUES(firma_2_id),
       logo_id       = VALUES(logo_id),
       user_actua_id = ?`,
    [empresaId, programaId, dto.plantilla_url, dto.firma_1_id ?? null,
     dto.firma_2_id ?? null, dto.logo_id ?? null, userId ?? null, userId ?? null],
  );
  return (await findByPrograma(tenantSlug, programaId))!;
}
