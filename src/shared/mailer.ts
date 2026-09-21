import type { Transporter } from 'nodemailer';
import { AppError } from './errors';

/**
 * Carga PEREZOSA de nodemailer. Si el paquete no está instalado en el servidor,
 * NO queremos tumbar toda la API al arrancar (login, certificados, etc.): solo
 * debe fallar el envío de correo, y de forma controlada. Por eso el `require` va
 * aquí dentro y no como import en la cabecera del módulo.
 */
function loadNodemailer(): typeof import('nodemailer') {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('nodemailer') as typeof import('nodemailer');
  } catch {
    throw new AppError('El envío de correo no está disponible en este servidor.', 503);
  }
}

/**
 * ── Envío de correo (SMTP) ────────────────────────────────────────────────────
 *
 * Único lugar que sabe enviar correo. Se configura 100% por variables de entorno
 * (secretos van en .env, NUNCA en el código). Pensado para el buzón info@vaxa.com.pe
 * en cPanel, pero sirve para cualquier SMTP.
 *
 *   SMTP_HOST      host del servidor de correo   (ej. mail.vaxa.com.pe)
 *   SMTP_PORT      puerto                         (465 SSL  ó  587 STARTTLS)
 *   SMTP_USER      usuario/casilla                (ej. info@vaxa.com.pe)
 *   SMTP_PASS      contraseña de la casilla
 *   SMTP_FROM      remitente visible (opcional)   (por defecto = SMTP_USER)
 *   CONTACTO_TO    destino de los mensajes de contacto (por defecto info@vaxa.com.pe)
 *
 * El transporter se crea una sola vez (lazy) y se reutiliza.
 */

let transporter: Transporter | null = null;

function getTransporter(): Transporter {
  if (transporter) return transporter;

  const host = process.env.SMTP_HOST?.trim();
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS;
  const port = Number(process.env.SMTP_PORT ?? 465);

  if (!host || !user || !pass) {
    // No exponemos esto al cliente (sendError lo trata como error interno).
    throw new Error('SMTP no configurado (faltan SMTP_HOST / SMTP_USER / SMTP_PASS)');
  }

  transporter = loadNodemailer().createTransport({
    host,
    port,
    secure: port === 465, // 465 = SSL directo; 587 = STARTTLS
    auth: { user, pass },
  });
  return transporter;
}

/** Destino por defecto de los formularios de contacto. */
export const CONTACTO_TO = process.env.CONTACTO_TO?.trim() || 'info@vaxa.com.pe';

export interface CorreoInput {
  to?: string;
  subject: string;
  /** Cuerpo en texto plano (obligatorio como respaldo). */
  text: string;
  /** Cuerpo en HTML (opcional). */
  html?: string;
  /** Responder-a: el correo de quien llenó el formulario, para responderle directo. */
  replyTo?: string;
}

/** Envía un correo. Lanza AppError si SMTP no está bien configurado o falla el envío. */
export async function enviarCorreo(msg: CorreoInput): Promise<void> {
  const from = process.env.SMTP_FROM?.trim() || process.env.SMTP_USER?.trim();
  try {
    await getTransporter().sendMail({
      from,
      to: msg.to || CONTACTO_TO,
      subject: msg.subject,
      text: msg.text,
      html: msg.html,
      replyTo: msg.replyTo,
    });
  } catch (e) {
    // Log interno con el detalle real; al cliente le llega un mensaje genérico.
    console.error('[mailer] fallo al enviar correo:', e);
    throw new AppError('No se pudo enviar el correo. Inténtalo más tarde.', 502);
  }
}
