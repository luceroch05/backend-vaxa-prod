import { getPool } from '../../db/pool';
import { AppError } from '../../shared/errors';

/**
 * Repositorio de REPORTES gerenciales de Historias Clínicas.
 * Solo LEE (agrega) sobre las tablas clínicas y de finanzas; no muta nada.
 * Aislado del resto para no mezclar responsabilidades. Todo scoped por empresa_id.
 * Acceso: ADMINISTRADOR y ADMISION (ver historias.reportes.routes.ts).
 */

function pool() {
  const p = getPool();
  if (!p) throw new Error('Base de datos no configurada');
  return p;
}

/** tenant_slug -> empresa_id (mismo criterio que el resto del sistema). */
async function getEmpresaId(tenantSlug: string): Promise<number> {
  const [rows] = await pool().query<any[]>(
    'SELECT id FROM empresas WHERE tenant_slug = ? AND activo = 1 LIMIT 1',
    [tenantSlug],
  );
  if (!rows.length) throw new AppError('Empresa no encontrada', 404);
  return rows[0].id as number;
}

/** Corre una query que puede tocar tablas aún no creadas (finanzas sin migrar).
 *  Si la tabla no existe, devuelve el fallback en vez de romper todo el reporte. */
async function seguro<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try { return await fn(); }
  catch (e: any) {
    if (e?.code === 'ER_NO_SUCH_TABLE' || e?.errno === 1146) return fallback;
    throw e;
  }
}

const num = (v: any): number => Number(v ?? 0);

export interface ReportesRango { desde?: string; hasta?: string }

export interface ReporteServicio {
  servicio_id: number;
  nombre: string;
  pacientes: number;   // pacientes distintos con cita de ese servicio en el rango
  citas: number;       // citas agendadas del servicio
  sesiones: number;    // sesiones (evoluciones) del servicio
  ingresos: number;    // S/ facturado por el servicio (ventas emitidas)
}
export interface ReportesData {
  rango: { desde: string; hasta: string };
  resumen: {
    pacientes_activos: number;
    pacientes_nuevos: number;
    sesiones: number;
    citas: number;
    ingresos_servicios: number;
    servicio_top: string | null;
  };
  servicios: ReporteServicio[];
  pacientes_por_sexo: { sexo: string; total: number }[];
  pacientes_por_mes: { mes: string; total: number }[];
  citas_por_estado: { estado: string; total: number }[];
}

