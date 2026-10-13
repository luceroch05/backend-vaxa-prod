import type { Request, Response } from 'express';
import { tid } from '../shared/router.helper';
import { gradosRepo } from '../shared/certificados.repository';

/**
 * Catálogo de grados académicos EXTRA por empresa (ej. "Mg", "MBA", "Esp.").
 * La lista base (Lic./Mag./Dr.…) vive en el frontend; esta tabla guarda solo los
 * que el centro agrega, para que los vean TODOS los usuarios (no solo un navegador).
 */

export async function listGrados(req: Request, res: Response): Promise<void> {
  const incluirInactivos = req.query.todos === '1' || req.query.todos === 'true';
  res.json(await gradosRepo.list(tid(req), incluirInactivos));
}

export async function createGrado(req: Request, res: Response): Promise<void> {
  const { nombre } = req.body ?? {};
  if (!nombre?.trim()) { res.status(400).json({ error: 'nombre es requerido' }); return; }
  res.status(201).json(await gradosRepo.create(tid(req), String(nombre).trim()));
}
