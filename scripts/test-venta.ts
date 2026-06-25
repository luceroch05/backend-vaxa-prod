import 'dotenv/config';
import { pool } from '../src/modules/certificados/shared/db.helper';
import { comprobanteRepo } from '../src/modules/facturacion/comprobante.repository';
async function main(){
  const [e] = await pool().query<any[]>("SELECT id, ruc, razon_social FROM empresas WHERE plan_actual_id IS NOT NULL AND tenant_slug<>'vaxa' LIMIT 1");
  if(!e.length){ console.log('No hay empresa con plan.'); process.exit(0); }
  const empId = e[0].id, ruc0 = e[0].ruc;
  console.log(`Empresa: ${e[0].razon_social}`);
  await pool().query("UPDATE empresas SET ruc='20000000001' WHERE id=?", [empId]);
  try {
    const r = await comprobanteRepo.registrarVenta({ empresaId: empId, incluirPlan: true, adicionales: 10, descuento: { tipo:'pct', valor:10 } });
    const c = r.comprobante;
    console.log('\n========== VENTA ==========');
    console.log(`Comprobante: ${c?.numero} · ${c?.estado_nombre}`);
    console.log(`SUNAT: ${c?.sunat_resp_desc ?? ''}`);
    console.log(`Descuento aplicado: S/ ${r.descuento.toFixed(2)} · Total: S/ ${r.total.toFixed(2)}`);
    console.log('Líneas:');
    for(const d of (c?.detalle ?? [])) console.log(`  - ${d.descripcion}: ${d.cantidad} x S/${d.valor_unitario.toFixed(2)} = S/${d.valor_total.toFixed(2)}`);
    console.log(`Total comprobante: S/ ${c?.importe_total?.toFixed(2)} (gravado ${c?.total_gravado?.toFixed(2)} + IGV ${c?.total_igv?.toFixed(2)})`);
  } finally { await pool().query("UPDATE empresas SET ruc=? WHERE id=?", [ruc0, empId]); }
  process.exit(0);
}
main().catch(e=>{console.error('ERROR:',e.message); process.exit(1);});
