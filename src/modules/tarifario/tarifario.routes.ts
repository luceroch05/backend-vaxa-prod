import { Router } from 'express';
import type { Request, Response } from 'express';
import { tarifarioRepo } from './tarifario.repository';
import { sendError } from '../../shared/errors';

const w = (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response) => fn(req, res).catch((e: unknown) => sendError(res, e, 'tarifario'));

const router = Router();

/** GET /api/admin/tarifario — paquetes de créditos, tramos, parámetros y servicios. */
router.get('/', w(async (_req, res) => {
  res.json(await tarifarioRepo.get());
}));

/** POST /api/admin/tarifario/servicios — crea un servicio (web/dominio/hosting). */
router.post('/servicios', w(async (req, res) => {
  const b = req.body ?? {};
  res.json(await tarifarioRepo.createServicio({
    slug: b.slug, grupo: b.grupo, nombre: b.nombre, precio: Number(b.precio), orden: b.orden,
  }));
}));

/** PUT /api/admin/tarifario/servicios/:id — edita nombre/precio/grupo/orden. */
router.put('/servicios/:id', w(async (req, res) => {
  const b = req.body ?? {};
  res.json(await tarifarioRepo.updateServicio(Number(req.params.id), {
    grupo: b.grupo, nombre: b.nombre,
    precio: b.precio != null ? Number(b.precio) : undefined,
    orden: b.orden != null ? Number(b.orden) : undefined,
  }));
}));

/** DELETE /api/admin/tarifario/servicios/:id — baja lógica. */
router.delete('/servicios/:id', w(async (req, res) => {
  await tarifarioRepo.deleteServicio(Number(req.params.id));
  res.json({ ok: true });
}));

export const tarifarioRoutes = router;
