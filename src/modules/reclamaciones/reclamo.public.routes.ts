/**
 * Rutas PÚBLICAS del Libro de Reclamaciones Virtual (sin JWT).
 * Cualquier consumidor registra su Reclamo/Queja y descarga su hoja en PDF.
 * Se montan bajo un rate-limit en index.ts para frenar abuso.
 */
import express, { Router } from 'express';
import type { Request, Response } from 'express';
import { reclamoRepo } from './reclamo.repository';
import { generarReclamoPdf } from './reclamo.pdf';
import { sendError } from '../../shared/errors';
import { rateLimit } from '../../middleware/rate-limit.middleware';
import { guardarAdjunto, ADJUNTO_MAX_BYTES } from '../../shared/archivos';

/** Anti-spam: pocos registros por IP por minuto (por encima del límite general). */
const crearLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 6,
  message: 'Has enviado varios reclamos en poco tiempo. Espera un momento antes de registrar otro.',
});

/** Anti-enumeración: limita los intentos de consulta (número + documento). */
const consultaLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  message: 'Demasiados intentos de consulta. Espera un momento e inténtalo de nuevo.',
});

/** Límite de subidas de archivos por IP. */
const adjuntoLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: 'Demasiadas subidas de archivos. Espera un momento e inténtalo de nuevo.',
});

/** Recibe el archivo como binario crudo (NO base64). Content-Type = MIME del archivo. */
const rawUpload = express.raw({ type: () => true, limit: ADJUNTO_MAX_BYTES + 4096 });

const w = (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response) => fn(req, res).catch((e: unknown) => sendError(res, e, 'reclamos-public'));

const ipDe = (req: Request): string =>
  (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
  || req.socket.remoteAddress || '';

const router = Router();

/** POST /public/reclamos — registra un reclamo/queja desde el formulario. */
router.post('/', crearLimiter, w(async (req, res) => {
  const b = req.body ?? {};
  const rec = await reclamoRepo.crear({
    consumidor: {
      nombre:          b.consumidor?.nombre ?? b.nombre,
      tipoDoc:         b.consumidor?.tipo_doc ?? b.tipo_doc,
      numDoc:          b.consumidor?.num_doc ?? b.num_doc,
      domicilio:       b.consumidor?.domicilio ?? b.domicilio,
      telefono:        b.consumidor?.telefono ?? b.telefono,
      email:           b.consumidor?.email ?? b.email,
      esMenor:         b.consumidor?.es_menor ?? b.es_menor,
      apoderadoNombre: b.consumidor?.apoderado_nombre ?? b.apoderado_nombre,
      apoderadoNumDoc: b.consumidor?.apoderado_num_doc ?? b.apoderado_num_doc,
    },
    bien: {
      tipo:        b.bien?.tipo ?? b.bien_tipo,
      monto:       b.bien?.monto ?? b.bien_monto,
      descripcion: b.bien?.descripcion ?? b.bien_descripcion,
    },
    reclamacion: {
      tipo:    b.reclamacion?.tipo ?? b.tipo,
      detalle: b.reclamacion?.detalle ?? b.detalle,
      pedido:  b.reclamacion?.pedido ?? b.pedido,
    },
    adjuntos: Array.isArray(b.adjuntos) ? b.adjuntos : undefined,
    ip: ipDe(req),
  });
  // Devuelve el número para mostrarlo/confirmar; el consumidor descarga su PDF con él.
  res.status(201).json({ numero: rec.numero, id: rec.id, fecha_limite: rec.fecha_limite });
}));

/** POST /public/reclamos/adjunto — sube UN archivo (binario) y devuelve su ruta/URL en el servidor.
 *  Headers: Content-Type = MIME del archivo · x-file-name = nombre original (URL-encoded). */
router.post('/adjunto', adjuntoLimiter, rawUpload, w(async (req, res) => {
  const mime = String(req.headers['content-type'] || '');
  let nombre = 'archivo';
  try { nombre = decodeURIComponent(String(req.headers['x-file-name'] || 'archivo')); } catch { /* deja 'archivo' */ }
  const buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body ?? []);
  res.status(201).json(guardarAdjunto(buffer, mime, nombre));
}));

/** GET /public/reclamos/consulta?numero=&doc= — seguimiento del consumidor (línea de tiempo). */
router.get('/consulta', consultaLimiter, w(async (req, res) => {
  res.json(await reclamoRepo.consultaPublica(String(req.query.numero ?? ''), String(req.query.doc ?? '')));
}));

/** GET /public/reclamos/:numero/pdf — descarga la Hoja de Reclamación. */
router.get('/:numero/pdf', w(async (req, res) => {
  const rec = await reclamoRepo.getByNumero(String(req.params.numero));
  if (!rec) { res.status(404).json({ error: 'Reclamo no encontrado' }); return; }
  const pdf = await generarReclamoPdf(rec);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${rec.numero}.pdf"`);
  res.send(pdf);
}));

export const reclamosPublicRoutes = router;
