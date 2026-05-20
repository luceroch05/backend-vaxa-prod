import { pool, getEmpresaId } from '../shared/db.helper';
import { FirmaEntity } from './firma.entity';
import type { CreateFirmaDto } from './firma.dto';

export async function findAll(tenantSlug: string): Promise<FirmaEntity[]> {
  const empresaId = await getEmpresaId(tenantSlug);
  const [rows] = await pool().query<any[]>(
    'SELECT * FROM firmas WHERE empresa_id = ? AND activo = 1 ORDER BY created_at DESC',
    [empresaId],
  );
  return (rows as any[]).map(FirmaEntity.fromRow);
}

export async function create(tenantSlug: string, dto: CreateFirmaDto, userId?: number): Promise<FirmaEntity> {
  const empresaId = await getEmpresaId(tenantSlug);
  const [result] = await pool().query<any>(
    'INSERT INTO firmas (empresa_id, nombre_autoridad, cargo, imagen_firma, user_crea_id) VALUES (?, ?, ?, ?, ?)',
    [empresaId, dto.nombre_autoridad, dto.cargo, dto.imagen_firma, userId ?? null],
  );
  const [rows] = await pool().query<any[]>('SELECT * FROM firmas WHERE id = ?', [result.insertId]);
  return FirmaEntity.fromRow(rows[0]);
}

export async function remove(tenantSlug: string, id: number): Promise<boolean> {
  const empresaId = await getEmpresaId(tenantSlug);
  const [r] = await pool().query<any>('UPDATE firmas SET activo = 0 WHERE id = ? AND empresa_id = ?', [id, empresaId]);
  return r.affectedRows > 0;
}
