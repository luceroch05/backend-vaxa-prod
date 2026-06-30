import type { Request, Response } from 'express';
import { sendError } from '../../../shared/errors';

export const w = (fn: Function) => (req: any, res: any) =>
  fn(req, res).catch((e: unknown) => sendError(res, e, 'certificados'));

/** Lee el tenant slug del header x-tenant-id (sin depender del tenantMiddleware). */
export const tid = (req: Request): string => {
  const slug = (req.headers['x-tenant-id'] as string)?.toLowerCase()?.trim();
  if (!slug) throw new Error('x-tenant-id header requerido');
  return slug;
};

/** Id del usuario autenticado (lo pone jwtMiddleware en authUser.sub). Para auditoría. */
export const uid = (req: Request): number | undefined => (req as any).authUser?.sub;
