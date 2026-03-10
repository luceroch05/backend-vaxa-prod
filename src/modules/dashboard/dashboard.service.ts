import type { TenantConfig } from '../../types/tenant';

/**
 * Servicio básico de dashboard.
 * Devuelve info resumida del tenant y módulos habilitados (para que el front pueda sincronizar).
 */
export const dashboardService = {
  getConfig(tenantId: string, tenant: TenantConfig) {
    return {
      tenantId,
      name: tenant.name,
      modules: tenant.modules,
      timestamp: new Date().toISOString(),
    };
  },
};
