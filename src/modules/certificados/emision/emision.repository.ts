import { pool, getEmpresaId } from '../shared/db.helper';
import { CertificadoEntity, CertificadoPublicoEntity } from './emision.entity';

function generarCodigo(empresaId: number): string {
  const ts  = Date.now().toString(36).toUpperCase();
  const rnd = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `CERT-${empresaId}-${ts}-${rnd}`;
}

export async function findAll(tenantSlug: string): Promise<CertificadoEntity[]> {
  const empresaId = await getEmpresaId(tenantSlug);
  const [rows] = await pool().query<any[]>(
    `SELECT c.*,
            CONCAT(p.nombres,' ',p.apellidos) AS participante_nombre,
            p.numero_documento, prog.nombre AS programa_nombre,
            g.nombre_grupo, ec.nombre AS estado_nombre
     FROM certificados c
     JOIN inscripciones i    ON i.id  = c.inscripcion_id
     JOIN participantes p    ON p.id  = i.participante_id
     JOIN grupos_programas g ON g.id  = i.grupo_id
     JOIN programas prog     ON prog.id = g.programa_id
     JOIN estado_certificado ec ON ec.id = c.estado_id
     WHERE c.empresa_id = ?
     ORDER BY c.created_at DESC`,
    [empresaId],
  );
  return (rows as any[]).map(CertificadoEntity.fromRow);
}

export async function generar(tenantSlug: string, inscripcionId: number, userId?: number): Promise<CertificadoEntity> {
  const empresaId = await getEmpresaId(tenantSlug);

  const [insc] = await pool().query<any[]>(
    'SELECT * FROM inscripciones WHERE id = ? AND empresa_id = ? AND estado_id = 3',
    [inscripcionId, empresaId],
  );
  if (!insc.length) throw new Error('Inscripción no encontrada o el participante no está aprobado');

  const [dup] = await pool().query<any[]>(
    'SELECT id FROM certificados WHERE inscripcion_id = ? AND estado_id != 2',
    [inscripcionId],
  );
  if (dup.length) throw new Error('Ya existe un certificado vigente para esta inscripción');

  const [result] = await pool().query<any>(
    `INSERT INTO certificados (empresa_id, inscripcion_id, codigo_unico, fecha_emision, estado_id, user_crea_id)
     VALUES (?, ?, ?, ?, 1, ?)`,
    [empresaId, inscripcionId, generarCodigo(empresaId), new Date().toISOString().split('T')[0], userId ?? null],
  );
  const [rows] = await pool().query<any[]>('SELECT * FROM certificados WHERE id = ?', [result.insertId]);
  return CertificadoEntity.fromRow(rows[0]);
}

export async function validarPublico(codigoUnico: string): Promise<CertificadoPublicoEntity | null> {
  const [rows] = await pool().query<any[]>(
    `SELECT c.codigo_unico, c.fecha_emision, c.url,
            CONCAT(p.nombres,' ',p.apellidos) AS participante_nombre,
            p.numero_documento, td.codigo AS tipo_doc,
            prog.nombre AS programa_nombre, prog.horas_academicas,
            g.nombre_grupo, g.fecha_inicio, g.fecha_fin,
            m.nombre AS modalidad, ec.nombre AS estado,
            e.razon_social AS empresa_nombre, e.logo_url AS empresa_logo
     FROM certificados c
     JOIN inscripciones i    ON i.id  = c.inscripcion_id
     JOIN participantes p    ON p.id  = i.participante_id
     JOIN tipos_documento td ON td.id = p.tipo_documento_id
     JOIN grupos_programas g ON g.id  = i.grupo_id
     JOIN programas prog     ON prog.id = g.programa_id
     JOIN modalidades m      ON m.id  = g.modalidad_id
     JOIN estado_certificado ec ON ec.id = c.estado_id
     JOIN empresas e         ON e.id  = c.empresa_id
     WHERE c.codigo_unico = ?`,
    [codigoUnico],
  );
  return rows[0] ? CertificadoPublicoEntity.fromRow(rows[0]) : null;
}

export async function anular(tenantSlug: string, id: number, userId?: number): Promise<boolean> {
  const empresaId = await getEmpresaId(tenantSlug);
  const [r] = await pool().query<any>(
    'UPDATE certificados SET estado_id = 2, user_actua_id = ? WHERE id = ? AND empresa_id = ?',
    [userId ?? null, id, empresaId],
  );
  return r.affectedRows > 0;
}
