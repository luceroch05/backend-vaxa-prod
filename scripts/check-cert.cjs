/**
 * Verifica que el certificado .pfx abre con su contraseña y muestra sus datos.
 * Uso (desde backend-vaxa-prod):  node scripts/check-cert.cjs
 * Lee SUNAT_CERT_PATH y SUNAT_CERT_PASSWORD del .env.
 */
require('dotenv').config();
const fs = require('fs');
const forge = require('node-forge');

const path = process.env.SUNAT_CERT_PATH || './secrets/cert.pfx';
const pass = process.env.SUNAT_CERT_PASSWORD || '';

if (!fs.existsSync(path)) {
  console.log(`❌ No encuentro el certificado en "${path}".`);
  console.log('   Pon tu .pfx ahí (o ajusta SUNAT_CERT_PATH en el .env).');
  process.exit(1);
}

try {
  const der = fs.readFileSync(path, 'binary');
  const p12 = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(der), false, pass);
  const certBag = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag][0];
  const cert = certBag.cert;
  const cn = cert.subject.getField('CN');
  const hoy = new Date();
  const vigente = hoy >= cert.validity.notBefore && hoy <= cert.validity.notAfter;
  console.log('✅ Certificado abierto correctamente.');
  console.log(`   Titular (CN): ${cn ? cn.value : '(sin CN)'}`);
  console.log(`   Válido desde: ${cert.validity.notBefore.toISOString().slice(0, 10)}`);
  console.log(`   Válido hasta: ${cert.validity.notAfter.toISOString().slice(0, 10)}`);
  console.log(`   ¿Vigente hoy?: ${vigente ? 'SÍ' : 'NO ⚠️'}`);
} catch (e) {
  console.log('❌ No se pudo abrir el certificado.');
  console.log(`   ${e.message}`);
  console.log('   Causa más común: la contraseña (SUNAT_CERT_PASSWORD) no coincide.');
  process.exit(1);
}
