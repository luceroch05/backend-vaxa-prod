import { Router } from 'express';
import type { Request, Response } from 'express';
import { cotizacionRepo } from './cotizacion.repository';
import { generarCotizacionPdf } from './cotizacion.pdf';
import { sendError } from '../../shared/errors';

const w = (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response) => fn(req, res).catch((e: unknown) => sendError(res, e, 'cotizaciones'));

const uid = (req: Request): number | undefined => (req as any).authUser?.sub;

const router = Router();

/** GET /api/admin/cotizaciones — lista (más recientes primero). */
router.get('/', w(async (req, res) => {
  const limit = Number(req.query.limit) || 200;
  res.json(await cotizacionRepo.list(limit));
}));

/** POST /api/admin/cotizaciones — crea una cotización (empresa o prospecto). */
router.post('/', w(async (req, res) => {
  const b = req.body ?? {};
  res.status(201).json(await cotizacionRepo.crear({
    empresaId: b.empresa_id ?? b.empresaId ?? null,
    cliente: b.cliente,
    items: Array.isArray(b.items) ? b.items : [],
    descuento: b.descuento && Number(b.descuento.valor) > 0
      ? { tipo: b.descuento.tipo === 'pct' ? 'pct' : 'monto', valor: Number(b.descuento.valor) }
      : undefined,
    igvIncluido: b.igv_incluido !== false,
    notas: b.notas,
    validaHasta: b.valida_hasta,
    createdBy: uid(req),
  }));
}));

/** GET /api/admin/cotizaciones/:id — detalle. */
router.get('/:id', w(async (req, res) => {
  const cot = await cotizacionRepo.getById(Number(req.params.id));
  if (!cot) { res.status(404).json({ error: 'Cotización no encontrada' }); return; }
  res.json(cot);
}));

/** PATCH /api/admin/cotizaciones/:id/estado  { estado_id } */
router.patch('/:id/estado', w(async (req, res) => {
  const estadoId = Number(req.body?.estado_id);
  res.json(await cotizacionRepo.cambiarEstado(Number(req.params.id), estadoId));
}));

/** PUT /api/admin/cotizaciones/:id — edita cliente/líneas/descuento (si no está convertida). */
router.put('/:id', w(async (req, res) => {
  const b = req.body ?? {};
  res.json(await cotizacionRepo.actualizar(Number(req.params.id), {
    empresaId: b.empresa_id ?? b.empresaId ?? null,
    cliente: b.cliente,
    items: Array.isArray(b.items) ? b.items : [],
    descuento: b.descuento && Number(b.descuento.valor) > 0
      ? { tipo: b.descuento.tipo === 'pct' ? 'pct' : 'monto', valor: Number(b.descuento.valor) }
      : undefined,
    igvIncluido: b.igv_incluido !== false,
    notas: b.notas,
    validaHasta: b.valida_hasta,
  }));
}));

/** DELETE /api/admin/cotizaciones/:id — elimina (si no está convertida). */
router.delete('/:id', w(async (req, res) => {
  await cotizacionRepo.eliminar(Number(req.params.id));
  res.json({ ok: true });
}));

/** GET /api/admin/cotizaciones/:id/pdf — representación en base64. */
router.get('/:id/pdf', w(async (req, res) => {
  const cot = await cotizacionRepo.getById(Number(req.params.id));
  if (!cot) { res.status(404).json({ error: 'Cotización no encontrada' }); return; }
  const pdf = await generarCotizacionPdf(cot);
  res.json({ nombre: `${cot.numero}.pdf`, pdf_base64: pdf.toString('base64') });
}));

/** POST /api/admin/cotizaciones/:id/convertir  { tipo_comprobante } → emite la venta. */
router.post('/:id/convertir', w(async (req, res) => {
  const t = req.body?.tipo_comprobante;
  const tipo = (t === '01' || t === '03' || t === 'NV') ? t : 'NV';
  res.json(await cotizacionRepo.convertirEnVenta(Number(req.params.id), tipo));
}));

export const cotizacionRoutes = router;
