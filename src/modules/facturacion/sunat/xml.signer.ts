/**
 * Firma un XML UBL con firma digital XML-DSig (enveloped), como exige SUNAT.
 * La ds:Signature se inserta dentro de ext:ExtensionContent y referencia todo
 * el documento (URI="") con transform enveloped. Usa el certificado .pfx (PEM).
 */
import { getCertificado } from './cert.loader';

// Carga PEREZOSA de xml-crypto / node-forge: se requieren solo al firmar (SUNAT),
// no al arrancar el API. Así, si en el servidor falta alguna dependencia de
// facturación, el resto del backend (certificados, importación, etc.) sigue vivo.
const getSignedXml = () => (require('xml-crypto') as typeof import('xml-crypto')).SignedXml;
const getForge = () => require('node-forge') as typeof import('node-forge');

const ENVELOPED = 'http://www.w3.org/2000/09/xmldsig#enveloped-signature';
const C14N = 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315';
const RSA_SHA1 = 'http://www.w3.org/2000/09/xmldsig#rsa-sha1';
const SHA1 = 'http://www.w3.org/2000/09/xmldsig#sha1';

/**
 * Firma RSA-SHA1 y hash SHA1 en JS PURO (node-forge), sin usar el OpenSSL del
 * sistema. Necesario porque algunos servidores (AlmaLinux/RHEL con crypto-policies)
 * bloquean SHA1 en firmas y lanzan "digital envelope routines::invalid digest".
 * SUNAT exige SHA1, así que firmamos en JS para no depender de la política del SO.
 * El resultado es idéntico (RSASSA-PKCS1-v1.5 + SHA1), válido para SUNAT.
 */
class RsaSha1Forge {
  getAlgorithmName() { return RSA_SHA1; }
  getSignature(signedInfo: string, privateKeyPem: string): string {
    const forge = getForge();
    const md = forge.md.sha1.create();
    md.update(signedInfo, 'utf8');
    const key = forge.pki.privateKeyFromPem(privateKeyPem);
    return forge.util.encode64(key.sign(md));
  }
  verifySignature() { return true; }
}
class Sha1Forge {
  getAlgorithmName() { return SHA1; }
  getHash(value: string): string {
    const forge = getForge();
    const md = forge.md.sha1.create();
    md.update(value, 'utf8');
    return forge.util.encode64(md.digest().getBytes());
  }
}

export interface ResultadoFirma {
  xmlFirmado: string;
  digestValue: string | null;   // hash del documento (DigestValue)
  signatureValue: string | null;
}

/** Firma el XML y devuelve el documento firmado + los valores de la firma. */
export function firmarXml(xml: string): ResultadoFirma {
  const SignedXml = getSignedXml();
  const cert = getCertificado();

  const sig = new SignedXml({
    privateKey: cert.privateKeyPem,
    publicCert: cert.certificatePem,
    signatureAlgorithm: RSA_SHA1,
    canonicalizationAlgorithm: C14N,
  });

  // Reemplaza el cálculo de firma/hash SHA1 por la versión en JS puro (forge),
  // para no depender del OpenSSL del servidor (que puede bloquear SHA1).
  (sig as unknown as { SignatureAlgorithms: Record<string, unknown> }).SignatureAlgorithms[RSA_SHA1] = RsaSha1Forge;
  (sig as unknown as { HashAlgorithms: Record<string, unknown> }).HashAlgorithms[SHA1] = Sha1Forge;

  // Referencia a todo el documento (URI="") con transform enveloped + C14N.
  // Las DOS son necesarias: SUNAT canonicaliza antes de calcular el digest;
  // sin la C14N el DigestValue no coincide (error 2335).
  sig.addReference({
    xpath: "//*[local-name(.)='Invoice' or local-name(.)='CreditNote' or local-name(.)='DebitNote' or local-name(.)='SummaryDocuments']",
    transforms: [ENVELOPED, C14N],
    digestAlgorithm: SHA1,
    uri: '',
    isEmptyUri: true,
  });

  // La firma va DENTRO del contenedor ext:ExtensionContent.
  sig.computeSignature(xml, {
    prefix: 'ds',
    attrs: { Id: 'SignVaxa' },
    location: { reference: "//*[local-name(.)='ExtensionContent']", action: 'append' },
  });

  const xmlFirmado = sig.getSignedXml();
  return {
    xmlFirmado,
    digestValue: extraer(xmlFirmado, 'DigestValue'),
    signatureValue: extraer(xmlFirmado, 'SignatureValue'),
  };
}

function extraer(xml: string, tag: string): string | null {
  const m = xml.match(new RegExp(`<(?:ds:)?${tag}[^>]*>([^<]+)</(?:ds:)?${tag}>`));
  return m ? m[1] : null;
}
