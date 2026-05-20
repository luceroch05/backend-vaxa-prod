export class LogoEntity {
  id!: number;
  empresa_id!: number;
  nombre?: string;
  imagen_logo!: string;
  activo!: boolean;
  created_at!: string;
  static fromRow(row: any) { return Object.assign(new LogoEntity(), row); }
}
