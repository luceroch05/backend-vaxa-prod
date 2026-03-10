import type { Request, Response, NextFunction } from 'express';
import type { TenantModuleKey } from '../types/tenant';
import type { RequestWithTenant } from './tenant.middleware';

/**
 * Middleware que comprueba si el tenant tiene el módulo habilitado.
 * Debe usarse después de tenantMiddleware (req.tenant ya debe existir).
 * Si el módulo no está habilitado, responde 403.
 */
export function requireModule(moduleKey: TenantModuleKey) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const tenant = (req as unknown as RequestWithTenant).tenant;
    if (!tenant) {
      res.status(500).json({ error: 'Tenant no resuelto (usa tenantMiddleware antes)' });
      return;
    }

    const enabled = tenant.modules[moduleKey];
    if (!enabled) {
      res.status(403).json({
        error: 'Módulo no disponible',
        module: moduleKey,
        tenantId: tenant.id,
      });
      return;
    }

    next();
  };
}
