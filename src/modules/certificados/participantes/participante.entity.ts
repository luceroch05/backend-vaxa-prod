export class ParticipanteEntity {
  id!: number;
  empresa_id!: number;
  tipo_documento_id!: number;
  tipo_doc_codigo?: string;
  tipo_doc_nombre?: string;
  numero_documento!: string;
  nombres!: string;
  apellidos!: string;
  email?: string;
  telefono?: string;
  activo!: boolean;
  created_at!: string;

  get nombreCompleto() { return `${this.nombres} ${this.apellidos}`; }
  static fromRow(row: any) { return Object.assign(new ParticipanteEntity(), row); }
}
