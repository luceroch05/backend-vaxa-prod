import { Router } from 'express';
import type { Request, Response } from 'express';
import { adminRepo } from './admin.repository';
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

export const adminRoutes = router;
