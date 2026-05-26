import type { Request, Response } from 'express';

export const w = (fn: Function) => (req: any, res: any) =>
  fn(req, res).catch((e: Error) => res.status(500).json({ error: e.message }));

/** Lee el tenant slug del header x-tenant-id (sin depender del tenantMiddleware). */
export const tid = (req: Request): string => {
  const slug = (req.headers['x-tenant-id'] as string)?.toLowerCase()?.trim();
  if (!slug) throw new Error('x-tenant-id header requerido');
  return slug;
};
