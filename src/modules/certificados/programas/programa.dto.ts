export interface CreateProgramaDto {
  tipo_programa_id: number;
  nombre: string;
  descripcion?: string;
  horas_academicas: number;
  /** Etiqueta de las unidades del programa (Unidad / Ciclo / Módulo). Default 'Unidad'. */
  unidad_label?: string;
  /** Nota mínima de aprobación (escala 0-20). Default 11. */
  nota_minima?: number;
}

export type UpdateProgramaDto = Partial<CreateProgramaDto>;
