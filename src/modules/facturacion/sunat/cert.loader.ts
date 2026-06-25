/**
 * Carga el certificado digital (.pfx/.p12) y extrae la llave privada y el
 * certificado X.509 en formato PEM, que es lo que necesita el firmador XML-DSig.
 *
 * Usa node-forge para abrir el PKCS#12. El .pfx NUNCA se versiona (ver .gitignore);
 * su ruta y contraseña vienen del .env.
 */
import { readFileSync } from 'fs';
import forge from 'node-forge';

export interface CertificadoPem {
  privateKeyPem: string;   // llave privada (firma)
  certificatePem: string;  // certificado público (va dentro de la firma)
  subject: string;         // CN del titular (para diagnóstico)
  notBefore: Date;
  notAfter: Date;
}

/** Abre el .pfx en `path` con `password` y devuelve la llave + el certificado en PEM. */
export function cargarCertificado(path: string, password: string): CertificadoPem {
  let der: string;
  try {
    der = readFileSync(path, 'binary');
  } catch {
    throw new Error(`No se pudo leer el certificado en "${path}". Verifica SUNAT_CERT_PATH.`);
  }

  let p12: forge.pkcs12.Pkcs12Pfx;
  try {
    const asn1 = forge.asn1.fromDer(der);
    p12 = forge.pkcs12.pkcs12FromAsn1(asn1, false, password);
  } catch {
    throw new Error('No se pudo abrir el certificado. ¿La contraseña (SUNAT_CERT_PASSWORD) es correcta?');
  }

  // Llave privada: puede venir cifrada (pkcs8ShroudedKeyBag) o en claro (keyBag).
  const keyBags = {
    ...p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag }),
    ...p12.getBags({ bagType: forge.pki.oids.keyBag }),
  };
  const keyBag =
    (keyBags[forge.pki.oids.pkcs8ShroudedKeyBag]?.[0]) ??
    (keyBags[forge.pki.oids.keyBag]?.[0]);
  const key = keyBag?.key;
  if (!key) throw new Error('El certificado no contiene una llave privada.');

  // Certificado: tomamos el primero (el del titular / hoja).
  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag });
  const certBag = certBags[forge.pki.oids.certBag]?.[0];
  const cert = certBag?.cert;
  if (!cert) throw new Error('El certificado no contiene un X.509 válido.');

  const cn = cert.subject.getField('CN');

  return {
    privateKeyPem:  forge.pki.privateKeyToPem(key as forge.pki.PrivateKey),
    certificatePem: forge.pki.certificateToPem(cert),
    subject:        cn?.value ?? '(sin CN)',
    notBefore:      cert.validity.notBefore,
    notAfter:       cert.validity.notAfter,
  };
}

let cache: CertificadoPem | null = null;

/** Igual que cargarCertificado pero usando el .env y cacheado. */
export function getCertificado(): CertificadoPem {
  if (cache) return cache;
  const path = process.env.SUNAT_CERT_PATH;
  if (!path) throw new Error('Falta SUNAT_CERT_PATH en el .env');
  cache = cargarCertificado(path, process.env.SUNAT_CERT_PASSWORD ?? '');
  return cache;
}
