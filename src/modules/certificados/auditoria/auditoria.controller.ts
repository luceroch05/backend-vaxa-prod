import type { Request, Response } from 'express';
import { auditoriaService } from './auditoria.service';
import { tid } from '../shared/router.helper';

/** Solo el ADMINISTRADOR de la empresa puede ver la auditoría. */
const esAdmin = (req: Request): boolean =>
  String((req as any).authUser?.rol ?? '').toUpperCase() === 'ADMINISTRADOR';

/** GET /api/certificados/auditoria — historial de acciones (filtros + paginación). */
export async function getAuditoria(req: Request, res: Response): Promise<void> {
  if (!esAdmin(req)) {
    res.status(403).json({ error: 'Solo el administrador de la empresa puede ver la auditoría.', code: 'NO_ADMIN' });
    return;
  }
  const { accion, entidad, limit, offset } = req.query;
  res.json(await auditoriaService.listar(tid(req), {
    accion:  accion  ? String(accion)  : undefined,
    entidad: entidad ? String(entidad) : undefined,
    limit:   limit   ? Number(limit)   : undefined,
    offset:  offset  ? Number(offset)  : undefined,
  }));
}
