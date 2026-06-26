export class LogoEntity {
  id!: number;
  empresa_id!: number;
  nombre?: string;
  imagen_logo!: string;
  es_default?: number | boolean;   // 1 = logo obligatorio de la empresa (no se elimina)
  activo!: boolean;
  created_at!: string;
  static fromRow(row: any) { return Object.assign(new LogoEntity(), row); }
}
