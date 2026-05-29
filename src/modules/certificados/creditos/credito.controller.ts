import type { Request, Response } from 'express';
import { tid } from '../shared/router.helper';
import { creditosRepo } from '../shared/creditos.repository';

/** GET /api/certificados/creditos — saldo de la empresa del operador. */
export async function getCreditos(req: Request, res: Response): Promise<void> {
  res.json(await creditosRepo.getEstado(tid(req)));
}

/** GET /api/certificados/creditos/movimientos — historial. */
export async function getMovimientos(req: Request, res: Response): Promise<void> {
  const limit = Number(req.query.limit) || 100;
  res.json(await creditosRepo.listMovimientos(tid(req), limit));
}
