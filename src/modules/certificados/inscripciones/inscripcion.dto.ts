export interface CreateInscripcionDto {
  participante_id: number;
  grupo_id: number;
  fecha_inscripcion: string;
}

export interface CambiarEstadoDto {
  estado_id: number;
}

/** Inscribir desde el admin: reutiliza el participante por documento o lo crea. */
export interface InscribirDto {
  tipo_documento_id: number;
  numero_documento: string;
  nombres: string;
  apellidos: string;
  email?: string;
  telefono?: string;
  grupo_id: number;
  fecha_inscripcion?: string;
}
