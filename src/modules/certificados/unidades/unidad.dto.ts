export interface CreateUnidadDto {
  programa_id: number;
  nombre: string;
  orden?: number;
}

export type UpdateUnidadDto = Partial<Pick<CreateUnidadDto, 'nombre' | 'orden'>>;
