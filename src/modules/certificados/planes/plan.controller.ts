import type { Request, Response } from 'express';
import { tid } from '../shared/router.helper';
import { planRepo } from './plan.repository';

/** GET /api/certificados/planes — catálogo de planes disponibles. */
export async function listPlanes(_req: Request, res: Response): Promise<void> {
  res.json(await planRepo.listPlanes());
}

/** GET /api/certificados/planes/estado — plan vigente + consumo del mes de la empresa. */
export async function getEstadoPlan(req: Request, res: Response): Promise<void> {
  res.json(await planRepo.getEstado(tid(req)));
}
