export class ProgramaEntity {
  id!: number;
  empresa_id!: number;
  tipo_programa_id!: number;
  tipo_programa_nombre?: string;
  nombre!: string;
  descripcion?: string;
  horas_academicas!: number;
  activo!: boolean;
  created_at!: string;
  updated_at?: string;
  static fromRow(row: any) { return Object.assign(new ProgramaEntity(), row); }
}
