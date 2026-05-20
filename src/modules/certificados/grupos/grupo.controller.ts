import type { Request, Response } from 'express';
import { grupoService } from './grupo.service';
import type { RequestWithTenant } from '../../../middleware/tenant.middleware';

const tid = (req: Request) => (req as unknown as RequestWithTenant).tenant.id;

export async function listGrupos(req: Request, res: Response): Promise<void> {
  res.json(await grupoService.listAll(tid(req)));
}

export async function getGrupo(req: Request, res: Response): Promise<void> {
  const g = await grupoService.findById(tid(req), Number(req.params.id));
  if (!g) { res.status(404).json({ error: 'Grupo no encontrado' }); return; }
  res.json(g);
}

export async function createGrupo(req: Request, res: Response): Promise<void> {
  const { programa_id, nombre_grupo, fecha_inicio, fecha_fin, modalidad_id } = req.body ?? {};
  if (!programa_id || !nombre_grupo || !fecha_inicio || !fecha_fin || !modalidad_id) {
    res.status(400).json({ error: 'programa_id, nombre_grupo, fecha_inicio, fecha_fin y modalidad_id son requeridos' }); return;
  }
  res.status(201).json(await grupoService.create(tid(req), { programa_id, nombre_grupo, fecha_inicio, fecha_fin, modalidad_id }));
}
