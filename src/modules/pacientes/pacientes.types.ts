export interface Paciente {
  id: string;
  tenantId: string;
  nombre: string;
  email?: string;
  telefono?: string;
  createdAt: string;
}

export interface CreatePacienteInput {
  nombre: string;
  email?: string;
  telefono?: string;
}
