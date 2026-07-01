/**
 * Repositorio de cotizaciones: propuestas económicas previas a la venta.
 * Cotizar NO consume créditos ni emite nada a SUNAT. Al "convertir en venta"
 * se reutiliza el motor de comprobantes (comprobanteRepo.registrarVenta /
 * registrarVentaManual), sin duplicar la lógica de créditos/IGV/renovación.
 */
import type { PoolConnection } from 'mysql2/promise';
import { pool } from '../certificados/shared/db.helper';
import { comprobanteRepo } from '../facturacion/comprobante.repository';
import {
  Cotizacion, CotizacionConDetalle, CotizacionEntity, NuevaCotizacionInput, r2,
} from './cotizacion.entity';

/** SELECT base con estado + empresa + número de comprobante convertido. */
const SELECT_BASE = `
  SELECT c.*, ce.codigo AS estado, ce.nombre AS estado_nombre,
         e.razon_social AS empresa,
         CONCAT(cp.serie, '-', cp.correlativo) AS comprobante_numero
    FROM cotizaciones c
    JOIN cotizacion_estado ce ON ce.id = c.estado_id
    LEFT JOIN empresas e      ON e.id  = c.empresa_id
    LEFT JOIN comprobantes cp ON cp.id = c.comprobante_id`;

/** Reserva el siguiente número anual (COT-2026-0001) de forma atómica. */
async function siguienteNumero(conn: PoolConnection): Promise<string> {
  const anio = new Date().getFullYear();
  await conn.query(
    `INSERT INTO cotizacion_series (anio, correlativo) VALUES (?, 1)
     ON DUPLICATE KEY UPDATE correlativo = correlativo + 1`,
    [anio],
  );
  const [rows] = await conn.query<any[]>('SELECT correlativo FROM cotizacion_series WHERE anio = ?', [anio]);
  const corr = Number(rows[0]?.correlativo ?? 1);
  return `COT-${anio}-${String(corr).padStart(4, '0')}`;
}

/** Calcula subtotal, descuento y total (todo con IGV = lo que se ve). */
function calcularTotales(
  items: NuevaCotizacionInput['items'],
  descuento?: { tipo: 'monto' | 'pct'; valor: number },
) {
  const subtotal = r2(items.reduce((a, it) => a + (Number(it.cantidad) || 0) * (Number(it.precioUnitario) || 0), 0));
  let descuentoMonto = 0;
  if (descuento && descuento.valor > 0) {
    descuentoMonto = descuento.tipo === 'pct'
      ? r2(subtotal * Math.min(descuento.valor, 100) / 100)
      : r2(Math.min(descuento.valor, subtotal));
  }
  const total = r2(subtotal - descuentoMonto);
  return { subtotal, descuentoMonto, total };
}

