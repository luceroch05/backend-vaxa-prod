export class ConfigCertificadoEntity {
  id!: number;
  empresa_id!: number;
  programa_id!: number;
  plantilla_url!: string;
  firma_1_id?: number;
  firma1_autoridad?: string;
  firma1_cargo?: string;
  firma1_imagen?: string;
  firma_2_id?: number;
  firma2_autoridad?: string;
  firma2_cargo?: string;
  firma2_imagen?: string;
  logo_id?: number;
  imagen_logo?: string;
  logo_nombre?: string;
  activo!: boolean;
  created_at!: string;
  static fromRow(row: any) { return Object.assign(new ConfigCertificadoEntity(), row); }
}
