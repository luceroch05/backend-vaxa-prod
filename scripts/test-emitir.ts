/** Prueba la emisión completa por el repositorio (BD + SUNAT). beta. */
import 'dotenv/config';
import { pool } from '../src/modules/certificados/shared/db.helper';
import { comprobanteRepo } from '../src/modules/facturacion/comprobante.repository';

async function main() {
  const [emp] = await pool().query<any[]>(
    "SELECT id, ruc, razon_social FROM empresas WHERE ruc IS NOT NULL AND ruc <> '' AND tenant_slug <> 'vaxa' LIMIT 1",
  );
  if (!emp.length) { console.log('No hay empresa con RUC para facturar.'); process.exit(0); }
  console.log(`Cliente: ${emp[0].razon_social} (RUC ${emp[0].ruc})`);

  const c = await comprobanteRepo.emitir({
    empresaId: emp[0].id,
    // RUC de prueba válido (las empresas demo tienen RUC ficticio que SUNAT rechaza).
    cliente: { tipoDoc: '6', numDoc: '20000000001', razonSocial: 'CLIENTE DE PRUEBA S.A.C.', direccion: 'AV. PRUEBA 123' },
    items: [{ descripcion: 'Suscripcion Plan - prueba integracion', cantidad: 1, valorUnitario: 406.78, unidad: 'ZZ' }],
  });
  console.log('\n========== RESULTADO ==========');
  console.log(`Número:  ${c?.numero}`);
  console.log(`Estado:  ${c?.estado_nombre} (${c?.estado})`);
  console.log(`SUNAT:   ${c?.sunat_resp_codigo ?? '-'} · ${c?.sunat_resp_desc ?? ''}`);
  console.log(`Total:   S/ ${c?.importe_total?.toFixed(2)}`);
  console.log(`Guardado en BD con id ${c?.id}`);
  process.exit(0);
}
main().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