export const cotizacionRepo = {
  /** Crea una cotización (empresa registrada o prospecto) con sus líneas. */
  async crear(input: NuevaCotizacionInput): Promise<CotizacionConDetalle> {
    if (!input.items?.length) throw new Error('La cotización no tiene líneas. Agrega al menos un producto.');

    // ── Resolver el cliente (snapshot) ──
    let empresaId: number | null = input.empresaId ?? null;
    let tipoDoc = '6', numDoc = '0', razonSocial = '', email: string | null = null;

    if (empresaId) {
      const [rows] = await pool().query<any[]>(
        'SELECT razon_social, ruc, tipo_doc FROM empresas WHERE id = ? LIMIT 1', [empresaId],
      );
      if (!rows.length) throw new Error('La empresa seleccionada no existe.');
      razonSocial = rows[0].razon_social;
      numDoc      = rows[0].ruc ?? '0';
      tipoDoc     = rows[0].tipo_doc ?? '6';
    } else if (input.cliente) {
      razonSocial = String(input.cliente.razonSocial ?? '').trim();
      tipoDoc     = input.cliente.tipoDoc || '1';
      numDoc      = tipoDoc === '0' ? '0' : String(input.cliente.numDoc ?? '').trim();
      email       = input.cliente.email?.trim() || null;
      if (!razonSocial) throw new Error('Falta el nombre del cliente.');
      if (tipoDoc !== '0' && !numDoc) throw new Error('Falta el documento del cliente.');
    } else {
      throw new Error('Falta el cliente: elige una empresa o ingresa un prospecto.');
    }

    const igvIncluido = input.igvIncluido !== false;
    const descuento = input.descuento && Number(input.descuento.valor) > 0
      ? { tipo: input.descuento.tipo === 'pct' ? 'pct' as const : 'monto' as const, valor: Number(input.descuento.valor) }
      : undefined;
    const { subtotal, descuentoMonto, total } = calcularTotales(input.items, descuento);

    const conn = await pool().getConnection();
    let cotizacionId = 0;
    try {
      await conn.beginTransaction();
      const numero = await siguienteNumero(conn);

      const [ins] = await conn.query<any>(
        `INSERT INTO cotizaciones
           (numero, empresa_id, cliente_tipo_doc, cliente_num_doc, cliente_razon_social, cliente_email,
            moneda, igv_incluido, subtotal, descuento_tipo, descuento_valor, descuento_monto, total,
            notas, valida_hasta, estado_id, created_by)
         VALUES (?, ?, ?, ?, ?, ?, 'PEN', ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
        [
          numero, empresaId, tipoDoc, numDoc, razonSocial.slice(0, 190), email,
          igvIncluido ? 1 : 0, subtotal, descuento?.tipo ?? null, descuento?.valor ?? 0, descuentoMonto, total,
          input.notas?.trim() || null, input.validaHasta || null, input.createdBy ?? null,
        ],
      );
      cotizacionId = ins.insertId;

      let orden = 1;
      for (const it of input.items) {
        const cantidad = Math.max(1, Number(it.cantidad) || 1);
        const precio = r2(Number(it.precioUnitario) || 0);
        await conn.query(
          `INSERT INTO cotizacion_detalle
             (cotizacion_id, orden, descripcion, cantidad, precio_unitario, total, creditos, renueva)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            cotizacionId, orden++, String(it.descripcion ?? 'Producto').slice(0, 250),
            cantidad, precio, r2(cantidad * precio),
            it.creditos ? Math.max(0, Number(it.creditos)) : null, it.renueva ? 1 : 0,
          ],
        );
      }

      await conn.commit();
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }

    const cot = await this.getById(cotizacionId);
    if (!cot) throw new Error('No se pudo leer la cotización recién creada.');
    return cot;
  },

  /** Lista de cotizaciones (más recientes primero). */
  async list(limit = 200): Promise<Cotizacion[]> {
    const [rows] = await pool().query<any[]>(
      `${SELECT_BASE} ORDER BY c.id DESC LIMIT ?`,
      [Math.min(Number(limit) || 200, 1000)],
    );
    return rows.map(CotizacionEntity.fromRow);
  },

  /** Una cotización con su detalle. */
  async getById(id: number): Promise<CotizacionConDetalle | null> {
    const [rows] = await pool().query<any[]>(`${SELECT_BASE} WHERE c.id = ? LIMIT 1`, [id]);
    if (!rows.length) return null;
    const [det] = await pool().query<any[]>(
      `SELECT orden, descripcion, cantidad, precio_unitario, total, creditos, renueva
         FROM cotizacion_detalle WHERE cotizacion_id = ? ORDER BY orden`,
      [id],
    );
    return {
      ...CotizacionEntity.fromRow(rows[0]),
      detalle: det.map((d) => ({
        orden: d.orden, descripcion: d.descripcion,
        cantidad: Number(d.cantidad), precio_unitario: Number(d.precio_unitario), total: Number(d.total),
        creditos: d.creditos != null ? Number(d.creditos) : null, renueva: !!d.renueva,
      })),
    };
  },

  /** Cambia el estado (BORRADOR/ENVIADA/ACEPTADA/RECHAZADA/VENCIDA). */
  async cambiarEstado(id: number, estadoId: number): Promise<CotizacionConDetalle> {
    if (![1, 2, 3, 4, 5].includes(estadoId)) throw new Error('Estado inválido.');
    const [res] = await pool().query<any>('UPDATE cotizaciones SET estado_id = ? WHERE id = ?', [estadoId, id]);
    if (!res.affectedRows) throw new Error('Cotización no encontrada.');
    const cot = await this.getById(id);
    if (!cot) throw new Error('Cotización no encontrada.');
    return cot;
  },

  /**
   * Convierte la cotización en una venta real reutilizando el motor de
   * comprobantes. Empresa → registrarVenta (créditos/renovación); prospecto →
   * registrarVentaManual (solo boleta/NV). Marca la cotización ACEPTADA y guarda
   * el comprobante generado.
   */
  async convertirEnVenta(id: number, tipoComprobante: '01' | '03' | 'NV') {
    const cot = await this.getById(id);
    if (!cot) throw new Error('Cotización no encontrada.');
    if (cot.comprobante_id) throw new Error('Esta cotización ya fue convertida en venta.');

    // Regla: FACTURA = solo empresa registrada con RUC. BOLETA/NV = con DNI o cualquier cliente.
    if (tipoComprobante === '01') {
      if (!cot.empresa_id) throw new Error('La factura solo se emite a empresas registradas. Usa boleta o nota de venta.');
      if (cot.cliente_tipo_doc !== '6' || !cot.cliente_num_doc || cot.cliente_num_doc === '0') {
        throw new Error('La factura requiere que el cliente tenga RUC.');
      }
    }

    const items = cot.detalle.map((d) => ({
      descripcion: d.descripcion,
      cantidad: d.cantidad,
      precioUnitario: d.precio_unitario,
      creditos: d.creditos ?? undefined,
      renueva: d.renueva || undefined,
    }));
    const descuento = cot.descuento_tipo && cot.descuento_valor > 0
      ? { tipo: cot.descuento_tipo, valor: cot.descuento_valor }
      : undefined;

    let resultado;
    if (cot.empresa_id) {
      resultado = await comprobanteRepo.registrarVenta({
        empresaId: cot.empresa_id, items, descuento, tipoComprobante,
      });
    } else {
      // Prospecto (sin empresa): solo boleta o nota de venta.
      const tipoManual = tipoComprobante === 'NV' ? 'NV' : '03';
      resultado = await comprobanteRepo.registrarVentaManual({
        cliente: { tipoDoc: cot.cliente_tipo_doc, numDoc: cot.cliente_num_doc, razonSocial: cot.cliente_razon_social },
        items, descuento, tipoComprobante: tipoManual,
      });
    }

    const comprobanteId = (resultado.comprobante as any)?.id;
    await pool().query(
      'UPDATE cotizaciones SET comprobante_id = ?, estado_id = 3 WHERE id = ?',
      [comprobanteId ?? null, id],
    );

    return { comprobante: resultado.comprobante, cotizacion: await this.getById(id) };
  },
};
