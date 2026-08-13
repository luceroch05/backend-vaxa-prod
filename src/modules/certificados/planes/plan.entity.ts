/** Un plan del catálogo (planes). */
export interface Plan {
  id: number;
  slug: string;
  nombre: string;
  precio_mensual: number;            // = mantenimiento mensual
  implementacion: number;            // pago único de activación
  mantenimiento_mensual: number;
  creditos_incluidos: number;
  usuarios_incluidos: number;        // 0 = ilimitado
  limite_certificados_mes: number;
  precio_certificado_adicional: number;
  setup_inicial: number;             // = implementación
  permite_diseno: boolean;
  permite_subdominio: boolean;
  permite_api: boolean;
  permite_carga_masiva: boolean;
  permite_metricas: boolean;
  permite_auditoria: boolean;
  muestra_pdf_publico: boolean;
  activo: boolean;
  orden: number;
}

export const PlanEntity = {
  fromRow(r: any): Plan {
    return {
      id:                           r.id,
      slug:                         r.slug,
      nombre:                       r.nombre,
      precio_mensual:               Number(r.precio_mensual),
      implementacion:               Number(r.implementacion ?? 0),
      mantenimiento_mensual:        Number(r.mantenimiento_mensual ?? 0),
      creditos_incluidos:           Number(r.creditos_incluidos ?? 0),
      usuarios_incluidos:           Number(r.usuarios_incluidos ?? 1),
      limite_certificados_mes:      r.limite_certificados_mes,
      precio_certificado_adicional: Number(r.precio_certificado_adicional),
      setup_inicial:                Number(r.setup_inicial),
      permite_diseno:               !!r.permite_diseno,
      permite_subdominio:           !!r.permite_subdominio,
      permite_api:                  !!r.permite_api,
      permite_carga_masiva:         !!r.permite_carga_masiva,
      permite_metricas:             !!r.permite_metricas,
      permite_auditoria:            !!r.permite_auditoria,
      muestra_pdf_publico:          !!r.muestra_pdf_publico,
      activo:                       !!r.activo,
      orden:                        r.orden,
    };
  },
};

/** Consumo de certificados de un periodo (consumo_mensual). */
export interface ConsumoMes {
  anio: number;
  mes: number;
  incluidos: number;        // cupo del plan ese mes
  emitidos: number;         // total emitidos
  adicionales: number;      // excedente (emitidos por encima del cupo)
  monto_adicional: number;  // S/ a cobrar por los excedentes
  restantes: number;        // cupo libre = max(incluidos - emitidos, 0)
}

/** Semáforo de cobranza según qué tan cerca está el vencimiento. */
export type EstadoCobranza = 'vigente' | 'por_vencer' | 'vencido';

/** Datos de vencimiento/cobranza derivados de fecha_fin (no se almacenan). */
export interface Cobranza {
  fecha_limite_pago: string;       // fecha máxima para pagar = el mismo día de vencimiento (fecha_fin)
  dias_para_vencer: number;        // días desde hoy hasta fecha_fin (negativo si ya venció)
  estado_cobranza: EstadoCobranza; // vigente | por_vencer | vencido
}

/** Una línea sugerida del "resumen de lo que debo cobrar". */
export interface LineaCobro {
  concepto: 'mantenimiento' | 'usuario_mant' | 'usuario_activacion' | 'usuario_mant_prorrateado';
  descripcion: string;
  cantidad: number;
  precioUnitario: number;
  renueva?: boolean;     // el mantenimiento del plan renueva la suscripción al cobrarse
  usuarioId?: number;    // usuario adicional al que corresponde (activación/prorrateo)
}

/** Resumen de lo que se le debe cobrar a la empresa (calculado, no se almacena). */
export interface ResumenCobro {
  plan: { id: number; nombre: string; slug: string } | null;
  ciclo: string | null;
  vencimiento: (Cobranza & { fecha_fin: string }) | null;
  usuarios: { incluidos: number; actuales: number; extra: number; ilimitado: boolean };
  lineas: LineaCobro[];
  total: number;
  marcarActivacionUsuarios: number[];  // ids a marcar activacion_cobrada=1 al registrar la venta
  // Mes EN CURSO (aún no vencido): informativo, NO se cobra todavía ni suma al total.
  // Sirve para que el mantenimiento del mes actual "se vea" sin presionar al cliente.
  enCurso: LineaCobro[];
  totalEnCurso: number;
  fechaCobroEnCurso: string | null;    // fin de mes en que se cobrará ('YYYY-MM-DD'), o null
}

/** Estado del plan de una empresa: suscripción vigente + consumo del mes. */
/** Saldo de créditos de la empresa (modelo créditos + mantenimiento). */
export interface CreditosSaldo {
  disponibles: number;   // saldo actual para emitir
  asignados: number;     // total histórico asignado (plan + recargas)
  consumidos: number;    // asignados - disponibles
  recargados: number;    // total comprado aparte (movimientos tipo 'recarga'); el resto vino del plan
  ilimitado: boolean;    // plan con creditos_incluidos = 0 (ej. Corporativo): emite sin tope
}

export interface EstadoPlan {
  plan: Plan | null;
  suscripcion: ({
    id: number;
    ciclo: string;
    estado: string;
    fecha_inicio: string;
    fecha_fin: string;
  } & Cobranza) | null;
  consumo: ConsumoMes;
  creditos: CreditosSaldo;
  /** Precio por certificado (solo modo "Pago por certificado"). null = no aplica. */
  precio_certificado?: number | null;
}
