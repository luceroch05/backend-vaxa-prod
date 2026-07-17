export class GrupoEntity {
  id!: number;
  empresa_id!: number;
  programa_id!: number;
  programa_nombre?: string;
  nombre_grupo!: string;
  fecha_inicio!: string;       // Día 1
  fecha_fin?: string | null;   // legado (rango); aulas nuevas usan los días puntuales
  fecha_dia2?: string | null;  // Día 2 puntual
  fecha_dia3?: string | null;  // Día 3 puntual
  dias_semana?: string | null;
  hora_inicio?: string | null;
  hora_fin?: string | null;
  modalidad_id!: number;
  modalidad_nombre?: string;
  activo!: boolean;
  created_at!: string;
  static fromRow(row: any) { return Object.assign(new GrupoEntity(), row); }
}
