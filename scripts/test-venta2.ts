import 'dotenv/config';
import { pool } from '../src/modules/certificados/shared/db.helper';
import { comprobanteRepo } from '../src/modules/facturacion/comprobante.repository';
async function main(){
  const [e] = await pool().query<any[]>("SELECT id, ruc, creditos_disponibles FROM empresas WHERE plan_actual_id IS NOT NULL AND tenant_slug<>'vaxa' LIMIT 1");
  const empId=e[0].id, ruc0=e[0].ruc, saldo0=e[0].creditos_disponibles;
  await pool().query("UPDATE empresas SET ruc='20000000001' WHERE id=?", [empId]);
  try {
    const r = await comprobanteRepo.registrarVenta({ empresaId: empId, items: [
      { descripcion:'Mantenimiento Plan Básico (Mensual)', cantidad:1, precioUnitario:30, renueva:true },
      { descripcion:'Paquete 100 créditos', cantidad:1, precioUnitario:270, creditos:100 },
    ], descuento:{ tipo:'pct', valor:10 } });
    const c=r.comprobante;
    console.log(`Comprobante: ${c?.numero} · ${c?.estado_nombre}`);
    console.log(`Total: S/ ${r.total.toFixed(2)} · Descuento: S/ ${r.descuento.toFixed(2)} · Créditos agregados: ${r.creditosAgregados}`);
    console.log('Líneas:'); for(const d of (c?.detalle??[])) console.log(`  - ${d.descripcion}: ${d.cantidad} x S/${d.valor_unitario.toFixed(2)} = S/${d.valor_total.toFixed(2)}`);
    const [s]=await pool().query<any[]>("SELECT creditos_disponibles FROM empresas WHERE id=?",[empId]);
    console.log(`Saldo créditos: ${saldo0} → ${s[0].creditos_disponibles}`);
  } finally { await pool().query("UPDATE empresas SET ruc=? WHERE id=?", [ruc0, empId]); }
  process.exit(0);
}
main().catch(e=>{console.error('ERROR:',e.message); process.exit(1);});
