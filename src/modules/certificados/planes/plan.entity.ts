/** Un plan del catálogo (planes). */
export interface Plan {
  id: number;
  slug: string;
  nombre: string;
  precio_mensual: number;
  limite_certificados_mes: number;
  precio_certificado_adicional: number;
  setup_inicial: number;
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

/** Estado del plan de una empresa: suscripción vigente + consumo del mes. */
export interface EstadoPlan {
  plan: Plan | null;
  suscripcion: {
    id: number;
    ciclo: string;
    estado: string;
    fecha_inicio: string;
    fecha_fin: string;
  } | null;
  consumo: ConsumoMes;
}
