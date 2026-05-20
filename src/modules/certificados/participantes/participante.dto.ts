export interface CreateParticipanteDto {
  tipo_documento_id: number;
  numero_documento: string;
  nombres: string;
  apellidos: string;
  email?: string;
  telefono?: string;
}

export type UpdateParticipanteDto = Partial<CreateParticipanteDto>;
