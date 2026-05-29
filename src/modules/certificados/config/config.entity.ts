export interface ConfigLogoItem {
  id:          number;
  imagen_logo: string;
  nombre:      string | null;
  orden:       number;
}

export interface ConfigFirmaItem {
  id:               number;
  nombre_autoridad: string;
  cargo:            string;
  imagen_firma:     string;
  orden:            number;
}

export class ConfigCertificadoEntity {
  id!:           number;
  empresa_id!:   number;
  programa_id!:  number;
  plantilla_url!: string | null;
  activo!:       boolean;
  created_at!:   string;
  logos:  ConfigLogoItem[]  = [];
  firmas: ConfigFirmaItem[] = [];

  static fromRow(
    row: any,
    logos:  ConfigLogoItem[]  = [],
    firmas: ConfigFirmaItem[] = [],
  ): ConfigCertificadoEntity {
    const e = Object.assign(new ConfigCertificadoEntity(), row);
    e.logos  = logos;
    e.firmas = firmas;
    return e;
  }
}
