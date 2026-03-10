import type { CreatePacienteInput } from './pacientes.types';
import {
  getPacientesByTenant,
  addPaciente,
  getPacienteById,
  updatePaciente,
  deletePaciente,
} from './pacientes.store';

/**
 * Servicio de pacientes: todas las operaciones filtradas por tenantId.
 * El tenantId viene del request (req.tenant.id), nunca del body.
 */
export const pacientesService = {
  list(tenantId: string) {
    return getPacientesByTenant(tenantId);
  },

  getById(tenantId: string, id: string) {
    return getPacienteById(tenantId, id);
  },

  create(tenantId: string, input: CreatePacienteInput) {
    return addPaciente(tenantId, input);
  },

  update(tenantId: string, id: string, input: Partial<CreatePacienteInput>) {
    return updatePaciente(tenantId, id, input);
  },

  remove(tenantId: string, id: string) {
    return deletePaciente(tenantId, id);
  },
};
