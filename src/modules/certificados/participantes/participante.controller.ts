import type { Request, Response } from 'express';
import { participanteService } from './participante.service';
import type { RequestWithTenant } from '../../../middleware/tenant.middleware';

const tid = (req: Request) => (req as unknown as RequestWithTenant).tenant.id;

export async function listParticipantes(req: Request, res: Response): Promise<void> {
  res.json(await participanteService.listAll(tid(req)));
}

export async function getParticipante(req: Request, res: Response): Promise<void> {
  const p = await participanteService.findById(tid(req), Number(req.params.id));
  if (!p) { res.status(404).json({ error: 'Participante no encontrado' }); return; }
  res.json(p);
}

export async function createParticipante(req: Request, res: Response): Promise<void> {
  const { tipo_documento_id, numero_documento, nombres, apellidos, email, telefono } = req.body ?? {};
  if (!tipo_documento_id || !numero_documento || !nombres || !apellidos) {
    res.status(400).json({ error: 'tipo_documento_id, numero_documento, nombres y apellidos son requeridos' }); return;
  }
  res.status(201).json(
    await participanteService.create(tid(req), { tipo_documento_id, numero_documento, nombres, apellidos, email, telefono }),
  );
}
