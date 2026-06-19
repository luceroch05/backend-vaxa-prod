import { Router } from 'express';
import type { Request, Response } from 'express';
import { creditosRepo } from '../certificados/shared/creditos.repository';
import { sendError } from '../../shared/errors';

const w = (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response) => fn(req, res).catch((e: unknown) => sendError(res, e, 'admin/creditos'));

const uid = (req: Request): number | undefined => (req as any).authUser?.sub;

const router = Router();

/** GET /api/admin/creditos/empresas — todas las empresas con saldo y consumo. */
router.get('/empresas', w(async (_req, res) => {
  res.json(await creditosRepo.listEmpresas());
}));

/** POST /api/admin/creditos/empresas/:empresaId/recargar  { cantidad, descripcion } */
router.post('/empresas/:empresaId/recargar', w(async (req, res) => {
  const empresaId = Number(req.params.empresaId);
  const { cantidad, descripcion } = req.body ?? {};
  const nuevoSaldo = await creditosRepo.recargar(empresaId, Number(cantidad), uid(req), descripcion);
  res.json({ empresaId, saldo: nuevoSaldo });
}));

/** GET /api/admin/creditos/empresas/:empresaId/movimientos */
router.get('/empresas/:empresaId/movimientos', w(async (req, res) => {
  const empresaId = Number(req.params.empresaId);
  const limit = Number(req.query.limit) || 100;
  res.json(await creditosRepo.listMovimientosByEmpresaId(empresaId, limit));
}));

export const creditosAdminRoutes = router;
