import type { Request, Response } from 'express';
import { notaService } from './nota.service';
import { tid, uid } from '../shared/router.helper';

/** Matriz de notas de un grupo (unidades + alumnos + promedios). */
export async function getNotasGrupo(req: Request, res: Response): Promise<void> {
  const data = await notaService.matrizGrupo(tid(req), Number(req.params.grupoId));
  if (!data) { res.status(404).json({ error: 'Grupo no encontrado' }); return; }
  res.json(data);
}

/** Guarda las notas de un alumno y recalcula su aprobación. */
export async function guardarNotas(req: Request, res: Response): Promise<void> {
  const notas = Array.isArray(req.body?.notas) ? req.body.notas : null;
  if (!notas) { res.status(400).json({ error: 'notas debe ser un arreglo' }); return; }
  res.json(await notaService.guardar(tid(req), Number(req.params.inscripcionId), notas, uid(req)));
}
