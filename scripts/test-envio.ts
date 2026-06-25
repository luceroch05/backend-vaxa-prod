/**
 * Prueba END-TO-END contra SUNAT BETA: construye una factura, la firma,
 * la zipea, la envía por sendBill y muestra el veredicto (CDR).
 * Uso:  npx ts-node --transpile-only scripts/test-envio.ts
 * ⚠️ Requiere SUNAT_MODO=beta (ambiente de pruebas, sin efecto legal).
 */
import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'fs';
import { construirFacturaXml } from '../src/modules/facturacion/ubl/factura.builder';
import { firmarXml } from '../src/modules/facturacion/sunat/xml.signer';
import { enviarComprobante } from '../src/modules/facturacion/sunat/envio.service';
import { getSunatConfig } from '../src/modules/facturacion/sunat/sunat.config';
import { DatosComprobante } from '../src/modules/facturacion/comprobante.types';

async function main() {
  const cfg = getSunatConfig();
  console.log(`Ambiente: ${cfg.modo.toUpperCase()}  ·  Endpoint: ${cfg.billServiceUrl}`);
  console.log(`Usuario WS: ${cfg.wsUsuario}\n`);

  const datos: DatosComprobante = {
    tipoDoc: '01',
    serie: 'F001',
    correlativo: 1,
    fechaEmision: new Date().toISOString().slice(0, 10),
    horaEmision: new Date().toTimeString().slice(0, 8),
    moneda: 'PEN',
    cliente: { tipoDoc: '6', numDoc: '20000000001', razonSocial: 'CLIENTE DE PRUEBA S.A.C.', direccion: 'AV. PRUEBA 123' },
    items: [{ descripcion: 'Suscripcion Plan Profesional - prueba beta', cantidad: 1, valorUnitario: 406.78, unidad: 'ZZ' }],
  };

  const { xml } = construirFacturaXml(datos);
  const { xmlFirmado } = firmarXml(xml);

  console.log('Enviando a SUNAT...');
  const r = await enviarComprobante({ tipoSunat: '01', serie: datos.serie, correlativo: datos.correlativo, xmlFirmado });

  console.log('\n========== RESPUESTA DE SUNAT ==========');
  console.log(`Comprobante: ${r.nombre}`);
  console.log(`Veredicto:   ${r.veredicto}`);
  console.log(`Código:      ${r.codigo ?? '-'}`);
  console.log(`Mensaje:     ${r.descripcion}`);
  if (r.notas?.length) console.log(`Observaciones:\n  - ${r.notas.join('\n  - ')}`);

  mkdirSync('secrets/out', { recursive: true });
  if (r.cdrXml) {
    writeFileSync(`secrets/out/R-${r.nombre}.xml`, r.cdrXml, 'utf8');
    console.log(`\nCDR guardado en: secrets/out/R-${r.nombre}.xml`);
  } else if (r.crudo) {
    writeFileSync('secrets/out/respuesta-cruda.xml', r.crudo, 'utf8');
    console.log('\nRespuesta cruda guardada en: secrets/out/respuesta-cruda.xml');
  }
}

main().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
