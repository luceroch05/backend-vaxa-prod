/** Una línea de la cotización (misma forma que VentaItem del comprobante). */
export interface CotizacionDetalle {
  orden: number;
  descripcion: string;
  cantidad: number;
  precio_unitario: number;   // CON IGV (lo que se ve/escribe)
  total: number;             // cantidad * precio_unitario
  creditos: number | null;   // créditos que otorgaría esta línea (paquete)
  renueva: boolean;          // si renovaría la suscripción (mantenimiento)
}

/** Cabecera de una cotización para la lista (sin detalle). */
export interface Cotizacion {
  id: number;
  numero: string;                    // COT-2026-0001
  empresa_id: number | null;         // null = prospecto (no registrado)
  empresa: string | null;            // razón social de la empresa (si aplica)
  cliente_tipo_doc: string;          // cat.06
  cliente_num_doc: string;
  cliente_razon_social: string;
  cliente_email: string | null;
  moneda: string;
  igv_incluido: boolean;
  subtotal: number;
  descuento_tipo: 'monto' | 'pct' | null;
  descuento_valor: number;
  descuento_monto: number;
  total: number;
  notas: string | null;
  valida_hasta: string | null;       // 'YYYY-MM-DD'
  estado_id: number;
  estado: string;                    // codigo (BORRADOR, ENVIADA…)
  estado_nombre: string;
  comprobante_id: number | null;     // comprobante generado al convertir
  comprobante_numero: string | null; // F001-3 / NV01-2…
  created_at: string;
  updated_at: string;
}

/** Cotización con su detalle (getById). */
export interface CotizacionConDetalle extends Cotizacion {
  detalle: CotizacionDetalle[];
}

/** DTO de creación (lo que manda el front). */
export interface NuevaCotizacionInput {
  empresaId?: number | null;
  cliente?: { tipoDoc: string; numDoc: string; razonSocial: string; email?: string };
  items: Array<{ descripcion: string; cantidad: number; precioUnitario: number; creditos?: number; renueva?: boolean }>;
  descuento?: { tipo: 'monto' | 'pct'; valor: number };
  igvIncluido?: boolean;
  notas?: string;
  validaHasta?: string;   // 'YYYY-MM-DD'
  createdBy?: number;
}

/** Redondeo a 2 decimales (mismo criterio que el motor de comprobantes). */
export const r2 = (n: number): number => Math.round((Number(n) || 0) * 100) / 100;

const pad2 = (n: number) => String(n).padStart(2, '0');

/**
 * Normaliza una fecha de MySQL a 'YYYY-MM-DD'. MySQL2 devuelve las columnas
 * DATE/DATETIME como objetos Date; `String(date)` daría "Thu Jul 16 2026…" y
 * romper el parseo en el front/PDF ("Invalid Date"). Maneja Date y string.
 */
export function fechaYMD(v: any): string | null {
  if (v == null || v === '') return null;
  if (v instanceof Date) return `${v.getFullYear()}-${pad2(v.getMonth() + 1)}-${pad2(v.getDate())}`;
  return String(v).slice(0, 10);
}

export const CotizacionEntity = {
  fromRow(r: any): Cotizacion {
    return {
      id:                   r.id,
      numero:               r.numero,
      empresa_id:           r.empresa_id ?? null,
      empresa:              r.empresa ?? null,
      cliente_tipo_doc:     r.cliente_tipo_doc,
      cliente_num_doc:      r.cliente_num_doc,
      cliente_razon_social: r.cliente_razon_social,
      cliente_email:        r.cliente_email ?? null,
      moneda:               r.moneda,
      igv_incluido:         !!r.igv_incluido,
      subtotal:             Number(r.subtotal),
      descuento_tipo:       r.descuento_tipo ?? null,
      descuento_valor:      Number(r.descuento_valor),
      descuento_monto:      Number(r.descuento_monto),
      total:                Number(r.total),
      notas:                r.notas ?? null,
      valida_hasta:         fechaYMD(r.valida_hasta),
      estado_id:            r.estado_id,
      estado:               r.estado,
      estado_nombre:        r.estado_nombre,
      comprobante_id:       r.comprobante_id ?? null,
      comprobante_numero:   r.comprobante_numero ?? null,
      created_at:           fechaYMD(r.created_at) ?? '',
      updated_at:           fechaYMD(r.updated_at) ?? '',
    };
  },
};