export const reportesRepo = {
  /** Todos los indicadores del panel de reportes en una sola llamada. */
  async resumen(tenantSlug: string, rango: ReportesRango): Promise<ReportesData> {
    const empresaId = await getEmpresaId(tenantSlug);

    // Rango por defecto: mes actual. Se normaliza a límites del día para columnas DATETIME.
    const hoy = new Date();
    const desde = rango.desde || `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-01`;
    const hasta = rango.hasta || new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0).toISOString().slice(0, 10);
    const desdeIni = `${desde} 00:00:00`;
    const hastaFin = `${hasta} 23:59:59`;

    // ── Servicios: demanda (citas + pacientes distintos), sesiones e ingresos ──────
    const servicios = await seguro(async () => {
      const [rows] = await pool().query<any[]>(
        `SELECT s.id AS servicio_id, s.nombre,
                COALESCE(ct.pacientes, 0) AS pacientes,
                COALESCE(ct.citas, 0)     AS citas,
                COALESCE(se.sesiones, 0)  AS sesiones,
                COALESCE(vi.ingresos, 0)  AS ingresos
           FROM hc_servicios s
           LEFT JOIN (
             SELECT servicio_id, COUNT(DISTINCT paciente_id) AS pacientes, COUNT(*) AS citas
               FROM hc_citas
              WHERE empresa_id = ? AND servicio_id IS NOT NULL AND inicio BETWEEN ? AND ?
              GROUP BY servicio_id
           ) ct ON ct.servicio_id = s.id
           LEFT JOIN (
             SELECT servicio_id, COUNT(*) AS sesiones
               FROM hc_sesiones
              WHERE empresa_id = ? AND servicio_id IS NOT NULL AND fecha BETWEEN ? AND ?
              GROUP BY servicio_id
           ) se ON se.servicio_id = s.id
           LEFT JOIN (
             SELECT vi.servicio_id, SUM(vi.subtotal) AS ingresos
               FROM hc_venta_items vi
               JOIN hc_ventas v ON v.id = vi.venta_id
              WHERE vi.empresa_id = ? AND vi.tipo = 'servicio' AND vi.servicio_id IS NOT NULL
                AND v.estado = 'emitida' AND v.fecha BETWEEN ? AND ?
              GROUP BY vi.servicio_id
           ) vi ON vi.servicio_id = s.id
          WHERE s.empresa_id = ?
          ORDER BY pacientes DESC, citas DESC, sesiones DESC, s.nombre ASC`,
        [empresaId, desdeIni, hastaFin, empresaId, desdeIni, hastaFin, empresaId, desdeIni, hastaFin, empresaId],
      );
      return rows.map((r): ReporteServicio => ({
        servicio_id: r.servicio_id,
        nombre: r.nombre,
        pacientes: num(r.pacientes),
        citas: num(r.citas),
        sesiones: num(r.sesiones),
        ingresos: num(r.ingresos),
      }));
    }, [] as ReporteServicio[]);

    // ── Resumen (KPIs) ─────────────────────────────────────────────────────────
    const [[pac]] = await pool().query<any[]>(
      `SELECT
         (SELECT COUNT(*) FROM hc_pacientes WHERE empresa_id = ? AND activo = 1) AS activos,
         (SELECT COUNT(*) FROM hc_pacientes WHERE empresa_id = ? AND created_at BETWEEN ? AND ?) AS nuevos`,
      [empresaId, empresaId, desdeIni, hastaFin],
    ) as any;

    const [[ses]] = await pool().query<any[]>(
      `SELECT COUNT(*) AS n FROM hc_sesiones WHERE empresa_id = ? AND fecha BETWEEN ? AND ?`,
      [empresaId, desdeIni, hastaFin],
    ) as any;

    const [[cit]] = await pool().query<any[]>(
      `SELECT COUNT(*) AS n FROM hc_citas WHERE empresa_id = ? AND inicio BETWEEN ? AND ?`,
      [empresaId, desdeIni, hastaFin],
    ) as any;

    const ingresosServicios = servicios.reduce((a, s) => a + s.ingresos, 0);
    const servicioTop = servicios.find(s => s.pacientes > 0 || s.citas > 0)?.nombre ?? null;

    // ── Pacientes por sexo (estado actual, activos) ──────────────────────────────
    const [porSexo] = await pool().query<any[]>(
      `SELECT COALESCE(sx.nombre, 'Sin especificar') AS sexo, COUNT(*) AS total
         FROM hc_pacientes p
         LEFT JOIN hc_sexo sx ON sx.id = p.sexo_id
        WHERE p.empresa_id = ? AND p.activo = 1
        GROUP BY sexo
        ORDER BY total DESC`,
      [empresaId],
    );

    // ── Pacientes nuevos por mes (dentro del rango) ──────────────────────────────
    const [porMes] = await pool().query<any[]>(
      `SELECT DATE_FORMAT(created_at, '%Y-%m') AS mes, COUNT(*) AS total
         FROM hc_pacientes
        WHERE empresa_id = ? AND created_at BETWEEN ? AND ?
        GROUP BY mes
        ORDER BY mes ASC`,
      [empresaId, desdeIni, hastaFin],
    );

    // ── Citas por estado (asistencia) ────────────────────────────────────────────
    const [porEstado] = await pool().query<any[]>(
      `SELECT COALESCE(e.nombre, 'Sin estado') AS estado, COUNT(*) AS total
         FROM hc_citas c
         LEFT JOIN hc_cita_estado e ON e.id = c.estado_id
        WHERE c.empresa_id = ? AND c.inicio BETWEEN ? AND ?
        GROUP BY estado
        ORDER BY total DESC`,
      [empresaId, desdeIni, hastaFin],
    );

    return {
      rango: { desde, hasta },
      resumen: {
        pacientes_activos: num(pac?.activos),
        pacientes_nuevos: num(pac?.nuevos),
        sesiones: num(ses?.n),
        citas: num(cit?.n),
        ingresos_servicios: ingresosServicios,
        servicio_top: servicioTop,
      },
      servicios,
      pacientes_por_sexo: porSexo.map(r => ({ sexo: r.sexo, total: num(r.total) })),
      pacientes_por_mes: porMes.map(r => ({ mes: r.mes, total: num(r.total) })),
      citas_por_estado: porEstado.map(r => ({ estado: r.estado, total: num(r.total) })),
    };
  },
};
