export interface CreateParticipanteDto {
  tipo_documento_id: number;
  numero_documento: string;
  nombres: string;
  apellidos: string;
  email?: string;
  telefono?: string;
  /** Grados académicos (abreviaturas) que se anteponen al nombre en el certificado. */
  grados?: string[];
}

export type UpdateParticipanteDto = Partial<CreateParticipanteDto>;
