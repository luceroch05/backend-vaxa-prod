export interface CreateUnidadDto {
  programa_id: number;
  nombre: string;
  orden?: number;
  /** Créditos que otorga la unidad (solo modo "Crédito"). */
  creditos?: number;
}

export type UpdateUnidadDto = Partial<Pick<CreateUnidadDto, 'nombre' | 'orden' | 'creditos'>>;
