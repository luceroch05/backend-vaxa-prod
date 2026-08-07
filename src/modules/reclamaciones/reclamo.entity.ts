/**
 * Tipos y helpers del Libro de Reclamaciones Virtual (formato INDECOPI).
 *
 * Es el libro ÚNICO de Vaxa (el proveedor somos nosotros): cualquier consumidor
 * registra su Reclamo o Queja. NO es multi-tenant. La firma del consumidor es
 * "presentación virtual" (sin manuscrita) y la del proveedor es solo texto.
 */

/** Catálogos sembrados por scripts/mysql-libro-reclamaciones.sql (ids fijos). */
export const TIPO_ID: Record<string, number> = { RECLAMO: 1, QUEJA: 2 };
export const BIEN_TIPO_ID: Record<string, number> = { PRODUCTO: 1, SERVICIO: 2 };
export const ESTADO = { PENDIENTE: 1, EN_PROCESO: 2, ATENDIDO: 3, CERRADO: 4 } as const;

/** Documentos válidos del consumidor (cat.06). El proveedor siempre es RUC. */
export const DOCS_CONSUMIDOR = ['1', '4', '7'] as const; // DNI · CE · Pasaporte

/** Cabecera de un reclamo para la lista (con nombres de catálogo resueltos). */
export interface Reclamo {
  id: number;
  numero: string;                    // LR-2026-0001

  consumidor_nombre: string;
  consumidor_tipo_doc: string;       // cat.06
  consumidor_num_doc: string;
  consumidor_domicilio: string | null;
  consumidor_telefono: string | null;
  consumidor_email: string | null;
  es_menor: boolean;
  apoderado_nombre: string | null;
  apoderado_num_doc: string | null;

  bien_tipo_id: number;
  bien_tipo: string;                 // codigo (PRODUCTO/SERVICIO)
  bien_tipo_nombre: string;
  bien_monto: number | null;
  bien_descripcion: string | null;

  tipo_id: number;
  tipo: string;                      // codigo (RECLAMO/QUEJA)
  tipo_nombre: string;
  detalle: string;
  pedido: string;

  estado_id: number;
  estado: string;                    // codigo (PENDIENTE…)
  estado_nombre: string;
  respuesta: string | null;
  respondido_at: string | null;
  user_crea_id: number | null;       // quién lo creó (NULL = consumidor público)
  user_actua_id: number | null;      // último usuario Vaxa que respondió/actualizó
  fecha_limite: string | null;       // 'YYYY-MM-DD' (fecha + 15 días hábiles)

  adjuntos?: ReclamoAdjunto[];       // evidencia (solo en getById; la lista no lo trae)

  created_at: string;
  updated_at: string;
}

/** DTO de creación (lo que manda el formulario público). */
export interface NuevoReclamoInput {
  consumidor: {
    nombre: string;
    tipoDoc?: string;                // default '1' (DNI)
    numDoc: string;
    domicilio?: string;
    telefono?: string;
    email?: string;
    esMenor?: boolean;
    apoderadoNombre?: string;
    apoderadoNumDoc?: string;
  };
  bien: {
    tipo: string;                    // 'PRODUCTO' | 'SERVICIO'
    monto?: number;
    descripcion?: string;
  };
  reclamacion: {
    tipo: string;                    // 'RECLAMO' | 'QUEJA'
    detalle: string;
    pedido: string;
  };
  /** Rutas de archivos ya subidos al servidor (no binario/base64): /uploads/reclamos/... */
  adjuntos?: Array<{ ruta: string; nombre?: string; mime?: string; tamano?: number }>;
  ip?: string;                       // traza de quién registró
}

/** Un archivo adjunto (evidencia) del reclamo. En la BD se guarda la RUTA, no el binario. */
export interface ReclamoAdjunto {
  nombre: string;   // nombre original del archivo
  ruta: string;     // /uploads/reclamos/<hash>.<ext>
  mime: string;
  tamano: number;   // bytes
}

/** Un hito de la línea de tiempo del reclamo (seguimiento del consumidor). */
export interface ReclamoHito {
  estado: string;          // codigo (PENDIENTE…)
  estado_nombre: string;
  nota: string | null;
  fecha: string | null;    // 'YYYY-MM-DD HH:MM'
}

