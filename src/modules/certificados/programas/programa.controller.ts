import type { Request, Response } from 'express';
import { programaService } from './programa.service';
import type { RequestWithTenant } from '../../../middleware/tenant.middleware';

const tid = (req: Request) => (req as unknown as RequestWithTenant).tenant.id;

export async function listProgramas(req: Request, res: Response): Promise<void> {
  res.json(await programaService.listAll(tid(req)));
}

export async function getPrograma(req: Request, res: Response): Promise<void> {
  const prog = await programaService.findById(tid(req), Number(req.params.id));
  if (!prog) { res.status(404).json({ error: 'Programa no encontrado' }); return; }
  res.json(prog);
}

export async function createPrograma(req: Request, res: Response): Promise<void> {
  const { tipo_programa_id, nombre, descripcion, horas_academicas } = req.body ?? {};
  if (!nombre || !tipo_programa_id || !horas_academicas) {
    res.status(400).json({ error: 'nombre, tipo_programa_id y horas_academicas son requeridos' }); return;
  }
  res.status(201).json(await programaService.create(tid(req), { tipo_programa_id, nombre, descripcion, horas_academicas }));
}

export async function updatePrograma(req: Request, res: Response): Promise<void> {
  const prog = await programaService.update(tid(req), Number(req.params.id), req.body ?? {});
  if (!prog) { res.status(404).json({ error: 'Programa no encontrado' }); return; }
  res.json(prog);
}
