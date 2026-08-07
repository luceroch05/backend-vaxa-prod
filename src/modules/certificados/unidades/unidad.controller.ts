import type { Request, Response } from 'express';
import { unidadService } from './unidad.service';
import { tid, uid } from '../shared/router.helper';

export async function listUnidades(req: Request, res: Response): Promise<void> {
  const programaId = Number(req.query.programa_id);
  if (!programaId) { res.status(400).json({ error: 'programa_id es requerido' }); return; }
  res.json(await unidadService.listByPrograma(tid(req), programaId));
}

export async function createUnidad(req: Request, res: Response): Promise<void> {
  const { programa_id, nombre, orden, creditos } = req.body ?? {};
  if (!programa_id || !nombre?.trim()) {
    res.status(400).json({ error: 'programa_id y nombre son requeridos' }); return;
  }
  res.status(201).json(await unidadService.create(tid(req), { programa_id, nombre: nombre.trim(), orden, creditos }, uid(req)));
}

export async function updateUnidad(req: Request, res: Response): Promise<void> {
  const { nombre, orden, creditos } = req.body ?? {};
  const u = await unidadService.update(tid(req), Number(req.params.id), { nombre, orden, creditos }, uid(req));
  if (!u) { res.status(404).json({ error: 'Unidad no encontrada' }); return; }
  res.json(u);
}

export async function deleteUnidad(req: Request, res: Response): Promise<void> {
  const ok = await unidadService.remove(tid(req), Number(req.params.id), uid(req));
  if (!ok) { res.status(404).json({ error: 'Unidad no encontrada' }); return; }
  res.status(204).send();
}
