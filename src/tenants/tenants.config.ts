import type { TenantConfig } from '../types/tenant';

/**
 * Base de datos simulada de tenants.
 * Alinea con la idea del front (tenants.ts).
 * Más adelante puede leerse de BD.
 */
export const tenants: Record<string, TenantConfig> = {
  backoffice: {
    id: 'backoffice',
    name: 'Sistemas Vaxa',
    activo: true,
    modules: {
      dashboard: true,
      pacientes: false,
      citas: false,
      terapeutas: false,
      facturacion: false,
    },
  },
  'empresa-techpro': {
    id: 'empresa-certificaciones',
    name: 'Certificaciones',
    primaryColor: 'purple',
    activo: true,
    hasLogin: true,
    modules: {
      dashboard: true,
      pacientes: false,
      citas: false,
      terapeutas: false,
      facturacion: false,
    },
    customModules: ['Dashl'],
  },
};
