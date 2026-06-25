/**
 * Prueba local: construye una factura de ejemplo, la firma con el certificado
 * y la guarda en secrets/out/ para inspección. NO envía nada a SUNAT.
 * Uso:  npx ts-node --transpile-only scripts/test-factura.ts
 */
import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'fs';
import { construirFacturaXml } from '../src/modules/facturacion/ubl/factura.builder';
import { firmarXml } from '../src/modules/facturacion/sunat/xml.signer';
import { DatosComprobante } from '../src/modules/facturacion/comprobante.types';

const datos: DatosComprobante = {
  tipoDoc: '01',
  serie: 'F001',
  correlativo: 1,
  fechaEmision: new Date().toISOString().slice(0, 10),
  horaEmision: new Date().toTimeString().slice(0, 8),
  moneda: 'PEN',
  cliente: {
    tipoDoc: '6',
    numDoc: '20000000001',
    razonSocial: 'CLIENTE DE PRUEBA S.A.C.',
    direccion: 'AV. PRUEBA 123',
  },
  items: [
    { descripcion: 'Suscripcion Plan Profesional - mes de junio 2026', cantidad: 1, valorUnitario: 406.78, unidad: 'ZZ' },
  ],
};

const { xml, totales } = construirFacturaXml(datos);
const { xmlFirmado, digestValue, signatureValue } = firmarXml(xml);

mkdirSync('secrets/out', { recursive: true });
const file = `secrets/out/${datos.serie}-${datos.correlativo}.xml`;
writeFileSync(file, xmlFirmado, 'utf8');

console.log('=== Factura de prueba generada y firmada ===');
console.log(`Gravado: S/ ${totales.gravado.toFixed(2)}  IGV: S/ ${totales.igv.toFixed(2)}  Total: S/ ${totales.total.toFixed(2)}`);
console.log(`DigestValue:    ${digestValue ? digestValue.slice(0, 40) + '…' : 'NO ENCONTRADO ❌'}`);
console.log(`SignatureValue: ${signatureValue ? signatureValue.slice(0, 40) + '…' : 'NO ENCONTRADO ❌'}`);
console.log(`Firma insertada en ext:ExtensionContent: ${xmlFirmado.includes('<ds:Signature') ? 'SÍ ✅' : 'NO ❌'}`);
console.log(`XML guardado en: ${file}`);
