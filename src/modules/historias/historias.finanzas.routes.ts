import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { finanzasRepo } from './historias.finanzas.repository';
import { sendError } from '../../shared/errors';

/**
 * Rutas de FINANZAS de Historias Clínicas (Caja + Ventas + Inventario).
 * Se montan bajo /api/historias (mismo stack: JWT + tenant + bloqueo por vencimiento).
 * Acceso: solo ADMINISTRADOR y ADMISION (el TERAPEUTA queda en lo clínico).
 * Aisladas del router clínico para no mezclar responsabilidades.
 */

const w = (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response) => fn(req, res).catch((e) => sendError(res, e, 'historias-finanzas'));

const tid = (req: Request): string => {
  const slug = (req.headers['x-tenant-id'] as string)?.toLowerCase()?.trim();
  if (!slug) throw new Error('x-tenant-id header requerido');
  return slug;
};
const uid = (req: Request): number | undefined => (req as any).authUser?.sub;
const rol = (req: Request): string => String((req as any).authUser?.rol ?? '').toUpperCase();

/** Solo recepción/dirección manejan dinero e inventario. */
const gestionaFinanzas = (req: Request, res: Response, next: NextFunction): void => {
  if (['ADMINISTRADOR', 'ADMISION'].includes(rol(req))) { next(); return; }
  res.status(403).json({ error: 'Tu rol no tiene permiso para el módulo de caja.', code: 'ROL_SIN_PERMISO' });
};

const router = Router();
router.use(gestionaFinanzas);

// ── Inventario / Productos ─────────────────────────────────────────────────────
router.get('/productos', w(async (req, res) => {
  const todos = req.query.todos === '1' || req.query.todos === 'true';
  res.json(await finanzasRepo.listProductos(tid(req), todos));
}));

router.post('/productos', w(async (req, res) => {
  res.status(201).json(await finanzasRepo.createProducto(tid(req), req.body ?? {}, uid(req)));
}));

router.patch('/productos/:id', w(async (req, res) => {
  const p = await finanzasRepo.updateProducto(tid(req), Number(req.params.id), req.body ?? {});
  if (!p) { res.status(404).json({ error: 'Producto no encontrado' }); return; }
  res.json(p);
}));

router.get('/productos/:id/movimientos', w(async (req, res) => {
  res.json(await finanzasRepo.listMovsInventario(tid(req), Number(req.params.id)));
}));

router.post('/productos/:id/stock', w(async (req, res) => {
  const tipo = req.body?.tipo === 'salida' ? 'salida' : 'entrada';
  const p = await finanzasRepo.ajustarStock(tid(req), Number(req.params.id), tipo, Number(req.body?.cantidad), req.body?.motivo ?? '', uid(req));
  res.json(p);
}));

// ── Ventas ──────────────────────────────────────────────────────────────────────
router.get('/ventas', w(async (req, res) => {
  res.json(await finanzasRepo.listVentas(tid(req), {
    desde: (req.query.desde as string) || undefined,
    hasta: (req.query.hasta as string) || undefined,
  }));
}));

router.get('/ventas/:id', w(async (req, res) => {
  const v = await finanzasRepo.getVenta(tid(req), Number(req.params.id));
  if (!v) { res.status(404).json({ error: 'Venta no encontrada' }); return; }
  res.json(v);
}));

router.post('/ventas', w(async (req, res) => {
  res.status(201).json(await finanzasRepo.createVenta(tid(req), req.body ?? {}, uid(req)));
}));

router.post('/ventas/:id/anular', w(async (req, res) => {
  res.json(await finanzasRepo.anularVenta(tid(req), Number(req.params.id), uid(req)));
}));

// ── Caja: ingresos / egresos ─────────────────────────────────────────────────────
router.get('/caja', w(async (req, res) => {
  res.json(await finanzasRepo.listCaja(tid(req), {
    desde: (req.query.desde as string) || undefined,
    hasta: (req.query.hasta as string) || undefined,
    tipo:  (req.query.tipo as string) || undefined,
  }));
}));

router.post('/caja', w(async (req, res) => {
  res.status(201).json(await finanzasRepo.createCajaMov(tid(req), req.body ?? {}, uid(req)));
}));

router.delete('/caja/:id', w(async (req, res) => {
  const ok = await finanzasRepo.deleteCajaMov(tid(req), Number(req.params.id));
  if (!ok) { res.status(404).json({ error: 'Movimiento no encontrado o no se puede eliminar (viene de una venta)' }); return; }
  res.status(204).send();
}));

export const historiasFinanzasRoutes = router;
