export interface CreateGrupoDto {
  programa_id: number;
  nombre_grupo: string;
  fecha_inicio: string;                // Día 1 (obligatorio)
  fecha_fin?: string | null;           // legado (rango). Aulas nuevas usan los días puntuales
  fecha_dia2?: string | null;          // Día 2 puntual (opcional)
  fecha_dia3?: string | null;          // Día 3 puntual (opcional)
  modalidad_id: number;
  dias_semana?: string | null;  // días en ISO 1=Lun..7=Dom, separados por coma. Ej: "1,3,5"
  hora_inicio?: string | null;  // "HH:MM"
  hora_fin?: string | null;     // "HH:MM"
}

export type UpdateGrupoDto = Partial<CreateGrupoDto>;
