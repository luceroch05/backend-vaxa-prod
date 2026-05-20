export class FirmaEntity {
  id!: number;
  empresa_id!: number;
  nombre_autoridad!: string;
  cargo!: string;
  imagen_firma!: string;
  activo!: boolean;
  created_at!: string;
  static fromRow(row: any) { return Object.assign(new FirmaEntity(), row); }
}
