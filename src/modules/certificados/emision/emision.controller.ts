import type { Request, Response } from 'express';
import { emisionService } from './emision.service';
import { tid } from '../shared/router.helper';

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

export async function regenerarPDF(req: Request, res: Response): Promise<void> {
  const url = await emisionService.regenerarPDF(tid(req), Number(req.params.id));
  if (!url) { res.status(404).json({ error: 'Certificado no encontrado' }); return; }
  res.json({ url: `/${url}` });
}
