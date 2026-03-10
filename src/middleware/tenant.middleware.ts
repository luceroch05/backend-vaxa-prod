import type { Request, Response, NextFunction } from 'express';
import type { TenantConfig } from '../types/tenant';
import { getTenantConfig } from '../tenants/get-tenant';

/** Request con tenant resuelto por el middleware. */
export interface RequestWithTenant extends Request {
  tenant: TenantConfig;
}

/** Header que el front debe enviar con el tenant (ej: X-Tenant-Id). */
export const TENANT_HEADER = 'x-tenant-id';

/**
 * Resuelve el tenant del request y lo deja en req.tenant.
 * Si no viene header o el tenant no existe, responde 400/404.
 */
export function tenantMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const tenantId = (req.headers[TENANT_HEADER] as string)?.toLowerCase()?.trim();

  if (!tenantId) {
    res.status(400).json({
      error: 'Tenant requerido',
      message: `Envía el header "${TENANT_HEADER}" con el id del tenant (ej: empresa-techpro).`,
    });
    return;
  }

  const config = getTenantConfig(tenantId);
  if (!config) {
    res.status(404).json({
      error: 'Tenant no encontrado',
      tenantId,
    });
    return;
  }

  (req as RequestWithTenant).tenant = config;
  next();
}
