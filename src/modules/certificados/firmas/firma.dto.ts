export interface CreateFirmaDto {
  nombre_autoridad: string;
  cargo: string;
  imagen_firma: string;
}

/** Editar firma: todo opcional. Si `imagen_firma` viene vacío/omitido, se conserva la actual. */
export interface UpdateFirmaDto {
  nombre_autoridad?: string;
  cargo?: string;
  imagen_firma?: string;
}
