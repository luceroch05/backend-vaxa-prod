/**
 * Repositorio del tarifario. NO crea tablas nuevas: reutiliza las que ya
 * existen del modelo de créditos:
 *   • paquetes de créditos  → tabla `creditos_paquetes`
 *   • usuario extra / params → tabla `parametros_facturacion`
 * Los tramos de crédito suelto (1–49 → S/3.00, 50–99 → S/2.85) no tienen tabla:
 * viven en la lógica de `plan.repository.recargarCupo`, así que se devuelven aquí
 * como constante (misma fuente de verdad).
 * Los PLANES salen de `planes` (GET /api/admin/planes).
 */
import { pool } from '../certificados/shared/db.helper';

export interface TarifaPaquete { id: number; slug: string; planSlug: string | null; nombre: string; creditos: number; precio: number; }
export interface TarifaTramo   { desde: number; hasta: number; precio: number; }
export interface ServicioCatalogo { id: number; slug: string; grupo: string; nombre: string; precio: number; orden: number; }
export interface Tarifario {
  paquetes: TarifaPaquete[];
  tramos: TarifaTramo[];
  parametros: Record<string, number>;
  servicios: ServicioCatalogo[];
}

/** Tramos del crédito suelto (idénticos a plan.repository.recargarCupo). */
const TRAMOS_CREDITO: TarifaTramo[] = [
  { desde: 1, hasta: 49, precio: 3.00 },
  { desde: 50, hasta: 99, precio: 2.85 },
];

/** Mapea una fila de catalogo_servicios al DTO. */
const servicioFromRow = (s: any): ServicioCatalogo => ({
  id: s.id, slug: s.slug, grupo: s.grupo, nombre: s.nombre, precio: Number(s.precio), orden: Number(s.orden),
});

export const tarifarioRepo = {
  async get(): Promise<Tarifario> {
    const [paquetes] = await pool().query<any[]>(
      `SELECT id, nombre, creditos, precio
         FROM creditos_paquetes WHERE activo = 1 ORDER BY orden, creditos`,
    );
    const [params] = await pool().query<any[]>(
      'SELECT clave, valor FROM parametros_facturacion',
    );
    return {
      paquetes: paquetes.map((p) => ({
        id: p.id, slug: `pq${p.id}`, planSlug: null,
        nombre: p.nombre, creditos: Number(p.creditos), precio: Number(p.precio),
      })),
      tramos: TRAMOS_CREDITO,
      parametros: Object.fromEntries(params.map((p) => [p.clave, Number(p.valor)])),
      servicios: await tarifarioRepo.listServicios(),
    };
  },

  /** Servicios sueltos (web/dominios/hosting). Si la tabla aún no existe, [] (fallback al front). */
  async listServicios(): Promise<ServicioCatalogo[]> {
    try {
      const [rows] = await pool().query<any[]>(
        'SELECT id, slug, grupo, nombre, precio, orden FROM catalogo_servicios WHERE activo = 1 ORDER BY orden, id',
      );
      return rows.map(servicioFromRow);
    } catch {
      return [];   // migración catalogo_servicios aún no corrida
    }
  },

  async createServicio(input: { slug: string; grupo: string; nombre: string; precio: number; orden?: number }): Promise<ServicioCatalogo> {
    const slug = String(input.slug || '').trim().toUpperCase();
    const grupo = String(input.grupo || '').trim();
    const nombre = String(input.nombre || '').trim();
    const precio = Math.round((Number(input.precio) || 0) * 100) / 100;
    if (!slug || !grupo || !nombre) throw new Error('slug, grupo y nombre son obligatorios.');
    if (!(precio > 0)) throw new Error('El precio debe ser mayor a 0.');
    const [r] = await pool().query<any>(
      'INSERT INTO catalogo_servicios (slug, grupo, nombre, precio, orden) VALUES (?, ?, ?, ?, ?)',
      [slug, grupo, nombre, precio, Number(input.orden) || 0],
    );
    const [rows] = await pool().query<any[]>('SELECT id, slug, grupo, nombre, precio, orden FROM catalogo_servicios WHERE id = ?', [r.insertId]);
    return servicioFromRow(rows[0]);
  },

  async updateServicio(id: number, input: { grupo?: string; nombre?: string; precio?: number; orden?: number }): Promise<ServicioCatalogo> {
    const sets: string[] = []; const vals: any[] = [];
    if (input.grupo != null)  { sets.push('grupo = ?');  vals.push(String(input.grupo).trim()); }
    if (input.nombre != null) { sets.push('nombre = ?'); vals.push(String(input.nombre).trim()); }
    if (input.precio != null) {
      const precio = Math.round((Number(input.precio) || 0) * 100) / 100;
      if (!(precio > 0)) throw new Error('El precio debe ser mayor a 0.');
      sets.push('precio = ?'); vals.push(precio);
    }
    if (input.orden != null)  { sets.push('orden = ?');  vals.push(Number(input.orden) || 0); }
    if (!sets.length) throw new Error('Nada que actualizar.');
    vals.push(id);
    await pool().query(`UPDATE catalogo_servicios SET ${sets.join(', ')} WHERE id = ?`, vals);
    const [rows] = await pool().query<any[]>('SELECT id, slug, grupo, nombre, precio, orden FROM catalogo_servicios WHERE id = ?', [id]);
    if (!rows.length) throw new Error('Servicio no encontrado.');
    return servicioFromRow(rows[0]);
  },

  /** Baja lógica (activo = 0) para no romper referencias históricas. */
  async deleteServicio(id: number): Promise<void> {
    await pool().query('UPDATE catalogo_servicios SET activo = 0 WHERE id = ?', [id]);
  },
};
