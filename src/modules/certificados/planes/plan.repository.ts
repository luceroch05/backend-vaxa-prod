import type { PoolConnection } from 'mysql2/promise';
import { pool, getEmpresaId } from '../shared/db.helper';
import { Plan, PlanEntity, EstadoPlan, ConsumoMes, Cobranza, CreditosSaldo, ResumenCobro, LineaCobro } from './plan.entity';
import { cuotasMantenimiento, cuotasVencidas, mantenimientoUsuarioMes, estadoCobranzaMant, estadoCobranza, cobroPrepagoPendiente, proximaRenovacionPrepago } from './mantenimiento.helper';
import { comprobanteRepo } from '../../facturacion/comprobante.repository';
import { getSunatConfig } from '../../facturacion/sunat/sunat.config';
import { SinCreditosError } from '../shared/creditos.repository';

/**
 * Días ANTES del vencimiento en que el semáforo pasa a "por_vencer" (aviso
 * anticipado de que conviene pagar). NO mueve la fecha máxima de pago: esa es
 * el mismo día de vencimiento (fecha_fin). Solo afecta el color/estado del aviso.
 */
export const DIAS_AVISO_PAGO = 7;

const DIA_MS = 24 * 60 * 60 * 1000;

/** Fecha (Date) a 'YYYY-MM-DD' sin desfase de zona horaria. */
function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Medianoche local de una fecha (acepta Date o 'YYYY-MM-DD'). */
function aMedianoche(v: Date | string): Date {
  const d = v instanceof Date ? new Date(v) : new Date(`${String(v).slice(0, 10)}T00:00:00`);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Normaliza a 'YYYY-MM-DD' un valor que viene de MySQL. mysql2 devuelve las
 * columnas DATE/DATETIME como objetos Date, y `String(date)` da "Thu Jul 24 2026…",
 * NO 'YYYY-MM-DD'. Por eso convertimos siempre con los getters locales.
 */
function aYmd(v: Date | string | null | undefined): string | null {
  if (v == null) return null;
  if (typeof v === 'string') return v.slice(0, 10);
  return ymd(v);
}

/**
 * Deriva el semáforo de cobranza a partir de la fecha de vencimiento.
 *  - vigente:    faltan más de DIAS_AVISO_PAGO días.
 *  - por_vencer: estamos dentro de la ventana de aviso (debe pagar ya), aún no vence.
 *  - vencido:    ya pasó fecha_fin.
 */
export function calcularCobranza(fechaFin: Date | string): Cobranza {
  const hoy = aMedianoche(new Date());
  const fin = aMedianoche(fechaFin);
  const diasParaVencer = Math.round((fin.getTime() - hoy.getTime()) / DIA_MS);

  let estado: Cobranza['estado_cobranza'];
  if (diasParaVencer < 0) estado = 'vencido';
  else if (diasParaVencer <= DIAS_AVISO_PAGO) estado = 'por_vencer';
  else estado = 'vigente';

  return {
    // La fecha máxima para pagar es el MISMO día de vencimiento (no antes).
    fecha_limite_pago: ymd(fin),
    dias_para_vencer: diasParaVencer,
    estado_cobranza: estado,
  };
}

let _ensuredActivacion = false;
/**
 * Garantiza (una sola vez, en runtime) la columna `usuarios.activacion_cobrada`
 * sin stored procedures ni migración manual: revisa information_schema y, si
 * falta, la agrega marcando a los usuarios existentes como ya activados
 * (grandfather: no se les cobra activación retroactiva).
 */
async function ensureActivacionCobrada(): Promise<void> {
  if (_ensuredActivacion) return;
  const [cols] = await pool().query<any[]>(
    `SELECT 1 FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'usuarios'
        AND COLUMN_NAME = 'activacion_cobrada' LIMIT 1`,
  );
  if (!(cols as any[]).length) {
    await pool().query(
      `ALTER TABLE usuarios ADD COLUMN activacion_cobrada TINYINT(1) NOT NULL DEFAULT 0 AFTER activo`,
    );
    await pool().query(`UPDATE usuarios SET activacion_cobrada = 1`);
  }
  _ensuredActivacion = true;
}

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

/**
 * ¿El plan vigente de la empresa es ILIMITADO? Convención: `creditos_incluidos = 0`
 * (ej. Corporativo). En ese caso la emisión no consume ni se bloquea por saldo.
 */
async function planEsIlimitado(conn: PoolConnection, empresaId: number): Promise<boolean> {
  const [rows] = await conn.query<any[]>(
    `SELECT p.creditos_incluidos
       FROM empresas e
       JOIN planes p ON p.id = e.plan_actual_id
      WHERE e.id = ?`,
    [empresaId],
  );
  return rows.length > 0 && Number(rows[0].creditos_incluidos) === 0;
}

export const planRepo = {
  /** ¿El plan vigente del tenant permite carga masiva por Excel? (Profesional+). */
  async permiteCargaMasiva(tenantSlug: string): Promise<boolean> {
    const empresaId = await getEmpresaId(tenantSlug);
    const [rows] = await pool().query<any[]>(
      `SELECT p.permite_carga_masiva
         FROM empresas e JOIN planes p ON p.id = e.plan_actual_id
        WHERE e.id = ?`,
      [empresaId],
    );
    return rows.length > 0 && Number(rows[0].permite_carga_masiva) === 1;
  },

  /** ¿El plan vigente del tenant incluye auditoría? (Profesional+). */
  async permiteAuditoria(empresaId: number): Promise<boolean> {
    const [rows] = await pool().query<any[]>(
      `SELECT p.permite_auditoria
         FROM empresas e JOIN planes p ON p.id = e.plan_actual_id
        WHERE e.id = ?`,
      [empresaId],
    );
    return rows.length > 0 && Number(rows[0].permite_auditoria) === 1;
  },

  /** ¿El plan vigente del tenant incluye reportes/métricas? (Profesional+). */
  async permiteMetricas(tenantSlug: string): Promise<boolean> {
    const empresaId = await getEmpresaId(tenantSlug);
    const [rows] = await pool().query<any[]>(
      `SELECT p.permite_metricas
         FROM empresas e JOIN planes p ON p.id = e.plan_actual_id
        WHERE e.id = ?`,
      [empresaId],
    );
    return rows.length > 0 && Number(rows[0].permite_metricas) === 1;
  },

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
      // Crear la nueva. Modelo Leonardo (mantenimiento a fin de mes):
      //   fecha_inicio = hoy (implementación / cambio de plan) → fija el prorrateo.
      //   fecha_fin    = "mantenimiento pagado hasta" = fin del mes ANTERIOR, así
      //                  el mes actual queda como 1ra cuota pendiente (prorrateada).
      void meses; // el ciclo ya no fija la vigencia; el mantenimiento es mensual (fin de mes)
      await conn.query(
        `INSERT INTO empresa_suscripcion (empresa_id, plan_id, ciclo_id, estado_id, fecha_inicio, fecha_fin)
         VALUES (?, ?, ?, 1, CURDATE(), LAST_DAY(DATE_SUB(CURDATE(), INTERVAL 1 MONTH)))`,
        [empresaId, planId, cicloId],
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
              c.nombre AS ciclo, c.meses_pago, c.meses_vigencia, es.nombre AS estado, p.*
         FROM empresa_suscripcion s
         JOIN planes p              ON p.id  = s.plan_id
         JOIN ciclo_facturacion c   ON c.id  = s.ciclo_id
         JOIN estado_suscripcion es ON es.id = s.estado_id
        WHERE s.empresa_id = ? AND s.estado_id = 1
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

    // Saldo de créditos (modelo créditos + mantenimiento).
    const [emp] = await pool().query<any[]>(
      'SELECT creditos_disponibles, creditos_asignados_total FROM empresas WHERE id = ?',
      [empresaId],
    );
    const disponibles = Number(emp[0]?.creditos_disponibles ?? 0);
    const asignados   = Number(emp[0]?.creditos_asignados_total ?? 0);
    // Total comprado aparte (recargas), independiente del límite del historial.
    const [rec] = await pool().query<any[]>(
      `SELECT COALESCE(SUM(cantidad), 0) AS recargados
         FROM creditos_movimientos WHERE empresa_id = ? AND tipo = 'recarga'`,
      [empresaId],
    );
    const recargados = Number(rec[0]?.recargados ?? 0);
    const creditos: CreditosSaldo = {
      disponibles, asignados,
      consumidos: Math.max(asignados - disponibles, 0),
      recargados,
      // Plan ilimitado (creditos_incluidos = 0, ej. Corporativo): emite sin tope.
      ilimitado: !!plan && Number(plan.creditos_incluidos) === 0,
    };

    return {
      plan,
      suscripcion: sus.length
        ? {
            id:           sus[0].suscripcion_id,
            ciclo:        sus[0].ciclo,
            estado:       sus[0].estado,
            fecha_inicio: aYmd(sus[0].fecha_inicio)!,
            fecha_fin:    aYmd(sus[0].fecha_fin)!,
            ...estadoCobranza({
              fechaInicio: sus[0].fecha_inicio,
              pagadoHasta: sus[0].fecha_fin,
              mantenimientoMensual: Number(plan?.mantenimiento_mensual) || 0,
              hasta: new Date(),
              mesesVigencia: Number(sus[0].meses_vigencia) || 1,
            }),
          }
        : null,
      consumo,
      creditos,
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
    // Emisión individual: consume 1 crédito con descripción individual.
    await planRepo.consumirCreditos(conn, empresaId, 1, 'Emisión de certificado');
  },

  /**
   * Consume `cantidad` créditos del saldo de la empresa en UN solo movimiento.
   * Lo usa la emisión individual (cantidad=1) y la emisión EN LOTE (cantidad=N),
   * para que el ledger muestre una sola fila por tanda en vez de N filas de -1.
   * DEBE correr dentro de una transacción: bloquea la fila (FOR UPDATE).
   * Plan ILIMITADO (creditos_incluidos = 0, ej. Corporativo): NO se bloquea por
   * saldo, pero SÍ registra el consumo (saldo puede quedar negativo; la UI muestra ∞).
   * En planes normales, si no alcanza el saldo → SinCreditosError.
   */
  async consumirCreditos(conn: PoolConnection, empresaId: number, cantidad: number, descripcion: string): Promise<void> {
    const n = Math.floor(Number(cantidad));
    if (!Number.isFinite(n) || n <= 0) return;

    const ilimitado = await planEsIlimitado(conn, empresaId);
    const [rows] = await conn.query<any[]>(
      'SELECT creditos_disponibles FROM empresas WHERE id = ? FOR UPDATE',
      [empresaId],
    );
    if (!rows.length) throw new SinPlanError();
    const saldo = Number(rows[0].creditos_disponibles ?? 0);
    if (!ilimitado && saldo < n) throw new SinCreditosError();

    const nuevo = saldo - n;
    await conn.query('UPDATE empresas SET creditos_disponibles = ? WHERE id = ?', [nuevo, empresaId]);
    await conn.query(
      `INSERT INTO creditos_movimientos (empresa_id, tipo, cantidad, saldo_resultante, descripcion)
       VALUES (?, 'consumo', ?, ?, ?)`,
      [empresaId, -n, nuevo, descripcion],
    );
  },

  /** Saldo de créditos disponible de la empresa (sin bloquear). Para calcular el lote. */
  async saldoCreditos(conn: PoolConnection, empresaId: number): Promise<{ saldo: number; ilimitado: boolean }> {
    const ilimitado = await planEsIlimitado(conn, empresaId);
    const [rows] = await conn.query<any[]>(
      'SELECT creditos_disponibles FROM empresas WHERE id = ? FOR UPDATE',
      [empresaId],
    );
    if (!rows.length) throw new SinPlanError();
    return { saldo: Number(rows[0].creditos_disponibles ?? 0), ilimitado };
  },

  /**
   * Recarga de CRÉDITOS (lado Vaxa): le suma `cantidad` créditos al saldo de la
   * empresa (acumulables) al precio por crédito suelto escalonado (tarifario
   * oficial 2026: 1–49 → S/3.00 · 50 o más → S/2.85 c/IGV; desde 100 conviene un
   * paquete) y deja el cobro registrado en `pagos` (concepto excedente, pendiente).
   */
  async recargarCupo(
    empresaId: number,
    cantidad: number,
    montoOverride?: number,
  ): Promise<{ agregados: number; precio_unitario: number; monto: number }> {
    const n = Math.floor(Number(cantidad));
    if (!Number.isFinite(n) || n <= 0) throw new Error('La cantidad debe ser un entero mayor a 0');

    // Precio por crédito suelto, escalonado (tarifario oficial 2026, incluye IGV):
    //   1–49 → S/3.00 · 50 o más → S/2.85 (a partir de 100 conviene un paquete).
    const PRECIO_CREDITO = n >= 50 ? 2.85 : 3.00;
    // Si se pasa un monto total (ej. precio de paquete con descuento: 300→S/750,
    // 700→S/1500), se cobra ese; si no, se cobra al precio por crédito suelto.
    const monto = (montoOverride != null && Number.isFinite(Number(montoOverride)) && Number(montoOverride) >= 0)
      ? Math.round(Number(montoOverride) * 100) / 100
      : Math.round(PRECIO_CREDITO * n * 100) / 100;
    const precioUnitario = n > 0 ? Math.round((monto / n) * 100) / 100 : PRECIO_CREDITO;

    const conn = await pool().getConnection();
    try {
      await conn.beginTransaction();

      // SOLO suma los créditos al saldo (acumulables) + movimiento en el ledger.
      // NO genera pago ni comprobante: el cobro/comprobante se registra aparte al
      // hacer una "Nueva venta". Aquí únicamente se recarga el saldo del sistema.
      const [emp] = await conn.query<any[]>(
        'SELECT creditos_disponibles FROM empresas WHERE id = ? FOR UPDATE', [empresaId],
      );
      if (!emp.length) throw new SinPlanError();
      const nuevoSaldo = Number(emp[0].creditos_disponibles ?? 0) + n;
      await conn.query(
        `UPDATE empresas SET creditos_disponibles = creditos_disponibles + ?,
                             creditos_asignados_total = creditos_asignados_total + ? WHERE id = ?`,
        [n, n, empresaId],
      );
      await conn.query(
        `INSERT INTO creditos_movimientos (empresa_id, tipo, cantidad, saldo_resultante, descripcion)
         VALUES (?, 'recarga', ?, ?, 'Recarga de créditos')`,
        [empresaId, n, nuevoSaldo],
      );

      await conn.commit();
      return { agregados: n, precio_unitario: precioUnitario, monto };
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  },

  /**
   * Revierte 1 emisión del mes en curso (al ELIMINAR un certificado).
   * Si la emisión revertida era un excedente, también descuenta el adicional.
   * DEBE correr dentro de una transacción.
   */
  async devolverCupo(conn: PoolConnection, empresaId: number): Promise<void> {
    // Aplica también a planes ilimitados: como el consumo SÍ se registró, al
    // eliminar el certificado se revierte el movimiento (ajusta el conteo).
    // Modelo de CRÉDITOS: al eliminar un certificado se devuelve 1 crédito.
    const [rows] = await conn.query<any[]>(
      'SELECT creditos_disponibles FROM empresas WHERE id = ? FOR UPDATE',
      [empresaId],
    );
    if (!rows.length) return;
    const nuevo = Number(rows[0].creditos_disponibles ?? 0) + 1;
    await conn.query('UPDATE empresas SET creditos_disponibles = ? WHERE id = ?', [nuevo, empresaId]);
    await conn.query(
      `INSERT INTO creditos_movimientos (empresa_id, tipo, cantidad, saldo_resultante, descripcion)
       VALUES (?, 'devolucion', 1, ?, 'Devolución por eliminación de certificado')`,
      [empresaId, nuevo],
    );
  },

  /**
   * Control de cobranza (lado Vaxa): TODAS las empresas (menos la raíz) con su
   * suscripción vigente y el semáforo de vencimiento. Las que no tienen plan
   * vienen con suscripcion=null. Ordena primero a las que urge cobrar.
   */
  async listVencimientos(): Promise<VencimientoEmpresa[]> {
    const [rows] = await pool().query<any[]>(
      `SELECT e.id AS empresa_id, e.razon_social, e.tenant_slug, e.activo,
              s.id AS suscripcion_id, s.fecha_inicio, s.fecha_fin,
              c.nombre AS ciclo, c.meses_pago, c.meses_vigencia, p.nombre AS plan, p.precio_mensual, p.mantenimiento_mensual,
              (SELECT MAX(pg.fecha_pago) FROM pagos pg
                 WHERE pg.empresa_id = e.id AND pg.concepto_id = 1 AND pg.estado_id = 2) AS ultimo_pago
         FROM empresas e
         LEFT JOIN empresa_suscripcion s
                ON s.empresa_id = e.id AND s.estado_id = 1
         LEFT JOIN planes p            ON p.id = s.plan_id
         LEFT JOIN ciclo_facturacion c ON c.id = s.ciclo_id
        WHERE e.tenant_slug <> 'vaxa'
        ORDER BY e.razon_social`,
      [],
    );

    return (rows as any[])
      .map((r): VencimientoEmpresa => ({
        empresa_id:   r.empresa_id,
        razon_social: r.razon_social,
        tenant_slug:  r.tenant_slug,
        activo:       !!r.activo,
        plan:         r.plan ?? null,
        ciclo:        r.ciclo ?? null,
        precio_mensual: r.precio_mensual != null ? Number(r.precio_mensual) : null,
        fecha_inicio: aYmd(r.fecha_inicio),
        fecha_fin:    aYmd(r.fecha_fin),
        ultimo_pago:  aYmd(r.ultimo_pago),
        cobranza:     r.fecha_fin
          ? estadoCobranza({
              fechaInicio: r.fecha_inicio,
              pagadoHasta: r.fecha_fin,
              mantenimientoMensual: Number(r.mantenimiento_mensual) || 0,
              hasta: new Date(),
              mesesVigencia: Number(r.meses_vigencia) || 1,
            })
          : null,
      }))
      // Urgencia primero: sin plan → vencido → por_vencer → vigente; dentro, menos días primero.
      .sort((a, b) => urgencia(a) - urgencia(b));
  },

  /**
   * Registra el pago del ciclo de una empresa (lado Vaxa) y RENUEVA la
   * suscripción: corre fecha_fin un ciclo hacia adelante. Si ya venció,
   * el nuevo periodo arranca hoy; si sigue vigente, se encadena a fecha_fin
   * (no pierde días por pagar anticipado). Deja el pago en `pagos`
   * (concepto suscripción, estado pagado). Devuelve el estado actualizado.
   */
  async marcarPagado(
    empresaId: number,
    opts: { monto?: number; fecha_pago?: string; comprobante_tipo_id?: number; comprobante_numero?: string; emitir_comprobante?: boolean; renovar?: boolean; registrar_pago?: boolean } = {},
  ): Promise<EstadoPlan> {
    let pagoId = 0;
    let montoPagado = 0;
    let planNombre = '';
    const conn = await pool().getConnection();
    try {
      await conn.beginTransaction();

      // Suscripción activa más reciente (aunque ya haya vencido por fecha).
      const [sus] = await conn.query<any[]>(
        `SELECT s.id, s.fecha_inicio, s.fecha_fin, s.precio_pactado,
                ci.meses_pago, ci.meses_vigencia, p.precio_mensual, p.mantenimiento_mensual, p.nombre AS plan_nombre
           FROM empresa_suscripcion s
           JOIN ciclo_facturacion ci ON ci.id = s.ciclo_id
           JOIN planes p             ON p.id  = s.plan_id
          WHERE s.empresa_id = ? AND s.estado_id = 1
          ORDER BY s.id DESC LIMIT 1`,
        [empresaId],
      );
      if (!sus.length) {
        throw new SinPlanError('SIN_PLAN: La empresa no tiene una suscripción para renovar. Asígnale un plan primero.');
      }
      const s = sus[0];
      const monto = opts.monto != null
        ? Number(opts.monto)
        : (s.precio_pactado != null ? Number(s.precio_pactado) : Number(s.precio_mensual) * Number(s.meses_pago));
      montoPagado = monto;
      planNombre = s.plan_nombre ?? 'plan';

      // Registrar el pago de la suscripción (pagado). Se OMITE cuando
      // registrar_pago=false (ej. "Confirmar pago del mantenimiento": el pago ya
      // se registró con "Nueva venta"; este botón SOLO renueva el mes).
      if (opts.registrar_pago !== false) {
        const [insPago] = await conn.query<any>(
          `INSERT INTO pagos
             (empresa_id, suscripcion_id, concepto_id, monto, estado_id, fecha_pago, comprobante_tipo_id, comprobante_numero)
           VALUES (?, ?, 1, ?, 2, ?, ?, ?)`,
          [
            empresaId, s.id, monto,
            opts.fecha_pago ? `${opts.fecha_pago.slice(0, 10)} 00:00:00` : new Date(),
            opts.comprobante_tipo_id ?? 1,
            opts.comprobante_numero?.trim() || null,
          ],
        );
        pagoId = insPago.insertId;
      }

      // Confirmar pago del mantenimiento (modelo fin de mes): salda TODAS las cuotas
      // de mantenimiento vencidas → avanza "pagado hasta" (fecha_fin) al último fin
      // de mes vencido. Se omite en la PRIMERA venta (renovar=false).
      if (opts.renovar !== false) {
        const mesesVigencia = Number(s.meses_vigencia) || 1;
        if (mesesVigencia > 1) {
          // PREPAGO (semestral/anual): renovar salda el ciclo completo → "cubierto hasta"
          // salta meses_vigencia meses hacia adelante.
          const pend = cobroPrepagoPendiente({
            fechaInicio: s.fecha_inicio,
            pagadoHasta: s.fecha_fin,
            mantenimientoMensual: Number(s.mantenimiento_mensual) || 0,
            hasta: new Date(),
            mesesPago: Number(s.meses_pago) || 1,
            mesesVigencia,
          });
          if (!pend) {
            throw new Error('AL_DIA: El mantenimiento del ciclo ya está cubierto. El próximo se cobra al vencer la cobertura.');
          }
          await conn.query(
            `UPDATE empresa_suscripcion SET fecha_fin = ? WHERE id = ?`,
            [pend.nuevaCobertura, s.id],
          );
        } else {
          // MENSUAL: salda TODAS las cuotas de fin de mes vencidas → avanza "pagado hasta".
          const vencidas = cuotasVencidas({
            fechaInicio: s.fecha_inicio,
            pagadoHasta: s.fecha_fin,
            mantenimientoMensual: Number(s.mantenimiento_mensual) || 0,
            hasta: new Date(),
          });
          if (!vencidas.length) {
            throw new Error('AL_DIA: No hay mantenimiento vencido por pagar. El próximo se cobra a fin de mes.');
          }
          const ultimoFinMes = vencidas[vencidas.length - 1].fechaCorte; // 'YYYY-MM-DD'
          await conn.query(
            `UPDATE empresa_suscripcion SET fecha_fin = ? WHERE id = ?`,
            [ultimoFinMes, s.id],
          );
        }
      }

      await conn.commit();
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }

    // Emisión automática de la factura del ciclo (best-effort: si falla, el pago
    // ya quedó registrado; el comprobante puede emitirse luego manualmente).
    if (opts.emitir_comprobante && pagoId) {
      try {
        const valorUnitario = Math.round((montoPagado / (1 + getSunatConfig().igvPct / 100)) * 100) / 100;
        await comprobanteRepo.emitir({
          empresaId,
          pagoId,
          items: [{ descripcion: `Suscripción ${planNombre}`, cantidad: 1, valorUnitario, unidad: 'ZZ' }],
        });
      } catch (e) {
        console.warn('[planes] no se pudo emitir la factura automática:', (e as Error).message);
      }
    }

    return planRepo.getEstadoById(empresaId);
  },

  /**
   * Revierte la ÚLTIMA renovación del ciclo (si se confirmó el pago por error).
   * Resta un ciclo (meses_vigencia) a fecha_fin, dejando el vencimiento como
   * estaba antes de marcar. NO toca pagos (el botón "Confirmar pago" solo renueva,
   * no registra pago). Vuelve a habilitar el botón de confirmar pago.
   */
  async revertirCiclo(empresaId: number): Promise<EstadoPlan> {
    const conn = await pool().getConnection();
    try {
      await conn.beginTransaction();
      const [sus] = await conn.query<any[]>(
        `SELECT s.id, s.fecha_inicio, s.fecha_fin FROM empresa_suscripcion s
          WHERE s.empresa_id = ? AND s.estado_id = 1
          ORDER BY s.id DESC LIMIT 1`,
        [empresaId],
      );
      if (!(sus as any[]).length) throw new SinPlanError();
      const s = (sus as any[])[0];
      // Retrocede "pagado hasta" al fin del mes anterior (deshace un mes de mantenimiento).
      const fin = aMedianoche(s.fecha_fin);
      const nuevoFin = new Date(fin.getFullYear(), fin.getMonth(), 0);
      // TOPE: no se puede retroceder más allá del inicio de la cuenta (no se debe
      // mantenimiento de antes de la implementación). Piso = fin del mes ANTERIOR a fecha_inicio.
      const inicio = aMedianoche(s.fecha_inicio);
      const piso = new Date(inicio.getFullYear(), inicio.getMonth(), 0);
      if (nuevoFin.getTime() < piso.getTime()) {
        throw new Error('TOPE_REVERTIR: No se puede revertir más: ya está en el inicio de la cuenta (mes de implementación).');
      }
      await conn.query(`UPDATE empresa_suscripcion SET fecha_fin = ? WHERE id = ?`, [ymd(nuevoFin), s.id]);
      await conn.commit();
    } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
    return planRepo.getEstadoById(empresaId);
  },

  /**
   * Ajuste MANUAL de "mantenimiento pagado hasta" (fecha_fin). Reemplaza al
   * "revertir por clics": Vaxa fija exactamente hasta qué mes está pagado el
   * mantenimiento. Se guarda como el ÚLTIMO DÍA del mes elegido (el modelo usa el
   * mes, no el día). Sirve para corregir cualquier error sin adivinar.
   */
  async ajustarPagadoHasta(empresaId: number, fecha: string): Promise<EstadoPlan> {
    const d = new Date(`${String(fecha).slice(0, 10)}T00:00:00`);
    if (isNaN(d.getTime())) throw new Error('Fecha inválida');
    const finMes = new Date(d.getFullYear(), d.getMonth() + 1, 0); // último día de ese mes
    const [r] = await pool().query<any>(
      `UPDATE empresa_suscripcion SET fecha_fin = ? WHERE empresa_id = ? AND estado_id = 1`,
      [ymd(finMes), empresaId],
    );
    if (!r.affectedRows) throw new SinPlanError('SIN_PLAN: La empresa no tiene una suscripción activa.');
    return planRepo.getEstadoById(empresaId);
  },

  /**
   * Reactiva la cuenta de mantenimiento tras una suspensión por falta de pago
   * (modelo Leonardo). Las cuotas ATRASADAS se cobran aparte (en "Nueva venta");
   * este método arranca una CUENTA NUEVA desde hoy: fecha_inicio = hoy y
   * "pagado hasta" = fin del mes anterior, de modo que el mes actual quede
   * prorrateado desde hoy y se cobre a fin de este mes.
   */
  async reactivarCuenta(empresaId: number): Promise<EstadoPlan> {
    const conn = await pool().getConnection();
    try {
      await conn.beginTransaction();
      const [r] = await conn.query<any>(
        `UPDATE empresa_suscripcion
            SET fecha_inicio = CURDATE(),
                fecha_fin    = LAST_DAY(DATE_SUB(CURDATE(), INTERVAL 1 MONTH))
          WHERE empresa_id = ? AND estado_id = 1`,
        [empresaId],
      );
      if (!r.affectedRows) throw new SinPlanError('SIN_PLAN: La empresa no tiene una suscripción activa para reactivar.');
      await conn.commit();
    } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
    return planRepo.getEstadoById(empresaId);
  },

  /** Historial de pagos de una empresa (más recientes primero). */
  async listPagos(empresaId: number, limit = 100): Promise<PagoHist[]> {
    const [rows] = await pool().query<any[]>(
      `SELECT pg.id, pg.monto, pg.moneda, pg.metodo, pg.referencia_niubiz,
              pg.comprobante_numero, pg.created_at, pg.fecha_pago, pg.comprobante_id,
              cp.nombre AS concepto, ep.nombre AS estado, tc.nombre AS comprobante_tipo,
              c.serie AS cpe_serie, c.correlativo AS cpe_correlativo, ecc.codigo AS cpe_estado,
              (SELECT GROUP_CONCAT(cd.descripcion ORDER BY cd.orden SEPARATOR ' · ')
                 FROM comprobante_detalle cd WHERE cd.comprobante_id = c.id) AS detalle
         FROM pagos pg
         JOIN concepto_pago    cp ON cp.id = pg.concepto_id
         JOIN estado_pago      ep ON ep.id = pg.estado_id
         JOIN tipo_comprobante tc ON tc.id = pg.comprobante_tipo_id
         LEFT JOIN comprobantes c        ON c.id = pg.comprobante_id
         LEFT JOIN estado_comprobante ecc ON ecc.id = c.estado_id
        WHERE pg.empresa_id = ?
        ORDER BY COALESCE(pg.fecha_pago, pg.created_at) DESC, pg.id DESC
        LIMIT ?`,
      [empresaId, Math.max(1, Math.min(Number(limit) || 100, 500))],
    );
    return (rows as any[]).map((r): PagoHist => ({
      id:                r.id,
      concepto:          r.concepto,
      monto:             Number(r.monto),
      moneda:            r.moneda,
      estado:            r.estado,
      comprobante_tipo:  r.comprobante_tipo,
      comprobante_numero: r.comprobante_numero ?? null,
      referencia_niubiz: r.referencia_niubiz ?? null,
      fecha:             aYmd(r.fecha_pago ?? r.created_at),
      cpe_id:            r.comprobante_id ?? null,
      cpe_numero:        r.cpe_serie ? `${r.cpe_serie}-${r.cpe_correlativo}` : null,
      cpe_estado:        r.cpe_estado ?? null,
      detalle:           r.detalle ?? null,
    }));
  },

  /**
   * Resumen de lo que hay que cobrarle a la empresa (modelo Leonardo, fin de mes):
   * una cuota de mantenimiento por cada FIN DE MES vencido e impago (el mes de la
   * implementación va prorrateado por días reales), + mantenimiento de usuarios
   * adicionales de cada mes, + activación (pago único) de usuarios nuevos. Calculado
   * al vuelo: reusa fecha_inicio (implementación), fecha_fin (mantenimiento pagado
   * hasta), usuarios.created_at, parametros_facturacion y planes.
   */
  async resumenCobro(empresaId: number): Promise<ResumenCobro> {
    await ensureActivacionCobrada();
    const vacio: ResumenCobro = {
      plan: null, ciclo: null, vencimiento: null,
      usuarios: { incluidos: 0, actuales: 0, extra: 0, ilimitado: false },
      lineas: [], total: 0, marcarActivacionUsuarios: [],
      enCurso: [], totalEnCurso: 0, fechaCobroEnCurso: null,
    };

    const [ss] = await pool().query<any[]>(
      `SELECT s.fecha_inicio, s.fecha_fin, ci.meses_pago, ci.meses_vigencia, ci.nombre AS ciclo,
              p.id AS plan_id, p.nombre AS plan_nombre, p.slug AS plan_slug,
              p.mantenimiento_mensual, p.usuarios_incluidos
         FROM empresa_suscripcion s
         JOIN ciclo_facturacion ci ON ci.id = s.ciclo_id
         JOIN planes p             ON p.id  = s.plan_id
        WHERE s.empresa_id = ? AND s.estado_id = 1
        ORDER BY s.id DESC LIMIT 1`,
      [empresaId],
    );
    if (!(ss as any[]).length) return vacio;
    const s = (ss as any[])[0];
    const mantMensual = Number(s.mantenimiento_mensual) || 0;
    const mesesPago     = Number(s.meses_pago) || 1;
    const mesesVigencia = Number(s.meses_vigencia) || 1;
    const esPrepago   = mesesVigencia > 1;   // semestral/anual: cobro por ciclo adelantado
    const cobranza    = estadoCobranza({ fechaInicio: s.fecha_inicio, pagadoHasta: s.fecha_fin, mantenimientoMensual: mantMensual, hasta: new Date(), mesesVigencia });
    const incluidos   = Number(s.usuarios_incluidos) || 0;
    const ilimitadoUsuarios = incluidos === 0;   // convención: 0 = ilimitado (Corporativo)
    const hoy = aMedianoche(new Date());

    // Precios del usuario adicional (parametros_facturacion; defaults por si acaso).
    const [prm] = await pool().query<any[]>(
      `SELECT clave, valor FROM parametros_facturacion
        WHERE clave IN ('usuario_extra_activacion','usuario_extra_mensual')`,
    );
    const P: Record<string, number> = {};
    for (const r of prm as any[]) P[r.clave] = Number(r.valor);
    const precioAct  = P['usuario_extra_activacion'] ?? 50;
    const precioMant = P['usuario_extra_mensual'] ?? 5;

    // Usuarios de certificaciones activos, del más antiguo al más nuevo.
    let usuarios: any[] = [];
    try {
      const [us] = await pool().query<any[]>(
        `SELECT u.id, u.nombres, u.apellidos, u.created_at, u.activacion_cobrada
           FROM usuarios u
           JOIN usuario_producto up ON up.usuario_id = u.id AND up.activo = 1
           JOIN productos pr        ON pr.id = up.producto_id AND pr.slug = 'certificaciones'
          WHERE u.empresa_id = ? AND u.activo = 1
          ORDER BY u.created_at ASC, u.id ASC`,
        [empresaId],
      );
      usuarios = us as any[];
    } catch {
      const [us] = await pool().query<any[]>(
        `SELECT id, nombres, apellidos, created_at, activacion_cobrada
           FROM usuarios WHERE empresa_id = ? AND activo = 1
          ORDER BY created_at ASC, id ASC`,
        [empresaId],
      );
      usuarios = us as any[];
    }

    // Los primeros `incluidos` van con el plan; el resto son adicionales.
    const extras = ilimitadoUsuarios ? [] : usuarios.slice(incluidos);
    const nombreDe = (u: any) => `${u.nombres ?? ''} ${u.apellidos ?? ''}`.trim() || `Usuario ${u.id}`;
    const r2 = (n: number) => Math.round(n * 100) / 100;
    const lineas: LineaCobro[] = [];
    let enCurso: LineaCobro[] = [];
    let totalEnCurso = 0;
    let fechaCobroEnCurso: string | null = null;

    if (esPrepago) {
      // ── PREPAGO (semestral/anual): se cobra el CICLO COMPLETO por adelantado ──────
      // "paga N, recibe M": un solo cobro de N meses que cubre M meses. Mientras la
      // cobertura (fecha_fin) siga vigente, NO hay nada que cobrar. Al vencer, se cobra
      // el siguiente ciclo (y "pagado hasta" salta M meses al confirmar el pago/venta).
      const prox = proximaRenovacionPrepago({
        fechaInicio: s.fecha_inicio,
        pagadoHasta: s.fecha_fin,
        mantenimientoMensual: mantMensual,
        hasta: hoy,
        mesesPago,
        mesesVigencia,
      });
      // Líneas de la renovación (plan + usuarios adicionales del ciclo).
      const lineasRenovacion: LineaCobro[] = [{
        concepto: 'mantenimiento',
        descripcion: `Mantenimiento ${s.plan_nombre} · ${s.ciclo} · ${prox.etiquetaVentana} (paga ${prox.mesesPago}, recibe ${prox.mesesVigencia})`,
        cantidad: 1,
        precioUnitario: prox.montoPlan,
        renueva: true,
      }];
      for (const u of extras) {
        lineasRenovacion.push({
          concepto: 'usuario_mant',
          descripcion: `Mantenimiento usuario adicional · ${nombreDe(u)} · ${prox.etiquetaVentana} (paga ${prox.mesesPago})`,
          cantidad: 1,
          precioUnitario: r2(precioMant * prox.mesesPago),
          usuarioId: u.id,
        });
      }
      if (prox.cobrableAhora) {
        // Dentro de la ventana (7 días antes / vencido): ACTIVO, se puede cobrar ya.
        lineas.push(...lineasRenovacion);
      } else {
        // Aún cubierto: preview OPACADO en "en curso" (no se cobra todavía).
        enCurso = lineasRenovacion;
        totalEnCurso = r2(enCurso.reduce((a, l) => a + l.cantidad * l.precioUnitario, 0));
        fechaCobroEnCurso = prox.fechaCorte;
      }
    } else {
      // ── MENSUAL (modelo Leonardo, fin de mes) ─────────────────────────────────────
      // Una cuota por cada fin de mes VENCIDO e impago; el mes de la implementación
      // va prorrateado por los días reales del mes. Se incluye también el
      // mantenimiento de los usuarios adicionales de ESE mes (prorrateado su 1er mes).
      const todasCuotas = cuotasMantenimiento({
        fechaInicio: s.fecha_inicio,
        pagadoHasta: s.fecha_fin,
        mantenimientoMensual: mantMensual,
        hasta: hoy,
      });
      const cuotas   = todasCuotas.filter((c) => c.vencida);   // a cobrar (ya vencidas)
      const enCursoC = todasCuotas.filter((c) => !c.vencida);  // mes en curso (aún no vence)

      // Arma las líneas de mantenimiento (plan + usuarios adicionales) de una cuota.
      const lineasDeCuota = (c: typeof todasCuotas[number]): LineaCobro[] => {
        const out: LineaCobro[] = [{
          concepto: 'mantenimiento',
          descripcion: `Mantenimiento ${s.plan_nombre} · ${c.etiqueta}${c.prorrateado ? ` (prorrateado ${c.diasCobrados}/${c.diasMes} días)` : ''}`,
          cantidad: 1,
          precioUnitario: c.monto,
          renueva: true,
        }];
        for (const u of extras) {
          const m = mantenimientoUsuarioMes(u.created_at, c.anio, c.mes, precioMant);
          if (m.monto > 0) {
            out.push({
              concepto: 'usuario_mant',
              descripcion: `Mantenimiento usuario adicional · ${nombreDe(u)} · ${c.etiqueta}${m.prorrateado ? ` (prorr ${m.dias}/${m.diasMes})` : ''}`,
              cantidad: 1,
              precioUnitario: m.monto,
              usuarioId: u.id,
            });
          }
        }
        return out;
      };

      for (const c of cuotas) lineas.push(...lineasDeCuota(c));

      // Mes EN CURSO: informativo (no se cobra ni suma al total). Normalmente es 1 cuota
      // (el mes actual); su fecha de cobro es el fin de ese mes.
      for (const c of enCursoC) enCurso.push(...lineasDeCuota(c));
      totalEnCurso     = r2(enCurso.reduce((a, l) => a + l.cantidad * l.precioUnitario, 0));
      fechaCobroEnCurso = enCursoC.length ? enCursoC[enCursoC.length - 1].fechaCorte : null;
    }

    // NOTA: el "Resumen de cobro" es SOLO mantenimiento (automático, recurrente, a fin
    // de mes). Los cobros por ADELANTADO (implementación, activación de usuario,
    // recarga de créditos) son MANUALES → se arman en "Nueva venta" o en una Cotización
    // cuando el cliente va a pagar. Por eso ya NO se inyecta la activación aquí.
    void precioAct;  // ya no se cobra la activación en el resumen (es manual)
    const marcarActivacionUsuarios: number[] = [];

    const total = r2(lineas.reduce((a, l) => a + l.cantidad * l.precioUnitario, 0));

    return {
      plan: { id: s.plan_id, nombre: s.plan_nombre, slug: s.plan_slug },
      ciclo: s.ciclo,
      vencimiento: { fecha_fin: aYmd(s.fecha_fin)!, ...cobranza },
      usuarios: { incluidos, actuales: usuarios.length, extra: extras.length, ilimitado: ilimitadoUsuarios },
      lineas,
      total,
      marcarActivacionUsuarios,
      enCurso,
      totalEnCurso,
      fechaCobroEnCurso,
    };
  },

  /** Marca la activación (S/50 pago único) como ya cobrada para esos usuarios. */
  async marcarActivacionCobrada(usuarioIds: number[]): Promise<void> {
    await ensureActivacionCobrada();
    const ids = (usuarioIds ?? []).filter((n) => Number.isInteger(n) && n > 0);
    if (!ids.length) return;
    await pool().query(
      `UPDATE usuarios SET activacion_cobrada = 1 WHERE id IN (${ids.map(() => '?').join(',')})`,
      ids,
    );
  },
};

/** Una fila del historial de pagos. */
export interface PagoHist {
  id: number;
  concepto: string;
  monto: number;
  moneda: string;
  estado: string;
  comprobante_tipo: string;
  comprobante_numero: string | null;
  referencia_niubiz: string | null;
  fecha: string | null;
  /** Comprobante electrónico vinculado (si ya se facturó). */
  cpe_id: number | null;
  cpe_numero: string | null;       // F001-3
  cpe_estado: string | null;       // ACEPTADO / RECHAZADO...
  /** Líneas facturadas (lo que se envió en el comprobante: "Implementación · Mantenimiento…"). */
  detalle: string | null;
}

/** Fila del control de cobranza de Vaxa (una por empresa). */
export interface VencimientoEmpresa {
  empresa_id: number;
  razon_social: string;
  tenant_slug: string;
  activo: boolean;
  plan: string | null;
  ciclo: string | null;
  precio_mensual: number | null;
  fecha_inicio: string | null;
  fecha_fin: string | null;
  ultimo_pago: string | null;
  cobranza: Cobranza | null;
}

/** Peso de urgencia para ordenar el control de cobranza (menor = más urgente). */
function urgencia(v: VencimientoEmpresa): number {
  if (!v.cobranza) return -1_000_000;                 // sin plan: lo más arriba
  const orden = { vencido: 0, por_vencer: 1, vigente: 2 } as const;
  return orden[v.cobranza.estado_cobranza] * 100_000 + v.cobranza.dias_para_vencer;
}
