import 'dotenv/config';
import { pool } from '../src/modules/certificados/shared/db.helper';
import { comprobanteRepo } from '../src/modules/facturacion/comprobante.repository';
async function main(){
  const [p] = await pool().query<any[]>("SELECT id, empresa_id FROM pagos WHERE comprobante_id IS NULL AND concepto_id=1 ORDER BY id LIMIT 1");
  if(!p.length){ console.log('No hay pago de suscripción sin facturar.'); process.exit(0); }
  const [e] = await pool().query<any[]>("SELECT ruc FROM empresas WHERE id=?", [p[0].empresa_id]);
  const ruc0 = e[0].ruc;
  await pool().query("UPDATE empresas SET ruc='20000000001' WHERE id=?", [p[0].empresa_id]);
  try {
    const c = await comprobanteRepo.emitirDesdePago(p[0].id);
    console.log(`Factura ${c?.numero} · ${c?.estado_nombre}`);
    console.log(`DESCRIPCIÓN de la línea: "${c?.detalle?.[0]?.descripcion}"`);
    console.log(`Monto: S/ ${c?.importe_total?.toFixed(2)}`);
  } finally { await pool().query("UPDATE empresas SET ruc=? WHERE id=?", [ruc0, p[0].empresa_id]); }
  process.exit(0);
}
main().catch(e=>{console.error('ERROR:',e.message); process.exit(1);});
