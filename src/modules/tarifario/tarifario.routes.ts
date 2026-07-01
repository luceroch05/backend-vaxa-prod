import { Router } from 'express';
import type { Request, Response } from 'express';
import { tarifarioRepo } from './tarifario.repository';
import { sendError } from '../../shared/errors';

const w = (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response) => fn(req, res).catch((e: unknown) => sendError(res, e, 'tarifario'));

const router = Router();

/** GET /api/admin/tarifario — paquetes de créditos, tramos y parámetros. */
router.get('/', w(async (_req, res) => {
  res.json(await tarifarioRepo.get());
}));

export const tarifarioRoutes = router;
