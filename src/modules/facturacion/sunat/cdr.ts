/**
 * Interpreta la respuesta del billService de SUNAT:
 *  - Si es un Fault SOAP: error de comunicación/credenciales/estructura.
 *  - Si trae applicationResponse: es el CDR (zip base64) con el veredicto.
 *
 * Códigos del CDR (cbc:ResponseCode):
 *   0            -> ACEPTADO
 *   2000..3999   -> RECHAZADO (error que invalida el comprobante)
 *   4000+        -> ACEPTADO CON OBSERVACIONES
 */
import { leerPrimerXmlDeZip } from './zip.util';

export type VeredictoSunat = 'ACEPTADO' | 'OBSERVADO' | 'RECHAZADO' | 'ERROR';

export interface RespuestaSunat {
  veredicto: VeredictoSunat;
  codigo: string | null;        // ResponseCode del CDR o faultcode
  descripcion: string;          // mensaje legible
  cdrXml?: string;              // CDR completo (si hubo)
  notas?: string[];             // observaciones (códigos 4000+)
  crudo?: string;               // respuesta cruda (para depurar errores)
}

function entre(xml: string, tag: string): string | null {
  // Soporta prefijos (cbc:, soap-env:, etc.)
  const m = xml.match(new RegExp(`<(?:[\\w-]+:)?${tag}[^>]*>([\\s\\S]*?)</(?:[\\w-]+:)?${tag}>`, 'i'));
  return m ? m[1].trim() : null;
}

/** Procesa el texto de respuesta del sendBill. */
export function interpretarRespuesta(respuestaXml: string): RespuestaSunat {
  // ¿Fault SOAP? (credenciales, estructura, servicio caído...)
  // El tag puede traer atributos (xmlns), por eso [\s>] y no solo `>`.
  if (/<(?:[\w-]+:)?Fault[\s>]/i.test(respuestaXml)) {
    const faultstring = entre(respuestaXml, 'faultstring') ?? 'Error SOAP desconocido';
    const faultcode = entre(respuestaXml, 'faultcode');
    // faultcode viene como "soap-env:Client.2017"; nos quedamos con el número.
    const codigo = faultcode?.match(/(\d{3,5})\s*$/)?.[1] ?? faultcode;
    return {
      veredicto: 'ERROR',
      codigo,
      descripcion: faultstring,
      crudo: respuestaXml,
    };
  }

  // CDR en base64 dentro de applicationResponse
  const appResp = entre(respuestaXml, 'applicationResponse');
  if (!appResp) {
    return { veredicto: 'ERROR', codigo: null, descripcion: 'Respuesta sin CDR ni Fault.', crudo: respuestaXml };
  }
  return cdrDesdeZipBase64(appResp, respuestaXml);
}

/** Lee un CDR zipeado (base64) y deriva el veredicto. Compartido por sendBill y getStatus. */
function cdrDesdeZipBase64(zipBase64: string, crudo: string): RespuestaSunat {
  const cdr = leerPrimerXmlDeZip(Buffer.from(zipBase64, 'base64'));
  if (!cdr) {
    return { veredicto: 'ERROR', codigo: null, descripcion: 'No se pudo leer el CDR del ZIP.', crudo };
  }

  const codigo = entre(cdr.xml, 'ResponseCode');
  const descripcion = entre(cdr.xml, 'Description') ?? '(sin descripción)';
  const num = Number(codigo);

  let veredicto: VeredictoSunat;
  if (num === 0) veredicto = 'ACEPTADO';
  else if (num >= 2000 && num <= 3999) veredicto = 'RECHAZADO';
  else if (num >= 4000) veredicto = 'OBSERVADO';
  else veredicto = 'ERROR';

  // Observaciones (notas) si las hubiera
  const notas = [...cdr.xml.matchAll(/<(?:[\w-]+:)?Note[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?Note>/gi)]
    .map((m) => m[1].trim())
    .filter(Boolean);

  return { veredicto, codigo, descripcion, cdrXml: cdr.xml, notas: notas.length ? notas : undefined };
}

export interface EstadoTicket {
  enProceso: boolean;          // true = SUNAT aún procesa (statusCode 98) → reintentar
  statusCode?: string | null;
  respuesta?: RespuestaSunat;  // veredicto final cuando ya terminó
}

/**
 * Interpreta la respuesta de getStatus (consulta de un ticket de resumen):
 *   statusCode 0  -> procesado: el CDR va en <content> (zip base64)
 *   statusCode 98 -> en proceso: hay que volver a consultar
 *   statusCode 99 -> procesado con error: el CDR (con el rechazo) va en <content>
 */
export function interpretarTicket(respuestaXml: string): EstadoTicket {
  if (/<(?:[\w-]+:)?Fault[\s>]/i.test(respuestaXml)) {
    const faultstring = entre(respuestaXml, 'faultstring') ?? 'Error SOAP desconocido';
    const faultcode = entre(respuestaXml, 'faultcode');
    const codigo = faultcode?.match(/(\d{3,5})\s*$/)?.[1] ?? faultcode;
    return { enProceso: false, respuesta: { veredicto: 'ERROR', codigo, descripcion: faultstring, crudo: respuestaXml } };
  }

  const statusCode = entre(respuestaXml, 'statusCode');
  if (statusCode === '98') return { enProceso: true, statusCode };

  const content = entre(respuestaXml, 'content');
  if (!content) {
    return {
      enProceso: false,
      statusCode,
      respuesta: { veredicto: 'ERROR', codigo: statusCode, descripcion: `SUNAT devolvió statusCode ${statusCode} sin CDR.`, crudo: respuestaXml },
    };
  }
  return { enProceso: false, statusCode, respuesta: cdrDesdeZipBase64(content, respuestaXml) };
}
