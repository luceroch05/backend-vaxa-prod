/** Tipos de dominio para construir un comprobante electrónico (factura/boleta). */

export type TipoComprobante = '01' | '03' | 'NV'; // 01 factura · 03 boleta · NV nota de venta (interna, no SUNAT)

/** Una línea del comprobante. Montos en valor SIN IGV (valorUnitario). */
export interface ItemComprobante {
  descripcion: string;
  cantidad: number;
  valorUnitario: number;        // precio unitario SIN IGV
  unidad?: string;              // cat.03 SUNAT (default 'NIU'; servicios suelen usar 'ZZ')
  tipoAfectacion?: string;      // cat.07 (default '10' = gravado)
}

/** Adquirente (cliente al que se le emite). */
export interface ClienteComprobante {
  tipoDoc: string;              // cat.06: '6' RUC, '1' DNI, '0' sin doc...
  numDoc: string;
  razonSocial: string;
  direccion?: string;
}

/** Datos para emitir un comprobante. El emisor sale de la config (.env). */
export interface DatosComprobante {
  tipoDoc: TipoComprobante;
  serie: string;                // F001 / B001
  correlativo: number;
  fechaEmision: string;         // 'YYYY-MM-DD'
  horaEmision?: string;         // 'HH:MM:SS'
  moneda?: string;              // default 'PEN'
  cliente: ClienteComprobante;
  items: ItemComprobante[];
}

/** Totales calculados de un comprobante. */
export interface TotalesComprobante {
  gravado: number;              // suma de bases afectas a IGV
  igv: number;
  total: number;                // gravado + igv
  lineas: Array<{
    valorVenta: number;         // cantidad * valorUnitario
    igv: number;
    precioUnitarioConIgv: number;
  }>;
}
