import type { Paciente } from './pacientes.types';

/**
 * Almacén en memoria por tenant.
 * En producción reemplazar por BD con tenant_id en cada tabla.
 */
const store = new Map<string, Paciente[]>();

function getKey(tenantId: string): string {
  return tenantId;
}

export function getPacientesByTenant(tenantId: string): Paciente[] {
  const key = getKey(tenantId);
  if (!store.has(key)) store.set(key, []);
  return store.get(key)!;
}

export function addPaciente(tenantId: string, data: Omit<Paciente, 'id' | 'tenantId' | 'createdAt'>): Paciente {
  const list = getPacientesByTenant(tenantId);
  const id = `pac-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const paciente: Paciente = {
    id,
    tenantId,
    ...data,
    createdAt: new Date().toISOString(),
  };
  list.push(paciente);
  return paciente;
}

export function getPacienteById(tenantId: string, id: string): Paciente | undefined {
  return getPacientesByTenant(tenantId).find((p) => p.id === id);
}

export function updatePaciente(
  tenantId: string,
  id: string,
  data: Partial<Pick<Paciente, 'nombre' | 'email' | 'telefono'>>
): Paciente | undefined {
  const p = getPacienteById(tenantId, id);
  if (!p) return undefined;
  if (data.nombre !== undefined) p.nombre = data.nombre;
  if (data.email !== undefined) p.email = data.email;
  if (data.telefono !== undefined) p.telefono = data.telefono;
  return p;
}

export function deletePaciente(tenantId: string, id: string): boolean {
  const list = getPacientesByTenant(tenantId);
  const idx = list.findIndex((p) => p.id === id);
  if (idx === -1) return false;
  list.splice(idx, 1);
  return true;
}
