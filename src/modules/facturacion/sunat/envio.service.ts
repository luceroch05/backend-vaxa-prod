/**
 * Orquesta el envío de un comprobante a SUNAT:
 *   XML firmado -> ZIP -> sendBill -> interpretar CDR.
 * No toca la BD (eso lo hará el repository en la Fase 6).
 */
import { nombreComprobante, zipearXml } from './zip.util';
import { sendBill, sendSummary, getStatus } from './soap.client';
import { interpretarRespuesta, interpretarTicket, RespuestaSunat } from './cdr';
import { getSunatConfig } from './sunat.config';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface EnvioParams {
  tipoSunat: string;   // '01' factura, '03' boleta...
  serie: string;       // F001
  correlativo: number; // 1
  xmlFirmado: string;
}

/** Envía una factura/nota por sendBill y devuelve el veredicto de SUNAT. */
export async function enviarComprobante(p: EnvioParams): Promise<RespuestaSunat & { nombre: string }> {
  const cfg = getSunatConfig();
  const nombre = nombreComprobante(cfg.ruc, p.tipoSunat, p.serie, p.correlativo);
  const zip = zipearXml(nombre, p.xmlFirmado);
  const respuesta = await sendBill(`${nombre}.zip`, zip.toString('base64'));
  return { ...interpretarRespuesta(respuesta), nombre };
}

export interface EnvioResumenParams {
  id: string;          // 'RC-YYYYMMDD-N' (sin el RUC delante)
  xmlFirmado: string;
}

/**
 * Envía un Resumen Diario de boletas (sendSummary) y ESPERA el resultado
 * consultando el ticket (getStatus) hasta que SUNAT termine de procesarlo.
 * El nombre del archivo es {RUC}-RC-YYYYMMDD-N (igual que la factura: RUC delante).
 */
export async function enviarResumen(p: EnvioResumenParams): Promise<RespuestaSunat & { nombre: string; ticket?: string }> {
  const cfg = getSunatConfig();
  const nombre = `${cfg.ruc}-${p.id}`;
  const zip = zipearXml(nombre, p.xmlFirmado);

  // 1) Enviar el resumen → SUNAT devuelve un ticket (o un Fault).
  const respEnvio = await sendSummary(`${nombre}.zip`, zip.toString('base64'));
  const ticket = extraerTicket(respEnvio);
  if (!ticket) {
    // No hubo ticket: casi seguro un Fault (credenciales/estructura). Reusar el parser.
    return { ...interpretarRespuesta(respEnvio), nombre };
  }

  // 2) Consultar el ticket hasta que deje de estar "en proceso" (statusCode 98).
  const MAX_INTENTOS = 12;
  const ESPERA_MS = 2500;
  for (let i = 0; i < MAX_INTENTOS; i++) {
    await sleep(ESPERA_MS);
    const estado = interpretarTicket(await getStatus(ticket));
    if (!estado.enProceso && estado.respuesta) {
      return { ...estado.respuesta, nombre, ticket };
    }
  }

  // Timeout: el resumen se envió pero SUNAT seguía procesando.
  return {
    veredicto: 'ERROR',
    codigo: '98',
    descripcion: `Resumen enviado pero SUNAT sigue procesándolo. Consulta el resultado en unos minutos (ticket ${ticket}).`,
    nombre,
    ticket,
  };
}

/** Extrae el <ticket> de la respuesta de sendSummary. */
function extraerTicket(xml: string): string | null {
  const m = xml.match(/<(?:[\w-]+:)?ticket>([\s\S]*?)<\/(?:[\w-]+:)?ticket>/i);
  return m ? m[1].trim() : null;
}
