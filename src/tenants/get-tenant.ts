import type { TenantConfig } from '../types/tenant';
import { tenants } from './tenants.config';

/**
 * Devuelve la config del tenant por id.
 * Si no existe, devuelve undefined (el middleware responderá 400/404).
 */
export function getTenantConfig(tenantId: string): TenantConfig | undefined {
  return tenants[tenantId];
}
