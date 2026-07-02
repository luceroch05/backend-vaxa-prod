import { getPool } from '../../../db/pool';
import { cuotasVencidas } from '../planes/mantenimiento.helper';

export function pool() {
  const p = getPool();
  if (!p) throw new Error('Base de datos no configurada');
  return p;
}

export async function getEmpresaId(tenantSlug: string): Promise<number> {
  const [rows] = await pool().query<any[]>(
    'SELECT id FROM empresas WHERE tenant_slug = ? AND activo = 1 LIMIT 1',
    [tenantSlug],
  );
  if (!rows.length) throw new Error(`Empresa no encontrada para tenant: ${tenantSlug}`);
  return rows[0].id as number;
}

/**
 * ¿La empresa está BLOQUEADA por falta de pago del mantenimiento?
 *
 * Regla de negocio de Leonardo (modelo "agua/luz"): NO se corta a la 1ra cuota
 * vencida, sino a la 2DA. Es decir, hay un ciclo de gracia: con 1 cuota pendiente
 * el cliente sigue usando (solo se le avisa); con 2 cuotas pendientes se corta.
 *
 * Traducción a fechas: `fecha_fin` marca hasta cuándo pagó. El corte entra cuando
 * ya pasó fecha_fin + UN ciclo completo más (meses_vigencia), o sea cuando la 2da
 * cuota también quedó impaga. Un plan cortado bloquea TODO: login, inscripción,
 * emisión y validación. Si no hay suscripción, NO bloquea por esta vía.
 */
export async function estaVencidaPorPago(empresaId: number): Promise<boolean> {
  const [rows] = await pool().query<any[]>(
    `SELECT s.fecha_inicio, s.fecha_fin, p.mantenimiento_mensual
       FROM empresa_suscripcion s
       JOIN planes p ON p.id = s.plan_id
      WHERE s.empresa_id = ? AND s.estado_id = 1
      ORDER BY s.id DESC LIMIT 1`,
    [empresaId],
  );
  if (!rows.length) return false;
  const s = rows[0];
  // Corte "agua/luz": 2 o más cuotas de mantenimiento de fin de mes vencidas e impagas.
  const vencidas = cuotasVencidas({
    fechaInicio: s.fecha_inicio,
    pagadoHasta: s.fecha_fin,
    mantenimientoMensual: Number(s.mantenimiento_mensual) || 0,
    hasta: new Date(),
  });
  return vencidas.length >= 2;
}

/** Mensaje único del bloqueo por falta de pago (para reusar en todos los puntos). */
export const MSG_VENCIDA = 'El servicio está suspendido por falta de pago (2 cuotas de mantenimiento vencidas). La institución debe regularizar el pago de las cuotas atrasadas con Vaxa para reactivarlo.';
