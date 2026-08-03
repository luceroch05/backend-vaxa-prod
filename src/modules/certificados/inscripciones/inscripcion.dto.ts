export interface CreateInscripcionDto {
  participante_id: number;
  grupo_id: number;
  fecha_inscripcion: string;
  /** Calidad de participación (Participante, Organizador, Ponente…). Default 'Participante'. */
  calidad?: string;
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
  /** Calidad de participación. Solo el admin lo puede setear; la web pública NO. */
  calidad?: string;
}
