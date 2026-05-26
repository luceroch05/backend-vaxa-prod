export interface TipoDocumentoDto {
  id: number;
  codigo: string;
  nombre: string;
  activo: boolean;
}

export interface TipoProgramaDto {
  id: number;
  nombre: string;
  activo: boolean;
}

export interface ModalidadDto {
  id: number;
  codigo: string;
  nombre: string;
  activo: boolean;
}

export interface CatalogosDto {
  tipos_documento: TipoDocumentoDto[];
  tipos_programa:  TipoProgramaDto[];
  modalidades:     ModalidadDto[];
}
