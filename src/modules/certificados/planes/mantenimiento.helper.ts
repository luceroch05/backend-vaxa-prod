/**
 * Cálculo del MANTENIMIENTO mensual bajo el modelo de Leonardo (jul 2026):
 *
 *  - El mantenimiento se cobra el ÚLTIMO DÍA DE CADA MES calendario (no en el
 *    aniversario de la implementación).
 *  - El PRIMER mes (mes de la implementación o de la reactivación) se PRORRATEA
 *    por los días reales que usó ese mes: monto = mensual × (díasUsados / díasDelMes),
 *    usando los días reales del mes (28/29/30/31).
 *  - Del mes siguiente en adelante → mantenimiento COMPLETO cada fin de mes.
 *  - Corte "agua/luz": se suspende cuando hay 2 CUOTAS de mantenimiento vencidas.
 *
 * Todo se deriva de dos fechas de la suscripción:
 *  - fechaInicio  = fecha de implementación (o de reactivación). Fija el prorrateo.
 *  - pagadoHasta  = último día de mes cuyo mantenimiento YA se pagó (o null si aún
 *                   no se pagó ninguno; entonces el primer pendiente es el mes de
 *                   la implementación).
 */

/** Fecha (Date) → 'YYYY-MM-DD' con getters locales (sin desfase de zona). */
function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Medianoche local de un 'YYYY-MM-DD' | Date. */
function aMedianoche(v: Date | string): Date {
  const d = v instanceof Date ? new Date(v) : new Date(`${String(v).slice(0, 10)}T00:00:00`);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Último día del mes (Date a medianoche) del mes que contiene a `d`. */
export function finDeMes(d: Date): Date {
  return aMedianoche(new Date(d.getFullYear(), d.getMonth() + 1, 0));
}

/** Cantidad de días reales del mes que contiene a `d` (28/29/30/31). */
export function diasDelMes(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Una cuota mensual de mantenimiento (cobrable a fin de mes). */
export interface CuotaMantenimiento {
  anio: number;
  mes: number;            // 1..12
  etiqueta: string;       // "julio 2026"
  fechaCorte: string;     // 'YYYY-MM-DD' último día del mes (cuándo se cobra)
  monto: number;          // prorrateado (1er mes) o completo
  prorrateado: boolean;
  diasCobrados: number;   // días facturados de ese mes
  diasMes: number;        // días totales de ese mes
  vencida: boolean;       // su fecha de corte ya pasó respecto a `hasta`
}

/**
 * Devuelve las cuotas de mantenimiento desde el primer mes impago hasta el mes de
 * `hasta` (normalmente hoy), inclusive. La cuota del mes de `hasta` va marcada
 * como NO vencida si su fin de mes aún no llegó (se está acumulando).
 *
 * NOTA: este es el motor MENSUAL (ciclo mensual, cobro a fin de mes). Los ciclos
 * PREPAGO (semestral/anual "paga N, recibe M") NO usan esta función: se cobran por
 * ciclo completo por adelantado con `cobranzaPrepago` / `cobroPrepagoPendiente`.
 */
export function cuotasMantenimiento(opts: {
  fechaInicio: string | Date;
  pagadoHasta: string | Date | null;
  mantenimientoMensual: number;
  hasta: string | Date;
}): CuotaMantenimiento[] {
  const inicio = aMedianoche(opts.fechaInicio);
  const hasta = aMedianoche(opts.hasta);
  const mant = Number(opts.mantenimientoMensual) || 0;

  // Primer mes a evaluar: el mes de la implementación, salvo que ya se haya pagado
  // más allá — en ese caso, el mes siguiente al último pagado.
  let cursor = new Date(inicio.getFullYear(), inicio.getMonth(), 1); // 1er día del mes de implementación
  if (opts.pagadoHasta) {
    const pagado = aMedianoche(opts.pagadoHasta);
    const sigMesPagado = new Date(pagado.getFullYear(), pagado.getMonth() + 1, 1);
    if (sigMesPagado.getTime() > cursor.getTime()) cursor = sigMesPagado;
  }

  const cuotas: CuotaMantenimiento[] = [];
  // Iterar mes a mes mientras el mes del cursor no pase el mes de `hasta`.
  const finHasta = new Date(hasta.getFullYear(), hasta.getMonth(), 1);
  while (cursor.getTime() <= finHasta.getTime()) {
    const corte = finDeMes(cursor);
    const dias = diasDelMes(cursor);
    // ¿Es el mes de la implementación/reactivación? → prorratea desde ese día.
    const esMesInicio = cursor.getFullYear() === inicio.getFullYear() && cursor.getMonth() === inicio.getMonth();
    const diasCobrados = esMesInicio ? (dias - inicio.getDate() + 1) : dias;
    const monto = esMesInicio ? r2(mant * diasCobrados / dias) : r2(mant);
    cuotas.push({
      anio: cursor.getFullYear(),
      mes: cursor.getMonth() + 1,
      etiqueta: `${MESES[cursor.getMonth()]} ${cursor.getFullYear()}`,
      fechaCorte: ymd(corte),
      monto,
      prorrateado: esMesInicio,
      diasCobrados,
      diasMes: dias,
      vencida: corte.getTime() <= hasta.getTime(),
    });
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
  }
  return cuotas;
}

/** Cuotas ya VENCIDAS e impagas (su fin de mes ya llegó/pasó). */
export function cuotasVencidas(opts: Parameters<typeof cuotasMantenimiento>[0]): CuotaMantenimiento[] {
  return cuotasMantenimiento(opts).filter((c) => c.vencida);
}

const DIA_MS = 24 * 60 * 60 * 1000;

/**
 * Semáforo de cobranza en el modelo fin-de-mes, derivado de las CUOTAS vencidas
 * (NO de `fecha_fin < hoy`, que ahora significa "pagado hasta"):
 *  - vigente:    0 cuotas vencidas (al día; el próximo cobro es a fin de este mes).
 *  - por_vencer: 1 cuota vencida (debe 1 mes; solo aviso, sigue funcionando).
 *  - vencido:    2+ cuotas vencidas (suspendido / cortado).
 * `dias_para_vencer`: al día → días hasta el próximo fin de mes (positivo); con deuda
 * → días desde la 1ra cuota impaga (negativo). `cuotas_vencidas` = cuántas debe.
 */
export function estadoCobranzaMant(opts: Parameters<typeof cuotasMantenimiento>[0]): {
  fecha_limite_pago: string; dias_para_vencer: number;
  estado_cobranza: 'vigente' | 'por_vencer' | 'vencido'; cuotas_vencidas: number;
} {
  const hoy = aMedianoche(opts.hasta);
  const vencidas = cuotasMantenimiento(opts).filter((c) => c.vencida);
  const n = vencidas.length;
  const estado_cobranza = n >= 2 ? 'vencido' : n === 1 ? 'por_vencer' : 'vigente';
  const ref = n === 0
    ? new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0)   // próximo fin de mes
    : aMedianoche(vencidas[0].fechaCorte);                 // 1ra cuota impaga
  return {
    fecha_limite_pago: ymd(ref),
    dias_para_vencer: Math.round((ref.getTime() - hoy.getTime()) / DIA_MS),
    estado_cobranza,
    cuotas_vencidas: n,
  };
}

/** Estado del semáforo de cobranza (común a mensual y prepago). */
export interface CobranzaEstado {
  fecha_limite_pago: string;
  dias_para_vencer: number;
  estado_cobranza: 'vigente' | 'por_vencer' | 'vencido';
  cuotas_vencidas: number;
}

/** Último día del mes que está `n` meses después del mes de `d`. */
function finDeMesMas(d: Date, n: number): Date {
  return aMedianoche(new Date(d.getFullYear(), d.getMonth() + n + 1, 0));
}

/**
 * "Pagado hasta" efectivo (fin de mes): si nunca pagó (null o < inicio), la cobertura
 * termina el fin del mes ANTERIOR al de la implementación → todo el 1er ciclo queda
 * pendiente por adelantado.
 */
function coberturaHasta(fechaInicio: string | Date, pagadoHasta: string | Date | null): Date {
  const inicio = aMedianoche(fechaInicio);
  const piso = new Date(inicio.getFullYear(), inicio.getMonth(), 0); // fin del mes anterior al inicio
  if (!pagadoHasta) return aMedianoche(piso);
  const p = aMedianoche(pagadoHasta);
  return p.getTime() < piso.getTime() ? aMedianoche(piso) : p;
}

/**
 * Meses de PRÓRROGA "agua/luz" para prepago: tras vencer la cobertura, la empresa
 * tiene este margen de gracia (sigue funcionando, solo aviso). Si no paga al pasar
 * ese mes, recién ahí se suspende. Igual criterio que el mensual (corte a la 2da).
 */
const MESES_PRORROGA_PREPAGO = 1;

/**
 * Días ANTES de que se acabe la cobertura en que ya se avisa/cobra la renovación:
 * el resumen muestra el cobro y el cliente ve el aviso desde 1 semana antes.
 */
const AVISO_DIAS_PREPAGO = 7;

/**
 * Semáforo de cobranza para ciclos PREPAGO (semestral/anual): la empresa paga el
 * ciclo por adelantado y `fecha_fin` = "cubierto hasta" (fin de mes). Estados:
 *  - vigente:    aún falta más de 1 semana para que se acabe la cobertura.
 *  - por_vencer: desde 1 semana antes de acabarse la cobertura y durante la prórroga
 *                (1 mes de gracia tras vencer) → se avisa/cobra, sigue funcionando.
 *  - vencido:    pasó la prórroga sin pagar → suspendido (corte).
 * `fecha_limite_pago` = fin de la cobertura vigente (cuándo toca renovar).
 */
export function cobranzaPrepago(opts: {
  fechaInicio: string | Date;
  pagadoHasta: string | Date | null;
  hasta: string | Date;
  mesesVigencia: number;
}): CobranzaEstado {
  const hoy = aMedianoche(opts.hasta);
  const cobertura = coberturaHasta(opts.fechaInicio, opts.pagadoHasta);
  // Aviso: se abre la ventana 1 semana antes de que se acabe la cobertura.
  const avisaDesde = cobertura.getTime() - AVISO_DIAS_PREPAGO * DIA_MS;
  // Prórroga: 1 mes de gracia tras vencer la cobertura (no un ciclo completo).
  const suspendeEn = finDeMesMas(cobertura, MESES_PRORROGA_PREPAGO);
  let estado_cobranza: CobranzaEstado['estado_cobranza'];
  let cuotas_vencidas: number;
  if (hoy.getTime() < avisaDesde) { estado_cobranza = 'vigente';    cuotas_vencidas = 0; }
  else if (hoy.getTime() <= suspendeEn.getTime()) { estado_cobranza = 'por_vencer'; cuotas_vencidas = 1; }
  else { estado_cobranza = 'vencido'; cuotas_vencidas = 2; }
  return {
    fecha_limite_pago: ymd(cobertura),
    dias_para_vencer: Math.round((cobertura.getTime() - hoy.getTime()) / DIA_MS),
    estado_cobranza,
    cuotas_vencidas,
  };
}

/** La próxima renovación PREPAGO de una empresa (un ciclo). Siempre existe; `cobrableAhora`
 *  indica si ya se puede cobrar (ventana de 7 días antes / vencido) o es solo preview. */
export interface CobroPrepago {
  mesesPago: number;
  mesesVigencia: number;
  montoPlan: number;        // meses_pago × mantenimiento mensual
  etiquetaVentana: string;  // "julio–diciembre 2026"
  nuevaCobertura: string;   // 'YYYY-MM-DD' fin de mes hasta donde cubre al pagar
  cobrableAhora: boolean;   // true = ya se puede cobrar; false = preview (aún cubierto, opacado)
  fechaCorte: string;       // 'YYYY-MM-DD' fin de la cobertura actual (cuándo se cobra la renovación)
}
export function proximaRenovacionPrepago(opts: {
  fechaInicio: string | Date;
  pagadoHasta: string | Date | null;
  mantenimientoMensual: number;
  hasta: string | Date;
  mesesPago: number;
  mesesVigencia: number;
}): CobroPrepago {
  const hoy = aMedianoche(opts.hasta);
  const mp = Math.max(1, Number(opts.mesesPago) || 1);
  const mv = Math.max(mp, Number(opts.mesesVigencia) || mp);
  const mant = Number(opts.mantenimientoMensual) || 0;
  const cobertura = coberturaHasta(opts.fechaInicio, opts.pagadoHasta);
  // Cobrable desde 1 semana antes de que se acabe la cobertura (y después de vencida).
  const avisaDesde = cobertura.getTime() - AVISO_DIAS_PREPAGO * DIA_MS;
  const cobrableAhora = hoy.getTime() >= avisaDesde;
  const nuevaCobertura = finDeMesMas(cobertura, mv);
  const mesIni = new Date(cobertura.getFullYear(), cobertura.getMonth() + 1, 1); // 1er mes de la ventana
  const etiquetaVentana = mesIni.getFullYear() === nuevaCobertura.getFullYear()
    ? `${MESES[mesIni.getMonth()]}–${MESES[nuevaCobertura.getMonth()]} ${nuevaCobertura.getFullYear()}`
    : `${MESES[mesIni.getMonth()]} ${mesIni.getFullYear()}–${MESES[nuevaCobertura.getMonth()]} ${nuevaCobertura.getFullYear()}`;
  return { mesesPago: mp, mesesVigencia: mv, montoPlan: r2(mant * mp), etiquetaVentana, nuevaCobertura: ymd(nuevaCobertura), cobrableAhora, fechaCorte: ymd(cobertura) };
}
/** El cobro PREPAGO ya cobrable (o null si todavía es solo preview). Lo usan pago/venta. */
export function cobroPrepagoPendiente(opts: Parameters<typeof proximaRenovacionPrepago>[0]): CobroPrepago | null {
  const p = proximaRenovacionPrepago(opts);
  return p.cobrableAhora ? p : null;
}

/**
 * Semáforo de cobranza unificado: mensual (motor fin-de-mes) o prepago (por ciclo),
 * según `mesesVigencia` (1 = mensual; >1 = prepago semestral/anual).
 */
export function estadoCobranza(opts: {
  fechaInicio: string | Date;
  pagadoHasta: string | Date | null;
  mantenimientoMensual: number;
  hasta: string | Date;
  mesesVigencia?: number;
}): CobranzaEstado {
  const mv = Math.max(1, Number(opts.mesesVigencia) || 1);
  return mv > 1 ? cobranzaPrepago(opts as any) : estadoCobranzaMant(opts);
}

/**
 * Mantenimiento de UN usuario adicional para un mes dado (anio/mes 1..12).
 * - Si el usuario no existía ese mes (created_at posterior al fin de mes) → 0.
 * - Si es el mes en que se dio de alta → prorrateado por los días reales del mes.
 * - Si ya existía de antes → mantenimiento completo.
 */
export function mantenimientoUsuarioMes(
  createdAt: string | Date, anio: number, mes: number, mensual: number,
): { monto: number; prorrateado: boolean; dias: number; diasMes: number } {
  const alta = aMedianoche(createdAt);
  const finMes = new Date(anio, mes, 0);          // último día del mes (mes es 1..12)
  const dm = finMes.getDate();
  if (alta.getTime() > aMedianoche(finMes).getTime()) return { monto: 0, prorrateado: false, dias: 0, diasMes: dm };
  const esMesAlta = alta.getFullYear() === anio && alta.getMonth() + 1 === mes;
  const dias = esMesAlta ? (dm - alta.getDate() + 1) : dm;
  return { monto: r2(Number(mensual) * dias / dm), prorrateado: esMesAlta, dias, diasMes: dm };
}
