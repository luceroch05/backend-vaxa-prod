import { getPool } from '../../db/pool';

export interface EmpresaVaxaRow {
  id: string;
  name: string;
  primary_color: string | null;
  activo: number;
  tiene_login: number;
  created_at: Date;
  updated_at: Date;
}

/**
 * Lista de empresas desde la tabla empresas_vaxa.
 * Requiere MYSQL_DATABASE y tabla creada con scripts/mysql-empresas.sql.
 */
export async function getEmpresasFromDb(): Promise<EmpresaVaxaRow[]> {
  const pool = getPool();
  if (!pool) throw new Error('MySQL no configurado (MYSQL_DATABASE)');

  const [rows] = await pool.execute(
    'SELECT id, name, primary_color, activo, tiene_login, created_at, updated_at FROM empresas_vaxa ORDER BY id'
  );
  return (Array.isArray(rows) ? rows : []) as EmpresaVaxaRow[];
}
