import { pool, getEmpresaId } from '../shared/db.helper';
import { InscripcionEntity } from './inscripcion.entity';
import type { CreateInscripcionDto } from './inscripcion.dto';

export async function findAll(tenantSlug: string, grupoId?: number): Promise<InscripcionEntity[]> {
  const empresaId = await getEmpresaId(tenantSlug);
  const base = `
    SELECT i.*,
           CONCAT(p.nombres,' ',p.apellidos) AS participante_nombre,
           p.numero_documento, g.nombre_grupo,
           ei.nombre AS estado_nombre
    FROM inscripciones i
    JOIN participantes p       ON p.id  = i.participante_id
    JOIN grupos_programas g    ON g.id  = i.grupo_id
    JOIN estado_inscripcion ei ON ei.id = i.estado_id
    WHERE i.empresa_id = ?`;
  const [rows] = grupoId
    ? await pool().query<any[]>(`${base} AND i.grupo_id = ? ORDER BY p.apellidos`, [empresaId, grupoId])
    : await pool().query<any[]>(`${base} ORDER BY i.created_at DESC`, [empresaId]);
  return (rows as any[]).map(InscripcionEntity.fromRow);
}

export async function create(tenantSlug: string, dto: CreateInscripcionDto, userId?: number): Promise<InscripcionEntity> {
  const empresaId = await getEmpresaId(tenantSlug);
  const [result] = await pool().query<any>(
    `INSERT INTO inscripciones (empresa_id, participante_id, grupo_id, estado_id, fecha_inscripcion, user_crea_id)
     VALUES (?, ?, ?, 1, ?, ?)`,
    [empresaId, dto.participante_id, dto.grupo_id, dto.fecha_inscripcion, userId ?? null],
  );
  const [rows] = await pool().query<any[]>(
    `SELECT i.*, ei.nombre AS estado_nombre FROM inscripciones i
     JOIN estado_inscripcion ei ON ei.id = i.estado_id WHERE i.id = ?`,
    [result.insertId],
  );
  return InscripcionEntity.fromRow(rows[0]);
}

export async function cambiarEstado(tenantSlug: string, id: number, estadoId: number, userId?: number): Promise<InscripcionEntity | null> {
  const empresaId = await getEmpresaId(tenantSlug);
  const [upd] = await pool().query<any>(
    'UPDATE inscripciones SET estado_id = ?, user_actua_id = ? WHERE id = ? AND empresa_id = ?',
    [estadoId, userId ?? null, id, empresaId],
  );
  if (!upd.affectedRows) return null;
  const [rows] = await pool().query<any[]>(
    `SELECT i.*, CONCAT(p.nombres,' ',p.apellidos) AS participante_nombre,
            p.numero_documento, g.nombre_grupo, ei.nombre AS estado_nombre
     FROM inscripciones i
     JOIN participantes p       ON p.id  = i.participante_id
     JOIN grupos_programas g    ON g.id  = i.grupo_id
     JOIN estado_inscripcion ei ON ei.id = i.estado_id
     WHERE i.id = ?`,
    [id],
  );
  return rows[0] ? InscripcionEntity.fromRow(rows[0]) : null;
}
