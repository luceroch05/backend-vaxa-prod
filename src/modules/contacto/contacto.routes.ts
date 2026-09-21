import { Router } from 'express';
import type { Request, Response } from 'express';
import { enviarCorreo, CONTACTO_TO } from '../../shared/mailer';
import { AppError, sendError } from '../../shared/errors';

/**
 * ── Contacto público (formularios de landings) ────────────────────────────────
 *
 * Las landings de marca personal (p. ej. la de la Lic. Lisseth Baca) NO exponen el
 * correo ni el teléfono de la profesional. Todo mensaje del formulario llega a Vaxa
 * (info@vaxa.com.pe) y Vaxa hace de intermediario con la profesional.
 *
 * Público: sin JWT ni tenant. Se monta bajo /public/contacto con rate-limit estricto.
 */

const clean = (v: unknown, max = 500): string =>
  String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

const esCorreoValido = (v: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

/** Escapa HTML para no romper la plantilla ni permitir inyección. */
const esc = (s: string): string =>
  String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c] as string));

interface DatosCorreo {
  origen: string; nombre: string; telefono: string; correo: string; motivo: string; mensaje: string;
}

/**
 * Plantilla del correo de contacto. Tablas + estilos inline (obligatorio para que
 * se vea bien en Gmail/Outlook, que ignoran <style> y flexbox). Paleta de la marca
 * (azul → cian) e incluye botones para responder directo por correo o WhatsApp.
 */
function correoHtml(d: DatosCorreo): string {
  const A1 = '#0C4A8E', A2 = '#2EAEDF', INK = '#0B2540', SOFT = '#5A6B7B', LINE = '#E4EAF0';
  const GRAD = `linear-gradient(100deg, ${A1}, ${A2})`;

  const fila = (label: string, valor: string) => `
    <tr>
      <td style="padding:12px 0;border-bottom:1px solid ${LINE};color:${SOFT};font-size:13px;width:120px;vertical-align:top">${esc(label)}</td>
      <td style="padding:12px 0;border-bottom:1px solid ${LINE};color:${INK};font-size:15px;font-weight:600">${valor}</td>
    </tr>`;

  const waDigits = d.telefono.replace(/\D/g, '');
  const btn = (href: string, texto: string, bg: string) => `
    <a href="${href}" style="display:inline-block;background:${bg};color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:11px 20px;border-radius:10px;margin:0 8px 8px 0">${texto}</a>`;
  const botones = [
    d.correo && esCorreoValido(d.correo)
      ? btn(`mailto:${esc(d.correo)}?subject=${encodeURIComponent('Respuesta a tu consulta · Vaxa')}`, '✉ Responder por correo', A1) : '',
    waDigits ? btn(`https://wa.me/${waDigits}`, '💬 Escribir por WhatsApp', '#25D366') : '',
  ].join('');

  return `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#EEF3F8;font-family:Arial,Helvetica,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#EEF3F8;padding:28px 12px">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:18px;overflow:hidden;box-shadow:0 10px 30px rgba(11,37,64,.10)">

        <!-- Header -->
        <tr><td style="background:${GRAD};padding:30px 34px">
          <div style="color:rgba(255,255,255,.85);font-size:12px;letter-spacing:2px;text-transform:uppercase;font-weight:700">Vaxa · Nuevo contacto</div>
          <div style="color:#ffffff;font-size:24px;font-weight:700;margin-top:6px">Te escribieron desde la web</div>
          <div style="color:rgba(255,255,255,.9);font-size:14px;margin-top:6px">${esc(d.origen)}</div>
        </td></tr>

        <!-- Datos -->
        <tr><td style="padding:26px 34px 6px">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            ${fila('Nombre', esc(d.nombre))}
            ${fila('Teléfono', d.telefono ? esc(d.telefono) : '<span style="color:#9AA8B6;font-weight:400">—</span>')}
            ${fila('Correo', d.correo ? esc(d.correo) : '<span style="color:#9AA8B6;font-weight:400">—</span>')}
            ${fila('Motivo', d.motivo ? esc(d.motivo) : '<span style="color:#9AA8B6;font-weight:400">—</span>')}
          </table>
        </td></tr>

        <!-- Mensaje -->
        <tr><td style="padding:14px 34px 4px">
          <div style="color:${SOFT};font-size:13px;margin-bottom:8px">Mensaje</div>
          <div style="background:#F4F8FB;border:1px solid ${LINE};border-left:4px solid ${A2};border-radius:12px;padding:16px 18px;color:${INK};font-size:15px;line-height:1.6;white-space:pre-wrap">${d.mensaje ? esc(d.mensaje) : '<span style="color:#9AA8B6">(sin mensaje)</span>'}</div>
        </td></tr>

        <!-- Botones -->
        ${botones ? `<tr><td style="padding:22px 34px 6px">${botones}</td></tr>` : ''}

        <!-- Footer -->
        <tr><td style="padding:22px 34px 30px">
          <div style="border-top:1px solid ${LINE};padding-top:18px;color:#9AA8B6;font-size:12px;line-height:1.6">
            Este mensaje se generó automáticamente desde el formulario de contacto.<br>
            Puedes responder este correo para contactar directamente a la persona.
          </div>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body></html>`;
}

const router = Router();

router.post('/', (req: Request, res: Response) => (async () => {
  const b = req.body ?? {};

  const nombre  = clean(b.nombre, 120);
  const correo  = clean(b.correo, 160);
  const telefono = clean(b.telefono, 40);
  const motivo  = clean(b.motivo, 120);
  const mensaje = clean(b.mensaje, 2000);
  // De qué landing viene (para el asunto). No confiar en algo largo/raro.
  const origen  = clean(b.origen, 80) || 'Landing';

  // Validación mínima: nombre + al menos un medio de contacto.
  if (!nombre) throw new AppError('El nombre es obligatorio.', 400);
  if (!telefono && !correo) throw new AppError('Indica un teléfono o correo de contacto.', 400);
  if (correo && !esCorreoValido(correo)) throw new AppError('El correo no es válido.', 400);

  const asunto = `Nuevo contacto · ${origen}${motivo ? ` · ${motivo}` : ''}`;

  const lineas = [
    `Nuevo mensaje desde: ${origen}`,
    '',
    `Nombre:   ${nombre}`,
    `Teléfono: ${telefono || '—'}`,
    `Correo:   ${correo || '—'}`,
    `Motivo:   ${motivo || '—'}`,
    '',
    'Mensaje:',
    mensaje || '(sin mensaje)',
  ];
  const text = lineas.join('\n');

  const html = correoHtml({ origen, nombre, telefono, correo, motivo, mensaje });

  await enviarCorreo({
    to: CONTACTO_TO,
    subject: asunto,
    text,
    html,
    // Responder desde el buzón contesta directo a quien escribió (si dejó correo).
    replyTo: correo && esCorreoValido(correo) ? correo : undefined,
  });

  res.status(200).json({ ok: true });
})().catch((e) => sendError(res, e, 'public/contacto')));

export const contactoPublicRoutes = router;
