import type { Request, Response, NextFunction } from 'express';
import type { RequestWithAuth } from './jwt.middleware';

/**
 * Verifica que el tenant del JWT (authUser.empresa) coincida con el tenant
 * solicitado en el header x-tenant-id.
 *
 * Sin esto, cualquier usuario autenticado en una empresa puede acceder a los
 * datos de otra simplemente cambiando el header / la URL (p. ej. token de
 * `vaxa` con `x-tenant-id: tech-pro`). El JWT prueba "soy un usuario válido",
 * pero NO basta para decidir a qué empresa puede entrar: eso lo decide el slug
 * embebido en el propio token, no un header que controla el cliente.
 *
 * Debe montarse SIEMPRE después de jwtMiddleware.
 */
export function tenantMatchMiddleware(req: Request, res: Response, next: NextFunction): void {
  const authUser = (req as RequestWithAuth).authUser;
  const requested = (req.headers['x-tenant-id'] as string | undefined)?.toLowerCase().trim();

  if (!requested) {
    res.status(400).json({ error: 'x-tenant-id header requerido' });
    return;
  }

  const tokenTenant = authUser?.empresa?.toLowerCase().trim();

  if (!tokenTenant || tokenTenant !== requested) {
    res.status(403).json({ error: 'Acceso denegado: no perteneces a esta empresa' });
    return;
  }

  next();
}
