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
export interface Tarifario {
  paquetes: TarifaPaquete[];
  tramos: TarifaTramo[];
  parametros: Record<string, number>;
}

/** Tramos del crédito suelto (idénticos a plan.repository.recargarCupo). */
const TRAMOS_CREDITO: TarifaTramo[] = [
  { desde: 1, hasta: 49, precio: 3.00 },
  { desde: 50, hasta: 99, precio: 2.85 },
];

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
    };
  },
};
