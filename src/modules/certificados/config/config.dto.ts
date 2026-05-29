export interface UpsertConfigDto {
  plantilla_url?:      string | null;
  texto_personalizado?: string | null;
  logo_ids?:  number[];
  firma_ids?: number[];
  /** 0 = config del programa (default). >0 = config específica de un grupo */
  grupo_id?: number;
}
