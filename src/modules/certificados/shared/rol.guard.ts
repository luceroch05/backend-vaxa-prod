import type { Request, Response, NextFunction } from 'express';

/**
 * Guard de rol para el módulo de certificados. Debe ir DESPUÉS de jwtMiddleware
 * (que pone `authUser.rol`). Solo el rol ADMINISTRADOR de la empresa pasa; el rol
 * ADMISION (operativo) queda bloqueado en las acciones sensibles: editar, archivar,
 * eliminar, anular certificados, y ver reportes/auditoría.
 */
export function soloAdmin(req: Request, res: Response, next: NextFunction): void {
  const rol = String((req as any).authUser?.rol ?? '').toUpperCase();
  if (rol !== 'ADMINISTRADOR') {
    res.status(403).json({
      error: 'Tu rol no tiene permiso para esta acción. Pídeselo a un administrador.',
      code: 'ROL_SIN_PERMISO',
    });
    return;
  }
  next();
}
