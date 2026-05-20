import { pool, getEmpresaId } from '../shared/db.helper';
import { LogoEntity } from './logo.entity';
import type { CreateLogoDto } from './logo.dto';

export async function findAll(tenantSlug: string): Promise<LogoEntity[]> {
  const empresaId = await getEmpresaId(tenantSlug);
  const [rows] = await pool().query<any[]>(
    'SELECT * FROM logos WHERE empresa_id = ? AND activo = 1 ORDER BY created_at DESC',
    [empresaId],
  );
  return (rows as any[]).map(LogoEntity.fromRow);
}

export async function create(tenantSlug: string, dto: CreateLogoDto, userId?: number): Promise<LogoEntity> {
  const empresaId = await getEmpresaId(tenantSlug);
  const [result] = await pool().query<any>(
    'INSERT INTO logos (empresa_id, nombre, imagen_logo, user_crea_id) VALUES (?, ?, ?, ?)',
    [empresaId, dto.nombre ?? null, dto.imagen_logo, userId ?? null],
  );
  const [rows] = await pool().query<any[]>('SELECT * FROM logos WHERE id = ?', [result.insertId]);
  return LogoEntity.fromRow(rows[0]);
}

export async function remove(tenantSlug: string, id: number): Promise<boolean> {
  const empresaId = await getEmpresaId(tenantSlug);
  const [r] = await pool().query<any>('UPDATE logos SET activo = 0 WHERE id = ? AND empresa_id = ?', [id, empresaId]);
  return r.affectedRows > 0;
}
