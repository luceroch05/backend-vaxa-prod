import { Router } from 'express';
import type { Request, Response } from 'express';
import { historiasRepo } from './historias.repository';
import { sendError } from '../../shared/errors';

/**
 * Rutas PÚBLICAS del portal de padres/apoderados (sin login).
 * Se montan en /public/portal (ver index.ts). El token del enlace ES la
 * credencial: resuelve centro + paciente y devuelve solo lectura del progreso.
 * Única excepción de escritura: el apoderado marca sus tareas como cumplidas.
 */
const router = Router();

router.get('/:token', (req: Request, res: Response) => {
  historiasRepo.portalData(String(req.params.token))
    .then((data) => res.json(data))
    .catch((e) => sendError(res, e, 'portal'));
});

router.post('/:token/tareas/:tareaId/cumplir', (req: Request, res: Response) => {
  const cumplida = req.body?.cumplida !== false;
  historiasRepo.marcarTareaPortal(String(req.params.token), Number(req.params.tareaId), cumplida)
    .then((r) => res.json(r))
    .catch((e) => sendError(res, e, 'portal'));
});

export const historiasPublicRoutes = router;
