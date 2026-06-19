import type { PoolConnection } from 'mysql2/promise';
import { pool, getEmpresaId } from '../shared/db.helper';
import { Plan, PlanEntity, EstadoPlan, ConsumoMes } from './plan.entity';

/** Error tipado: la empresa no tiene una suscripción vigente (no puede emitir). */
export class SinPlanError extends Error {
  constructor(msg = 'SIN_PLAN: La empresa no tiene un plan activo. Contacta a Vaxa para activar tu suscripción.') {
    super(msg);
    this.name = 'SinPlanError';
  }
}

/** Año/mes actual (mes 1..12) para indexar consumo_mensual. */
function periodoActual(): { anio: number; mes: number } {
  const now = new Date();
  return { anio: now.getFullYear(), mes: now.getMonth() + 1 };
}

export const planRepo = {
  /** Catálogo de planes activos (ordenados). */
  async listPlanes(): Promise<Plan[]> {
    const [rows] = await pool().query<any[]>(
      'SELECT * FROM planes WHERE activo = 1 ORDER BY orden',
    );
    return (rows as any[]).map(PlanEntity.fromRow);
  },

  /** id de un plan por su slug (ej. 'basico'). null si no existe. */
  async getPlanIdBySlug(slug: string): Promise<number | null> {
    const [rows] = await pool().query<any[]>('SELECT id FROM planes WHERE slug = ? LIMIT 1', [slug]);
    return rows.length ? (rows[0].id as number) : null;
  },

  /**
   * Asigna (o CAMBIA) el plan de una empresa. Cierra la suscripción activa
   * anterior (estado=cancelada, fecha_fin=hoy) y crea una nueva vigente según
   * el ciclo. Así el historial de cambios de plan queda en empresa_suscripcion.
   * La vigencia sale del ciclo (mensual=1, semestral=6, anual=12 meses).
   */
  async asignarPlan(empresaId: number, planId: number, cicloId = 1): Promise<void> {
    const conn = await pool().getConnection();
    try {
      await conn.beginTransaction();
      const [c] = await conn.query<any[]>(
        'SELECT meses_vigencia FROM ciclo_facturacion WHERE id = ?', [cicloId],
      );
      const meses = Number((c as any[])[0]?.meses_vigencia ?? 1);

      // Cerrar la suscripción activa anterior (si la hay).
      await conn.query(
        `UPDATE empresa_suscripcion SET estado_id = 4, fecha_fin = CURDATE()
          WHERE empresa_id = ? AND estado_id = 1`,
        [empresaId],
      );
      // Crear la nueva, vigente desde hoy según el ciclo.
      await conn.query(
        `INSERT INTO empresa_suscripcion (empresa_id, plan_id, ciclo_id, estado_id, fecha_inicio, fecha_fin)
         VALUES (?, ?, ?, 1, CURDATE(), DATE_ADD(CURDATE(), INTERVAL ? MONTH))`,
        [empresaId, planId, cicloId, meses],
      );
      // Puntero rápido al plan vigente.
      await conn.query('UPDATE empresas SET plan_actual_id = ? WHERE id = ?', [planId, empresaId]);
      await conn.commit();
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  },

  /**
   * Estado del plan de la empresa: plan vigente + consumo del mes en curso.
   * Si no tiene suscripción activa, plan/suscripcion van en null y el consumo en 0.
   */
  async getEstado(tenantSlug: string): Promise<EstadoPlan> {
    return planRepo.getEstadoById(await getEmpresaId(tenantSlug));
  },

  /** Igual que getEstado pero por id de empresa (lo usa el panel admin de Vaxa). */
  async getEstadoById(empresaId: number): Promise<EstadoPlan> {
    const { anio, mes } = periodoActual();

    const [sus] = await pool().query<any[]>(
      `SELECT s.id AS suscripcion_id, s.fecha_inicio, s.fecha_fin,
              c.nombre AS ciclo, es.nombre AS estado, p.*
         FROM empresa_suscripcion s
         JOIN planes p              ON p.id  = s.plan_id
         JOIN ciclo_facturacion c   ON c.id  = s.ciclo_id
         JOIN estado_suscripcion es ON es.id = s.estado_id
        WHERE s.empresa_id = ? AND s.estado_id = 1
          AND CURDATE() BETWEEN s.fecha_inicio AND s.fecha_fin
        ORDER BY s.id DESC LIMIT 1`,
      [empresaId],
    );

    const plan = sus.length ? PlanEntity.fromRow(sus[0]) : null;

    const [cm] = await pool().query<any[]>(
      `SELECT incluidos, emitidos, adicionales, monto_adicional
         FROM consumo_mensual WHERE empresa_id = ? AND anio = ? AND mes = ?`,
      [empresaId, anio, mes],
    );

    const cupo = plan?.limite_certificados_mes ?? 0;
    const row  = cm[0] ?? {};
    const incluidos = Number(row.incluidos ?? cupo);
    const emitidos  = Number(row.emitidos ?? 0);

    const consumo: ConsumoMes = {
      anio,
      mes,
      incluidos,
      emitidos,
      adicionales:     Number(row.adicionales ?? 0),
      monto_adicional: Number(row.monto_adicional ?? 0),
      restantes:       Math.max(incluidos - emitidos, 0),
    };

    return {
      plan,
      suscripcion: sus.length
        ? {
            id:           sus[0].suscripcion_id,
            ciclo:        sus[0].ciclo,
            estado:       sus[0].estado,
            fecha_inicio: sus[0].fecha_inicio,
            fecha_fin:    sus[0].fecha_fin,
          }
        : null,
      consumo,
    };
  },

  /**
   * Suma 1 al consumo del mes (o lo marca como excedente si ya pasó el cupo).
   * Reemplaza al viejo "descontar 1 crédito".
   * DEBE correr dentro de una transacción: bloquea la fila del mes
   * (SELECT ... FOR UPDATE) para evitar carreras entre emisiones simultáneas.
   * Lanza SinPlanError si la empresa no tiene suscripción vigente.
   */
  async consumirCupo(conn: PoolConnection, empresaId: number): Promise<void> {
    // 1) Plan vigente de la empresa.
    const [sus] = await conn.query<any[]>(
      `SELECT p.limite_certificados_mes AS cupo, p.precio_certificado_adicional AS precio_extra
         FROM empresa_suscripcion s
         JOIN planes p ON p.id = s.plan_id
        WHERE s.empresa_id = ? AND s.estado_id = 1
          AND CURDATE() BETWEEN s.fecha_inicio AND s.fecha_fin
        ORDER BY s.id DESC LIMIT 1`,
      [empresaId],
    );
    if (!sus.length) throw new SinPlanError();
    const cupo        = Number(sus[0].cupo);
    const precioExtra = Number(sus[0].precio_extra);

    // 2) Fila de consumo del mes (la crea con el cupo del plan si no existe) y la bloquea.
    const { anio, mes } = periodoActual();
    await conn.query(
      `INSERT INTO consumo_mensual (empresa_id, anio, mes, incluidos)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE id = id`,
      [empresaId, anio, mes, cupo],
    );
    const [cm] = await conn.query<any[]>(
      `SELECT id, emitidos, incluidos FROM consumo_mensual
        WHERE empresa_id = ? AND anio = ? AND mes = ? FOR UPDATE`,
      [empresaId, anio, mes],
    );
    const row     = cm[0];
    const cupoMes = Number(row.incluidos) || cupo;
    // Esta emisión es excedente si supera el cupo del mes.
    const esExcedente = row.emitidos + 1 > cupoMes;

    await conn.query(
      `UPDATE consumo_mensual
          SET emitidos        = emitidos + 1,
              adicionales     = adicionales + ?,
              monto_adicional = monto_adicional + ?
        WHERE id = ?`,
      [esExcedente ? 1 : 0, esExcedente ? precioExtra : 0, row.id],
    );
  },

  /**
   * Revierte 1 emisión del mes en curso (al ELIMINAR un certificado).
   * Si la emisión revertida era un excedente, también descuenta el adicional.
   * DEBE correr dentro de una transacción.
   */
  async devolverCupo(conn: PoolConnection, empresaId: number): Promise<void> {
    const { anio, mes } = periodoActual();
    const [cm] = await conn.query<any[]>(
      `SELECT cm.id, cm.emitidos, cm.incluidos, p.precio_certificado_adicional AS precio_extra
         FROM consumo_mensual cm
         LEFT JOIN empresa_suscripcion s
                ON s.empresa_id = cm.empresa_id AND s.estado_id = 1
               AND CURDATE() BETWEEN s.fecha_inicio AND s.fecha_fin
         LEFT JOIN planes p ON p.id = s.plan_id
        WHERE cm.empresa_id = ? AND cm.anio = ? AND cm.mes = ? FOR UPDATE`,
      [empresaId, anio, mes],
    );
    if (!cm.length || cm[0].emitidos <= 0) return;
    const row = cm[0];
    // El último emitido fue excedente si los emitidos superaban el cupo.
    const eraExcedente = row.emitidos > Number(row.incluidos);
    const precioExtra  = Number(row.precio_extra ?? 0);

    await conn.query(
      `UPDATE consumo_mensual
          SET emitidos        = GREATEST(emitidos - 1, 0),
              adicionales     = GREATEST(adicionales - ?, 0),
              monto_adicional = GREATEST(monto_adicional - ?, 0)
        WHERE id = ?`,
      [eraExcedente ? 1 : 0, eraExcedente ? precioExtra : 0, row.id],
    );
  },
};
