import type { Request, Response } from 'express';
import { configService } from './config.service';
import type { RequestWithTenant } from '../../../middleware/tenant.middleware';

const tid = (req: Request) => (req as unknown as RequestWithTenant).tenant.id;

export async function getConfig(req: Request, res: Response): Promise<void> {
  const cfg = await configService.findByPrograma(tid(req), Number(req.params.programaId));
  if (!cfg) { res.status(404).json({ error: 'Configuración no encontrada' }); return; }
  res.json(cfg);
}

export async function upsertConfig(req: Request, res: Response): Promise<void> {
  const { plantilla_url, firma_1_id, firma_2_id, logo_id } = req.body ?? {};
  if (!plantilla_url) { res.status(400).json({ error: 'plantilla_url es requerido' }); return; }
  res.json(await configService.upsert(tid(req), Number(req.params.programaId), { plantilla_url, firma_1_id, firma_2_id, logo_id }));
}
