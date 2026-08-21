import { Router } from 'express';
import type { Request, Response } from 'express';
import { adminRepo } from './admin.repository';
import { planRepo } from '../certificados/planes/plan.repository';
import { comprobanteRepo } from '../facturacion/comprobante.repository';
import { consultarRuc } from '../facturacion/consulta-ruc.service';
import { generarPdf } from '../facturacion/pdf.service';
import { sendError } from '../../shared/errors';

const w = (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response) => fn(req, res).catch((e: unknown) => sendError(res, e, 'admin'));

const uid = (req: Request): number | undefined => (req as any).authUser?.sub;

const router = Router();

/** Empresas */
router.get('/empresas', w(async (_req, res) => {
  res.json(await adminRepo.listEmpresas());
}));

router.post('/empresas', w(async (req, res) => {
  res.status(201).json(await adminRepo.crearEmpresa(req.body ?? {}, uid(req)));
}));

router.patch('/empresas/:id', w(async (req, res) => {
  res.json(await adminRepo.updateEmpresa(Number(req.params.id), req.body ?? {}));
}));

router.delete('/empresas/:id', w(async (req, res) => {
  res.json(await adminRepo.eliminarEmpresa(Number(req.params.id)));
}));

/** Migración ÚNICA: pasa las imágenes base64 de la BD a archivos en /uploads (para correr desde el panel). */
router.post('/migrar-imagenes', w(async (_req, res) => {
  res.json(await adminRepo.migrarImagenes());
}));

/** Recarga manual de créditos. body: { cantidad, monto? } — monto opcional para paquetes con descuento. */
router.post('/empresas/:id/recargar-cupo', w(async (req, res) => {
  const { cantidad, monto } = req.body ?? {};
  res.json(await planRepo.recargarCupo(
    Number(req.params.id),
    Number(cantidad),
    monto != null ? Number(monto) : undefined,
  ));
}));

/** Control de cobranza: todas las empresas con su vencimiento y semáforo. */
router.get('/cobranza', w(async (_req, res) => {
  res.json(await planRepo.listVencimientos());
}));

/** Marca el ciclo como pagado y renueva el vencimiento.
 *  body: { monto?, fecha_pago?, comprobante_tipo_id?, comprobante_numero? } */
router.post('/empresas/:id/marcar-pagado', w(async (req, res) => {
  res.json(await planRepo.marcarPagado(Number(req.params.id), req.body ?? {}));
}));

/** Revierte la última renovación del ciclo (si se confirmó el pago por error). */
router.post('/empresas/:id/revertir-ciclo', w(async (req, res) => {
  res.json(await planRepo.revertirCiclo(Number(req.params.id)));
}));

/** Reactiva la cuenta de mantenimiento tras suspensión (cuenta nueva desde hoy). */
router.post('/empresas/:id/reactivar-cuenta', w(async (req, res) => {
  res.json(await planRepo.reactivarCuenta(Number(req.params.id)));
}));

/** Ajuste manual de "mantenimiento pagado hasta" (fecha_fin). body: { fecha } */
router.post('/empresas/:id/pagado-hasta', w(async (req, res) => {
  res.json(await planRepo.ajustarPagadoHasta(Number(req.params.id), String(req.body?.fecha ?? '')));
}));

/** Historial de pagos de una empresa. */
router.get('/empresas/:id/pagos', w(async (req, res) => {
  res.json(await planRepo.listPagos(Number(req.params.id)));
}));

/** Resumen de lo que hay que cobrar (mantenimiento del ciclo + usuarios extra prorrateados). */
router.get('/empresas/:id/resumen-cobro', w(async (req, res) => {
  res.json(await planRepo.resumenCobro(Number(req.params.id)));
}));

/** ── Facturación electrónica ──────────────────────────────── */

/** Lista de comprobantes emitidos. */
router.get('/comprobantes', w(async (_req, res) => {
  res.json(await comprobanteRepo.list());
}));

/** Detalle de un comprobante. */
router.get('/comprobantes/:id', w(async (req, res) => {
  const c = await comprobanteRepo.getById(Number(req.params.id));
  if (!c) { res.status(404).json({ error: 'Comprobante no encontrado' }); return; }
  res.json(c);
}));

/** Emite la factura de un pago ya registrado (plan o certificados adicionales). */
router.post('/pagos/:id/comprobante', w(async (req, res) => {
  res.json(await comprobanteRepo.emitirDesdePago(Number(req.params.id)));
}));

/** Registra una venta (líneas libres + descuento → pago + comprobante + créditos/renovación). */
router.post('/empresas/:id/venta', w(async (req, res) => {
  const b = req.body ?? {};
  res.json(await comprobanteRepo.registrarVenta({
    empresaId: Number(req.params.id),
    items: Array.isArray(b.items) ? b.items : [],
    descuento: b.descuento && Number(b.descuento.valor) > 0
      ? { tipo: b.descuento.tipo === 'pct' ? 'pct' : 'monto', valor: Number(b.descuento.valor) }
      : undefined,
    tipoComprobante: b.tipo_comprobante,
    marcarActivacionUsuarios: Array.isArray(b.marcar_activacion_usuarios) ? b.marcar_activacion_usuarios.map(Number) : undefined,
  }));
}));

