import 'dotenv/config';
import { pool } from '../src/modules/certificados/shared/db.helper';
import { comprobanteRepo } from '../src/modules/facturacion/comprobante.repository';
async function main(){
  const [p] = await pool().query<any[]>("SELECT id, empresa_id FROM pagos WHERE comprobante_id IS NULL ORDER BY id LIMIT 1");
  if(!p.length){ console.log('No hay pagos sin facturar.'); process.exit(0); }
  const pagoId = p[0].id, empId = p[0].empresa_id;
  const [e] = await pool().query<any[]>("SELECT ruc FROM empresas WHERE id=?", [empId]);
  const rucOriginal = e[0].ruc;
  console.log(`Pago ${pagoId} (empresa ${empId}). RUC original: ${rucOriginal}`);
  // RUC de prueba válido temporal
  await pool().query("UPDATE empresas SET ruc='20000000001' WHERE id=?", [empId]);
  try {
    const c = await comprobanteRepo.emitirDesdePago(pagoId);
    console.log('\n========== FACTURA DESDE PAGO ==========');
    console.log(`Número: ${c?.numero} · ${c?.estado_nombre}`);
    console.log(`SUNAT:  ${c?.sunat_resp_desc ?? ''}`);
    const [pg] = await pool().query<any[]>("SELECT comprobante_id FROM pagos WHERE id=?", [pagoId]);
    console.log(`Pago vinculado al comprobante: ${pg[0].comprobante_id ?? 'NO'}`);
  } finally {
    await pool().query("UPDATE empresas SET ruc=? WHERE id=?", [rucOriginal, empId]);
    console.log(`RUC restaurado a: ${rucOriginal}`);
  }
  process.exit(0);
}
main().catch(e=>{console.error('ERROR:',e.message); process.exit(1);});
