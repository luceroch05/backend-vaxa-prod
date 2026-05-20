export interface CreateInscripcionDto {
  participante_id: number;
  grupo_id: number;
  fecha_inscripcion: string;
}

export interface CambiarEstadoDto {
  estado_id: number;
}
