export interface CreateGrupoDto {
  programa_id: number;
  nombre_grupo: string;
  fecha_inicio: string;
  fecha_fin: string;
  modalidad_id: number;
}

export type UpdateGrupoDto = Partial<CreateGrupoDto>;
