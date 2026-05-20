import type { Request, Response } from 'express';
import { inscripcionService } from './inscripcion.service';
import type { RequestWithTenant } from '../../../middleware/tenant.middleware';

const tid = (req: Request) => (req as unknown as RequestWithTenant).tenant.id;

export async function listInscripciones(req: Request, res: Response): Promise<void> {
  const grupoId = req.query.grupo_id ? Number(req.query.grupo_id) : undefined;
  res.json(await inscripcionService.listAll(tid(req), grupoId));
}

export async function createInscripcion(req: Request, res: Response): Promise<void> {
  const { participante_id, grupo_id, fecha_inscripcion } = req.body ?? {};
  if (!participante_id || !grupo_id || !fecha_inscripcion) {
    res.status(400).json({ error: 'participante_id, grupo_id y fecha_inscripcion son requeridos' }); return;
  }
  res.status(201).json(await inscripcionService.create(tid(req), { participante_id, grupo_id, fecha_inscripcion }));
}

export async function cambiarEstado(req: Request, res: Response): Promise<void> {
  const { estado_id } = req.body ?? {};
  if (!estado_id) { res.status(400).json({ error: 'estado_id es requerido' }); return; }
  const updated = await inscripcionService.cambiarEstado(tid(req), Number(req.params.id), { estado_id });
  if (!updated) { res.status(404).json({ error: 'Inscripción no encontrada' }); return; }
  res.json(updated);
}
