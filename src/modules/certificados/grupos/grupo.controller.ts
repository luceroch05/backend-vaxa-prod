import type { Request, Response } from 'express';
import { grupoService } from './grupo.service';
import { tid, uid } from '../shared/router.helper';
import { DatosAsociadosError } from '../shared/certificados.repository';

export async function listGrupos(req: Request, res: Response): Promise<void> {
  const incluirInactivos = req.query.todos === '1' || req.query.todos === 'true';
  res.json(await grupoService.listAll(tid(req), incluirInactivos));
}

/** BORRA un aula y sus inscripciones (con protección de certificados). */
export async function eliminarGrupo(req: Request, res: Response): Promise<void> {
  try {
    const ok = await grupoService.remove(tid(req), Number(req.params.id), uid(req));
    if (!ok) { res.status(404).json({ error: 'Aula no encontrada' }); return; }
    res.status(204).send();
  } catch (e) {
    if (e instanceof DatosAsociadosError) { res.status(409).json({ error: e.message, code: 'DATOS_ASOCIADOS' }); return; }
    throw e;
  }
}

/** Archiva (desactiva) o reactiva un aula. Body: { activo: boolean }. */
export async function setActivoGrupo(req: Request, res: Response): Promise<void> {
  const activo = req.body?.activo !== false;
  const g = await grupoService.setActivo(tid(req), Number(req.params.id), activo, uid(req));
  if (!g) { res.status(404).json({ error: 'Grupo no encontrado' }); return; }
  res.json(g);
}

export async function getGrupo(req: Request, res: Response): Promise<void> {
  const g = await grupoService.findById(tid(req), Number(req.params.id));
  if (!g) { res.status(404).json({ error: 'Grupo no encontrado' }); return; }
  res.json(g);
}

export async function createGrupo(req: Request, res: Response): Promise<void> {
  const { programa_id, nombre_grupo, fecha_inicio, fecha_fin, modalidad_id, dias_semana, hora_inicio, hora_fin } = req.body ?? {};
  if (!programa_id || !nombre_grupo || !fecha_inicio || !fecha_fin || !modalidad_id) {
    res.status(400).json({ error: 'programa_id, nombre_grupo, fecha_inicio, fecha_fin y modalidad_id son requeridos' }); return;
  }
  res.status(201).json(await grupoService.create(tid(req), {
    programa_id, nombre_grupo, fecha_inicio, fecha_fin, modalidad_id,
    dias_semana: dias_semana || null, hora_inicio: hora_inicio || null, hora_fin: hora_fin || null,
  }, uid(req)));
}
