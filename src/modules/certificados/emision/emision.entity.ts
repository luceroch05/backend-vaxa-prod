export class CertificadoEntity {
  id!: number;
  empresa_id!: number;
  inscripcion_id!: number;
  programa_id?: number;
  participante_nombre?: string;
  numero_documento?: string;
  programa_nombre?: string;
  tipo_programa_nombre?: string;
  horas_academicas?: number;
  creditos?: number;
  nombre_grupo?: string;
  fecha_inicio?: string;
  fecha_fin?: string;
  modalidad_nombre?: string;
  codigo_unico!: string;
  url?: string;
  fecha_emision!: string;
  estado_id!: number;
  estado_nombre?: string;
  created_at!: string;
  static fromRow(row: any) { return Object.assign(new CertificadoEntity(), row); }
}

export class CertificadoPublicoEntity {
  codigo_unico!: string;
  fecha_emision!: string;
  url?: string;
  participante_nombre!: string;
  numero_documento!: string;
  tipo_doc!: string;
  programa_nombre!: string;
  horas_academicas!: number;
  nombre_grupo!: string;
  fecha_inicio!: string;
  fecha_fin!: string;
  modalidad!: string;
  estado!: string;
  empresa_nombre!: string;
  empresa_logo?: string;
  static fromRow(row: any) { return Object.assign(new CertificadoPublicoEntity(), row); }
}
