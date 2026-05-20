import { pool, getEmpresaId } from '../shared/db.helper';
import { ProgramaEntity } from './programa.entity';
import type { CreateProgramaDto, UpdateProgramaDto } from './programa.dto';

export async function findAll(tenantSlug: string): Promise<ProgramaEntity[]> {
  const empresaId = await getEmpresaId(tenantSlug);
  const [rows] = await pool().query<any[]>(
    `SELECT p.*, tp.nombre AS tipo_programa_nombre
     FROM programas p
     JOIN tipos_programa tp ON tp.id = p.tipo_programa_id
     WHERE p.empresa_id = ? AND p.activo = 1
     ORDER BY p.created_at DESC`,
    [empresaId],
  );
  return (rows as any[]).map(ProgramaEntity.fromRow);
}

export async function findById(tenantSlug: string, id: number): Promise<ProgramaEntity | null> {
  const empresaId = await getEmpresaId(tenantSlug);
  const [rows] = await pool().query<any[]>(
    `SELECT p.*, tp.nombre AS tipo_programa_nombre
     FROM programas p
     JOIN tipos_programa tp ON tp.id = p.tipo_programa_id
     WHERE p.id = ? AND p.empresa_id = ? AND p.activo = 1`,
    [id, empresaId],
  );
  return rows[0] ? ProgramaEntity.fromRow(rows[0]) : null;
}

export async function create(tenantSlug: string, dto: CreateProgramaDto, userId?: number): Promise<ProgramaEntity> {
  const empresaId = await getEmpresaId(tenantSlug);
  const [result] = await pool().query<any>(
    `INSERT INTO programas (empresa_id, tipo_programa_id, nombre, descripcion, horas_academicas, user_crea_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [empresaId, dto.tipo_programa_id, dto.nombre, dto.descripcion ?? null, dto.horas_academicas, userId ?? null],
  );
  return (await findById(tenantSlug, result.insertId))!;
}

export async function update(tenantSlug: string, id: number, dto: UpdateProgramaDto, userId?: number): Promise<ProgramaEntity | null> {
  const empresaId = await getEmpresaId(tenantSlug);
  const fields: string[] = [];
  const values: any[] = [];
  if (dto.nombre           !== undefined) { fields.push('nombre = ?');           values.push(dto.nombre); }
  if (dto.descripcion      !== undefined) { fields.push('descripcion = ?');      values.push(dto.descripcion); }
  if (dto.horas_academicas !== undefined) { fields.push('horas_academicas = ?'); values.push(dto.horas_academicas); }
  if (dto.tipo_programa_id !== undefined) { fields.push('tipo_programa_id = ?'); values.push(dto.tipo_programa_id); }
  if (fields.length) {
    fields.push('user_actua_id = ?'); values.push(userId ?? null, id, empresaId);
    await pool().query(`UPDATE programas SET ${fields.join(', ')} WHERE id = ? AND empresa_id = ?`, values);
  }
  return findById(tenantSlug, id);
}
