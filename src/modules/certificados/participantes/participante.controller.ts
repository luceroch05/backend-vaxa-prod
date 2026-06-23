import type { Request, Response } from 'express';
import { participanteService } from './participante.service';
import { tid } from '../shared/router.helper';
import { DatosAsociadosError } from '../shared/certificados.repository';

export async function listParticipantes(req: Request, res: Response): Promise<void> {
  const incluirInactivos = req.query.todos === '1' || req.query.todos === 'true';
  res.json(await participanteService.listAll(tid(req), incluirInactivos));
}

/** Edita los datos de un estudiante. */
export async function actualizarParticipante(req: Request, res: Response): Promise<void> {
  const p = await participanteService.update(tid(req), Number(req.params.id), req.body ?? {});
  if (!p) { res.status(404).json({ error: 'Estudiante no encontrado' }); return; }
  res.json(p);
}

/** BORRA un estudiante y sus inscripciones (con protección de certificados). */
export async function eliminarParticipante(req: Request, res: Response): Promise<void> {
  try {
    const ok = await participanteService.remove(tid(req), Number(req.params.id));
    if (!ok) { res.status(404).json({ error: 'Estudiante no encontrado' }); return; }
    res.status(204).send();
  } catch (e) {
    if (e instanceof DatosAsociadosError) { res.status(409).json({ error: e.message, code: 'DATOS_ASOCIADOS' }); return; }
    throw e;
  }
}

/** Archiva (desactiva) o reactiva un estudiante. Body: { activo: boolean }. */
export async function setActivoParticipante(req: Request, res: Response): Promise<void> {
  const activo = req.body?.activo !== false;
  const p = await participanteService.setActivo(tid(req), Number(req.params.id), activo);
  if (!p) { res.status(404).json({ error: 'Participante no encontrado' }); return; }
  res.json(p);
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
