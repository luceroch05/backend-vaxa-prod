import type { Request, Response } from 'express';
import { emisionService } from './emision.service';
import { tid } from '../shared/router.helper';
import { SinCreditosError } from '../shared/creditos.repository';
import { getEmpresaId, estaVencidaPorPago, MSG_VENCIDA } from '../shared/db.helper';

/** Id del usuario autenticado (lo pone jwtMiddleware en authUser.sub). */
const uid = (req: Request): number | undefined => (req as any).authUser?.sub;

/** Corta la acción si el plan de la empresa venció (falta de pago). true = ya respondió 403. */
async function bloquearSiVencida(req: Request, res: Response): Promise<boolean> {
  try {
    const empresaId = await getEmpresaId(tid(req));
    if (await estaVencidaPorPago(empresaId)) {
      res.status(403).json({ error: MSG_VENCIDA, code: 'PLAN_VENCIDO' });
      return true;
    }
  } catch { /* no se pudo resolver la empresa → no bloquea aquí */ }
  return false;
}

export async function listCertificados(req: Request, res: Response): Promise<void> {
  res.json(await emisionService.listAll(tid(req)));
}

export async function generarCertificado(req: Request, res: Response): Promise<void> {
  if (await bloquearSiVencida(req, res)) return;
  try {
    res.status(201).json(await emisionService.generar(tid(req), Number(req.params.inscripcionId), uid(req)));
  } catch (e) {
    if (e instanceof SinCreditosError) {
      res.status(409).json({ error: e.message, code: 'SIN_CREDITOS' });
      return;
    }
    throw e;
  }
}

/** Emisión EN LOTE: emite varias inscripciones y registra UN solo movimiento de crédito. */
export async function generarLote(req: Request, res: Response): Promise<void> {
  const ids: number[] = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Boolean) : [];
  if (ids.length === 0) { res.status(400).json({ error: 'ids (lista no vacía) es requerido' }); return; }
  if (await bloquearSiVencida(req, res)) return;
  try {
    res.json(await emisionService.generarLote(tid(req), ids, uid(req)));
  } catch (e) {
    if (e instanceof SinCreditosError) {
      res.status(409).json({ error: e.message, code: 'SIN_CREDITOS' });
      return;
    }
    throw e;
  }
}

export async function validarPublico(req: Request, res: Response): Promise<void> {
  const tenantSlug = req.params.tenantSlug;
  if (!tenantSlug) { res.status(400).json({ error: 'Empresa requerida' }); return; }
  // Bloqueo por falta de pago: si el plan de la institución venció, se corta también
  // la validación pública (regla de negocio: sin pago no funciona nada).
  try {
    const empresaId = await getEmpresaId(tenantSlug);
    if (await estaVencidaPorPago(empresaId)) { res.status(403).json({ error: MSG_VENCIDA }); return; }
  } catch { /* empresa no encontrada → sigue al 404 normal abajo */ }
  const cert = await emisionService.validarPublico(req.params.codigo, tenantSlug);
  if (!cert) { res.status(404).json({ error: 'Certificado no encontrado' }); return; }
  res.json(cert);
}

export async function anularCertificado(req: Request, res: Response): Promise<void> {
  const ok = await emisionService.anular(tid(req), Number(req.params.id), uid(req));
  if (!ok) { res.status(404).json({ error: 'Certificado no encontrado' }); return; }
  res.status(204).send();
}

export async function eliminarCertificado(req: Request, res: Response): Promise<void> {
  const ok = await emisionService.eliminar(tid(req), Number(req.params.id), uid(req));
  if (!ok) { res.status(404).json({ error: 'Certificado no encontrado' }); return; }
  res.status(204).send();
}

export async function regenerarPDF(req: Request, res: Response): Promise<void> {
  const url = await emisionService.regenerarPDF(tid(req), Number(req.params.id));
  if (!url) { res.status(404).json({ error: 'Certificado no encontrado' }); return; }
  res.json({ url: `/${url}` });
}

/** Vista previa del certificado de una inscripción (PDF inline). No emite ni gasta crédito. */
export async function previewCertificado(req: Request, res: Response): Promise<void> {
  try {
    const buffer = await emisionService.preview(tid(req), Number(req.params.inscripcionId));
    if (!buffer) { res.status(404).json({ error: 'Inscripción no encontrada' }); return; }
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="vista-previa.pdf"');
    res.send(buffer);
  } catch (e) {
    const msg = (e as Error).message;
    if (msg.startsWith('FALTA_CONFIG:')) {
      res.status(409).json({ error: msg, code: 'FALTA_CONFIG' });
      return;
    }
    throw e;
  }


  
}
export async function descargarZipGrupo(
  req: Request,
  res: Response,
): Promise<void> {

  const grupoId = Number(req.params.grupoId);

  const zipBuffer = await emisionService.zipGrupo(
    tid(req),
    grupoId,
  );

  if (!zipBuffer) {
    res.status(404).json({
      error: 'No existen certificados para este grupo',
    });
    return;
  }

  res.setHeader('Content-Type', 'application/zip');

  res.setHeader(
    'Content-Disposition',
    `attachment; filename="grupo-${grupoId}.zip"`,
  );

  res.send(zipBuffer);
}

/** Descarga en ZIP los certificados de una lista de IDs (lo que el panel tenga filtrado). */
export async function descargarZipPorIds(req: Request, res: Response): Promise<void> {
  const ids: number[] = Array.isArray(req.body?.ids) ? req.body.ids : [];

  const zipBuffer = await emisionService.zipPorIds(tid(req), ids);

  if (!zipBuffer) {
    res.status(404).json({ error: 'No hay certificados para descargar' });
    return;
  }

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', 'attachment; filename="certificados.zip"');
  res.send(zipBuffer);
}
