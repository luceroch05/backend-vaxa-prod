import type { Request, Response, NextFunction } from 'express';
import type { RequestWithAuth } from './jwt.middleware';
import { getEmpresaId, estaVencidaPorPago, MSG_VENCIDA } from '../modules/certificados/shared/db.helper';

/** Tenant raíz de Vaxa: nunca se bloquea por vencimiento (es el panel interno). */
const ROOT_TENANT = process.env.VAXA_ROOT_TENANT ?? 'vaxa';

/**
 * Corta TODO el uso del panel de certificados cuando el plan de mantenimiento
 * venció (falta de pago). Cubre las SESIONES YA ABIERTAS: aunque el usuario haya
 * iniciado sesión antes del vencimiento, cada request al panel se rechaza con 403
 * `PLAN_VENCIDO`. El login ya se bloquea aparte; esto cierra el hueco de la sesión
 * viva. El tenant raíz de Vaxa nunca se bloquea.
 *
 * Debe montarse SIEMPRE después de jwtMiddleware + tenantMatchMiddleware.
 */
export async function bloqueoVencimientoMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  const tenant = (req as RequestWithAuth).authUser?.empresa?.toLowerCase().trim();
  if (!tenant || tenant === ROOT_TENANT) { next(); return; }
  try {
    const empresaId = await getEmpresaId(tenant);
    if (await estaVencidaPorPago(empresaId)) {
      res.status(403).json({ error: MSG_VENCIDA, code: 'PLAN_VENCIDO' });
      return;
    }
  } catch { /* no se pudo resolver la empresa → no bloquea aquí (otras capas responden) */ }
  next();
}