/** Verifica un RUC en SUNAT (dato público) y devuelve razón social + estado. */
router.get('/consulta/ruc/:ruc', w(async (req, res) => {
  res.json(await consultarRuc(req.params.ruc));
}));

/** Venta a cliente MANUAL (DNI/CE/sin doc), sin empresa. Solo boleta (03) o nota de venta (NV). */
router.post('/comprobantes/venta-manual', w(async (req, res) => {
  const b = req.body ?? {};
  res.json(await comprobanteRepo.registrarVentaManual({
    cliente: b.cliente,
    items: Array.isArray(b.items) ? b.items : [],
    descuento: b.descuento && Number(b.descuento.valor) > 0
      ? { tipo: b.descuento.tipo === 'pct' ? 'pct' : 'monto', valor: Number(b.descuento.valor) }
      : undefined,
    tipoComprobante: b.tipo_comprobante === 'NV' ? 'NV' : '03',
  }));
}));

/** Emite un comprobante (lo envía a SUNAT). body: { empresa_id, tipo_comprobante?, items, pago_id?, cliente? } */
router.post('/comprobantes', w(async (req, res) => {
  const b = req.body ?? {};
  res.json(await comprobanteRepo.emitir({
    empresaId: Number(b.empresa_id),
    tipoComprobante: b.tipo_comprobante,
    pagoId: b.pago_id ?? null,
    items: b.items ?? [],
    cliente: b.cliente,
  }));
}));

/** Emite una nota de crédito/débito sobre un comprobante. body: { tipo_nota, motivo_codigo, motivo_descripcion } */
router.post('/comprobantes/:id/nota', w(async (req, res) => {
  const b = req.body ?? {};
  res.json(await comprobanteRepo.emitirNota({
    comprobanteOrigenId: Number(req.params.id),
    tipoNota: b.tipo_nota,
    motivoCodigo: b.motivo_codigo,
    motivoDescripcion: b.motivo_descripcion,
  }));
}));

/** Descarga el XML firmado o el CDR. ?tipo=xml|cdr */
router.get('/comprobantes/:id/archivo', w(async (req, res) => {
  const cual = (req.query.tipo === 'cdr' ? 'cdr' : 'xml') as 'xml' | 'cdr';
  const xml = await comprobanteRepo.getXml(Number(req.params.id), cual);
  if (!xml) { res.status(404).json({ error: 'Archivo no disponible' }); return; }
  res.json({ xml });
}));

/** PDF (representación impresa) en base64. */
router.get('/comprobantes/:id/pdf', w(async (req, res) => {
  const c = await comprobanteRepo.getById(Number(req.params.id));
  if (!c) { res.status(404).json({ error: 'Comprobante no encontrado' }); return; }
  const pdf = await generarPdf(c);
  res.json({ nombre: `${c.numero}.pdf`, pdf_base64: pdf.toString('base64') });
}));

/** Usuarios por empresa */
router.get('/empresas/:id/usuarios', w(async (req, res) => {
  const producto = (req.query.producto as string | undefined)?.trim() || undefined;
  res.json(await adminRepo.listUsuarios(Number(req.params.id), producto));
}));

router.post('/empresas/:id/usuarios', w(async (req, res) => {
  res.status(201).json(await adminRepo.crearUsuario(Number(req.params.id), req.body ?? {}, uid(req)));
}));

router.patch('/empresas/:id/usuarios/:usuarioId', w(async (req, res) => {
  res.json(await adminRepo.editarUsuario(Number(req.params.id), Number(req.params.usuarioId), req.body ?? {}));
}));

router.delete('/empresas/:id/usuarios/:usuarioId', w(async (req, res) => {
  const producto = (req.query.producto as string | undefined)?.trim() || undefined;
  res.json(await adminRepo.eliminarUsuario(Number(req.params.id), Number(req.params.usuarioId), producto));
}));

/** Redes/contacto de la landing pública de Vaxa (editable desde sistemas-vaxa). */
router.get('/vaxa-landing', w(async (_req, res) => {
  res.json(await adminRepo.getVaxaLanding());
}));
router.put('/vaxa-landing', w(async (req, res) => {
  res.json(await adminRepo.saveVaxaLanding(req.body ?? {}));
}));

/** Roles (para el selector al crear usuario) */
router.get('/roles', w(async (_req, res) => {
  res.json(await adminRepo.listRoles());
}));

/** Planes — catálogo (para el selector). */
router.get('/planes', w(async (_req, res) => {
  res.json(await planRepo.listPlanes());
}));

/** Plan vigente + consumo del mes de una empresa (vista Vaxa). */
router.get('/empresas/:id/plan', w(async (req, res) => {
  res.json(await planRepo.getEstadoById(Number(req.params.id)));
}));

/** Asignar / cambiar el plan de una empresa. body: { plan_id, ciclo_id? } */
router.post('/empresas/:id/plan', w(async (req, res) => {
  const { plan_id, ciclo_id } = req.body ?? {};
  if (!plan_id) throw new Error('plan_id es requerido');
  await planRepo.asignarPlan(Number(req.params.id), Number(plan_id), Number(ciclo_id) || 1);
  res.json(await planRepo.getEstadoById(Number(req.params.id)));
}));

export const adminRoutes = router;
