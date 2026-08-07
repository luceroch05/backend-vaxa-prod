/**
 * Rutas ADMIN del Libro de Reclamaciones (solo Vaxa / tenant raíz).
 * Listar, ver, responder y cambiar estado de los reclamos, y descargar el PDF.
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { reclamoRepo } from './reclamo.repository';
import { generarReclamoPdf } from './reclamo.pdf';
import { sendError } from '../../shared/errors';

const w = (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response) => fn(req, res).catch((e: unknown) => sendError(res, e, 'reclamos-admin'));

const uid = (req: Request): number | undefined => (req as any).authUser?.sub;

const router = Router();

/** GET /api/admin/reclamos?estado_id=&limit= — lista (más recientes primero). */
router.get('/', w(async (req, res) => {
  res.json(await reclamoRepo.list({
    estadoId: req.query.estado_id ? Number(req.query.estado_id) : undefined,
    limit: req.query.limit ? Number(req.query.limit) : undefined,
  }));
}));

/** GET /api/admin/reclamos/:id — detalle. */
router.get('/:id', w(async (req, res) => {
  const rec = await reclamoRepo.getById(Number(req.params.id));
  if (!rec) { res.status(404).json({ error: 'Reclamo no encontrado' }); return; }
  res.json(rec);
}));

/** PATCH /api/admin/reclamos/:id/responder  { respuesta, estado_id? } */
router.patch('/:id/responder', w(async (req, res) => {
  const b = req.body ?? {};
  res.json(await reclamoRepo.responder(Number(req.params.id), {
    respuesta: b.respuesta,
    estadoId: b.estado_id != null ? Number(b.estado_id) : undefined,
    respondidoBy: uid(req),
  }));
}));

/** PATCH /api/admin/reclamos/:id/estado  { estado_id, nota? } */
router.patch('/:id/estado', w(async (req, res) => {
  res.json(await reclamoRepo.cambiarEstado(Number(req.params.id), Number(req.body?.estado_id), req.body?.nota, uid(req)));
}));

/** GET /api/admin/reclamos/:id/historial — línea de tiempo del reclamo. */
router.get('/:id/historial', w(async (req, res) => {
  res.json(await reclamoRepo.getHistorial(Number(req.params.id)));
}));

/** GET /api/admin/reclamos/:id/pdf — descarga la Hoja de Reclamación. */
router.get('/:id/pdf', w(async (req, res) => {
  const rec = await reclamoRepo.getById(Number(req.params.id));
  if (!rec) { res.status(404).json({ error: 'Reclamo no encontrado' }); return; }
  const pdf = await generarReclamoPdf(rec);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${rec.numero}.pdf"`);
  res.send(pdf);
}));

export const reclamosAdminRoutes = router;
