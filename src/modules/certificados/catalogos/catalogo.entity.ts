export class TipoDocumentoEntity {
  id!: number;
  codigo!: string;
  nombre!: string;
  activo!: boolean;
  static fromRow(row: any) { return Object.assign(new TipoDocumentoEntity(), row); }
}

export class TipoProgramaEntity {
  id!: number;
  nombre!: string;
  activo!: boolean;
  static fromRow(row: any) { return Object.assign(new TipoProgramaEntity(), row); }
}

export class ModalidadEntity {
  id!: number;
  codigo!: string;
  nombre!: string;
  activo!: boolean;
  static fromRow(row: any) { return Object.assign(new ModalidadEntity(), row); }
}
