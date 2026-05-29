export interface NotaInput {
  unidad_id: number;
  nota: number;
}

export interface GuardarNotasDto {
  notas: NotaInput[];
}
