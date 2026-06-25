import type { PoolConnection } from 'mysql2/promise';
import { pool, getEmpresaId } from '../shared/db.helper';
import { Plan, PlanEntity, EstadoPlan, ConsumoMes, Cobranza, CreditosSaldo } from './plan.entity';
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
    const creditos: CreditosSaldo = { disponibles, asignados, consumidos: Math.max(asignados - disponibles, 0) };

    return {
      plan,
      suscripcion: sus.length
        ? {
            id:           sus[0].suscripcion_id,
            ciclo:        sus[0].ciclo,
            estado:       sus[0].estado,
            fecha_inicio: aYmd(sus[0].fecha_inicio)!,
            fecha_fin:    aYmd(sus[0].fecha_fin)!,
            ...calcularCobranza(sus[0].fecha_fin),
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
    // Modelo de CRÉDITOS: cada certificado consume 1 crédito del saldo de la
    // empresa. Bloquea la fila (FOR UPDATE) para evitar carreras. Sin saldo → 409.
    const [rows] = await conn.query<any[]>(
      'SELECT creditos_disponibles FROM empresas WHERE id = ? FOR UPDATE',
      [empresaId],
    );
    if (!rows.length) throw new SinPlanError();
    const saldo = Number(rows[0].creditos_disponibles ?? 0);
    if (saldo <= 0) throw new SinCreditosError();

    const nuevo = saldo - 1;
    await conn.query('UPDATE empresas SET creditos_disponibles = ? WHERE id = ?', [nuevo, empresaId]);
    await conn.query(
      `INSERT INTO creditos_movimientos (empresa_id, tipo, cantidad, saldo_resultante, descripcion)
       VALUES (?, 'consumo', -1, ?, 'Emisión de certificado')`,
      [empresaId, nuevo],
    );
  },

  /**
   * Recarga de CRÉDITOS (lado Vaxa): le suma `cantidad` créditos al saldo de la
   * empresa (acumulables) al precio por crédito (S/2.70 c/IGV, base de los
   * paquetes) y deja el cobro registrado en `pagos` (concepto excedente, pendiente).
   */
  async recargarCupo(
    empresaId: number,
    cantidad: number,
  ): Promise<{ agregados: number; precio_unitario: number; monto: number }> {
    const n = Math.floor(Number(cantidad));
    if (!Number.isFinite(n) || n <= 0) throw new Error('La cantidad debe ser un entero mayor a 0');

    const PRECIO_CREDITO = 2.70;  // incluye IGV
    const monto = Math.round(PRECIO_CREDITO * n * 100) / 100;

    const conn = await pool().getConnection();
    try {
      await conn.beginTransaction();

      // Suscripción vigente (para vincular el pago). Tolerante si no la hay.
      const [sus] = await conn.query<any[]>(
        `SELECT id AS suscripcion_id FROM empresa_suscripcion
          WHERE empresa_id = ? AND estado_id = 1 ORDER BY id DESC LIMIT 1`,
        [empresaId],
      );

      // Suma los créditos al saldo (acumulables) + movimiento en el ledger.
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

      // Deja el cobro registrado (pendiente).
      try {
        await conn.query(
          `INSERT INTO pagos (empresa_id, suscripcion_id, concepto_id, monto, estado_id)
           VALUES (?, ?, 3, ?, 1)`,
          [empresaId, sus[0]?.suscripcion_id ?? null, monto],
        );
      } catch (e) {
        console.warn('[planes] no se pudo registrar el pago de la recarga:', (e as Error).message);
      }

      await conn.commit();
      return { agregados: n, precio_unitario: PRECIO_CREDITO, monto };
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
              c.nombre AS ciclo, p.nombre AS plan, p.precio_mensual,
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
        cobranza:     r.fecha_fin ? calcularCobranza(r.fecha_fin) : null,
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
    opts: { monto?: number; fecha_pago?: string; comprobante_tipo_id?: number; comprobante_numero?: string; emitir_comprobante?: boolean; renovar?: boolean } = {},
  ): Promise<EstadoPlan> {
    let pagoId = 0;
    let montoPagado = 0;
    let planNombre = '';
    const conn = await pool().getConnection();
    try {
      await conn.beginTransaction();

      // Suscripción activa más reciente (aunque ya haya vencido por fecha).
      const [sus] = await conn.query<any[]>(
        `SELECT s.id, s.fecha_fin, s.precio_pactado,
                ci.meses_pago, ci.meses_vigencia, p.precio_mensual, p.nombre AS plan_nombre
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
      const meses = Number(s.meses_vigencia);
      montoPagado = monto;
      planNombre = s.plan_nombre ?? 'plan';

      // Registrar el pago de la suscripción (pagado).
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

      // Renovar: encadena desde fecha_fin si sigue vigente, o desde hoy si ya venció.
      // Se omite en la PRIMERA venta (renovar=false): el período inicial ya se
      // otorgó al crear la empresa, así no se duplica la vigencia.
      if (opts.renovar !== false) {
        const finActual = aMedianoche(s.fecha_fin);
        const hoy = aMedianoche(new Date());
        const base = finActual.getTime() >= hoy.getTime() ? finActual : hoy;
        const nuevoFin = new Date(base);
        nuevoFin.setMonth(nuevoFin.getMonth() + meses);
        await conn.query(
          `UPDATE empresa_suscripcion SET fecha_fin = ? WHERE id = ?`,
          [ymd(nuevoFin), s.id],
        );
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

  /** Historial de pagos de una empresa (más recientes primero). */
  async listPagos(empresaId: number, limit = 100): Promise<PagoHist[]> {
    const [rows] = await pool().query<any[]>(
      `SELECT pg.id, pg.monto, pg.moneda, pg.metodo, pg.referencia_niubiz,
              pg.comprobante_numero, pg.created_at, pg.fecha_pago, pg.comprobante_id,
              cp.nombre AS concepto, ep.nombre AS estado, tc.nombre AS comprobante_tipo,
              c.serie AS cpe_serie, c.correlativo AS cpe_correlativo, ecc.codigo AS cpe_estado
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
    }));
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
