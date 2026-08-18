import type { Request, Response } from 'express';
import { tid } from '../shared/router.helper';
import { calidadesRepo } from '../shared/certificados.repository';

/**
 * Catálogo de calidades de participación por empresa (Participante, Ponente,
 * Organizador…). Reemplaza la lista hardcodeada del frontend: ahora las opciones
 * salen de esta tabla y el centro las administra.
 */

export async function listCalidades(req: Request, res: Response): Promise<void> {
  const incluirInactivas = req.query.todas === '1' || req.query.todas === 'true';
  res.json(await calidadesRepo.list(tid(req), incluirInactivas));
}

export async function createCalidad(req: Request, res: Response): Promise<void> {
  const { nombre } = req.body ?? {};
  if (!nombre?.trim()) { res.status(400).json({ error: 'nombre es requerido' }); return; }
  res.status(201).json(await calidadesRepo.create(tid(req), String(nombre).trim()));
}

export async function updateCalidad(req: Request, res: Response): Promise<void> {
  const { nombre, activo, orden } = req.body ?? {};
  const updated = await calidadesRepo.update(tid(req), Number(req.params.id), { nombre, activo, orden });
  if (!updated) { res.status(404).json({ error: 'Calidad no encontrada' }); return; }
  res.json(updated);
}
