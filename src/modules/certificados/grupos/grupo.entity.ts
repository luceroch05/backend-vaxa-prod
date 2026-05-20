export class GrupoEntity {
  id!: number;
  empresa_id!: number;
  programa_id!: number;
  programa_nombre?: string;
  nombre_grupo!: string;
  fecha_inicio!: string;
  fecha_fin!: string;
  modalidad_id!: number;
  modalidad_nombre?: string;
  activo!: boolean;
  created_at!: string;
  static fromRow(row: any) { return Object.assign(new GrupoEntity(), row); }
}
