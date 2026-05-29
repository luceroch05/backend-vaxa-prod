import type { Request, Response } from 'express';
import { participanteService } from './participante.service';
import { tid } from '../shared/router.helper';

export async function listParticipantes(req: Request, res: Response): Promise<void> {
  res.json(await participanteService.listAll(tid(req)));
}

/** Busca un participante por documento (para autocompletar al inscribir). 404 si no existe. */
export async function buscarParticipante(req: Request, res: Response): Promise<void> {
  const documento = (req.query.documento as string)?.trim();
  if (!documento) { res.status(400).json({ error: 'documento es requerido' }); return; }
  const tipoId = req.query.tipo_documento_id ? Number(req.query.tipo_documento_id) : undefined;
  const p = await participanteService.findByDocumento(tid(req), documento, tipoId);
  if (!p) { res.status(404).json({ error: 'No registrado' }); return; }
  res.json(p);
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
