import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { reportesRepo } from './historias.reportes.repository';
import { sendError } from '../../shared/errors';

/**
 * Rutas de REPORTES gerenciales de Historias Clínicas.
 * Se montan bajo /api/historias (mismo stack: JWT + tenant + bloqueo por vencimiento).
 * Solo LEEN datos agregados. Acceso: ADMINISTRADOR y ADMISION (gestión del centro).
 */

const w = (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response) => fn(req, res).catch((e) => sendError(res, e, 'historias-reportes'));

const tid = (req: Request): string => {
  const slug = (req.headers['x-tenant-id'] as string)?.toLowerCase()?.trim();
  if (!slug) throw new Error('x-tenant-id header requerido');
  return slug;
};
const rol = (req: Request): string => String((req as any).authUser?.rol ?? '').toUpperCase();

/** Solo dirección/recepción ven los reportes gerenciales (el terapeuta no). */
const gestiona = (req: Request, res: Response, next: NextFunction): void => {
  if (['ADMINISTRADOR', 'ADMISION'].includes(rol(req))) { next(); return; }
  res.status(403).json({ error: 'Tu rol no tiene permiso para ver reportes.', code: 'ROL_SIN_PERMISO' });
};

const router = Router();

router.get('/reportes', gestiona, w(async (req, res) => {
  res.json(await reportesRepo.resumen(tid(req), {
    desde: (req.query.desde as string) || undefined,
    hasta: (req.query.hasta as string) || undefined,
  }));
}));

export const historiasReportesRoutes = router;
