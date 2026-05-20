export class InscripcionEntity {
  id!: number;
  empresa_id!: number;
  participante_id!: number;
  participante_nombre?: string;
  numero_documento?: string;
  grupo_id!: number;
  nombre_grupo?: string;
  estado_id!: number;
  estado_nombre?: string;
  fecha_inscripcion!: string;
  created_at!: string;
  static fromRow(row: any) { return Object.assign(new InscripcionEntity(), row); }
}