/** Vista pública de seguimiento (datos mínimos, sin PII de más). */
export interface ReclamoConsulta {
  numero: string;
  tipo_nombre: string;
  bien_tipo_nombre: string;
  estado: string;
  estado_nombre: string;
  created_at: string;
  fecha_limite: string | null;
  respondido_at: string | null;
  respuesta: string | null;
  historial: ReclamoHito[];
  adjuntos: ReclamoAdjunto[];
}

/** DTO de respuesta del proveedor (admin Vaxa). */
export interface ResponderInput {
  respuesta: string;
  estadoId?: number;                 // default ATENDIDO
  respondidoBy?: number;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/**
 * Normaliza una fecha de MySQL a 'YYYY-MM-DD'. mysql2 devuelve DATE/DATETIME como
 * objetos Date; `String(date)` daría "Thu Jul 16 2026…" y rompería el parseo.
 */
export function fechaYMD(v: any): string | null {
  if (v == null || v === '') return null;
  if (v instanceof Date) return `${v.getFullYear()}-${pad2(v.getMonth() + 1)}-${pad2(v.getDate())}`;
  return String(v).slice(0, 10);
}

/** Igual que fechaYMD pero conserva la hora (para respondido_at). */
export function fechaHora(v: any): string | null {
  if (v == null || v === '') return null;
  if (v instanceof Date) {
    return `${v.getFullYear()}-${pad2(v.getMonth() + 1)}-${pad2(v.getDate())} `
      + `${pad2(v.getHours())}:${pad2(v.getMinutes())}`;
  }
  return String(v).slice(0, 16);
}

/**
 * Suma `dias` días HÁBILES (lunes–viernes) a una fecha. INDECOPI da un plazo de
 * 15 días hábiles improrrogables para responder. No se descuentan feriados
 * (no hay calendario oficial cargado); el conteo de lunes–viernes es la base.
 */
export function sumarDiasHabiles(desde: Date, dias: number): Date {
  const d = new Date(desde.getFullYear(), desde.getMonth(), desde.getDate());
  let sumados = 0;
  while (sumados < dias) {
    d.setDate(d.getDate() + 1);
    const dow = d.getDay(); // 0 domingo, 6 sábado
    if (dow !== 0 && dow !== 6) sumados++;
  }
  return d;
}

export const ReclamoEntity = {
  fromRow(r: any): Reclamo {
    return {
      id:                   r.id,
      numero:               r.numero,
      consumidor_nombre:    r.consumidor_nombre,
      consumidor_tipo_doc:  r.consumidor_tipo_doc,
      consumidor_num_doc:   r.consumidor_num_doc,
      consumidor_domicilio: r.consumidor_domicilio ?? null,
      consumidor_telefono:  r.consumidor_telefono ?? null,
      consumidor_email:     r.consumidor_email ?? null,
      es_menor:             !!r.es_menor,
      apoderado_nombre:     r.apoderado_nombre ?? null,
      apoderado_num_doc:    r.apoderado_num_doc ?? null,
      bien_tipo_id:         r.bien_tipo_id,
      bien_tipo:            r.bien_tipo,
      bien_tipo_nombre:     r.bien_tipo_nombre,
      bien_monto:           r.bien_monto != null ? Number(r.bien_monto) : null,
      bien_descripcion:     r.bien_descripcion ?? null,
      tipo_id:              r.tipo_id,
      tipo:                 r.tipo,
      tipo_nombre:          r.tipo_nombre,
      detalle:              r.detalle,
      pedido:               r.pedido,
      estado_id:            r.estado_id,
      estado:               r.estado,
      estado_nombre:        r.estado_nombre,
      respuesta:            r.respuesta ?? null,
      respondido_at:        fechaHora(r.respondido_at),
      user_crea_id:         r.user_crea_id ?? null,
      user_actua_id:        r.user_actua_id ?? null,
      fecha_limite:         fechaYMD(r.fecha_limite),
      created_at:           fechaHora(r.created_at) ?? '',
      updated_at:           fechaHora(r.updated_at) ?? '',
    };
  },
};
