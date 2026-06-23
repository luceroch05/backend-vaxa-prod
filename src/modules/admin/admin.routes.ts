import { Router } from 'express';
import type { Request, Response } from 'express';
import { adminRepo } from './admin.repository';
import { planRepo } from '../certificados/planes/plan.repository';
import { sendError } from '../../shared/errors';

const w = (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response) => fn(req, res).catch((e: unknown) => sendError(res, e, 'admin'));

const uid = (req: Request): number | undefined => (req as any).authUser?.sub;

const router = Router();

/** Empresas */
router.get('/empresas', w(async (_req, res) => {
  res.json(await adminRepo.listEmpresas());
}));

router.post('/empresas', w(async (req, res) => {
  res.status(201).json(await adminRepo.crearEmpresa(req.body ?? {}, uid(req)));
}));

router.patch('/empresas/:id', w(async (req, res) => {
  res.json(await adminRepo.updateEmpresa(Number(req.params.id), req.body ?? {}));
}));

router.delete('/empresas/:id', w(async (req, res) => {
  res.json(await adminRepo.eliminarEmpresa(Number(req.params.id)));
}));

/** Recarga manual de cupo del mes (cobro proporcional al plan). body: { cantidad } */
router.post('/empresas/:id/recargar-cupo', w(async (req, res) => {
  const { cantidad } = req.body ?? {};
  res.json(await planRepo.recargarCupo(Number(req.params.id), Number(cantidad)));
}));

/** Usuarios por empresa */
router.get('/empresas/:id/usuarios', w(async (req, res) => {
  const producto = (req.query.producto as string | undefined)?.trim() || undefined;
  res.json(await adminRepo.listUsuarios(Number(req.params.id), producto));
}));

router.post('/empresas/:id/usuarios', w(async (req, res) => {
  res.status(201).json(await adminRepo.crearUsuario(Number(req.params.id), req.body ?? {}, uid(req)));
}));

router.patch('/empresas/:id/usuarios/:usuarioId', w(async (req, res) => {
  res.json(await adminRepo.editarUsuario(Number(req.params.id), Number(req.params.usuarioId), req.body ?? {}));
}));

router.delete('/empresas/:id/usuarios/:usuarioId', w(async (req, res) => {
  const producto = (req.query.producto as string | undefined)?.trim() || undefined;
  res.json(await adminRepo.eliminarUsuario(Number(req.params.id), Number(req.params.usuarioId), producto));
}));

/** Roles (para el selector al crear usuario) */
router.get('/roles', w(async (_req, res) => {
  res.json(await adminRepo.listRoles());
}));

/** Planes — catálogo (para el selector). */
router.get('/planes', w(async (_req, res) => {
  res.json(await planRepo.listPlanes());
}));

/** Plan vigente + consumo del mes de una empresa (vista Vaxa). */
router.get('/empresas/:id/plan', w(async (req, res) => {
  res.json(await planRepo.getEstadoById(Number(req.params.id)));
}));

/** Asignar / cambiar el plan de una empresa. body: { plan_id, ciclo_id? } */
router.post('/empresas/:id/plan', w(async (req, res) => {
  const { plan_id, ciclo_id } = req.body ?? {};
  if (!plan_id) throw new Error('plan_id es requerido');
  await planRepo.asignarPlan(Number(req.params.id), Number(plan_id), Number(ciclo_id) || 1);
  res.json(await planRepo.getEstadoById(Number(req.params.id)));
}));

export const adminRoutes = router;
