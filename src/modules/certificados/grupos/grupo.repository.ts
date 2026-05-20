import { pool, getEmpresaId } from '../shared/db.helper';
import { GrupoEntity } from './grupo.entity';
import type { CreateGrupoDto } from './grupo.dto';

export async function findAll(tenantSlug: string): Promise<GrupoEntity[]> {
  const empresaId = await getEmpresaId(tenantSlug);
  const [rows] = await pool().query<any[]>(
    `SELECT g.*, p.nombre AS programa_nombre, m.nombre AS modalidad_nombre
     FROM grupos_programas g
     JOIN programas p   ON p.id = g.programa_id
     JOIN modalidades m ON m.id = g.modalidad_id
     WHERE g.empresa_id = ? AND g.activo = 1
     ORDER BY g.fecha_inicio DESC`,
    [empresaId],
  );
  return (rows as any[]).map(GrupoEntity.fromRow);
}

export async function findById(tenantSlug: string, id: number): Promise<GrupoEntity | null> {
  const empresaId = await getEmpresaId(tenantSlug);
  const [rows] = await pool().query<any[]>(
    `SELECT g.*, p.nombre AS programa_nombre, m.nombre AS modalidad_nombre
     FROM grupos_programas g
     JOIN programas p   ON p.id = g.programa_id
     JOIN modalidades m ON m.id = g.modalidad_id
     WHERE g.id = ? AND g.empresa_id = ?`,
    [id, empresaId],
  );
  return rows[0] ? GrupoEntity.fromRow(rows[0]) : null;
}

export async function create(tenantSlug: string, dto: CreateGrupoDto, userId?: number): Promise<GrupoEntity> {
  const empresaId = await getEmpresaId(tenantSlug);
  const [result] = await pool().query<any>(
    `INSERT INTO grupos_programas (empresa_id, programa_id, nombre_grupo, fecha_inicio, fecha_fin, modalidad_id, user_crea_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [empresaId, dto.programa_id, dto.nombre_grupo, dto.fecha_inicio, dto.fecha_fin, dto.modalidad_id, userId ?? null],
  );
  return (await findById(tenantSlug, result.insertId))!;
}
