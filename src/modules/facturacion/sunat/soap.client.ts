/**
 * Cliente SOAP para el billService de SUNAT (SEE Del Contribuyente).
 * Autentica con WS-Security UsernameToken: usuario = RUC + usuario SOL secundario,
 * password = Clave SOL. Envía con fetch (sin librería SOAP pesada).
 */
import { getSunatConfig } from './sunat.config';

const NS = {
  soap: 'http://schemas.xmlsoap.org/soap/envelope/',
  ser: 'http://service.sunat.gob.pe',
  wsse: 'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd',
};

function escXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Sobre SOAP genérico con la seguridad y un body interno. */
function sobre(body: string): string {
  const cfg = getSunatConfig();
  return `<soapenv:Envelope xmlns:soapenv="${NS.soap}" xmlns:ser="${NS.ser}" xmlns:wsse="${NS.wsse}">
  <soapenv:Header>
    <wsse:Security>
      <wsse:UsernameToken>
        <wsse:Username>${escXml(cfg.wsUsuario)}</wsse:Username>
        <wsse:Password>${escXml(cfg.claveSol)}</wsse:Password>
      </wsse:UsernameToken>
    </wsse:Security>
  </soapenv:Header>
  <soapenv:Body>${body}</soapenv:Body>
</soapenv:Envelope>`;
}

async function postSoap(xml: string): Promise<string> {
  const cfg = getSunatConfig();
  const res = await fetch(cfg.billServiceUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: '' },
    body: xml,
  });
  return res.text();
}

/**
 * sendBill: envía una factura/nota (síncrono). Devuelve el XML de respuesta
 * crudo (contiene applicationResponse en base64 = el CDR zipeado, o un Fault).
 */
export async function sendBill(nombreZip: string, zipBase64: string): Promise<string> {
  const body = `<ser:sendBill>
      <fileName>${escXml(nombreZip)}</fileName>
      <contentFile>${zipBase64}</contentFile>
    </ser:sendBill>`;
  return postSoap(sobre(body));
}

/**
 * sendSummary: envía un resumen diario (boletas / comunicación de baja).
 * Asíncrono: devuelve un ticket que luego se consulta con getStatus.
 */
export async function sendSummary(nombreZip: string, zipBase64: string): Promise<string> {
  const body = `<ser:sendSummary>
      <fileName>${escXml(nombreZip)}</fileName>
      <contentFile>${zipBase64}</contentFile>
    </ser:sendSummary>`;
  return postSoap(sobre(body));
}

/** getStatus: consulta el resultado de un ticket (resúmenes/bajas). */
export async function getStatus(ticket: string): Promise<string> {
  const body = `<ser:getStatus>
      <ticket>${escXml(ticket)}</ticket>
    </ser:getStatus>`;
  return postSoap(sobre(body));
}
