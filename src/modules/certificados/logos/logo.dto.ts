export interface CreateLogoDto {
  nombre?: string;
  imagen_logo: string;
}

/** Editar logo: todo opcional. Si `imagen_logo` viene vacío/omitido, se conserva la actual. */
export interface UpdateLogoDto {
  nombre?: string | null;
  imagen_logo?: string;
}
