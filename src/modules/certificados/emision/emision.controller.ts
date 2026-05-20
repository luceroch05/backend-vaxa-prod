import type { Request, Response } from 'express';
import { emisionService } from './emision.service';
import type { RequestWithTenant } from '../../../middleware/tenant.middleware';

const tid = (req: Request) => (req as unknown as RequestWithTenant).tenant.id;

export async function listCertificados(req: Request, res: Response): Promise<void> {
  res.json(await emisionService.listAll(tid(req)));
}

export async function generarCertificado(req: Request, res: Response): Promise<void> {
  res.status(201).json(await emisionService.generar(tid(req), Number(req.params.inscripcionId)));
}

export async function validarPublico(req: Request, res: Response): Promise<void> {
  const cert = await emisionService.validarPublico(req.params.codigo);
  if (!cert) { res.status(404).json({ error: 'Certificado no encontrado' }); return; }
  res.json(cert);
}

export async function anularCertificado(req: Request, res: Response): Promise<void> {
  const ok = await emisionService.anular(tid(req), Number(req.params.id));
  if (!ok) { res.status(404).json({ error: 'Certificado no encontrado' }); return; }
  res.status(204).send();
}
