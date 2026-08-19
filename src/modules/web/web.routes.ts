import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { webRepo } from './web.repository';
import { sendError } from '../../shared/errors';

/**
 * Módulo "Mi Web": el cliente administra el CONTENIDO de su web pública
 * (hero, servicios, staff, alianzas, redes, contacto). El diseño/layout es a
 * medida por cliente; aquí solo va el contenido, scoped por tenant.
 *
 *  · webRoutes       -> protegido (panel). Se monta bajo /api/web con
 *                       jwt + tenantMatch + bloqueoVencimiento (ver index.ts).
 *  · webPublicRoutes -> público (la landing lee el contenido, sin login).
 */

const w = (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response) => fn(req, res).catch((e) => sendError(res, e, 'web'));

const tid = (req: Request): string => {
  const slug = (req.headers['x-tenant-id'] as string)?.toLowerCase()?.trim();
  if (!slug) throw new Error('x-tenant-id header requerido');
  return slug;
};
const uid = (req: Request): number | undefined => (req as any).authUser?.sub;
const rol = (req: Request): string => String((req as any).authUser?.rol ?? '').toUpperCase();

/** Editar la web es tarea del dueño del centro. */
const soloAdmin = (req: Request, res: Response, next: NextFunction): void => {
  if (rol(req) === 'ADMINISTRADOR') return next();
  res.status(403).json({ error: 'Solo el administrador puede editar la web.', code: 'ROL_SIN_PERMISO' });
};

// ── Router protegido (panel) ──────────────────────────────────────────────────
const router = Router();

// Config (hero + marca + redes + contacto)
router.get('/config', w(async (req, res) => {
  res.json(await webRepo.getConfig(tid(req)));
}));
router.put('/config', soloAdmin, w(async (req, res) => {
  res.json(await webRepo.saveConfig(tid(req), req.body ?? {}, uid(req)));
}));

// Servicios
router.get('/servicios', w(async (req, res) => {
  res.json(await webRepo.listServicios(tid(req)));
}));
router.post('/servicios', soloAdmin, w(async (req, res) => {
  res.status(201).json(await webRepo.createServicio(tid(req), req.body ?? {}, uid(req)));
}));
router.patch('/servicios/:id', soloAdmin, w(async (req, res) => {
  const s = await webRepo.updateServicio(tid(req), Number(req.params.id), req.body ?? {}, uid(req));
  if (!s) { res.status(404).json({ error: 'Servicio no encontrado' }); return; }
  res.json(s);
}));
router.delete('/servicios/:id', soloAdmin, w(async (req, res) => {
  const ok = await webRepo.deleteServicio(tid(req), Number(req.params.id));
  if (!ok) { res.status(404).json({ error: 'Servicio no encontrado' }); return; }
  res.status(204).send();
}));

// Staff / equipo
router.get('/staff', w(async (req, res) => {
  res.json(await webRepo.listStaff(tid(req)));
}));
router.post('/staff', soloAdmin, w(async (req, res) => {
  res.status(201).json(await webRepo.createStaff(tid(req), req.body ?? {}, uid(req)));
}));
router.patch('/staff/:id', soloAdmin, w(async (req, res) => {
  const s = await webRepo.updateStaff(tid(req), Number(req.params.id), req.body ?? {}, uid(req));
  if (!s) { res.status(404).json({ error: 'Miembro no encontrado' }); return; }
  res.json(s);
}));
router.delete('/staff/:id', soloAdmin, w(async (req, res) => {
  const ok = await webRepo.deleteStaff(tid(req), Number(req.params.id));
  if (!ok) { res.status(404).json({ error: 'Miembro no encontrado' }); return; }
  res.status(204).send();
}));

// Alianzas y convenios
router.get('/alianzas', w(async (req, res) => {
  res.json(await webRepo.listAlianzas(tid(req)));
}));
router.post('/alianzas', soloAdmin, w(async (req, res) => {
  res.status(201).json(await webRepo.createAlianza(tid(req), req.body ?? {}, uid(req)));
}));
router.patch('/alianzas/:id', soloAdmin, w(async (req, res) => {
  const a = await webRepo.updateAlianza(tid(req), Number(req.params.id), req.body ?? {}, uid(req));
  if (!a) { res.status(404).json({ error: 'Alianza no encontrada' }); return; }
  res.json(a);
}));
router.delete('/alianzas/:id', soloAdmin, w(async (req, res) => {
  const ok = await webRepo.deleteAlianza(tid(req), Number(req.params.id));
  if (!ok) { res.status(404).json({ error: 'Alianza no encontrada' }); return; }
  res.status(204).send();
}));

export const webRoutes = router;

// ── Router público (la landing lee el contenido, sin login) ───────────────────
const publicRouter = Router();

/** Todo el contenido público de la web de un tenant (config + listas activas). */
publicRouter.get('/:tenantSlug', w(async (req, res) => {
  const slug = String(req.params.tenantSlug || '').toLowerCase().trim();
  if (!slug) { res.status(400).json({ error: 'tenant requerido' }); return; }
  res.json(await webRepo.getPublic(slug));
}));

export const webPublicRoutes = publicRouter;
