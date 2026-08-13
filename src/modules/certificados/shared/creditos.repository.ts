import type { PoolConnection } from 'mysql2/promise';
import { pool, getEmpresaId } from './db.helper';

export type MovimientoTipo = 'asignacion' | 'recarga' | 'consumo' | 'devolucion' | 'ajuste';

/** Error tipado para distinguir el caso "sin créditos" en los controllers. */
export class SinCreditosError extends Error {
  constructor(msg = 'SIN_CREDITOS: La empresa no tiene créditos disponibles para emitir certificados.') {
    super(msg);
    this.name = 'SinCreditosError';
  }
}

/**
 * Bloquea la fila de la empresa, valida que haya saldo, descuenta 1 y registra
 * el movimiento. DEBE ejecutarse dentro de una transacción (recibe la conexión)
 * para que el SELECT ... FOR UPDATE evite carreras entre emisiones simultáneas.
 */
async function consumir(conn: PoolConnection, empresaId: number, certId: number | null, userId?: number): Promise<number> {
  const [rows] = await conn.query<any[]>(
    'SELECT creditos_disponibles FROM empresas WHERE id = ? FOR UPDATE',
    [empresaId],
  );
  const saldo = (rows as any[])[0]?.creditos_disponibles ?? 0;
  if (saldo <= 0) throw new SinCreditosError();

  const nuevoSaldo = saldo - 1;
  await conn.query('UPDATE empresas SET creditos_disponibles = ? WHERE id = ?', [nuevoSaldo, empresaId]);
  await conn.query(
    `INSERT INTO creditos_movimientos (empresa_id, tipo, cantidad, saldo_resultante, certificado_id, descripcion, user_crea_id)
     VALUES (?, 'consumo', -1, ?, ?, ?, ?)`,
    [empresaId, nuevoSaldo, certId, 'Emisión de certificado', userId ?? null],
  );
  return nuevoSaldo;
}

/** Devuelve 1 crédito (al ELIMINAR un certificado). Dentro de transacción. */
async function devolver(conn: PoolConnection, empresaId: number, certId: number | null, userId?: number): Promise<number> {
  const [rows] = await conn.query<any[]>(
    'SELECT creditos_disponibles FROM empresas WHERE id = ? FOR UPDATE',
    [empresaId],
  );
  const saldo = (rows as any[])[0]?.creditos_disponibles ?? 0;
  const nuevoSaldo = saldo + 1;
  await conn.query('UPDATE empresas SET creditos_disponibles = ? WHERE id = ?', [nuevoSaldo, empresaId]);
  await conn.query(
    `INSERT INTO creditos_movimientos (empresa_id, tipo, cantidad, saldo_resultante, certificado_id, descripcion, user_crea_id)
     VALUES (?, 'devolucion', 1, ?, ?, ?, ?)`,
    [empresaId, nuevoSaldo, certId, 'Eliminación de certificado', userId ?? null],
  );
  return nuevoSaldo;
}

