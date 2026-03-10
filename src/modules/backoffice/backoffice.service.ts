import { getPool } from '../../db/pool';
import { getEmpresasFromDb } from './empresas.store';
import { tenants } from '../../tenants/tenants.config';

export interface EmpresaListItem {
  id: string;
  name: string;
  activo: boolean;
  primary_color?: string | null;
  tiene_login?: boolean;
}

/**
 * Lista de empresas para el backoffice.
 * Si MySQL está configurado (MYSQL_DATABASE), lee de la tabla empresas_vaxa.
 * Si no, usa la config estática de tenants.
 */
export async function getEmpresasList(): Promise<EmpresaListItem[]> {
  const pool = getPool();
  if (pool) {
    const rows = await getEmpresasFromDb();
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      activo: r.activo === 1,
      primary_color: r.primary_color ?? undefined,
      tiene_login: r.tiene_login === 1,
    }));
  }
  return Object.values(tenants).map((t) => ({
    id: t.id,
    name: t.name,
    activo: t.activo ?? true,
  }));
}
