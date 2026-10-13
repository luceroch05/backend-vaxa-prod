export class ProgramaEntity {
  id!: number;
  empresa_id!: number;
  tipo_programa_id!: number;
  tipo_programa_nombre?: string;
  nombre!: string;
  descripcion?: string;
  horas_academicas!: number;
  creditos!: number;
  unidad_label!: string;
  nota_minima!: number;
  /** 1 = lleva evaluación (notas + acta). 0 = sin evaluación (solo certificado). */
  requiere_notas!: number;
  activo!: boolean;
  created_at!: string;
  updated_at?: string;
  static fromRow(row: any) { return Object.assign(new ProgramaEntity(), row); }
}
