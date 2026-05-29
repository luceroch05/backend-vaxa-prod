import type { Request, Response, NextFunction } from 'express';
import type { RequestWithAuth } from './jwt.middleware';

/** Tenant "raíz" (Vaxa) que administra los créditos de todas las empresas. */
const ROOT_TENANT = (process.env.VAXA_ROOT_TENANT ?? 'vaxa').toLowerCase().trim();

/**
 * Permite el acceso solo a usuarios cuyo JWT pertenece al tenant raíz (Vaxa).
 * Protege los endpoints de administración (/api/admin/*), donde Vaxa gestiona
 * los créditos del resto de empresas. Debe montarse después de jwtMiddleware.
 */
export function requireRootTenant(req: Request, res: Response, next: NextFunction): void {
  const empresa = (req as RequestWithAuth).authUser?.empresa?.toLowerCase().trim();
  if (empresa !== ROOT_TENANT) {
    res.status(403).json({ error: 'Acceso restringido a administradores de Vaxa' });
    return;
  }
  next();
}
