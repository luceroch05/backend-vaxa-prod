import type { Request, Response } from 'express';
import { programaService } from './programa.service';
import { tid } from '../shared/router.helper';
import { DatosAsociadosError } from '../shared/certificados.repository';

export async function listProgramas(req: Request, res: Response): Promise<void> {
  const incluirInactivos = req.query.todos === '1' || req.query.todos === 'true';
  res.json(await programaService.listAll(tid(req), incluirInactivos));
}

/** BORRA un programa por completo (con protección de certificados). */
export async function eliminarPrograma(req: Request, res: Response): Promise<void> {
  try {
    const ok = await programaService.remove(tid(req), Number(req.params.id));
    if (!ok) { res.status(404).json({ error: 'Programa no encontrado' }); return; }
    res.status(204).send();
  } catch (e) {
    if (e instanceof DatosAsociadosError) { res.status(409).json({ error: e.message, code: 'DATOS_ASOCIADOS' }); return; }
    throw e;
  }
}

/** Archiva (desactiva) o reactiva un programa. Body: { activo: boolean }. */
export async function setActivoPrograma(req: Request, res: Response): Promise<void> {
  const activo = req.body?.activo !== false;   // por defecto true (reactivar) salvo que manden false
  const uid = (req as any).authUser?.sub;
  const prog = await programaService.setActivo(tid(req), Number(req.params.id), activo, uid);
  if (!prog) { res.status(404).json({ error: 'Programa no encontrado' }); return; }
  res.json(prog);
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
