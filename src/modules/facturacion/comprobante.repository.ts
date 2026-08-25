/**
 * Repositorio de comprobantes electrónicos: orquesta la emisión completa
 * (correlativo atómico → persistir PENDIENTE → firmar → enviar a SUNAT →
 * guardar veredicto + CDR) y las consultas para la UI de sistemas-vaxa.
 */
import { pool } from '../certificados/shared/db.helper';
import { cuotasVencidas, cobroPrepagoPendiente } from '../certificados/planes/mantenimiento.helper';
import { construirFacturaXml, calcularTotales } from './ubl/factura.builder';
import { construirNotaXml, TipoNota } from './ubl/nota.builder';
import { construirResumenXml } from './ubl/resumen.builder';
import { firmarXml } from './sunat/xml.signer';
import { enviarComprobante, enviarResumen } from './sunat/envio.service';
import { DatosComprobante, ItemComprobante, TipoComprobante, TotalesComprobante } from './comprobante.types';
import { VeredictoSunat } from './sunat/cdr';

export interface EmitirNotaInput {
  comprobanteOrigenId: number;
  tipoNota: TipoNota;            // '07' crédito | '08' débito
  motivoCodigo: string;         // cat.09 / cat.10
  motivoDescripcion: string;
}

/** Una línea de la venta (estilo comprobante: descripción + cantidad + precio). */
export interface VentaItem {
  descripcion: string;
  cantidad: number;
  precioUnitario: number;       // CON IGV (lo que se ve y se escribe)
  creditos?: number;            // total de créditos que otorga esta línea (paquete)
  renueva?: boolean;            // si renueva la suscripción (mantenimiento)
  descuentoTipo?: 'monto' | 'pct'; // descuento propio de ESTA línea (independiente del global)
  descuentoValor?: number;         // %: sobre el importe de la línea · monto: soles sobre el importe
}

export interface VentaInput {
  empresaId: number;
  items: VentaItem[];
  descuento?: { tipo: 'monto' | 'pct'; valor: number };
  tipoComprobante?: TipoComprobante;  // default 01 factura
  registrarPago?: boolean;            // registrar el pago (default true)
  marcarActivacionUsuarios?: number[]; // usuarios cuya activación (S/50) se cobra en esta venta
  notas?: string | null;              // observaciones para el PDF (no van a SUNAT). Admite párrafos.
}

export interface EmitirInput {
  empresaId: number | null;            // null = cliente manual (persona, sin empresa registrada)
  tipoComprobante?: TipoComprobante;   // '01' factura (default) | '03' boleta | 'NV' nota de venta
  pagoId?: number | null;
  items: ItemComprobante[];
  /** Cliente alternativo (boleta/NV a persona con DNI). Si no, se toma de la empresa. */
  cliente?: { tipoDoc: string; numDoc: string; razonSocial: string; direccion?: string };
  /** Notas/observaciones para la representación impresa (no van a SUNAT). Admite párrafos. */
  notas?: string | null;
}

/** Serie por defecto según el tipo. */
function serieDe(tipo: TipoComprobante): string {
  if (tipo === '03') return 'B001';
  if (tipo === 'NV') return 'NV01';     // nota de venta interna
  return 'F001';
}

/** Totales "monto simple" (sin IGV): para la nota de venta. El precio ES el valor. */
function totalesSimples(d: DatosComprobante): TotalesComprobante {
  let gravado = 0;
  const lineas = d.items.map((it) => {
    const valorVenta = r2(it.cantidad * it.valorUnitario);
    gravado += valorVenta;
    return { valorVenta, igv: 0, precioUnitarioConIgv: r2(it.valorUnitario) };
  });
  gravado = r2(gravado);
  return { gravado, igv: 0, total: gravado, lineas };
}

/** Mapea el veredicto de SUNAT al id de estado_comprobante. */
function estadoIdDe(v: VeredictoSunat): number {
  return ({ ACEPTADO: 3, OBSERVADO: 4, RECHAZADO: 5, ERROR: 7 } as const)[v];
}

/**
 * Correlativo del Resumen Diario para una fecha: cuenta las boletas del día
 * (cada boleta se informa en su propio resumen). El RC queda RC-YYYYMMDD-N,
 * único por día porque cada boleta incrementa el conteo.
 */
