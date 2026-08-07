export class UnidadEntity {
  id!: number;
  empresa_id!: number;
  programa_id!: number;
  nombre!: string;
  orden!: number;
  /** Créditos que otorga esta unidad (solo modo "Crédito"). MySQL lo devuelve como string. */
  creditos!: number;
  activo!: boolean;
  created_at!: string;
  static fromRow(row: any) { return Object.assign(new UnidadEntity(), row); }
}
