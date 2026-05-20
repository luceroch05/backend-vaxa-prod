import type { Request, Response } from 'express';
import { logoService } from './logo.service';
import type { RequestWithTenant } from '../../../middleware/tenant.middleware';

const tid = (req: Request) => (req as unknown as RequestWithTenant).tenant.id;

export async function listLogos(req: Request, res: Response): Promise<void> {
  res.json(await logoService.listAll(tid(req)));
}

export async function createLogo(req: Request, res: Response): Promise<void> {
  const { nombre, imagen_logo } = req.body ?? {};
  if (!imagen_logo) { res.status(400).json({ error: 'imagen_logo es requerido' }); return; }
  res.status(201).json(await logoService.create(tid(req), { nombre, imagen_logo }));
}

export async function deleteLogo(req: Request, res: Response): Promise<void> {
  const ok = await logoService.remove(tid(req), Number(req.params.id));
  if (!ok) { res.status(404).json({ error: 'Logo no encontrado' }); return; }
  res.status(204).send();
}
