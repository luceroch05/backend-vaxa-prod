import type { Request, Response } from 'express';
import { firmaService } from './firma.service';
import { tid, uid } from '../shared/router.helper';

export async function listFirmas(req: Request, res: Response): Promise<void> {
  res.json(await firmaService.listAll(tid(req)));
}

export async function createFirma(req: Request, res: Response): Promise<void> {
  const { nombre_autoridad, cargo, imagen_firma } = req.body ?? {};
  if (!nombre_autoridad || !cargo || !imagen_firma) {
    res.status(400).json({ error: 'nombre_autoridad, cargo e imagen_firma son requeridos' }); return;
  }
  res.status(201).json(await firmaService.create(tid(req), { nombre_autoridad, cargo, imagen_firma }, uid(req)));
}

export async function updateFirma(req: Request, res: Response): Promise<void> {
  const { nombre_autoridad, cargo, imagen_firma } = req.body ?? {};
  const firma = await firmaService.update(tid(req), Number(req.params.id), { nombre_autoridad, cargo, imagen_firma }, uid(req));
  if (!firma) { res.status(404).json({ error: 'Firma no encontrada' }); return; }
  res.json(firma);
}

export async function deleteFirma(req: Request, res: Response): Promise<void> {
  const ok = await firmaService.remove(tid(req), Number(req.params.id), uid(req));
  if (!ok) { res.status(404).json({ error: 'Firma no encontrada' }); return; }
  res.status(204).send();
}
