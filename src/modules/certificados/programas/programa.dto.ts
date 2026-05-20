export interface CreateProgramaDto {
  tipo_programa_id: number;
  nombre: string;
  descripcion?: string;
  horas_academicas: number;
}

export type UpdateProgramaDto = Partial<CreateProgramaDto>;
