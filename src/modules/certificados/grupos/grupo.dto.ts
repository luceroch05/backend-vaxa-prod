export interface CreateGrupoDto {
  programa_id: number;
  nombre_grupo: string;
  fecha_inicio: string;
  fecha_fin: string;
  modalidad_id: number;
  dias_semana?: string | null;  // días en ISO 1=Lun..7=Dom, separados por coma. Ej: "1,3,5"
  hora_inicio?: string | null;  // "HH:MM"
  hora_fin?: string | null;     // "HH:MM"
}

export type UpdateGrupoDto = Partial<CreateGrupoDto>;
