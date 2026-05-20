import { pool, getEmpresaId } from '../shared/db.helper';
import { ParticipanteEntity } from './participante.entity';
import type { CreateParticipanteDto } from './participante.dto';

export async function findAll(tenantSlug: string): Promise<ParticipanteEntity[]> {
  const empresaId = await getEmpresaId(tenantSlug);
  const [rows] = await pool().query<any[]>(
    `SELECT p.*, td.codigo AS tipo_doc_codigo, td.nombre AS tipo_doc_nombre
     FROM participantes p
     JOIN tipos_documento td ON td.id = p.tipo_documento_id
     WHERE p.empresa_id = ? AND p.activo = 1
     ORDER BY p.apellidos, p.nombres`,
    [empresaId],
  );
  return (rows as any[]).map(ParticipanteEntity.fromRow);
}

export async function findById(tenantSlug: string, id: number): Promise<ParticipanteEntity | null> {
  const empresaId = await getEmpresaId(tenantSlug);
  const [rows] = await pool().query<any[]>(
    `SELECT p.*, td.codigo AS tipo_doc_codigo, td.nombre AS tipo_doc_nombre
     FROM participantes p
     JOIN tipos_documento td ON td.id = p.tipo_documento_id
     WHERE p.id = ? AND p.empresa_id = ?`,
    [id, empresaId],
  );
  return rows[0] ? ParticipanteEntity.fromRow(rows[0]) : null;
}

export async function create(tenantSlug: string, dto: CreateParticipanteDto, userId?: number): Promise<ParticipanteEntity> {
  const empresaId = await getEmpresaId(tenantSlug);
  const [result] = await pool().query<any>(
    `INSERT INTO participantes (empresa_id, tipo_documento_id, numero_documento, nombres, apellidos, email, telefono, user_crea_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [empresaId, dto.tipo_documento_id, dto.numero_documento, dto.nombres, dto.apellidos,
     dto.email ?? null, dto.telefono ?? null, userId ?? null],
  );
  return (await findById(tenantSlug, result.insertId))!;
}