async function correlativoResumenDelDia(fecha: string): Promise<number> {
  const [c] = await pool().query<any[]>(
    `SELECT COUNT(*) AS n FROM comprobantes WHERE tipo_comprobante = '03' AND fecha_emision = ?`,
    [fecha],
  );
  return Math.max(1, Number(c[0]?.n ?? 1));
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Precio unitario NETO de una línea tras aplicar SU PROPIO descuento (mismos
 * "soles" que precioUnitario, es decir CON IGV). El descuento por línea se
 * "hornea" en el precio unitario antes de la proration del descuento global,
 * así el XML de SUNAT no cambia y el IGV cuadra.
 *   · pct   → precio * (1 - pct/100)
 *   · monto → se descuenta del importe de la línea (cantidad * precio)
 */
function precioUnitarioNetoLinea(it: VentaItem): number {
  const precio = r2(Number(it.precioUnitario) || 0);
  const cant = Math.max(1, Number(it.cantidad) || 1);
  const v = Number(it.descuentoValor) || 0;
  if (v <= 0) return precio;
  if (it.descuentoTipo === 'pct') return r2(precio * (1 - Math.min(v, 100) / 100));
  const importe = r2(cant * precio);
  const neto = Math.max(0, importe - Math.min(v, importe));
  return r2(neto / cant);
}

/** Arma la descripción de la línea de la factura según el concepto del pago + plan. */
function descripcionPago(p: { concepto_codigo?: string; concepto?: string; plan_nombre?: string | null; ciclo?: string | null }): string {
  const plan = p.plan_nombre?.trim();
  const ciclo = p.ciclo?.trim();
  switch (p.concepto_codigo) {
    case 'suscripcion':
      return plan ? `Suscripción ${plan}${ciclo ? ` (${ciclo})` : ''}` : 'Suscripción';
    case 'excedente':
      return plan ? `Certificados adicionales - ${plan}` : 'Certificados adicionales';
    case 'setup':
      return plan ? `Implementación inicial - ${plan}` : 'Implementación inicial';
    default:
      return p.concepto ?? 'Servicio';
  }
}

/** Normaliza una fecha de MySQL (Date u string) a 'YYYY-MM-DD'. */
function ymd(v: any): string | null {
  if (v == null) return null;
  if (v instanceof Date) {
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
  }
  return String(v).slice(0, 10);
}

export const comprobanteRepo = {
  /** Emite un comprobante de punta a punta. Devuelve el comprobante guardado. */
  async emitir(input: EmitirInput) {
    const tipo = input.tipoComprobante ?? '01';
    const serie = serieDe(tipo);

    let empresa: any = null;
    if (input.empresaId) {
      const [emp] = await pool().query<any[]>(
        'SELECT id, ruc, tipo_doc, razon_social, dominio FROM empresas WHERE id = ? LIMIT 1',
        [input.empresaId],
      );
      if (!emp.length) throw new Error('Empresa (cliente) no encontrada');
      empresa = emp[0];
    }

    // Cliente: explícito (manual / persona con DNI), o derivado de la empresa según su tipo_doc.
    // La boleta NO admite RUC (cat.06): si la empresa es RUC va "sin documento"; si es DNI/CE usa su doc.
    const docEmp = empresa?.tipo_doc || '6';
    const cliente = input.cliente ?? (empresa
      ? (tipo === '03'
          ? (docEmp !== '6' && empresa.ruc
              ? { tipoDoc: docEmp, numDoc: empresa.ruc, razonSocial: empresa.razon_social || 'CLIENTE', direccion: undefined as string | undefined }
              : { tipoDoc: '0', numDoc: '0', razonSocial: empresa.razon_social || 'CLIENTES VARIOS', direccion: undefined as string | undefined })
          : { tipoDoc: docEmp, numDoc: empresa.ruc ?? '', razonSocial: empresa.razon_social ?? '', direccion: undefined as string | undefined })
      : null);
    if (!cliente) throw new Error('Falta el cliente: sin empresa debes enviar el cliente manual (DNI + nombre).');
    if (tipo === '01' && (!cliente.numDoc || cliente.tipoDoc !== '6')) {
      throw new Error('Para una factura el cliente debe tener RUC. Agrega el RUC de la empresa o emite boleta.');
    }
    if (!input.items?.length) throw new Error('El comprobante debe tener al menos un ítem.');

    const fechaEmision = new Date().toISOString().slice(0, 10);
    const horaEmision = new Date().toTimeString().slice(0, 8);

    // ── 1) Reservar correlativo + insertar PENDIENTE (transacción corta) ──
    const conn = await pool().getConnection();
    let comprobanteId = 0;
    let correlativo = 0;
    let datos: DatosComprobante;
    try {
      await conn.beginTransaction();
      const [s] = await conn.query<any[]>(
        'SELECT id, correlativo FROM comprobante_series WHERE tipo_comprobante = ? AND serie = ? AND activo = 1 FOR UPDATE',
        [tipo, serie],
      );
      if (!s.length) throw new Error(`No existe la serie ${serie} para el tipo ${tipo}`);
      correlativo = Number(s[0].correlativo) + 1;
      await conn.query('UPDATE comprobante_series SET correlativo = ? WHERE id = ?', [correlativo, s[0].id]);

      datos = {
        tipoDoc: tipo, serie, correlativo, fechaEmision, horaEmision, moneda: 'PEN',
        cliente, items: input.items,
      };
      // Nota de venta = monto simple (sin IGV); factura/boleta = con IGV.
      const tot = tipo === 'NV' ? totalesSimples(datos) : calcularTotales(datos);

      const notas = input.notas?.trim() ? input.notas.trim().slice(0, 1000) : null;
      const [ins] = await conn.query<any>(
        `INSERT INTO comprobantes
          (empresa_id, pago_id, tipo_comprobante, serie, correlativo, fecha_emision, hora_emision, moneda,
           cliente_tipo_doc, cliente_num_doc, cliente_razon_social, cliente_direccion, notas,
           total_gravado, total_igv, importe_total, estado_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'PEN', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          input.empresaId ?? null, input.pagoId ?? null, tipo, serie, correlativo, fechaEmision, horaEmision,
          cliente.tipoDoc, cliente.numDoc, cliente.razonSocial, cliente.direccion ?? null, notas,
          tot.gravado, tot.igv, tot.total, tipo === 'NV' ? 8 : 1,   // 8 = EMITIDA (no SUNAT) · 1 = PENDIENTE
        ],
      );
      comprobanteId = ins.insertId;

      for (let i = 0; i < input.items.length; i++) {
        const it = input.items[i];
        const ln = tot.lineas[i];
        await conn.query(
          `INSERT INTO comprobante_detalle
            (comprobante_id, orden, descripcion, unidad, cantidad, valor_unitario, precio_unitario, tipo_afectacion, valor_total, igv)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [comprobanteId, i + 1, it.descripcion, it.unidad ?? 'NIU', it.cantidad,
           it.valorUnitario, ln.precioUnitarioConIgv, it.tipoAfectacion ?? '10', ln.valorVenta, ln.igv],
        );
      }
      await conn.commit();
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }

    // Nota de venta: documento INTERNO, no se declara a SUNAT. Ya quedó EMITIDA;
    // no se arma XML ni se firma ni se envía. Solo se vincula el pago y se devuelve.
    if (tipo === 'NV') {
      if (input.pagoId) {
        await pool().query('UPDATE pagos SET comprobante_id = ? WHERE id = ?', [comprobanteId, input.pagoId]);
      }
      return comprobanteRepo.getById(comprobanteId);
    }

    // ── 2) Construir + firmar la boleta/factura (fuera de la transacción) ──
    const { xml } = construirFacturaXml(datos);
    const { xmlFirmado, digestValue } = firmarXml(xml);

    let veredicto: VeredictoSunat = 'ERROR';
    let codigo: string | null = null;
    let descripcion = '';
    let cdrXml: string | undefined;
    try {
      if (tipo === '03') {
        // Boleta: NO va por sendBill. Se informa a SUNAT en un Resumen Diario
        // (sendSummary → ticket → getStatus). El CDR es del resumen.
        const t = calcularTotales(datos);
        const rcCorrelativo = await correlativoResumenDelDia(fechaEmision);
        const rcId = `RC-${fechaEmision.replace(/-/g, '')}-${rcCorrelativo}`;
        const resumen = construirResumenXml({
          id: rcId,
          fechaReferencia: fechaEmision,
          fechaGeneracion: fechaEmision,
          boletas: [{
            serie, correlativo,
            clienteTipoDoc: cliente.tipoDoc, clienteNumDoc: cliente.numDoc,
            gravado: t.gravado, igv: t.igv, total: t.total,
          }],
        });
        const { xmlFirmado: resumenFirmado } = firmarXml(resumen.xml);
        const r = await enviarResumen({ id: rcId, xmlFirmado: resumenFirmado });
        veredicto = r.veredicto; codigo = r.codigo;
        descripcion = r.ticket ? `${r.descripcion} (ticket ${r.ticket})` : r.descripcion;
        cdrXml = r.cdrXml;
      } else {
        const r = await enviarComprobante({ tipoSunat: tipo, serie, correlativo, xmlFirmado });
        veredicto = r.veredicto; codigo = r.codigo; descripcion = r.descripcion; cdrXml = r.cdrXml;
      }
    } catch (e) {
      descripcion = `Error de comunicación con SUNAT: ${(e as Error).message}`;
    }

    // ── 3) Guardar veredicto + XML + CDR ──
    await pool().query(
      `UPDATE comprobantes
          SET estado_id = ?, sunat_resp_codigo = ?, sunat_resp_desc = ?, hash_cpe = ?, xml_firmado = ?, cdr_xml = ?
        WHERE id = ?`,
      [estadoIdDe(veredicto), codigo ? String(codigo).slice(0, 10) : null, descripcion.slice(0, 255), digestValue, xmlFirmado, cdrXml ?? null, comprobanteId],
    );

    // Vincular el pago si la emisión fue aceptada.
    if (input.pagoId && (veredicto === 'ACEPTADO' || veredicto === 'OBSERVADO')) {
      await pool().query('UPDATE pagos SET comprobante_id = ? WHERE id = ?', [comprobanteId, input.pagoId]);
    }

    return comprobanteRepo.getById(comprobanteId);
  },

  /**
   * Emite una nota de crédito/débito sobre un comprobante ya emitido.
   * Copia los ítems del original (anulación/devolución total).
   */
  async emitirNota(input: EmitirNotaInput) {
    const origen = await comprobanteRepo.getById(input.comprobanteOrigenId);
    if (!origen) throw new Error('Comprobante de origen no encontrado');
    if (!['01', '03'].includes(origen.tipo_comprobante)) {
      throw new Error('Solo se pueden emitir notas sobre facturas o boletas.');
    }
    // Serie de la nota según el documento de origen.
    const serie = (origen.tipo_comprobante === '01' ? 'F' : 'B') + (input.tipoNota === '07' ? 'C01' : 'D01');
    const items: ItemComprobante[] = origen.detalle.map((d) => ({
      descripcion: d.descripcion, cantidad: d.cantidad, valorUnitario: d.valor_unitario, unidad: d.unidad,
    }));

    const fechaEmision = new Date().toISOString().slice(0, 10);
    const horaEmision = new Date().toTimeString().slice(0, 8);
    const cliente = {
      tipoDoc: origen.cliente_tipo_doc ?? '6', numDoc: origen.cliente_num_doc,
      razonSocial: origen.cliente_razon_social,
    };

    // 1) Reservar correlativo + insertar PENDIENTE
    const conn = await pool().getConnection();
    let comprobanteId = 0; let correlativo = 0;
    try {
      await conn.beginTransaction();
      const [s] = await conn.query<any[]>(
        'SELECT id, correlativo FROM comprobante_series WHERE tipo_comprobante = ? AND serie = ? AND activo = 1 FOR UPDATE',
        [input.tipoNota, serie],
      );
      if (!s.length) throw new Error(`No existe la serie ${serie} para notas tipo ${input.tipoNota}`);
      correlativo = Number(s[0].correlativo) + 1;
      await conn.query('UPDATE comprobante_series SET correlativo = ? WHERE id = ?', [correlativo, s[0].id]);

      const tot = calcularTotales({ items } as any);
      const [ins] = await conn.query<any>(
        `INSERT INTO comprobantes
          (empresa_id, tipo_comprobante, serie, correlativo, fecha_emision, hora_emision, moneda,
           cliente_tipo_doc, cliente_num_doc, cliente_razon_social,
           total_gravado, total_igv, importe_total,
           ref_tipo_comprobante, ref_serie_correlativo, nota_motivo_codigo, nota_motivo_desc, estado_id)
         VALUES (?, ?, ?, ?, ?, ?, 'PEN', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        [origen.empresa_id, input.tipoNota, serie, correlativo, fechaEmision, horaEmision,
         cliente.tipoDoc, cliente.numDoc, cliente.razonSocial,
         tot.gravado, tot.igv, tot.total,
         origen.tipo_comprobante, origen.numero, input.motivoCodigo, input.motivoDescripcion.slice(0, 190)],
      );
      comprobanteId = ins.insertId;
      for (let i = 0; i < items.length; i++) {
        const it = items[i]; const ln = tot.lineas[i];
        await conn.query(
          `INSERT INTO comprobante_detalle (comprobante_id, orden, descripcion, unidad, cantidad, valor_unitario, precio_unitario, tipo_afectacion, valor_total, igv)
           VALUES (?, ?, ?, ?, ?, ?, ?, '10', ?, ?)`,
          [comprobanteId, i + 1, it.descripcion, it.unidad ?? 'NIU', it.cantidad, it.valorUnitario, ln.precioUnitarioConIgv, ln.valorVenta, ln.igv],
        );
      }
      await conn.commit();
    } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }

    // 2) Construir + firmar + enviar
    const { xml } = construirNotaXml({
      tipoNota: input.tipoNota, serie, correlativo, fechaEmision, horaEmision, moneda: 'PEN',
      refTipo: origen.tipo_comprobante, refSerieCorrelativo: origen.numero,
      motivoCodigo: input.motivoCodigo, motivoDescripcion: input.motivoDescripcion,
      cliente, items,
    });
    const { xmlFirmado, digestValue } = firmarXml(xml);

    let veredicto: VeredictoSunat = 'ERROR'; let codigo: string | null = null; let descripcion = ''; let cdrXml: string | undefined;
    try {
      const r = await enviarComprobante({ tipoSunat: input.tipoNota, serie, correlativo, xmlFirmado });
      veredicto = r.veredicto; codigo = r.codigo; descripcion = r.descripcion; cdrXml = r.cdrXml;
    } catch (e) { descripcion = `Error de comunicación con SUNAT: ${(e as Error).message}`; }

    await pool().query(
      `UPDATE comprobantes SET estado_id = ?, sunat_resp_codigo = ?, sunat_resp_desc = ?, hash_cpe = ?, xml_firmado = ?, cdr_xml = ? WHERE id = ?`,
      [estadoIdDe(veredicto), codigo ? String(codigo).slice(0, 10) : null, descripcion.slice(0, 255), digestValue, xmlFirmado, cdrXml ?? null, comprobanteId],
    );
    return comprobanteRepo.getById(comprobanteId);
  },

  /**
   * Emite una factura a partir de un pago ya registrado (plan o certificados
   * adicionales). Toma el monto y el concepto del pago. Vincula el comprobante
   * al pago. El monto del pago INCLUYE IGV (se convierte a valor sin IGV).
   */
  async emitirDesdePago(pagoId: number, igvPct = 18) {
    const [rows] = await pool().query<any[]>(
      `SELECT pg.id, pg.empresa_id, pg.monto, pg.comprobante_id,
              cp.codigo AS concepto_codigo, cp.nombre AS concepto,
              p.nombre AS plan_nombre, ci.nombre AS ciclo,
              e.tipo_doc AS empresa_tipo_doc
         FROM pagos pg
         JOIN concepto_pago cp ON cp.id = pg.concepto_id
         LEFT JOIN empresas e             ON e.id  = pg.empresa_id
         LEFT JOIN empresa_suscripcion s  ON s.id  = pg.suscripcion_id
         LEFT JOIN planes p               ON p.id  = s.plan_id
         LEFT JOIN ciclo_facturacion ci   ON ci.id = s.ciclo_id
        WHERE pg.id = ? LIMIT 1`,
      [pagoId],
    );
    if (!rows.length) throw new Error('Pago no encontrado');
    const pago = rows[0];
    if (pago.comprobante_id) throw new Error('Este pago ya tiene un comprobante emitido.');
    if (!pago.empresa_id) throw new Error('El pago no está asociado a una empresa.');

    // Regla SUNAT: FACTURA (01) solo para RUC; PERSONA (DNI/CE/pasaporte) → BOLETA (03).
    // Nunca se emite factura a un DNI (SUNAT la rechaza / multa).
    const tipoComprobante: TipoComprobante = (pago.empresa_tipo_doc || '6') === '6' ? '01' : '03';
    const valorUnitario = Math.round((Number(pago.monto) / (1 + igvPct / 100)) * 100) / 100;
    return comprobanteRepo.emitir({
      empresaId: pago.empresa_id,
      pagoId: pago.id,
      tipoComprobante,
      items: [{ descripcion: descripcionPago(pago), cantidad: 1, valorUnitario, unidad: 'ZZ' }],
    });
  },

  /**
   * Registra una VENTA completa: arma las líneas (plan + adicionales + setup),
   * aplica el descuento (prorrateado en las líneas para que el IGV cuadre con
   * SUNAT), registra el pago, emite el comprobante y renueva la suscripción si
   * incluye el plan. Una sola acción cierra la venta.
   */
  async registrarVenta(input: VentaInput) {
    const igvPct = 18;
    // Nota de venta = monto simple (el precio escrito ES el valor, sin extraer IGV).
    const f = input.tipoComprobante === 'NV' ? 1 : 1 + igvPct / 100;
    if (!input.items?.length) throw new Error('La venta no tiene líneas. Agrega al menos un producto.');

    // Suscripción vigente (para vincular el pago y avanzar el mantenimiento). Tolerante.
    const [ss] = await pool().query<any[]>(
      `SELECT s.id AS suscripcion_id, s.fecha_inicio, s.fecha_fin, p.mantenimiento_mensual,
              ci.meses_pago, ci.meses_vigencia
         FROM empresa_suscripcion s
         JOIN planes p             ON p.id  = s.plan_id
         JOIN ciclo_facturacion ci ON ci.id = s.ciclo_id
        WHERE s.empresa_id = ? AND s.estado_id = 1
        ORDER BY s.id DESC LIMIT 1`,
      [input.empresaId],
    );
    const suscripcionId = ss[0]?.suscripcion_id ?? null;

    // ── Líneas libres → ItemComprobante (precio CON IGV, ya neto del descuento
    //    de la propia línea, → valor SIN IGV) ──
    const items: ItemComprobante[] = input.items.map((it) => ({
      descripcion: String(it.descripcion ?? 'Producto').slice(0, 250),
      cantidad: Math.max(1, Number(it.cantidad) || 1),
      valorUnitario: r2(precioUnitarioNetoLinea(it) / f),
      unidad: 'ZZ',
    }));

    // ── Descuento global, prorrateado en las líneas (sobre el total con IGV) ──
    const totalBruto = r2(items.reduce((a, it) => a + r2(it.cantidad * it.valorUnitario * f), 0));
    let descuento = 0;
    if (input.descuento && input.descuento.valor > 0) {
      descuento = input.descuento.tipo === 'pct'
        ? r2(totalBruto * Math.min(input.descuento.valor, 100) / 100)
        : r2(Math.min(input.descuento.valor, totalBruto));
    }
    const factor = totalBruto > 0 ? (totalBruto - descuento) / totalBruto : 1;
    if (factor !== 1) items.forEach((it) => { it.valorUnitario = r2(it.valorUnitario * factor); });
    const totalNeto = r2(items.reduce((a, it) => a + r2(it.cantidad * it.valorUnitario * f), 0));

    // Metadata de las líneas: créditos a otorgar y si alguna renueva.
    const creditosTotal = input.items.reduce((a, it) => a + (Math.max(0, Number(it.creditos) || 0)), 0);
    const renueva = input.items.some((it) => it.renueva);

    // ── Registrar el pago ──
    let pagoId: number | undefined;
    if (input.registrarPago !== false) {
      const conceptoId = renueva ? 1 : (creditosTotal > 0 ? 3 : 1);
      const [insPago] = await pool().query<any>(
        `INSERT INTO pagos (empresa_id, suscripcion_id, concepto_id, monto, estado_id, fecha_pago)
         VALUES (?, ?, ?, ?, 2, NOW())`,
        [input.empresaId, suscripcionId, conceptoId, totalNeto],
      );
      pagoId = insPago.insertId;
    }

    // ── Emitir el comprobante (líneas ya netas del descuento) ──
    const comprobante = await comprobanteRepo.emitir({
      empresaId: input.empresaId,
      tipoComprobante: input.tipoComprobante ?? '01',
      pagoId: pagoId ?? null,
      items,
      notas: input.notas ?? null,
    });

    // ── Sumar créditos al saldo (si alguna línea los otorga) ──
    if (creditosTotal > 0) {
      await pool().query(
        `UPDATE empresas SET creditos_disponibles = creditos_disponibles + ?,
                             creditos_asignados_total = creditos_asignados_total + ? WHERE id = ?`,
        [creditosTotal, creditosTotal, input.empresaId],
      );
      const [sal] = await pool().query<any[]>('SELECT creditos_disponibles FROM empresas WHERE id = ?', [input.empresaId]);
      await pool().query(
        `INSERT INTO creditos_movimientos (empresa_id, tipo, cantidad, saldo_resultante, descripcion)
         VALUES (?, 'recarga', ?, ?, 'Compra de créditos (venta)')`,
        [input.empresaId, creditosTotal, Number(sal[0]?.creditos_disponibles ?? 0)],
      );
    }

    // ── Mantenimiento pagado → avanzar "pagado hasta" (fecha_fin) ──
    if (renueva && suscripcionId) {
      const mesesVigencia = Number(ss[0].meses_vigencia) || 1;
      if (mesesVigencia > 1) {
        // PREPAGO (semestral/anual): la venta salda el ciclo → "cubierto hasta" salta M meses.
        const pend = cobroPrepagoPendiente({
          fechaInicio: ss[0].fecha_inicio,
          pagadoHasta: ss[0].fecha_fin,
          mantenimientoMensual: Number(ss[0].mantenimiento_mensual) || 0,
          hasta: new Date(),
          mesesPago: Number(ss[0].meses_pago) || 1,
          mesesVigencia,
        });
        if (pend) {
          await pool().query(
            `UPDATE empresa_suscripcion SET fecha_fin = ? WHERE id = ?`,
            [pend.nuevaCobertura, suscripcionId],
          );
        }
      } else {
        // MENSUAL (fin de mes): salda hasta la última cuota de fin de mes vencida.
        const vencidas = cuotasVencidas({
          fechaInicio: ss[0].fecha_inicio,
          pagadoHasta: ss[0].fecha_fin,
          mantenimientoMensual: Number(ss[0].mantenimiento_mensual) || 0,
          hasta: new Date(),
        });
        if (vencidas.length) {
          await pool().query(
            `UPDATE empresa_suscripcion SET fecha_fin = ? WHERE id = ?`,
            [vencidas[vencidas.length - 1].fechaCorte, suscripcionId],
          );
        }
      }
    }

    // ── Marcar la activación (S/50 pago único) de los usuarios adicionales cobrados ──
    const activar = (input.marcarActivacionUsuarios ?? []).filter((n) => Number.isInteger(n) && n > 0);
    if (activar.length) {
      await pool().query(
        `UPDATE usuarios SET activacion_cobrada = 1 WHERE id IN (${activar.map(() => '?').join(',')})`,
        activar,
      ).catch(() => { /* columna aún no migrada: se ignora */ });
    }

    return { comprobante, descuento, total: totalNeto, creditosAgregados: creditosTotal };
  },

  /**
   * Venta a un cliente MANUAL (persona con DNI/CE/sin doc), SIN empresa registrada.
   * Solo boleta (03) o nota de venta (NV). No registra pago ni toca plan/créditos.
   */
  async registrarVentaManual(input: {
    cliente: { tipoDoc: string; numDoc: string; razonSocial: string; direccion?: string };
    items: VentaItem[];
    descuento?: { tipo: 'monto' | 'pct'; valor: number };
    tipoComprobante: '03' | 'NV';
    notas?: string | null;
  }) {
    const igvPct = 18;
    // Nota de venta = monto simple (sin IGV); boleta = con IGV.
    const f = input.tipoComprobante === 'NV' ? 1 : 1 + igvPct / 100;
    if (!input.items?.length) throw new Error('La venta no tiene líneas. Agrega al menos un producto.');
    if (!input.cliente?.razonSocial?.trim()) throw new Error('Falta el nombre del cliente.');
    if (input.cliente.tipoDoc !== '0' && !input.cliente.numDoc?.trim()) throw new Error('Falta el documento del cliente.');

    const items: ItemComprobante[] = input.items.map((it) => ({
      descripcion: String(it.descripcion ?? 'Producto').slice(0, 250),
      cantidad: Math.max(1, Number(it.cantidad) || 1),
      valorUnitario: r2(precioUnitarioNetoLinea(it) / f),
      unidad: 'ZZ',
    }));

    // Descuento global prorrateado en las líneas (para que el IGV cuadre en boleta).
    const totalBruto = r2(items.reduce((a, it) => a + r2(it.cantidad * it.valorUnitario * f), 0));
    let descuento = 0;
    if (input.descuento && input.descuento.valor > 0) {
      descuento = input.descuento.tipo === 'pct'
        ? r2(totalBruto * Math.min(input.descuento.valor, 100) / 100)
        : r2(Math.min(input.descuento.valor, totalBruto));
    }
    const factor = totalBruto > 0 ? (totalBruto - descuento) / totalBruto : 1;
    if (factor !== 1) items.forEach((it) => { it.valorUnitario = r2(it.valorUnitario * factor); });
    const totalNeto = r2(items.reduce((a, it) => a + r2(it.cantidad * it.valorUnitario * f), 0));

    const comprobante = await comprobanteRepo.emitir({
      empresaId: null,
      tipoComprobante: input.tipoComprobante,
      items,
      notas: input.notas ?? null,
      cliente: {
        tipoDoc: input.cliente.tipoDoc,
        numDoc: input.cliente.tipoDoc === '0' ? '0' : input.cliente.numDoc.trim(),
        razonSocial: input.cliente.razonSocial.trim(),
        direccion: input.cliente.direccion,
      },
    });

    return { comprobante, descuento, total: totalNeto, creditosAgregados: 0 };
  },

  /** Lista de comprobantes (más recientes primero) para la UI. */
  async list(limit = 200) {
    const [rows] = await pool().query<any[]>(
      `SELECT c.id, c.tipo_comprobante, td.nombre AS tipo_nombre, c.serie, c.correlativo,
              c.fecha_emision, c.moneda, c.cliente_num_doc, c.cliente_razon_social,
              c.importe_total, c.estado_id, ec.codigo AS estado, ec.nombre AS estado_nombre,
              c.sunat_resp_codigo, c.sunat_resp_desc, c.empresa_id, e.razon_social AS empresa
         FROM comprobantes c
         JOIN estado_comprobante ec ON ec.id = c.estado_id
         LEFT JOIN tipo_comprobante td ON td.codigo_sunat = c.tipo_comprobante
         LEFT JOIN empresas e ON e.id = c.empresa_id
        ORDER BY c.id DESC
        LIMIT ?`,
      [Math.min(Number(limit) || 200, 1000)],
    );
    return rows.map(mapResumen);
  },

  /** Un comprobante con su detalle (sin los XML grandes salvo que se pidan). */
  async getById(id: number) {
    const [rows] = await pool().query<any[]>(
      `SELECT c.*, ec.codigo AS estado, ec.nombre AS estado_nombre, e.razon_social AS empresa
         FROM comprobantes c
         JOIN estado_comprobante ec ON ec.id = c.estado_id
         LEFT JOIN empresas e ON e.id = c.empresa_id
        WHERE c.id = ? LIMIT 1`,
      [id],
    );
    if (!rows.length) return null;
    const c = rows[0];
    const [det] = await pool().query<any[]>(
      'SELECT orden, descripcion, unidad, cantidad, valor_unitario, precio_unitario, valor_total, igv FROM comprobante_detalle WHERE comprobante_id = ? ORDER BY orden',
      [id],
    );
    return {
      ...mapResumen(c),
      hash: c.hash_cpe ?? null,
      cliente_direccion: c.cliente_direccion ?? null,
      notas: c.notas ?? null,
      detalle: det.map((d) => ({
        orden: d.orden, descripcion: d.descripcion, unidad: d.unidad,
        cantidad: Number(d.cantidad), valor_unitario: Number(d.valor_unitario),
        precio_unitario: Number(d.precio_unitario), valor_total: Number(d.valor_total), igv: Number(d.igv),
      })),
      total_gravado: Number(c.total_gravado), total_igv: Number(c.total_igv),
    };
  },

  /** Devuelve el XML firmado o el CDR (para descarga). */
  async getXml(id: number, cual: 'xml' | 'cdr'): Promise<string | null> {
    const col = cual === 'cdr' ? 'cdr_xml' : 'xml_firmado';
    const [rows] = await pool().query<any[]>(`SELECT ${col} AS x FROM comprobantes WHERE id = ? LIMIT 1`, [id]);
    return rows.length ? (rows[0].x ?? null) : null;
  },
};

function mapResumen(c: any) {
  return {
    id: c.id,
    tipo_comprobante: c.tipo_comprobante,
    tipo_nombre: c.tipo_nombre ?? (c.tipo_comprobante === '03' ? 'Boleta' : 'Factura'),
    serie: c.serie,
    correlativo: c.correlativo,
    numero: `${c.serie}-${c.correlativo}`,
    fecha_emision: ymd(c.fecha_emision),
    moneda: c.moneda,
    cliente_tipo_doc: c.cliente_tipo_doc ?? '6',
    cliente_num_doc: c.cliente_num_doc,
    cliente_razon_social: c.cliente_razon_social,
    importe_total: Number(c.importe_total),
    estado: c.estado,
    estado_nombre: c.estado_nombre,
    sunat_resp_codigo: c.sunat_resp_codigo ?? null,
    sunat_resp_desc: c.sunat_resp_desc ?? null,
    empresa_id: c.empresa_id ?? null,
    empresa: c.empresa ?? null,
  };
}