export const creditosRepo = {
  consumir,
  devolver,

  /** Saldo y total asignado de la empresa del tenant. */
  async getEstado(tenantSlug: string): Promise<{ saldo: number; asignados_total: number }> {
    const empresaId = await getEmpresaId(tenantSlug);
    const [rows] = await pool().query<any[]>(
      'SELECT creditos_disponibles, creditos_asignados_total FROM empresas WHERE id = ?',
      [empresaId],
    );
    const r = (rows as any[])[0] ?? {};
    return { saldo: r.creditos_disponibles ?? 0, asignados_total: r.creditos_asignados_total ?? 0 };
  },

  /** Historial de movimientos (más recientes primero). */
  async listMovimientos(tenantSlug: string, limit = 100) {
    const empresaId = await getEmpresaId(tenantSlug);
    return creditosRepo.listMovimientosByEmpresaId(empresaId, limit);
  },

  /** [Admin Vaxa] Historial por id de empresa. */
  async listMovimientosByEmpresaId(empresaId: number, limit = 100) {
    const [rows] = await pool().query<any[]>(
      `SELECT id, tipo, cantidad, saldo_resultante, certificado_id, descripcion, created_at
       FROM creditos_movimientos WHERE empresa_id = ?
       ORDER BY id DESC LIMIT ?`,
      [empresaId, Number(limit)],
    );
    return rows;
  },

  /** [Admin Vaxa] Todas las empresas con su saldo y consumo. */
  async listEmpresas() {
    const [rows] = await pool().query<any[]>(
      `SELECT e.id, e.razon_social, e.tenant_slug,
              e.creditos_disponibles, e.creditos_asignados_total,
              (e.creditos_asignados_total - e.creditos_disponibles) AS creditos_consumidos,
              (p.id IS NOT NULL AND p.creditos_incluidos = 0 AND p.slug <> 'pago_certificado') AS ilimitado
       FROM empresas e
       LEFT JOIN planes p ON p.id = e.plan_actual_id
       WHERE e.activo = 1 ORDER BY e.razon_social`,
    );
    return (rows as any[]).map(r => ({ ...r, ilimitado: !!r.ilimitado }));
  },

  /**
   * Recarga/asigna créditos a una empresa (acción de Vaxa). Suma al saldo y al
   * total asignado. Usa su propia transacción.
   */
  async recargar(empresaId: number, cantidad: number, userId?: number, descripcion?: string, tipo: MovimientoTipo = 'recarga') {
    if (!Number.isInteger(cantidad) || cantidad <= 0) throw new Error('La cantidad debe ser un entero positivo');
    const conn = await pool().getConnection();
    try {
      await conn.beginTransaction();
      const [rows] = await conn.query<any[]>(
        'SELECT creditos_disponibles FROM empresas WHERE id = ? FOR UPDATE',
        [empresaId],
      );
      if (!(rows as any[]).length) throw new Error('Empresa no encontrada');
      const nuevoSaldo = ((rows as any[])[0].creditos_disponibles ?? 0) + cantidad;
      await conn.query(
        'UPDATE empresas SET creditos_disponibles = ?, creditos_asignados_total = creditos_asignados_total + ? WHERE id = ?',
        [nuevoSaldo, cantidad, empresaId],
      );
      await conn.query(
        `INSERT INTO creditos_movimientos (empresa_id, tipo, cantidad, saldo_resultante, descripcion, user_crea_id)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [empresaId, tipo, cantidad, nuevoSaldo, descripcion ?? null, userId ?? null],
      );
      await conn.commit();
      return nuevoSaldo;
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  },

  /**
   * Ajuste manual de créditos (acción de Vaxa). Acepta un delta con signo:
   * negativo = QUITAR créditos (p. ej. se asignaron de más por error), positivo
   * = corregir sumando. Mueve saldo y total asignado en la misma cantidad para
   * no distorsionar el "consumido" (= asignado − disponible). No permite dejar
   * el saldo en negativo: solo se puede quitar hasta lo que aún queda disponible
   * (lo ya emitido no se puede recuperar). Registra un movimiento tipo 'ajuste'.
   */
  async ajustar(empresaId: number, delta: number, userId?: number, descripcion?: string) {
    if (!Number.isInteger(delta) || delta === 0) throw new Error('El ajuste debe ser un entero distinto de cero');
    const conn = await pool().getConnection();
    try {
      await conn.beginTransaction();
      const [rows] = await conn.query<any[]>(
        'SELECT creditos_disponibles, creditos_asignados_total FROM empresas WHERE id = ? FOR UPDATE',
        [empresaId],
      );
      if (!(rows as any[]).length) throw new Error('Empresa no encontrada');
      const saldo = (rows as any[])[0].creditos_disponibles ?? 0;
      const asignados = (rows as any[])[0].creditos_asignados_total ?? 0;
      const nuevoSaldo = saldo + delta;
      if (nuevoSaldo < 0) {
        throw new Error(`No puedes quitar ${Math.abs(delta)} créditos: la empresa solo tiene ${saldo} disponibles (el resto ya fue emitido).`);
      }
      const nuevoAsignado = Math.max(asignados + delta, 0);
      await conn.query(
        'UPDATE empresas SET creditos_disponibles = ?, creditos_asignados_total = ? WHERE id = ?',
        [nuevoSaldo, nuevoAsignado, empresaId],
      );
      await conn.query(
        `INSERT INTO creditos_movimientos (empresa_id, tipo, cantidad, saldo_resultante, descripcion, user_crea_id)
         VALUES (?, 'ajuste', ?, ?, ?, ?)`,
        [empresaId, delta, nuevoSaldo, descripcion ?? (delta < 0 ? 'Ajuste: se quitaron créditos' : 'Ajuste: se agregaron créditos'), userId ?? null],
      );
      await conn.commit();
      return nuevoSaldo;
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  },
};
