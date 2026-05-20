import type { Request, Response } from 'express';
import { catalogoService } from './catalogo.service';

export async function getCatalogos(_req: Request, res: Response): Promise<void> {
  res.json(await catalogoService.getCatalogos());
}
