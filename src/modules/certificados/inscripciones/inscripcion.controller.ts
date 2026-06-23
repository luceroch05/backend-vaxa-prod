import type { Request, Response } from 'express';
import { inscripcionService } from './inscripcion.service';
import { tid } from '../shared/router.helper';
import { DatosAsociadosError } from '../shared/certificados.repository';

/** Id del usuario autenticado (lo pone jwtMiddleware en authUser.sub). */
const uid = (req: Request): number | undefined => (req as any).authUser?.sub;

export async function listInscripciones(req: Request, res: Response): Promise<void> {
  const grupoId = req.query.grupo_id ? Number(req.query.grupo_id) : undefined;
  res.json(await inscripcionService.listAll(tid(req), grupoId));
}

export async function createInscripcion(req: Request, res: Response): Promise<void> {
  const { participante_id, grupo_id, fecha_inscripcion } = req.body ?? {};
  if (!participante_id || !grupo_id) {
    res.status(400).json({ error: 'participante_id y grupo_id son requeridos' }); return;
  }
  const fecha = fecha_inscripcion ?? new Date().toISOString().split('T')[0];
  res.status(201).json(await inscripcionService.create(tid(req), { participante_id, grupo_id, fecha_inscripcion: fecha }));
}

export async function inscribir(req: Request, res: Response): Promise<void> {
  const { tipo_documento_id, numero_documento, nombres, apellidos, email, telefono, grupo_id, fecha_inscripcion } = req.body ?? {};
  if (!tipo_documento_id || !numero_documento?.trim() || !nombres?.trim() || !apellidos?.trim() || !grupo_id) {
    res.status(400).json({ error: 'tipo_documento_id, numero_documento, nombres, apellidos y grupo_id son requeridos' }); return;
  }
  res.status(201).json(await inscripcionService.inscribir(tid(req), {
    tipo_documento_id, numero_documento: numero_documento.trim(),
    nombres: nombres.trim(), apellidos: apellidos.trim(),
    email, telefono, grupo_id, fecha_inscripcion,
  }));
}

export async function cambiarEstado(req: Request, res: Response): Promise<void> {
  const { estado_id } = req.body ?? {};
  if (!estado_id) { res.status(400).json({ error: 'estado_id es requerido' }); return; }
  const updated = await inscripcionService.cambiarEstado(tid(req), Number(req.params.id), { estado_id });
  if (!updated) { res.status(404).json({ error: 'Inscripción no encontrada' }); return; }
  res.json(updated);
}

/** BORRA una inscripción (con protección: bloquea si ya tiene certificado emitido). */
export async function eliminarInscripcion(req: Request, res: Response): Promise<void> {
  try {
    const ok = await inscripcionService.remove(tid(req), Number(req.params.id));
    if (!ok) { res.status(404).json({ error: 'Inscripción no encontrada' }); return; }
    res.status(204).send();
  } catch (e) {
    if (e instanceof DatosAsociadosError) { res.status(409).json({ error: e.message, code: 'DATOS_ASOCIADOS' }); return; }
    throw e;
  }
}

/** Cambia el estado de varias inscripciones a la vez (ej. aprobar todo un grupo sin notas). */
export async function cambiarEstadoMasivo(req: Request, res: Response): Promise<void> {
  const { ids, estado_id } = req.body ?? {};
  if (!Array.isArray(ids) || ids.length === 0 || !estado_id) {
    res.status(400).json({ error: 'ids (lista no vacía) y estado_id son requeridos' }); return;
  }
  const actualizadas = await inscripcionService.cambiarEstadoMasivo(tid(req), ids, Number(estado_id), uid(req));
  res.json({ actualizadas });
}
