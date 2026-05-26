import type { Request, Response } from 'express';
import type { RequestWithTenant } from '../../../middleware/tenant.middleware';

export const w = (fn: Function) => (req: any, res: any) =>
  fn(req, res).catch((e: Error) => res.status(500).json({ error: e.message }));

export const tid = (req: Request): string =>
  (req as unknown as RequestWithTenant).tenant.id;
